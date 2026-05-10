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
  fbGetIdToken,
  fbQuery,
  fbWhere,
  fbGetDocs,
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

const _cooldownMap = new Map();   // `${channel}:${uid}:${pondId}:${sensorKey}` → last-sent ms

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
 * Orchestrates: query all active users → resolved check → prefs check → cooldown check
 * → sendEmail/SMS → writeLog → toast on failure.
 * If offline, enqueues for retry.
 * 
 * FIXED: Now sends notifications to ALL active users, not just the logged-in user.
 */
export async function handleAlert(alert) {
  // 1. Skip resolved alerts
  if (alert?.resolved) return;

  // 2. Query all active users from Firestore
  let activeUsers = [];
  try {
    const usersRef = fbCollection(fbFirestore(), 'users');
    const q = fbQuery(usersRef, fbWhere('status', '==', 'active'));
    const snapshot = await fbGetDocs(q);
    activeUsers = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
  } catch (err) {
    console.error('[NotificationService] Failed to query active users:', err);
    return;
  }

  if (activeUsers.length === 0) return;

  // 3. Extract alert context
  const pondId = alert.pond || 'default';
  const sensorKey = alert.key;

  // 4. Process each active user
  for (const user of activeUsers) {
    try {
      // 4a. Load user preferences
      let prefs;
      try {
        prefs = await loadPrefs(user.uid);
      } catch {
        continue; // Skip this user if prefs can't be loaded
      }

      // 4b. Determine enabled channels
      const channels = [];
      if (prefs?.email?.enabled) channels.push('email');
      if (prefs?.sms?.enabled) channels.push('sms');
      if (channels.length === 0) continue;

      // 4c. Check if offline — enqueue and skip
      if (!navigator.onLine) {
        enqueueRetry(user.uid, alert, channels);
        continue;
      }

      // 4d. Dispatch each enabled channel
      for (const channel of channels) {
        // Check cooldown per user
        if (isCooledDown(channel, user.uid, pondId, sensorKey)) continue;
        markSent(channel, user.uid, pondId, sensorKey);

        // Send notification
        const result = channel === 'email'
          ? await sendEmail(prefs, alert)
          : await sendSms(user.uid, alert);

        // Log result
        const status = result.success ? 'sent' : 'failed';
        const errorDetail = result.success ? null : (result.error?.message || String(result.error) || 'Unknown error');
        await writeLog(user.uid, channel, alert, status, errorDetail);

        // Show toast on failure (only for logged-in user to avoid spam)
        if (!result.success && user.uid === _currentUser?.uid) {
          showToast(`${channel.toUpperCase()} notification failed: ${errorDetail}`, 'error');
        }
      }
    } catch (error) {
      console.error(`[NotificationService] Failed to process notifications for user ${user.uid}:`, error);
      // Continue processing other users
    }
  }
}

// ─── Internal: sendEmail ─────────────────────────────────────────────────────

