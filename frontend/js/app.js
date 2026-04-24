/**
 * App entry: navigation, clock, config, Firebase wiring, and feature inits.
 */
import { getConfig } from './config.js';
import {
  initFirebase,
  fbOnAuthStateChanged,
  fbSignIn,
  fbSignOut,
  fbDoc,
  fbGetDoc,
  fbSetDoc,
  fbServerTimestamp,
  fbFirestore,
} from './firebase-client.js';
import { connect, triggerFeed, saveSchedules, initRoleTracking } from './firebase.js';
import { log } from './utils.js';
import { getBadge, spkData, spkCol, drawSpark } from './utils.js';
import { pushChart } from './charts.js';
import { init as initDashboard } from './features/dashboard.js';
import { init as initWaterQuality } from './features/water-quality.js';
import { init as initHistoricalData } from './features/historical-data.js';
import { init as initFeeding } from './features/feeding.js';
import { init as initAlerts } from './features/alerts.js';
import { init as initFarmProfile } from './features/farm-profile.js';
import { init as initReports } from './features/reports.js';
import { init as initConfiguration } from './features/configuration.js';
import { init as initUserManagement, loadUsers, setCurrentUser } from './features/user-management.js';

let deviceId = 'device001';
let connectStarted = false;
let firebaseDatabaseUrl = '';
let currentUser = null;
let currentProfile = null;

const STORAGE_FB_URL = 'aquasense.fbUrl.v1';
const STORAGE_AUTO_CONNECT = 'aquasense.autoConnect.v1';

function showAuthScreen(on) {
  const auth = document.getElementById('auth-screen');
  const main = document.querySelector('.main-wrap');
  if (auth) auth.style.display = on ? 'flex' : 'none';
  if (main) main.style.display = on ? 'none' : '';
}

function setAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (!el) return;
  if (!msg) {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  el.style.display = 'block';
  el.textContent = msg;
}

/**
 * RBAC Role Definitions:
 *   admin  — super admin, full access to all features and roles
 *   owner  — operational + management: historical data, user creation, feeding config,
 *             reports, system logs (no role management of admins)
 *   farmer — limited operational: dashboard, manual feed, feeding logs, alerts
 */

// Canonical role values stored in Firestore
const VALID_ROLES = new Set(['admin', 'owner', 'farmer']);

function normalizeRole(role) {
  const r = String(role || '').toLowerCase();
  // Legacy aliases: manager → owner, viewer → farmer
  if (r === 'manager') return 'owner';
  if (r === 'viewer') return 'farmer';
  if (VALID_ROLES.has(r)) return r;
  return 'farmer';
}

/**
 * Returns a permission set for the given role.
 * Centralised here so all guards derive from one source of truth.
 */
function getPermissions(role) {
  const r = normalizeRole(role);
  return {
    // Pages visible in sidebar
    pages: {
      dashboard:         true,
      'water-quality':   true,                             // all roles can view water quality
      'historical-data': r === 'admin' || r === 'owner',
      feeding:           true,                             // farmers see feeding logs; controls gated separately
      alerts:            true,
      'farm-profile':    true,                             // all roles can manage their own profile
      reports:           r === 'admin' || r === 'owner',
      configuration:     r === 'admin' || r === 'owner',
      'user-management': r === 'admin' || r === 'owner',
    },
    // Fine-grained action permissions
    canTriggerFeed:      true,                             // all roles can trigger manual feed
    canEditSchedules:    r === 'admin' || r === 'owner',
    canEditThresholds:   r === 'admin' || r === 'owner',
    canEditConfig:       r === 'admin' || r === 'owner',
    canViewReports:      r === 'admin' || r === 'owner',
    canDownloadReports:  r === 'admin' || r === 'owner',
    canManageUsers:      r === 'admin' || r === 'owner',
    canDeleteUsers:      r === 'admin',
    canAssignAdminRole:  r === 'admin',
    canViewLogs:         r === 'admin' || r === 'owner',
    isAdmin:             r === 'admin',
    isOwner:             r === 'owner',
    isFarmer:            r === 'farmer',
    role:                r,
  };
}

// Expose permissions globally so feature modules can import them
window.getPermissions = getPermissions;
window.normalizeRole  = normalizeRole;

