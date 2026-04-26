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
  fbCollection,
  fbGetDocs,
  fbGetIdToken,
  fbReauthenticate,
  fbUpdatePassword,
} from './firebase-client.js';
import { connect, triggerFeed, saveSchedules, initRoleTracking, fetchHistoryFromRTDB } from './firebase.js';
import { log } from './utils.js';
import { getBadge, spkData, spkCol, drawSpark, recordSensorReading } from './utils.js';
import { getBadgeForSpecies, recordPondSensorReading } from './pond-config.js';
import { init as initPondManagement } from './features/pond-management.js';
import { setPondList, setActivePond, getActivePond, onActivePondChange } from './pond-context.js';
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
      dashboard:              true,
      'water-quality':        true,
      'historical-data':      r === 'admin' || r === 'owner',
      feeding:                true,
      alerts:                 true,
      reports:                r === 'admin' || r === 'owner',
      configuration:          r === 'admin' || r === 'owner',
      'user-management':      r === 'admin' || r === 'owner',
      'account-profile':      true,
      'account-password':     true,
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
  const avatarBtn = document.getElementById('account-avatar-btn');
  const displayName = profile?.displayName || 'User';
  if (name) name.textContent = displayName;
  if (email) email.textContent = profile?.email || (currentUser?.email || '—');
  if (avatarBtn) avatarBtn.textContent = (displayName[0] || 'U').toUpperCase();
  if (typeof window._syncAccountPopover === 'function') window._syncAccountPopover();
}

function badgeClassFromKey(key) {
  if (key === 'ok')         return 'status-normal';
  if (key === 'acceptable') return 'status-acceptable';
  if (key === 'stress')     return 'status-stress';
  if (key === 'warn')       return 'status-warning';
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
  window._spkData = spkData; // expose for reports module
  drawSpark(key, spkData[key], spkCol[key]);
  if (b.c === 'danger') log(`${key.toUpperCase()} CRITICAL: ${val.toFixed(1)}`, 'err');
  else if (b.c === 'stress') log(`${key.toUpperCase()} STRESS RISK: ${val.toFixed(1)}`, 'warn');
  else if (b.c === 'warn') log(`${key.toUpperCase()} HIGH/POOR: ${val.toFixed(1)}`, 'warn');
  else if (b.c === 'acceptable') log(`${key.toUpperCase()} Acceptable: ${val.toFixed(1)}`, '');
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

// ── Topbar Pond Selector ──────────────────────────────────────────────────────

function setupTopbarPondSelector() {
  const select = document.getElementById('topbar-pond-select');
  if (!select) return;

  function renderOptions(ponds) {
    const current = getActivePond();
    select.innerHTML = ponds.length
      ? ponds.map(p => `<option value="${p.id}"${p.id === current?.id ? ' selected' : ''}>${p.name || p.id}</option>`).join('')
      : '<option value="">No ponds configured</option>';
  }

  // Populate when pond list is loaded
  window.addEventListener('pond-list-updated', (e) => {
    renderOptions(e.detail.ponds || []);
  });

  // Keep in sync when active pond changes externally (e.g. from Configuration page)
  window.addEventListener('active-pond-changed', (e) => {
    const pond = e.detail.pond;
    if (pond && select.value !== pond.id) select.value = pond.id;
    updateDashboardPondBadge(pond);
    // Also sync the Configuration page pond-selector
    const cfgSel = document.getElementById('pond-selector');
    if (cfgSel && pond && cfgSel.value !== pond.id && cfgSel.querySelector(`option[value="${pond.id}"]`)) {
      cfgSel.value = pond.id;
    }
  });

  // User picks a pond in the topbar
  select.addEventListener('change', () => {
    const id = select.value;
    if (!id) return;
    // Load the config first, then enrich and set — avoids "Not Configured" flash
    import('./pond-config.js').then(async ({ loadActivePondConfig }) => {
      try {
        const active = await loadActivePondConfig(id);
        const ponds  = getPondList();
        const pond   = ponds.find(p => p.id === id);
        if (pond) {
          const isConfigured = !!(active?.isActive);
          setActivePond({ ...pond, species: isConfigured ? (active.species || '') : '' });
        } else {
          setActivePond(id);
        }
      } catch {
        setActivePond(id);
      }
    });
  });
}

function updateDashboardPondBadge(pond) {
  const badge   = document.getElementById('dash-pond-badge');
  const nameEl  = document.getElementById('dash-pond-name');
  const specEl  = document.getElementById('dash-pond-species');
  if (!badge) return;
  if (!pond) { badge.style.display = 'none'; return; }
  badge.style.display = '';
  if (nameEl) nameEl.textContent = pond.name || pond.id;
  if (specEl) {
    const species = pond.species;
    if (species) {
      // Has a configured species
      specEl.textContent   = species.charAt(0).toUpperCase() + species.slice(1);
      specEl.style.display = '';
      specEl.className     = 'species-chip';
    } else if (species === null) {
      // Explicitly marked as unconfigured by _propagatePondState
      specEl.textContent   = 'Not Configured';
      specEl.style.display = '';
      specEl.className     = 'species-chip species-chip--unconfigured';
    } else {
      // species is undefined or '' — config not yet loaded, hide chip
      specEl.style.display = 'none';
    }
  }
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
    onSensorData: (ph, doV, turb, temp, ts) => {
      updateCard('ph', ph);
      updateCard('do', doV);
      updateCard('turb', turb);
      updateCard('temp', temp);
      pushChart(ph, doV, turb, temp);
      recordSensorReading(ph, doV, turb, temp, ts);
      recordPondSensorReading(ph, doV, turb, temp).catch(() => {/* offline */});
      window.dispatchEvent(new CustomEvent('sensor-reading-recorded'));
      window.dispatchEvent(new CustomEvent('sensor-data-updated', { detail: { ph, doV, turb, temp, ts } }));
    },
    enableFeedBtn,
  });
}

