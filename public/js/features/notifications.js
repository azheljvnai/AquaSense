/**
 * NotificationService — email notifications via EmailJS.
 *
 * Public API:
 *   init(user)                          — called after auth
 *   loadPrefs(uid)                      — read Firestore prefs
 *   savePrefs(uid, prefs)               — validate + write via API
 *   refreshNotificationPrefsUi()        — re-sync toggles after profile change
 *   handleAlert(alert)                  — orchestrate dispatch
 */
import {
  fbFirestore,
  fbDoc,
  fbGetDoc,
  fbGetIdToken,
} from '../firebase-client.js';
import { getConfig } from '../config.js';
import { showAppToast } from '../ui/modal-ui.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const RETRY_QUEUE_KEY   = 'aquasense.notif.retryQueue.v1';
const MAX_ATTEMPTS      = 3;
const RETRY_INTERVAL_MS = 60 * 1000;               // 60 seconds

// ─── Module State ─────────────────────────────────────────────────────────────

let _currentUser                 = null;
let _emailjsPublicKey            = '';
let _emailjsServiceId            = '';
let _emailjsTemplateId           = '';
let _emailNotificationsAvailable = false;
let _prefsUiBound                = false;
let _prefsUiUser                 = null;
let _syncSmsUiState              = null;
let _persistPrefs                = null;

// ─── Exported: init ───────────────────────────────────────────────────────────

/**
 * Called once after the user authenticates.
 * Loads config, initialises EmailJS, wires up the prefs UI and the offline
 * retry flush.
 */
export async function init(user) {
  _currentUser = user;

  try {
    const cfg = await getConfig();
    _emailjsPublicKey  = cfg.emailjsPublicKey  || '';
    _emailjsServiceId  = cfg.emailjsServiceId  || '';
    _emailjsTemplateId = cfg.emailjsTemplateId || '';
    _emailNotificationsAvailable = cfg.emailNotificationsAvailable === true
      || !!(_emailjsPublicKey && _emailjsServiceId && _emailjsTemplateId);

    if (_emailjsPublicKey && typeof emailjs !== 'undefined') {
      emailjs.init(_emailjsPublicKey);
    }
  } catch (err) {
    console.warn('[NotificationService] Failed to load config:', err);
  }

  initPrefsUI(user);

  // Wire offline retry flush (once per page load)
  if (!window._notifOnlineBound) {
    window._notifOnlineBound = true;
    window.addEventListener('online', () => {
      flushRetryQueue().catch(err =>
        console.warn('[NotificationService] flushRetryQueue error:', err)
      );
    });
  }
}

// ─── Exported: loadPrefs ──────────────────────────────────────────────────────

/**
 * Reads `users/{uid}/notificationPrefs` from Firestore.
 * Returns a default prefs object if the document does not exist.
 */
export async function loadPrefs(uid) {
  const defaultPrefs = { email: { enabled: false, address: '' }, sms: { enabled: false } };
  if (!uid) return defaultPrefs;
  try {
    const ref  = fbDoc(fbFirestore(), 'users', uid, 'notificationPrefs', 'settings');
    const snap = await fbGetDoc(ref);
    if (!snap.exists()) return defaultPrefs;
    const data = snap.data();
    return {
      email: {
        enabled: typeof data?.email?.enabled === 'boolean' ? data.email.enabled : false,
        address: data?.email?.address || '',
      },
      sms: {
        enabled: typeof data?.sms?.enabled === 'boolean' ? data.sms.enabled : false,
      },
    };
  } catch (err) {
    console.warn('[NotificationService] loadPrefs error:', err);
    return defaultPrefs;
  }
}

// ─── Exported: savePrefs ─────────────────────────────────────────────────────

/**
 * Validates the email address when `email.enabled` is true, then persists via
 * PATCH /api/users/me (Admin SDK on server).
 * Throws if the email address is invalid or the API call fails.
 */
export async function savePrefs(uid, prefs) {
  if (!uid) throw new Error('No user ID provided.');

  if (prefs?.email?.enabled) {
    if (!isValidEmail(prefs.email.address)) {
      throw new Error('Invalid email address.');
    }
  }

  const token = await fbGetIdToken();
  const resp = await fetch('/api/users/me', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ notificationPrefs: prefs }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error || `HTTP ${resp.status}`);
  }
}