function applyRoleGuards(role) {
  const perms = getPermissions(role);

  // Sidebar navigation visibility
  document.querySelectorAll('.sidebar-nav a[data-page]').forEach((a) => {
    const page = a.getAttribute('data-page');
    const allowed = perms.pages[page] !== false;
    a.classList.toggle('nav-disabled', !allowed);
    a.setAttribute('aria-disabled', allowed ? 'false' : 'true');
    a.style.display = allowed ? '' : 'none';
    a.addEventListener(
      'click',
      (e) => {
        if (!allowed) {
          e.preventDefault();
          log('Access denied: your role does not have permission for this section.', 'warn');
        }
      },
      { once: true },
    );
  });

  // Feed button — all roles can trigger manual feed
  const feedBtn = document.getElementById('feed-btn');
  const feedNote = document.getElementById('feed-note-txt');
  if (feedBtn) {
    feedBtn.disabled = false;
    if (feedNote) feedNote.textContent = 'Firebase connected — button locks until ESP32 confirms';
  }

  // Schedule save button — owner/admin only
  const saveSchedBtn = document.getElementById('btn-save-schedules');
  if (saveSchedBtn) {
    saveSchedBtn.disabled = !perms.canEditSchedules;
    if (!perms.canEditSchedules) saveSchedBtn.title = 'Owner/Admin required to save schedules';
  }

  // Configuration save — owner/admin only
  const cfgSaveBtn = document.getElementById('cfg-save');
  if (cfgSaveBtn) {
    cfgSaveBtn.disabled = !perms.canEditConfig;
    if (!perms.canEditConfig) cfgSaveBtn.title = 'Owner/Admin required to change configuration';
  }

  // Threshold edit button — owner/admin only
  const threshBtn = document.getElementById('btn-edit-thresholds');
  if (threshBtn) {
    threshBtn.disabled = !perms.canEditThresholds;
    if (!perms.canEditThresholds) threshBtn.title = 'Owner/Admin required to edit thresholds';
  }

  // Report download buttons — owner/admin only
  if (!perms.canDownloadReports) {
    document.querySelectorAll('[data-report-format]').forEach((btn) => {
      btn.disabled = true;
      btn.title = 'Owner/Admin required to download reports';
    });
    const genBtn = document.getElementById('btn-custom-generate');
    if (genBtn) { genBtn.disabled = true; genBtn.title = 'Owner/Admin required'; }
  }

  // Expose current permissions on window for feature modules
  window._rbacPerms = perms;
}

async function ensureUserProfile(user) {
  const fs = fbFirestore();
  const userRef = fbDoc(fs, 'users', user.uid);
  const snap = await fbGetDoc(userRef);
  if (snap.exists()) {
    const data = snap.data();
    // Migrate legacy role names on read
    const rawRole = String(data?.role || '').toLowerCase();
    if (rawRole === 'manager') data.role = 'owner';
    else if (rawRole === 'viewer') data.role = 'farmer';
    return { id: snap.id, ...data };
  }

  const next = {
    email: user.email || '',
    displayName: user.displayName || (user.email ? user.email.split('@')[0] : 'User'),
    phone: '',
    role: 'farmer',
    farmId: '',
    status: 'active',
    createdAt: fbServerTimestamp(),
    lastLoginAt: fbServerTimestamp(),
  };
  await fbSetDoc(userRef, next, { merge: true });
  return next;
}

function renderSidebarUser(profile) {
  const name = document.getElementById('sb-user-name');
  const email = document.getElementById('sb-user-email');
  if (name) name.textContent = profile?.displayName || 'User';
  if (email) email.textContent = profile?.email || (currentUser?.email || '—');
}

function badgeClassFromKey(key) {
  if (key === 'ok') return 'status-normal';
  if (key === 'warn') return 'status-warning';
  return 'status-critical';
}

function formatSensorValue(key, val) {
  if (key === 'temp') return `${val.toFixed(1)}°C`;
  if (key === 'do') return `${val.toFixed(1)} mg/L`;
  if (key === 'turb') return `${val.toFixed(1)} NTU`;
  return val.toFixed(1);
}

function setStatus(lbl, online) {
  const lblEl = document.getElementById('fb-lbl');
  if (lblEl) {
    lblEl.textContent = lbl;
    lblEl.className = 'status-chip ' + (online ? 'online' : 'offline');
  }
  const d = document.getElementById('feed-dot');
  if (d) d.className = 'dot' + (online ? '' : ' off');
}

function enableFeedBtn(on) {
  const btn = document.getElementById('feed-btn');
  const dot = document.getElementById('feed-dot');
  const note = document.getElementById('feed-note-txt');
  if (btn) btn.disabled = !on;
  if (dot) dot.className = 'dot' + (on ? '' : ' off');
  if (note) note.textContent = on ? 'Firebase connected — button locks until ESP32 confirms' : 'Connect to Firebase to enable feed button';
}

