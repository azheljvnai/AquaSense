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
  fbCollection,
  fbAddDoc,
  fbServerTimestamp,
} from '../firebase-client.js';
import { getConfig } from '../config.js';
import { getActiveThresholds } from '../pond-config.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const COOLDOWN_MS       = 15 * 60 * 1000;          // 15 minutes
const RETRY_QUEUE_KEY   = 'aquasense.notif.retryQueue.v1';
const MAX_ATTEMPTS      = 3;
const RETRY_INTERVAL_MS = 60 * 1000;               // 60 seconds

const SENSOR_LABELS = { ph: 'pH', do: 'Dissolved O₂', turb: 'Turbidity', temp: 'Temperature' };
const SENSOR_UNITS  = { ph: '',   do: ' mg/L',         turb: ' NTU',      temp: '°C' };

// ─── Module State ─────────────────────────────────────────────────────────────

const _cooldownMap = new Map();   // `${pondId}:${sensorKey}` → last-sent ms

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
  const defaultPrefs = { email: { enabled: false, address: '' } };
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
    updatedAt: fbServerTimestamp(),
  }, { merge: true });
}

// ─── Exported: handleAlert ────────────────────────────────────────────────────

/**
 * Orchestrates: auth check → resolved check → prefs check → cooldown check
 * → sendEmail → writeLog → toast on failure.
 * If offline, enqueues for retry.
 */
export async function handleAlert(alert) {
  // 1. Auth guard
  if (!_currentUser?.uid) return;
  const uid = _currentUser.uid;

  // 2. Skip resolved alerts
  if (alert?.resolved) return;

  // 3. Load prefs
  let prefs;
  try {
    prefs = await loadPrefs(uid);
  } catch {
    return;
  }

  // 4. Email channel must be enabled
  if (!prefs?.email?.enabled) return;

  // 5. Cooldown guard — skip if still within the 15-min window
  const pondId    = alert.pond || 'default';
  const sensorKey = alert.key;
  if (isCooledDown(pondId, sensorKey)) return;

  // 6. Offline — enqueue and bail
  if (!navigator.onLine) {
    enqueueRetry(uid, alert);
    return;
  }

  // 7. Send email
  markSent(pondId, sensorKey);
  const result = await sendEmail(prefs, alert);

  // 8. Write log
  const status      = result.success ? 'sent' : 'failed';
  const errorDetail = result.success ? null : (result.error?.message || String(result.error) || 'Unknown error');
  await writeLog(uid, alert, status, errorDetail);

  // 9. Toast on failure
  if (!result.success) {
    showToast(`Email notification failed: ${errorDetail}`, 'error');
  }
}

// ─── Internal: sendEmail ─────────────────────────────────────────────────────

function initPrefsUI(user) {
  const toggle   = document.getElementById('notif-email-toggle');
  const address  = document.getElementById('notif-email-address');
  const saveBtn  = document.getElementById('notif-prefs-save');
  const warning  = document.getElementById('notif-config-warning');

  // Show config warning and disable toggle if EmailJS is not configured
  if (!_emailjsPublicKey) {
    if (warning) warning.style.display = '';
    if (toggle)  { toggle.disabled = true; toggle.checked = false; }
    if (saveBtn) saveBtn.disabled = true;
    return;
  }

  if (warning) warning.style.display = 'none';

  if (!user?.uid) return;

  // Load prefs and populate form
  loadPrefs(user.uid).then(prefs => {
    if (toggle)  toggle.checked  = !!prefs?.email?.enabled;
    if (address) {
      address.value = prefs?.email?.address || user.email || '';
    }
  }).catch(() => {
    if (address && !address.value && user.email) {
      address.value = user.email;
    }
  });

  // Wire save button
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const prefs = {
        email: {
          enabled: toggle ? toggle.checked : false,
          address: address ? address.value.trim() : '',
        },
      };
      try {
        await savePrefs(user.uid, prefs);
        showToast('Notification preferences saved.', 'success');
      } catch (err) {
        showToast(`Failed to save preferences: ${err.message}`, 'error');
      }
    });
  }
}

// ─── Internal: cooldown helpers ───────────────────────────────────────────────

/**
 * Returns true if the pond/sensor combo is WITHIN the 15-min cooldown window
 * (i.e. a notification was recently sent — do NOT send again yet).
 */
function isCooledDown(pondId, sensorKey) {
  const key  = `${pondId}:${sensorKey}`;
  const last = _cooldownMap.get(key);
  if (last == null) return false;
  return (Date.now() - last) < COOLDOWN_MS;
}