// ─── Exported: refreshNotificationPrefsUi ────────────────────────────────────

/** Re-load prefs and SMS phone state (e.g. after profile phone update). */
export async function refreshNotificationPrefsUi() {
  const user = _prefsUiUser || _currentUser;
  if (!user?.uid) return;

  applyEmailToggleAvailability();

  try {
    const prefs = await loadPrefs(user.uid);
    const toggle = document.getElementById('notif-email-toggle');
    const address = document.getElementById('notif-email-address');
    const smsToggle = document.getElementById('notif-sms-toggle');
    if (toggle) toggle.checked = !!prefs?.email?.enabled;
    if (address) address.value = prefs?.email?.address || user.email || '';
    if (smsToggle) smsToggle.checked = !!prefs?.sms?.enabled;
  } catch {
    // ignore
  }

  if (typeof _syncSmsUiState === 'function') {
    await _syncSmsUiState().catch(() => {/* ignore */});
  }
}

// ─── Exported: handleAlert ────────────────────────────────────────────────────

/**
 * Fan-out to all active users runs on the server (Firebase Admin); this calls
 * POST /api/notifications/dispatch-alert. If offline, enqueues alert for retry.
 */
/**
 * Dispatch one combined email/SMS for multiple alerts (single API call).
 */
export async function handleAlerts(alerts) {
  const list = Array.isArray(alerts) ? alerts.filter((a) => a && a.key && !a.resolved) : [];
  if (!list.length) return;

  console.log('[NotificationService] handleAlerts batch:', list.map((a) => a.key).join(', '));

  if (!navigator.onLine) {
    for (const alert of list) enqueueRetry(alert);
    return;
  }

  try {
    const data = await dispatchAlertViaApi(list);
    if (data?.errors?.length && _currentUser?.uid) {
      const mine = data.errors.filter((e) => e.uid === _currentUser.uid);
      if (mine.length) {
        const detail = mine.map((e) => `${e.channel}: ${e.message}`).join('; ');
        showAppToast(`Notification failed: ${detail}`, 'error');
      }
    }
  } catch (err) {
    console.error('[NotificationService] dispatch-alert failed:', err);
    if (_currentUser?.uid) {
      showAppToast(`Notifications could not be sent: ${err?.message || String(err)}`, 'error');
    }
  }
}

export async function handleAlert(alert) {
  // 1. Skip resolved alerts
  if (alert?.resolved) {
    console.log('[NotificationService] Skipping resolved alert:', alert?.id);
    return;
  }

  // 2. Skip null/undefined alerts
  if (!alert || !alert.key) {
    console.warn('[NotificationService] handleAlert called with invalid alert:', alert);
    return;
  }

  return handleAlerts([alert]);
}