window.connectFirebase = connectFirebase;
window.triggerFeed = () => triggerFeed(deviceId);
window.saveSchedules = () => saveSchedules(deviceId);
window.fetchHistoryFromRTDB = (fromMs, toMs) => fetchHistoryFromRTDB(deviceId, fromMs, toMs);

// ── Account Menu ─────────────────────────────────────────────────────────────

function setupAccountMenu() {
  const avatarBtn = document.getElementById('account-avatar-btn');
  const dropdown  = document.getElementById('account-dropdown');
  if (!avatarBtn || !dropdown) return;

  // ── Popover toggle ────────────────────────────────────────────────────────
  const openDropdown = () => {
    const rect = avatarBtn.getBoundingClientRect();
    // Reveal off-screen first so we can measure height
    dropdown.style.visibility = 'hidden';
    dropdown.hidden = false;
    const popH = dropdown.offsetHeight;
    const popW = dropdown.offsetWidth;
    dropdown.style.visibility = '';
    // Prefer above the avatar; fall back to below if not enough room
    const spaceAbove = rect.top - 8;
    const top = spaceAbove >= popH ? rect.top - popH - 8 : rect.bottom + 8;
    // Align left edge with avatar, clamp to viewport
    const left = Math.min(rect.left, window.innerWidth - popW - 8);
    dropdown.style.left = left + 'px';
    dropdown.style.top  = top + 'px';
    avatarBtn.setAttribute('aria-expanded', 'true');
    dropdown.querySelector('.account-popover-item')?.focus();
  };
  const closeDropdown = () => {
    dropdown.hidden = true;
    avatarBtn.setAttribute('aria-expanded', 'false');
  };

  avatarBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.hidden ? openDropdown() : closeDropdown();
  });
  avatarBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dropdown.hidden ? openDropdown() : closeDropdown(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); openDropdown(); }
  });
  document.addEventListener('click', (e) => {
    if (!dropdown.hidden && !dropdown.contains(e.target) && e.target !== avatarBtn) closeDropdown();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDropdown();
  });

  // ── Navigate to a page (reuses the existing nav system) ──────────────────
  function navigateTo(pageId, titleText) {
    closeDropdown();
    document.querySelectorAll('.sidebar-nav a').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.page-section').forEach((s) => s.classList.remove('active'));
    const el = document.getElementById(pageId);
    if (el) el.classList.add('active');
    const titleEl = document.getElementById('topbar-page-title');
    if (titleEl) titleEl.textContent = titleText;
    document.body.classList.remove('sidebar-open');
  }

  document.getElementById('acct-profile-btn')?.addEventListener('click', () => {
    navigateTo('page-account-profile', 'My Profile');
    populateProfilePage();
  });
  document.getElementById('acct-password-btn')?.addEventListener('click', () => {
    navigateTo('page-account-password', 'Change Password');
    resetPasswordPage();
  });

  // ── Edit Profile (inline on the profile page) ─────────────────────────────
  document.getElementById('btn-edit-profile')?.addEventListener('click', () => {
    openEditProfileDialog();
  });

  // ── Profile page population ───────────────────────────────────────────────
  function populateProfilePage() {
    const p = currentProfile || {};
    const name = p.displayName || currentUser?.email?.split('@')[0] || 'User';
    const role = p.role || 'farmer';
    const ROLE_LABEL = { admin: 'Admin', owner: 'Owner', farmer: 'Farmer' };
    const avatarLetter = (s) => (String(s || '').trim()[0] || 'U').toUpperCase();

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('fp-avatar-letter', avatarLetter(name));
    set('fp-display-name', name);

    // Sync popover header too
    set('acct-pop-avatar', avatarLetter(name));
    set('acct-pop-name', name);
    set('acct-pop-email', p.email || currentUser?.email || '—');

    const badge = document.getElementById('fp-role-badge');
    if (badge) {
      badge.textContent = ROLE_LABEL[role] || role;
      badge.className = `um-role-badge um-role-${role}`;
    }

    set('user-email', p.email || currentUser?.email || '—');
    set('user-phone', p.phone || '—');

    const memberSince = document.getElementById('fp-member-since');
    if (memberSince) {
      try {
        const d = p.createdAt?.toDate ? p.createdAt.toDate() : null;
        memberSince.textContent = d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
      } catch { memberSince.textContent = '—'; }
    }

    // Load farm data
    if (typeof window._farmProfileOnUser === 'function' && currentUser) {
      window._farmProfileOnUser(currentUser);
    }
  }

  function openEditProfileDialog() {
    const p = currentProfile || {};
    const esc = (s) => String(s || '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
    const dlg = document.createElement('dialog');
    dlg.className = 'um-modal';
    dlg.innerHTML = `
      <div class="um-modal-inner">
        <div class="um-modal-head">
          <div>
            <div class="um-modal-title">Edit Profile</div>
            <div class="um-modal-sub">Update your display name and phone number.</div>
          </div>
          <button class="um-modal-close" aria-label="Close" id="ep-x">
            <svg class="icon icon-16"><use href="#icon-x"/></svg>
          </button>
        </div>
        <div class="um-form-grid">
          <div class="um-field">
            <label>Display Name</label>
            <input id="ep-name" type="text" value="${esc(p.displayName)}" placeholder="Your name" />
          </div>
          <div class="um-field">
            <label>Phone Number</label>
            <input id="ep-phone" type="tel" value="${esc(p.phone)}" placeholder="+1 555 000 0000" />
          </div>
        </div>
        <div id="ep-error" style="color:var(--red-dark,#ef4444);font-size:0.8rem;margin-bottom:8px;display:none;"></div>
        <div class="um-modal-footer">
          <button type="button" class="btn btn-outline" id="ep-cancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="ep-save">Save Changes</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    dlg.showModal();

    const close = () => { dlg.close(); setTimeout(() => dlg.remove(), 0); };
    dlg.querySelector('#ep-x')?.addEventListener('click', close);
    dlg.querySelector('#ep-cancel')?.addEventListener('click', close);
    dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));

    dlg.querySelector('#ep-save')?.addEventListener('click', async () => {
      const errEl  = dlg.querySelector('#ep-error');
      const saveBtn = dlg.querySelector('#ep-save');
      const name  = (dlg.querySelector('#ep-name')?.value || '').trim();
      const phone = (dlg.querySelector('#ep-phone')?.value || '').trim();
      if (!name) { errEl.textContent = 'Display name is required.'; errEl.style.display = 'block'; return; }
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      try {
        const token = await fbGetIdToken();
        const resp = await fetch('/api/users/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ displayName: name, phone }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Save failed.');
        if (currentProfile) { currentProfile.displayName = name; currentProfile.phone = phone; }
        renderSidebarUser(currentProfile);
        populateProfilePage();
        close();
      } catch (e) {
        errEl.textContent = 'Save failed: ' + (e?.message || String(e));
        errEl.style.display = 'block';
        saveBtn.disabled = false; saveBtn.textContent = 'Save Changes';
      }
    });
  }

  // ── Password page ─────────────────────────────────────────────────────────
  function resetPasswordPage() {
    ['acct-pw-current','acct-pw-new','acct-pw-confirm'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const errEl = document.getElementById('acct-pw-error');
    const okEl  = document.getElementById('acct-pw-success');
    if (errEl) errEl.style.display = 'none';
    if (okEl)  okEl.style.display  = 'none';
    updatePasswordRules('');
  }

  const PW_RULES = [
    { id: 'rule-length', test: (p) => p.length >= 8 },
    { id: 'rule-upper',  test: (p) => /[A-Z]/.test(p) },
    { id: 'rule-lower',  test: (p) => /[a-z]/.test(p) },
    { id: 'rule-number', test: (p) => /\d/.test(p) },
  ];

  function updatePasswordRules(pw) {
    PW_RULES.forEach(({ id, test }) => {
      document.getElementById(id)?.classList.toggle('rule-ok', test(pw));
    });
  }

  document.getElementById('acct-pw-new')?.addEventListener('input', (e) => {
    updatePasswordRules(e.target.value);
  });

  document.getElementById('acct-pw-save')?.addEventListener('click', async () => {
    const errEl  = document.getElementById('acct-pw-error');
    const okEl   = document.getElementById('acct-pw-success');
    const saveBtn = document.getElementById('acct-pw-save');
    const current = document.getElementById('acct-pw-current')?.value || '';
    const newPw   = document.getElementById('acct-pw-new')?.value || '';
    const confirm = document.getElementById('acct-pw-confirm')?.value || '';

    if (errEl) errEl.style.display = 'none';
    if (okEl)  okEl.style.display  = 'none';

    if (!current) {
      if (errEl) { errEl.textContent = 'Enter your current password.'; errEl.style.display = 'block'; }
      return;
    }
    if (!PW_RULES.every(({ test }) => test(newPw))) {
      if (errEl) { errEl.textContent = 'New password does not meet all requirements.'; errEl.style.display = 'block'; }
      return;
    }
    if (newPw !== confirm) {
      if (errEl) { errEl.textContent = 'Passwords do not match.'; errEl.style.display = 'block'; }
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Updating…';
    try {
      await fbReauthenticate(current);
      await fbUpdatePassword(newPw);
      resetPasswordPage();
      if (okEl) okEl.style.display = 'block';
    } catch (e) {
      let msg = e?.message || 'Password update failed.';
      const code = e?.code || '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') msg = 'Current password is incorrect.';
      else if (code === 'auth/too-many-requests') msg = 'Too many attempts. Try again later.';
      if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Update Password';
    }
  });

  // ── Sync popover header on auth ───────────────────────────────────────────
  window._syncAccountPopover = () => {
    const p = currentProfile || {};
    const name = p.displayName || currentUser?.email?.split('@')[0] || 'User';
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('acct-pop-avatar', (name[0] || 'U').toUpperCase());
    set('acct-pop-name', name);
    set('acct-pop-email', p.email || currentUser?.email || '—');
  };
}

// ─────────────────────────────────────────────────────────────────────────────

function init() {
  setupNavigation();
  setupHamburger();
  setupClock();
  setupAccountMenu();
  setupTopbarPondSelector();
  initDashboard();
  initWaterQuality();
  initHistoricalData();
  initFeeding();
  initAlerts();
  initFarmProfile();
  initReports();
  initConfiguration();
  initUserManagement();
  initPondManagement();

  // Register species-aware badge classifier
  window._pondGetBadge = getBadgeForSpecies;

  // Expose pond context globally so pond-management and other modules can update it
  window._pondContext = { setPondList, setActivePond, getActivePond };

  // pond-management loads via window._pondMgmtOnUser after auth confirms

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

      // Load ponds now that we have a valid auth token
      if (typeof window._pondMgmtOnUser === 'function') {
        window._pondMgmtOnUser().catch(() => {/* offline */});
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
