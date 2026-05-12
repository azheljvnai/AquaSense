/**
 * NotificationService — email notifications via EmailJS.
 *
 * Public API:
 *   init(user)                          — called after auth
 *   loadPrefs(uid)                      — read Firestore prefs
 *   savePrefs(uid, prefs)               — validate + write Firestore prefs
 *   handleAlert(alert)                  — orchestrate dispatch
 */
import {
  fbFirestore,
  fbDoc,
  fbGetDoc,
  fbSetDoc,
  fbServerTimestamp,
  fbGetIdToken,
} from '../firebase-client.js';
import { getConfig } from '../config.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const RETRY_QUEUE_KEY   = 'aquasense.notif.retryQueue.v1';
const MAX_ATTEMPTS      = 3;
const RETRY_INTERVAL_MS = 60 * 1000;               // 60 seconds

// ─── Module State ─────────────────────────────────────────────────────────────

let _currentUser        = null;
let _emailjsPublicKey   = '';
let _emailjsServiceId   = '';
let _emailjsTemplateId  = '';

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

    if (_emailjsPublicKey && typeof emailjs !== 'undefined') {
      emailjs.init(_emailjsPublicKey);
    }
  } catch (err) {
    console.warn('[NotificationService] Failed to load config:', err);
  }

  initPrefsUI(user);

  // Wire offline retry flush
  window.addEventListener('online', () => {
    flushRetryQueue().catch(err =>
      console.warn('[NotificationService] flushRetryQueue error:', err)
    );
  });
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
 * Validates the email address when `email.enabled` is true, then writes to
 * Firestore with a server timestamp.
 * Throws if the email address is invalid.
 */
export async function savePrefs(uid, prefs) {
  if (!uid) throw new Error('No user ID provided.');

  if (prefs?.email?.enabled) {
    if (!isValidEmail(prefs.email.address)) {
      throw new Error('Invalid email address.');
    }
  }

  const ref = fbDoc(fbFirestore(), 'users', uid, 'notificationPrefs', 'settings');
  await fbSetDoc(ref, {
    email: {
      enabled: !!prefs?.email?.enabled,
      address: prefs?.email?.address || '',
    },
    sms: {
      enabled: !!prefs?.sms?.enabled,
    },
    updatedAt: fbServerTimestamp(),
  }, { merge: true });
}

// ─── Exported: handleAlert ────────────────────────────────────────────────────

/**
 * Fan-out to all active users runs on the server (Firebase Admin); this calls
 * POST /api/notifications/dispatch-alert. If offline, enqueues alert for retry.
 */
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

  console.log('[NotificationService] handleAlert called for alert:', alert.id, 'key:', alert.key, 'pond:', alert.pond);

  if (!navigator.onLine) {
    enqueueRetry(alert);
    return;
  }

  try {
    const data = await dispatchAlertViaApi(alert);
    if (data?.errors?.length && _currentUser?.uid) {
      const mine = data.errors.filter((e) => e.uid === _currentUser.uid);
      if (mine.length) {
        const detail = mine.map((e) => `${e.channel}: ${e.message}`).join('; ');
        showToast(`Notification failed: ${detail}`, 'error');
      }
    }
  } catch (err) {
    console.error('[NotificationService] dispatch-alert failed:', err);
    if (_currentUser?.uid) {
      showToast(`Notifications could not be sent: ${err?.message || String(err)}`, 'error');
    }
  }
}

async function dispatchAlertViaApi(alert) {
  const token = await fbGetIdToken();
  const resp = await fetch('/api/notifications/dispatch-alert', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ alert }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data?.error || `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return data;
}

function initPrefsUI(user) {
  const toggle   = document.getElementById('notif-email-toggle');
  const address  = document.getElementById('notif-email-address');
  const saveBtn  = document.getElementById('notif-prefs-save');
  const warning  = document.getElementById('notif-config-warning');
  const smsToggle = document.getElementById('notif-sms-toggle');
  const smsWarning = document.getElementById('notif-sms-warning');

  // Show config warning and disable email toggle if EmailJS is not configured
  // NOTE: Do NOT return early — SMS prefs must still be saveable even without EmailJS
  if (!_emailjsPublicKey) {
    if (warning) warning.style.display = '';
    if (toggle)  { toggle.disabled = true; toggle.checked = false; }
    // Do NOT disable saveBtn — SMS notifications can still be saved
  } else {
    if (warning) warning.style.display = 'none';
  }

  if (!user?.uid) return;

  // Load prefs and populate state
  loadPrefs(user.uid).then(prefs => {
    if (toggle)  toggle.checked  = !!prefs?.email?.enabled;
    // Recipient is always the logged-in user's email (no input UI required)
    if (address) address.value = prefs?.email?.address || user.email || '';
    if (smsToggle) smsToggle.checked = !!prefs?.sms?.enabled;
  }).catch(() => {
    if (address && !address.value && user.email) address.value = user.email;
  });

  async function syncSmsUiState() {
    const phone = await getUserPhone(user.uid).catch(() => '');
    const hasPhone = !!String(phone || '').trim();
    if (smsWarning) smsWarning.style.display = hasPhone ? 'none' : '';
    if (smsToggle) smsToggle.disabled = !hasPhone;
    if (smsToggle && !hasPhone) smsToggle.checked = false;
    return hasPhone;
  }

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
      showToast('Notification preferences saved.', 'success');
    } catch (err) {
      showToast(`Failed to save preferences: ${err.message}`, 'error');
    }
  }

  // Auto-save on toggle change (single-toggle UX)
  toggle?.addEventListener('change', () => {
    persist();
  });
  smsToggle?.addEventListener('change', () => {
    persist();
  });

  // Backward compatibility: if the old Save button still exists, keep it working.
  saveBtn?.addEventListener('click', () => persist());

  // Evaluate phone state on load (async) to show warning/disable as needed (no Firestore write)
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
          showToast(`Notification failed: ${detail}`, 'error');
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

// ─── Internal: toast ─────────────────────────────────────────────────────────

function showToast(message, type) {
  const toast = document.createElement('div');
  toast.className = `notif-toast notif-toast-${type || 'info'}`;
  toast.textContent = message;
  toast.style.cssText = [
    'position:fixed',
    'bottom:24px',
    'right:24px',
    'z-index:9999',
    'padding:12px 20px',
    'border-radius:8px',
    'font-size:0.875rem',
    'max-width:360px',
    'box-shadow:0 4px 12px rgba(0,0,0,0.15)',
    'color:#fff',
    `background:${type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : '#3b82f6'}`,
    'transition:opacity 0.3s ease',
  ].join(';');

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ─── Internal: helpers ────────────────────────────────────────────────────────

/** RFC 5322 simplified email regex */
function isValidEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(str || ''));
}