/** Used by firebase when sensor data arrives. */
export function updateCard(key, val) {
  const el = document.getElementById('v-' + key);
  const bd = document.getElementById('b-' + key);
  if (!el) return;
  el.textContent = val.toFixed(1);
  // Subtle flash on update
  el.classList.remove('value-updated');
  void el.offsetWidth; // reflow to restart animation
  el.classList.add('value-updated');
  const b = getBadge(key, val);
  if (bd) {
    bd.className = 'scard-badge ' + b.c;
    bd.textContent = b.l;
  }
  spkData[key].push(val);
  if (spkData[key].length > 30) spkData[key].shift();
  drawSpark(key, spkData[key], spkCol[key]);
  if (b.c === 'danger') log(`${key.toUpperCase()} CRITICAL: ${val.toFixed(1)}`, 'err');
  else if (b.c === 'warn') log(`${key.toUpperCase()} WARNING: ${val.toFixed(1)}`, 'warn');
  const wqPh = document.getElementById('wq-avg-ph');
  const wqTemp = document.getElementById('wq-avg-temp');
  const wqDo = document.getElementById('wq-avg-do');
  const wqTurb = document.getElementById('wq-avg-turb');
  if (key === 'ph' && wqPh) wqPh.textContent = val.toFixed(1);
  if (key === 'temp' && wqTemp) wqTemp.textContent = val.toFixed(1) + '°C';
  if (key === 'do' && wqDo) wqDo.textContent = val.toFixed(1) + ' mg/L';
  if (key === 'turb' && wqTurb) wqTurb.textContent = val.toFixed(1) + ' NTU';

  // Water Quality (Pond 1) live values + badges
  const pondVal = document.getElementById('wq-pond-' + key);
  if (pondVal) pondVal.textContent = formatSensorValue(key, val);
  const pondBadge = document.getElementById('wq-pond-b-' + key);
  if (pondBadge) {
    pondBadge.textContent = b.l;
    pondBadge.className = `badge-pill ${badgeClassFromKey(b.c)}`;
  }
}

function setupNavigation() {
  document.querySelectorAll('.sidebar-nav a[data-page]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const page = a.getAttribute('data-page');
      document.querySelectorAll('.sidebar-nav a').forEach((x) => x.classList.remove('active'));
      a.classList.add('active');
      document.querySelectorAll('.page-section').forEach((s) => s.classList.remove('active'));
      const el = document.getElementById('page-' + page);
      if (el) el.classList.add('active');

      // Reload users when navigating to user management
      if (page === 'user-management') loadUsers();

      // Update topbar page title
      const titleEl = document.getElementById('topbar-page-title');
      if (titleEl) titleEl.textContent = a.querySelector('span:not(.nav-icon)')?.textContent?.trim() || '';

      // Close mobile nav after navigation
      document.body.classList.remove('sidebar-open');
    });
  });
}

function setupHamburger() {
  const btn = document.getElementById('nav-toggle');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!btn || !backdrop) return;

  const close = () => document.body.classList.remove('sidebar-open');
  const toggle = () => document.body.classList.toggle('sidebar-open');

  btn.addEventListener('click', toggle);
  backdrop.addEventListener('click', close);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

function setupClock() {
  setInterval(() => {
    const el = document.getElementById('hclock');
    if (el) el.textContent = new Date().toTimeString().split(' ')[0];
  }, 1000);
}

async function loadConfigAndPrefill() {
  const config = await getConfig();
  const input = document.getElementById('fb-url');
  if (config.firebaseDatabaseUrl) {
    firebaseDatabaseUrl = config.firebaseDatabaseUrl;
    if (input) input.value = config.firebaseDatabaseUrl;
    try {
      localStorage.setItem(STORAGE_FB_URL, config.firebaseDatabaseUrl);
    } catch {
      // ignore
    }
  }
  if (config.deviceId) deviceId = config.deviceId;

  if (config.firebase && (config.firebase.apiKey || config.firebase.projectId || config.firebase.databaseURL)) {
    initFirebase(config.firebase);
    initRoleTracking();
    if (!firebaseDatabaseUrl) firebaseDatabaseUrl = config.firebase.databaseURL || '';
  }

  // Fallback: if backend isn't running, use last saved URL (if any)
  if (input && !input.value) {
    try {
      const saved = localStorage.getItem(STORAGE_FB_URL);
      if (saved) input.value = saved;
    } catch {
      // ignore
    }
  }

  return !!config.firebaseDatabaseUrl;
}