function initPrefsUI(user) {
  const toggle   = document.getElementById('notif-email-toggle');
  const address  = document.getElementById('notif-email-address');
  const saveBtn  = document.getElementById('notif-prefs-save');
  const warning  = document.getElementById('notif-config-warning');
  const smsToggle = document.getElementById('notif-sms-toggle');
  const smsWarning = document.getElementById('notif-sms-warning');

  // Show config warning and disable toggle if EmailJS is not configured
  if (!_emailjsPublicKey) {
    if (warning) warning.style.display = '';
    if (toggle)  { toggle.disabled = true; toggle.checked = false; }
    if (saveBtn) saveBtn.disabled = true;
    return;
  }

  if (warning) warning.style.display = 'none';

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

// ─── Internal: cooldown helpers ───────────────────────────────────────────────

/**
 * Returns true if the pond/sensor combo is WITHIN the 15-min cooldown window
 * (i.e. a notification was recently sent — do NOT send again yet).
 * Updated to track cooldown per user.
 */
function isCooledDown(channel, uid, pondId, sensorKey) {
  const key  = `${channel}:${uid}:${pondId}:${sensorKey}`;
  const last = _cooldownMap.get(key);
  if (last == null) return false;
  return (Date.now() - last) < COOLDOWN_MS;
}

function markSent(channel, uid, pondId, sensorKey) {
  _cooldownMap.set(`${channel}:${uid}:${pondId}:${sensorKey}`, Date.now());
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

// ─── Internal: sendSms ────────────────────────────────────────────────────────

async function getUserPhone(uid) {
  const snap = await fbGetDoc(fbDoc(fbFirestore(), 'users', uid));
  if (!snap.exists()) return '';
  return String(snap.data()?.phone || '').trim();
}

function normalizePhPhoneToE164(input) {
  // UniSMS expects E.164. For PH, accept 09XXXXXXXXX or 639XXXXXXXXX and normalize.
  const raw = String(input || '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/[^\d+]/g, '');
  if (/^\+639\d{9}$/.test(cleaned)) return cleaned;
  if (/^639\d{9}$/.test(cleaned)) return `+${cleaned}`;
  if (/^09\d{9}$/.test(cleaned)) return `+63${cleaned.slice(1)}`;
  return cleaned;
}

function buildSmsContent(alert) {
  const severity = alert?.severity === 'critical' ? 'Critical' : 'Warning';
  const pond = String(alert?.pond || 'Pond').trim() || 'Pond';
  const sensor = SENSOR_LABELS[alert?.key] || alert?.key || 'Value';
  const value = formatValue(alert?.key, alert?.val);

  // Requested pattern (kept short). Include sensor label before the value.
  let content = `AquaSenseAlert: Threshold Exceeded - ${severity} with ${sensor} ${value}. Please inspect ${pond} for corrective actions`;

  // Hard cap to 160 chars (UniSMS content limit). Trim pond name first.
  if (content.length > 160) {
    const maxPond = Math.max(8, Math.min(32, pond.length));
    const trimmedPond = pond.length > maxPond ? pond.slice(0, maxPond - 1) + '…' : pond;
    content = `AquaSenseAlert: Threshold Exceeded - ${severity} with ${sensor} ${value}. Please inspect ${trimmedPond} for corrective actions`;
  }
  if (content.length > 160) {
    // Final fallback: drop sensor label
    content = `AquaSenseAlert: Threshold Exceeded - ${severity} with ${value}. Please inspect ${pond} for corrective actions`;
  }
  if (content.length > 160) {
    // Final hard trim
    content = content.slice(0, 160);
  }
  return content;
}

async function sendSms(uid, alert) {
  try {
    const rawPhone = await getUserPhone(uid);
    if (!rawPhone) throw new Error('No phone number on profile.');
    const phone = normalizePhPhoneToE164(rawPhone);
    // If it still doesn't look like E.164, fail early with a clear message.
    if (!phone.startsWith('+')) {
      throw new Error('Phone number must be in E.164 format (e.g., +639123456789).');
    }
    const token = await fbGetIdToken();
    const content = buildSmsContent(alert);

    const resp = await fetch('/api/notifications/sms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        recipient: phone,
        content,
        metadata: {
          source: 'aquasense',
          alertId: alert?.id || '',
          pond: alert?.pond || '',
          key: alert?.key || '',
          severity: alert?.severity || '',
        },
      }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data?.error || 'SMS send failed.');
    }
    return { success: true, reference_id: data?.reference_id || null };
  } catch (err) {
    return { success: false, error: err };
  }
}

// ─── Internal: writeLog ───────────────────────────────────────────────────────

async function writeLog(uid, channel, alert, status, errorDetail) {
  try {
    await fbAddDoc(fbCollection(fbFirestore(), 'notificationLog'), {
      uid,
      channel:     channel || 'email',
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

function enqueueRetry(uid, alert, channels) {
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
      channels: Array.isArray(channels) && channels.length ? [...new Set(channels)] : ['email'],
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
      const channels = Array.isArray(item.channels) && item.channels.length ? item.channels : ['email'];
      const results = [];

      for (const channel of channels) {
        if (channel === 'email' && !prefs?.email?.enabled) continue;
        if (channel === 'sms' && !prefs?.sms?.enabled) continue;

        const pondId = item.alert?.pond || 'default';
        const sensorKey = item.alert?.key;
        if (sensorKey && isCooledDown(channel, item.uid, pondId, sensorKey)) continue;
        if (sensorKey) markSent(channel, item.uid, pondId, sensorKey);

        const result = channel === 'email'
          ? await sendEmail(prefs, item.alert)
          : await sendSms(item.uid, item.alert);

        const status = result.success ? 'sent' : 'failed';
        const errorDetail = result.success
          ? null
          : (result.error?.message || String(result.error) || 'Unknown error');
        await writeLog(item.uid, channel, item.alert, status, errorDetail);
        results.push(result);
      }

      const allOk = results.length ? results.every(r => r.success) : true;
      if (!allOk && item.attempts < MAX_ATTEMPTS) {
        item.nextRetryAt = now + RETRY_INTERVAL_MS;
        remaining.push(item);
      }
      // if allOk — drop from queue
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