function markSent(pondId, sensorKey) {
  _cooldownMap.set(`${pondId}:${sensorKey}`, Date.now());
}

// ─── Internal: sendEmail ─────────────────────────────────────────────────────

async function sendEmail(prefs, alert) {
  try {
    if (typeof emailjs === 'undefined') {
      throw new Error('EmailJS is not loaded.');
    }
    const params = {
      to_email:  prefs.email.address,
      to_name:   prefs.email.address.split('@')[0], // Extract name from email
      reply_to:  prefs.email.address,
      pond_name: alert.pond,
      parameter: SENSOR_LABELS[alert.key] || alert.key,
      value:     formatValue(alert.key, alert.val),
      severity:  alert.severity === 'critical' ? 'Critical' : 'Warning',
      threshold: getThresholdString(alert.key),
      timestamp: new Date(alert.ts).toISOString(),
    };
    console.log('[NotificationService] Sending email with params:', params);
    console.log('[NotificationService] EmailJS config:', {
      serviceId: _emailjsServiceId,
      templateId: _emailjsTemplateId,
      publicKey: _emailjsPublicKey ? '(set)' : '(missing)',
    });
    await emailjs.send(_emailjsServiceId, _emailjsTemplateId, params, _emailjsPublicKey);
    return { success: true };
  } catch (err) {
    console.error('[NotificationService] sendEmail error:', err);
    console.error('[NotificationService] Error details:', {
      message: err?.message,
      text: err?.text,
      status: err?.status,
      name: err?.name,
    });
    return { success: false, error: err };
  }
}

// ─── Internal: writeLog ───────────────────────────────────────────────────────

async function writeLog(uid, alert, status, errorDetail) {
  try {
    await fbAddDoc(fbCollection(fbFirestore(), 'notificationLog'), {
      uid,
      channel:     'email',
      alertId:     alert.id || '',
      pondName:    alert.pond || '',
      parameter:   alert.key || '',
      severity:    alert.severity || '',
      sentAt:      fbServerTimestamp(),
      status,
      errorDetail: errorDetail || null,
    });
  } catch (err) {
    console.warn('[NotificationService] writeLog error:', err);
  }
}

// ─── Internal: offline retry queue ───────────────────────────────────────────

function enqueueRetry(uid, alert) {
  let queue = [];
  try {
    queue = JSON.parse(sessionStorage.getItem(RETRY_QUEUE_KEY) || '[]');
  } catch { queue = []; }

  // Avoid duplicate entries for the same alert id
  const exists = queue.some(item => item.alert?.id === alert?.id);
  if (!exists) {
    queue.push({
      uid,
      alert,
      attempts:    0,
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

  const now       = Date.now();
  const remaining = [];

  for (const item of queue) {
    if (item.attempts >= MAX_ATTEMPTS) continue;   // exhausted — drop
    if (item.nextRetryAt > now) {
      remaining.push(item);                         // not yet due — keep
      continue;
    }

    item.attempts += 1;

    try {
      const prefs = await loadPrefs(item.uid);
      if (!prefs?.email?.enabled) continue;         // user disabled — drop

      const result = await sendEmail(prefs, item.alert);
      const status = result.success ? 'sent' : 'failed';
      const errorDetail = result.success
        ? null
        : (result.error?.message || String(result.error) || 'Unknown error');

      await writeLog(item.uid, item.alert, status, errorDetail);

      if (!result.success && item.attempts < MAX_ATTEMPTS) {
        item.nextRetryAt = now + RETRY_INTERVAL_MS;
        remaining.push(item);
      }
      // success — drop from queue
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

function formatValue(key, val) {
  if (val == null) return '—';
  const unit = SENSOR_UNITS[key] || '';
  if (key === 'ph')   return `${Number(val).toFixed(2)}${unit}`;
  return `${Number(val).toFixed(1)}${unit}`;
}

function getThresholdString(key) {
  try {
    const t = getActiveThresholds();
    if (!t) return '—';
    if (key === 'ph') {
      const pb = t.ph;
      if (pb) return `${pb.optimalMin}–${pb.optimalMax}`;
    }
    if (key === 'do') {
      const db = t.do;
      if (db) return `≥ ${db.optimalMin} mg/L`;
    }
    if (key === 'turb') {
      const tb = t.turb;
      if (tb) return `≤ ${tb.optimalMax} NTU`;
    }
    if (key === 'temp') {
      const tb = t.temp;
      if (tb) return `${tb.optimalMin}–${tb.optimalMax}°C`;
    }
  } catch { /* ignore */ }
  return '—';
}