function connectFirebase() {
  if (connectStarted) return;
  if (!currentUser) {
    log('Please sign in first.', 'warn');
    showAuthScreen(true);
    return;
  }
  const input = document.getElementById('fb-url');
  const url = input ? input.value.trim() : '';
  if (!url) {
    alert('Enter Firebase URL or set FIREBASE_DATABASE_URL in .env and run the backend.');
    return;
  }
  connectStarted = true;
  try {
    localStorage.setItem(STORAGE_FB_URL, url);
    localStorage.setItem(STORAGE_AUTO_CONNECT, 'true');
  } catch {
    // ignore
  }
  connect(url, deviceId, {
    onStatus: setStatus,
    onSensorData: (ph, doV, turb, temp) => {
      updateCard('ph', ph);
      updateCard('do', doV);
      updateCard('turb', turb);
      updateCard('temp', temp);
      pushChart(ph, doV, turb, temp);
    },
    enableFeedBtn,
  });
}

window.connectFirebase = connectFirebase;
window.triggerFeed = () => triggerFeed(deviceId);
window.saveSchedules = () => saveSchedules(deviceId);

function init() {
  setupNavigation();
  setupHamburger();
  setupClock();
  initDashboard();
  initWaterQuality();
  initHistoricalData();
  initFeeding();
  initAlerts();
  initFarmProfile();
  initReports();
  initConfiguration();
  initUserManagement();

  // Re-evaluate sensor badges whenever thresholds change
  window.addEventListener('thresholds-changed', () => {
    for (const key of ['ph', 'do', 'turb', 'temp']) {
      const el = document.getElementById('v-' + key);
      if (!el || el.textContent === '—') continue;
      const val = parseFloat(el.textContent);
      if (!Number.isFinite(val)) continue;
      updateCard(key, val);
    }
  });

  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    try {
      await fbSignOut();
    } catch (e) {
      log('Logout failed: ' + (e?.message || String(e)), 'err');
    }
  });

  // Load config first so Firebase is initialized before we wire up sign-in
  loadConfigAndPrefill().then((hasUrl) => {
    setStatus('OFFLINE', false);

    // Wire sign-in AFTER Firebase is initialized
    const btnSignIn = document.getElementById('auth-signin');
    const doSignIn = async () => {
      setAuthError('');
      const email = (document.getElementById('auth-email')?.value || '').trim();
      const password = document.getElementById('auth-password')?.value || '';
      if (!email || !password) {
        setAuthError('Enter email and password.');
        return;
      }
      btnSignIn.disabled = true;
      btnSignIn.textContent = 'Signing in…';
      try {
        await fbSignIn(email, password);
      } catch (e) {
        console.error('[Auth] Sign-in error:', e);
        let msg;
        const code = e?.code || '';
        if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
          msg = 'Invalid email or password. Please try again.';
        } else if (code === 'auth/too-many-requests') {
          msg = 'Too many failed attempts. Try again later.';
        } else if (code === 'auth/network-request-failed') {
          msg = 'Network error. Check your connection.';
        } else if (code === 'auth/operation-not-allowed') {
          msg = 'Email/password sign-in is not enabled in Firebase Console.';
        } else {
          msg = e?.message || 'Sign in failed. Check console for details.';
        }
        setAuthError(msg);
      } finally {
        btnSignIn.disabled = false;
        btnSignIn.textContent = 'Sign in';
      }
    };
    btnSignIn?.addEventListener('click', doSignIn);
    document.getElementById('auth-password')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSignIn();
    });
    document.getElementById('auth-email')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('auth-password')?.focus();
    });

    fbOnAuthStateChanged(async (user) => {
      currentUser = user || null;
      connectStarted = false;

      if (!user) {
        currentProfile = null;
        renderSidebarUser(null);
        showAuthScreen(true);
        enableFeedBtn(false);
        return;
      }

      showAuthScreen(false);

      try {
        currentProfile = await ensureUserProfile(user);
        currentProfile.role = normalizeRole(currentProfile.role);
        renderSidebarUser(currentProfile);
        applyRoleGuards(currentProfile.role);
      } catch (e) {
        log('Profile load failed: ' + (e?.message || String(e)), 'err');
      }

      // Notify farm-profile feature that a user is signed in
      if (typeof window._farmProfileOnUser === 'function') {
        window._farmProfileOnUser(user);
      }

      // Set current user context for user management and load users list
      setCurrentUser(user.uid, currentProfile?.role || 'farmer');
      const perms = getPermissions(currentProfile?.role || 'farmer');
      if (perms.canManageUsers) {
        loadUsers();
      }

      const input = document.getElementById('fb-url');
      const url = input ? input.value.trim() : (firebaseDatabaseUrl || '');
      if (url) {
        log('Connecting to telemetry…');
        connectFirebase();
      } else {
        log('Set Firebase URL in backend config, then connect.', 'warn');
      }
    });
  }).catch((err) => {
    console.error('[Init] Failed to load config:', err);
    setAuthError('Failed to load app configuration. Is the backend running?');
  });
}

init();