async function dispatchAlertViaApi(alertOrAlerts) {
  const token = await fbGetIdToken();
  const alerts = Array.isArray(alertOrAlerts) ? alertOrAlerts : [alertOrAlerts];
  const body = alerts.length === 1 ? { alert: alerts[0] } : { alerts };
  const resp = await fetch('/api/notifications/dispatch-alert', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data?.error || `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return data;
}

function applyEmailToggleAvailability() {
  const toggle = document.getElementById('notif-email-toggle');
  const warning = document.getElementById('notif-config-warning');
  const emailAvailable = _emailNotificationsAvailable || !!_emailjsPublicKey;

  if (warning) warning.classList.toggle('is-hidden', emailAvailable);
  if (toggle) toggle.disabled = !emailAvailable;
}

function initPrefsUI(user) {
  if (_prefsUiBound && _prefsUiUser?.uid === user?.uid) {
    refreshNotificationPrefsUi().catch(() => {/* ignore */});
    return;
  }

  const toggle   = document.getElementById('notif-email-toggle');
  const address  = document.getElementById('notif-email-address');
  const saveBtn  = document.getElementById('notif-prefs-save');
  const smsToggle = document.getElementById('notif-sms-toggle');
  const smsWarning = document.getElementById('notif-sms-warning');

  applyEmailToggleAvailability();

  if (!user?.uid) return;

  _prefsUiUser = user;

  // Load prefs and populate state
  loadPrefs(user.uid).then(prefs => {
    if (toggle)  toggle.checked  = !!prefs?.email?.enabled;
    if (address) address.value = prefs?.email?.address || user.email || '';
    if (smsToggle) smsToggle.checked = !!prefs?.sms?.enabled;
  }).catch(() => {
    if (address && !address.value && user.email) address.value = user.email;
  });

  async function syncSmsUiState() {
    const phone = await getUserPhone(user.uid).catch(() => '');
    const hasPhone = !!String(phone || '').trim();
    if (smsWarning) smsWarning.classList.toggle('is-hidden', hasPhone);
    if (smsToggle) smsToggle.disabled = !hasPhone;
    if (smsToggle && !hasPhone) smsToggle.checked = false;
    return hasPhone;
  }

  _syncSmsUiState = syncSmsUiState;

  async function persist() {
    await syncSmsUiState();

    const prefs = {
      email: {
        enabled: toggle ? toggle.checked : false,
        address: user.email || (address ? address.value.trim() : ''),
      },
      sms: {
        enabled: smsToggle ? smsToggle.checked : false,
      },
    };
    try {
      await savePrefs(user.uid, prefs);
      showAppToast('Notification preferences saved.', 'success');
    } catch (err) {
      showAppToast(`Failed to save preferences: ${err.message}`, 'error');
    }
  }

  _persistPrefs = persist;

  if (!_prefsUiBound) {
    toggle?.addEventListener('change', () => {
      persist();
    });
    smsToggle?.addEventListener('change', () => {
      persist();
    });
    saveBtn?.addEventListener('click', () => persist());
    _prefsUiBound = true;
  }

  syncSmsUiState().catch(() => {/* ignore */});
}

async function getUserPhone(uid) {
  const snap = await fbGetDoc(fbDoc(fbFirestore(), 'users', uid));
  if (!snap.exists()) return '';
  return String(snap.data()?.phone || '').trim();
}

function enqueueRetry(alert) {
  let queue = [];
  try {
    queue = JSON.parse(sessionStorage.getItem(RETRY_QUEUE_KEY) || '[]');
  } catch { queue = []; }

  const exists = queue.some(item => item.alert?.id === alert?.id);
  if (!exists) {
    queue.push({
      alert,
      attempts: 0,
      nextRetryAt: Date.now() + RETRY_INTERVAL_MS,
    });
  }

  try {
    sessionStorage.setItem(RETRY_QUEUE_KEY, JSON.stringify(queue));
  } catch { /* quota — ignore */ }
}

async function flushRetryQueue() {
  let queue = [];
  try {
    queue = JSON.parse(sessionStorage.getItem(RETRY_QUEUE_KEY) || '[]');
  } catch { return; }

  if (!queue.length) return;

  const now = Date.now();
  const remaining = [];

  for (const item of queue) {
    if (item.attempts >= MAX_ATTEMPTS) continue;
    if (item.nextRetryAt > now) {
      remaining.push(item);
      continue;
    }

    item.attempts += 1;

    try {
      if (!navigator.onLine) {
        if (item.attempts < MAX_ATTEMPTS) {
          item.nextRetryAt = now + RETRY_INTERVAL_MS;
          remaining.push(item);
        }
        continue;
      }

      const data = await dispatchAlertViaApi(item.alert);
      if (data?.errors?.length && _currentUser?.uid) {
        const mine = data.errors.filter((e) => e.uid === _currentUser.uid);
        if (mine.length) {
          const detail = mine.map((e) => `${e.channel}: ${e.message}`).join('; ');
          showAppToast(`Notification failed: ${detail}`, 'error');
        }
      }
    } catch {
      if (item.attempts < MAX_ATTEMPTS) {
        item.nextRetryAt = now + RETRY_INTERVAL_MS;
        remaining.push(item);
      }
    }
  }

  try {
    sessionStorage.setItem(RETRY_QUEUE_KEY, JSON.stringify(remaining));
  } catch { /* ignore */ }
}

// ─── Internal: helpers ────────────────────────────────────────────────────────

/** RFC 5322 simplified email regex */
function isValidEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(str || ''));
}
