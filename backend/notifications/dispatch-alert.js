/**
 * Server-side alert notification fan-out (Firebase Admin bypasses client Firestore rules).
 */
import admin from 'firebase-admin';
import { sendUniSms, normalizePhPhoneToE164 } from '../lib/unisms.js';
import { getEmailJsServerEnv } from '../lib/emailjs-env.js';
import { NOTIFY_INTERVAL_MS } from '../lib/alert-notify-interval.js';

/** Same predicate as /api/config serverDispatchesAlerts — RTDB watcher owns dispatch when true. */
export function isServerWatcherEnabled() {
  if (!process.env.FIREBASE_DATABASE_URL) return false;
  const disabled =
    process.env.RTDB_ALERT_WATCHER === '0' ||
    String(process.env.RTDB_ALERT_WATCHER || '').toLowerCase() === 'false';
  return !disabled;
}

const SENSOR_LABELS = { ph: 'pH', do: 'Dissolved O₂', turb: 'Turbidity', temp: 'Temperature' };
const SENSOR_UNITS = { ph: '', do: ' mg/L', turb: ' NTU', temp: '°C' };

/** GSM / ASCII-safe copy for SMS only — UniSMS returns 422 on subscript ₂, degree °, etc. */
const SMS_SENSOR_LABELS = { ph: 'pH', do: 'Dissolved O2', turb: 'Turbidity', temp: 'Temperature' };
const SMS_SENSOR_UNITS = { ph: '', do: ' mg/L', turb: ' NTU', temp: ' C' };

function formatValue(key, val) {
  if (val == null) return '—';
  const unit = SENSOR_UNITS[key] || '';
  if (key === 'ph') return `${Number(val).toFixed(2)}${unit}`;
  return `${Number(val).toFixed(1)}${unit}`;
}

function formatSmsValue(key, val) {
  if (val == null) return '-';
  const unit = SMS_SENSOR_UNITS[key] || '';
  if (key === 'ph') return `${Number(val).toFixed(2)}${unit}`;
  return `${Number(val).toFixed(1)}${unit}`;
}

/** Exported for tests — must stay ASCII for UniSMS. */
export function buildSmsContent(alert) {
  const severity = alert?.severity === 'critical' ? 'Critical' : 'Warning';
  const pondRaw = String(alert?.pond || 'Pond').trim() || 'Pond';
  const pond = pondRaw.replace(/[^\x00-\x7F]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Pond';
  const sensor = SMS_SENSOR_LABELS[alert?.key] || String(alert?.key || 'Value').replace(/[^\x00-\x7F]/g, '');
  const value = formatSmsValue(alert?.key, alert?.val);

  let content = `AquaSenseAlert: Threshold Exceeded - ${severity} with ${sensor} ${value}. Please inspect ${pond} for corrective actions`;

  if (content.length > 160) {
    const maxPond = Math.max(8, Math.min(32, pond.length));
    const trimmedPond = pond.length > maxPond ? `${pond.slice(0, maxPond - 1)}...` : pond;
    content = `AquaSenseAlert: Threshold Exceeded - ${severity} with ${sensor} ${value}. Please inspect ${trimmedPond} for corrective actions`;
  }
  if (content.length > 160) {
    content = `AquaSenseAlert: Threshold Exceeded - ${severity} with ${value}. Please inspect ${pond} for corrective actions`;
  }
  if (content.length > 160) {
    content = content.slice(0, 160);
  }
  return content;
}

/** Combined SMS for multiple parameters (ASCII, max 160 chars). */
export function buildBatchedSmsContent(alerts) {
  const list = Array.isArray(alerts) ? alerts.filter(Boolean) : [];
  if (!list.length) return '';
  if (list.length === 1) return buildSmsContent(list[0]);

  const pondRaw = String(list[0]?.pond || 'Pond').trim() || 'Pond';
  const pond = pondRaw.replace(/[^\x00-\x7F]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Pond';
  const hasCritical = list.some((a) => a.severity === 'critical');
  const severity = hasCritical ? 'Critical' : 'Warning';
  const parts = list.map((a) => {
    const sensor = SMS_SENSOR_LABELS[a.key] || String(a.key || '').replace(/[^\x00-\x7F]/g, '');
    return `${sensor} ${formatSmsValue(a.key, a.val)}`;
  });
  let content = `AquaSenseAlert: ${severity} - ${parts.join('; ')}. Check ${pond}`;
  if (content.length > 160) {
    content = `AquaSenseAlert: ${severity} - ${parts.slice(0, 2).join('; ')} +${list.length - 2} more. Check ${pond}`;
  }
  if (content.length > 160) {
    content = content.slice(0, 160);
  }
  return content;
}

function highestSeverity(alerts) {
  return alerts.some((a) => a.severity === 'critical') ? 'critical' : 'warning';
}

/**
 * Pure cooldown check for tests and Firestore-backed dispatch.
 * Rows without `severity` are ignored so legacy notificationLog docs do not block sends.
 * Rows are expected in newest-first order (same as Firestore query).
 */
export function isCooledDownFromLogRows(rows, { nowMs, pondName, parameter, channel, severity, cooldownMs }) {
  const sev = String(severity || '');
  for (const d of rows) {
    if (d.pondName !== pondName || d.parameter !== parameter || d.channel !== channel) continue;
    if (d.status !== 'sent') continue;
    const logSev = d.severity != null && String(d.severity).trim() !== '' ? String(d.severity) : '';
    if (!logSev) continue;
    if (logSev !== sev) continue;
    const ts = typeof d.sentAtMs === 'number' ? d.sentAtMs : 0;
    if (nowMs - ts < cooldownMs) return true;
  }
  return false;
}

async function isCooledDown(fs, uid, pondName, parameter, channel, severity) {
  const snap = await fs
    .collection('notificationLog')
    .where('uid', '==', uid)
    .orderBy('sentAt', 'desc')
    .limit(50)
    .get();

  const rows = snap.docs.map((doc) => {
    const d = doc.data();
    return {
      pondName: d.pondName,
      parameter: d.parameter,
      channel: d.channel,
      status: d.status,
      severity: d.severity,
      sentAtMs: d.sentAt?.toMillis?.() ?? 0,
    };
  });
  return isCooledDownFromLogRows(rows, {
    nowMs: Date.now(),
    pondName,
    parameter,
    channel,
    severity,
    cooldownMs: NOTIFY_INTERVAL_MS,
  });
}

async function writeLog(fs, uid, channel, alert, status, errorDetail) {
  await fs.collection('notificationLog').add({
    uid,
    channel: channel || 'email',
    alertId: alert.id || '',
    pondName: alert.pond || '',
    parameter: alert.key || '',
    severity: alert.severity || '',
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    status,
    errorDetail: errorDetail || null,
  });
}

async function sendEmailJsServer(prefs, alertOrAlerts) {
  const { privateKey, publicKey, serviceId, templateId, configured, missing } = getEmailJsServerEnv();
  if (!configured) {
    return {
      ok: false,
      error: `EmailJS server credentials not configured (missing: ${missing.join('; ')}).`,
    };
  }

  const alerts = Array.isArray(alertOrAlerts) ? alertOrAlerts : [alertOrAlerts];
  const primary = alerts[0];
  const sev = highestSeverity(alerts);
  const parameter =
    alerts.length === 1
      ? SENSOR_LABELS[primary.key] || primary.key
      : alerts.map((a) => SENSOR_LABELS[a.key] || a.key).join(', ');
  const value =
    alerts.length === 1
      ? formatValue(primary.key, primary.val)
      : alerts.map((a) => `${SENSOR_LABELS[a.key] || a.key}: ${formatValue(a.key, a.val)}`).join('; ');
  const threshold =
    alerts.length === 1 && typeof primary.thresholdSummary === 'string' && primary.thresholdSummary.trim()
      ? primary.thresholdSummary.trim()
      : alerts
          .map((a) => {
            const t =
              typeof a.thresholdSummary === 'string' && a.thresholdSummary.trim()
                ? a.thresholdSummary.trim()
                : '—';
            return `${SENSOR_LABELS[a.key] || a.key}: ${t}`;
          })
          .join('; ');

  const template_params = {
    to_email: prefs.email.address,
    to_name: prefs.email.address.split('@')[0],
    reply_to: prefs.email.address,
    pond_name: primary.pond || '',
    parameter,
    value,
    severity: sev === 'critical' ? 'Critical' : 'Warning',
    threshold,
    timestamp: new Date(Number(primary.ts) || Date.now()).toISOString(),
  };

  const resp = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      accessToken: privateKey,
      template_params,
    }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const raw = String(data?.text || data?.message || '').trim() || `EmailJS HTTP ${resp.status}`;
    if (resp.status === 403) {
      const hint =
        raw.toLowerCase().includes('non-browser') || raw.toLowerCase().includes('disabled')
          ? ' Enable “Allow EmailJS API for non-browser applications” under Account → Security: https://dashboard.emailjs.com/admin/account/security'
          : ' Check Account → Security in EmailJS and that EMAILJS_PRIVATE_KEY matches the same account as EMAILJS_PUBLIC_KEY.';
      return { ok: false, error: `${raw}.${hint}` };
    }
    return { ok: false, error: raw };
  }
  return { ok: true };
}

export function validateDispatchAlertBody(alert) {
  if (!alert || typeof alert !== 'object') return 'alert object required';
  if (alert.resolved === true) return 'resolved alerts are skipped';
  if (!alert.key || typeof alert.key !== 'string') return 'alert.key required';
  if (alert.id == null || alert.id === '') return 'alert.id required';
  if (alert.ts == null || !Number.isFinite(Number(alert.ts))) return 'alert.ts required';
  if (!alert.pond || typeof alert.pond !== 'string') return 'alert.pond required';
  if (!alert.severity || typeof alert.severity !== 'string') return 'alert.severity required';
  if (alert.val == null || !Number.isFinite(Number(alert.val))) return 'alert.val required';
  return null;
}

/**
 * Persist alert records for the Alerts tab (server watcher path).
 */
export async function persistAlertsToFirestore(alerts) {
  if (!admin.apps.length || !Array.isArray(alerts) || !alerts.length) {
    return { written: 0, skipped: 0 };
  }
  const fs = admin.firestore();
  const batch = fs.batch();
  let written = 0;
  let skipped = 0;
  for (const alert of alerts) {
    if (validateDispatchAlertBody(alert)) {
      skipped += 1;
      continue;
    }
    const ref = fs.collection('alerts').doc(String(alert.id));
    batch.set(
      ref,
      {
        id: alert.id,
        ts: alert.ts,
        key: alert.key,
        val: alert.val,
        severity: alert.severity,
        badge: alert.badge || '',
        label: alert.label || '',
        description: alert.description || '',
        pond: alert.pond || '',
        resolved: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    written += 1;
  }
  if (written) await batch.commit();
  return { written, skipped };
}

/**
 * Fan out one email + one SMS per user for all due alerts in a snapshot.
 * Per-parameter cooldown still applies; only parameters outside cooldown are included.
 */
export async function dispatchAlertsBatchToAllUsers(alerts) {
  if (!admin.apps.length) {
    throw new Error('Admin SDK not initialised.');
  }

  const list = Array.isArray(alerts) ? alerts.filter(Boolean) : [];
  if (!list.length) {
    return {
      ok: true,
      processed: 0,
      smsSent: 0,
      emailSent: 0,
      skipped: 0,
      errors: [],
      notified: [],
    };
  }

  for (const alert of list) {
    const validationError = validateDispatchAlertBody(alert);
    if (validationError) throw new Error(validationError);
  }

  const fs = admin.firestore();
  let processed = 0;
  let smsSent = 0;
  let emailSent = 0;
  let skipped = 0;
  const errors = [];
  const notified = [];

  let activeSnap;
  try {
    activeSnap = await fs.collection('users').where('status', '==', 'active').get();
  } catch (e) {
    console.error('[dispatch-alert] active users query failed:', e);
    throw new Error('Failed to query active users.');
  }

  if (activeSnap.empty) {
    return {
      ok: true,
      processed: 0,
      smsSent: 0,
      emailSent: 0,
      skipped: 0,
      errors: [],
      notified: [],
      message: 'No active users.',
    };
  }

  const emailJsEnv = getEmailJsServerEnv();
  const emailJsConfigured = emailJsEnv.configured;

  for (const userDoc of activeSnap.docs) {
    const uid = userDoc.id;
    processed += 1;

    let prefs = { email: { enabled: false, address: '' }, sms: { enabled: false } };
    try {
      const prefSnap = await fs.doc(`users/${uid}/notificationPrefs/settings`).get();
      if (prefSnap.exists) {
        const data = prefSnap.data();
        prefs = {
          email: {
            enabled: typeof data?.email?.enabled === 'boolean' ? data.email.enabled : false,
            address: data?.email?.address || '',
          },
          sms: {
            enabled: typeof data?.sms?.enabled === 'boolean' ? data.sms.enabled : false,
          },
        };
      }
    } catch (e) {
      errors.push({ uid, step: 'prefs', message: e?.message || String(e) });
      skipped += 1;
      continue;
    }

    const userData = userDoc.data() || {};
    const rawPhone = String(userData.phone || '').trim();
    const profileEmail = String(userData.email || '').trim();
    const resolvedEmail = String(prefs.email?.address || profileEmail || '').trim();
    const normalizedPhone = rawPhone ? normalizePhPhoneToE164(rawPhone) : '';
    const smsCapable = normalizedPhone.startsWith('+');

    const emailAlerts = [];
    const smsAlerts = [];

    for (const alert of list) {
      const pondName = alert.pond;
      const parameter = alert.key;
      if (prefs.email.enabled === true && resolvedEmail && emailJsConfigured) {
        if (!(await isCooledDown(fs, uid, pondName, parameter, 'email', alert.severity))) {
          emailAlerts.push(alert);
        }
      }
      if (prefs.sms.enabled === true && smsCapable) {
        if (!(await isCooledDown(fs, uid, pondName, parameter, 'sms', alert.severity))) {
          smsAlerts.push(alert);
        }
      }
    }

    if (!emailAlerts.length && !smsAlerts.length) {
      skipped += 1;
      continue;
    }

    const markNotifiedFor = (alert) => {
      const tag = `${alert.key}:${alert.severity}`;
      if (!notified.includes(tag)) notified.push(tag);
    };

    if (emailAlerts.length) {
      try {
        const r = await sendEmailJsServer({ email: { address: resolvedEmail } }, emailAlerts);
        if (r.ok) {
          emailSent += 1;
          for (const alert of emailAlerts) {
            await writeLog(fs, uid, 'email', alert, 'sent', null);
            markNotifiedFor(alert);
          }
        } else {
          for (const alert of emailAlerts) {
            await writeLog(fs, uid, 'email', alert, 'failed', r.error || 'email failed');
          }
          errors.push({ uid, channel: 'email', message: r.error });
        }
      } catch (e) {
        const msg = e?.message || String(e);
        errors.push({ uid, channel: 'email', message: msg });
        for (const alert of emailAlerts) {
          try {
            await writeLog(fs, uid, 'email', alert, 'failed', msg);
          } catch (logErr) {
            console.error('[dispatch-alert] writeLog failed:', logErr);
          }
        }
      }
    }

    if (smsAlerts.length) {
      try {
        const content = buildBatchedSmsContent(smsAlerts);
        const smsResult = await sendUniSms({
          recipient: normalizedPhone,
          content,
          metadata: {
            source: 'aquasense',
            alertId: smsAlerts.map((a) => a.id).join(','),
            pond: smsAlerts[0]?.pond || '',
            keys: smsAlerts.map((a) => a.key).join(','),
            severity: highestSeverity(smsAlerts),
          },
        });
        if (smsResult.ok) {
          smsSent += 1;
          for (const alert of smsAlerts) {
            await writeLog(fs, uid, 'sms', alert, 'sent', null);
            markNotifiedFor(alert);
          }
        } else {
          for (const alert of smsAlerts) {
            await writeLog(fs, uid, 'sms', alert, 'failed', smsResult.error || 'SMS failed');
          }
          errors.push({ uid, channel: 'sms', message: smsResult.error });
        }
      } catch (e) {
        const msg = e?.message || String(e);
        errors.push({ uid, channel: 'sms', message: msg });
        for (const alert of smsAlerts) {
          try {
            await writeLog(fs, uid, 'sms', alert, 'failed', msg);
          } catch (logErr) {
            console.error('[dispatch-alert] writeLog failed:', logErr);
          }
        }
      }
    }
  }

  return {
    ok: true,
    processed,
    smsSent,
    emailSent,
    skipped,
    errors,
    notified,
  };
}

/** @deprecated Use dispatchAlertsBatchToAllUsers — single-alert wrapper. */
export async function dispatchAlertToAllUsers(alert) {
  return dispatchAlertsBatchToAllUsers([alert]);
}

/**
 * Express handler: POST body `{ alert }`, Bearer auth already verified.
 */
export async function postDispatchAlert(req, res) {
  if (!admin.apps.length) {
    return res.status(503).json({ error: 'Admin SDK not initialised.' });
  }

  if (isServerWatcherEnabled()) {
    return res.status(202).json({
      ok: true,
      skipped: true,
      reason: 'server_watcher_enabled',
      message: 'Notifications are dispatched by the RTDB alert watcher; client dispatch skipped.',
      processed: 0,
      smsSent: 0,
      emailSent: 0,
      errors: [],
      notified: [],
    });
  }

  const { alert, alerts } = req.body || {};
  const batch = Array.isArray(alerts) && alerts.length ? alerts : alert ? [alert] : [];
  if (!batch.length) {
    return res.status(400).json({ error: 'alert or alerts array required' });
  }
  for (const a of batch) {
    const validationError = validateDispatchAlertBody(a);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
  }

  try {
    const result = await dispatchAlertsBatchToAllUsers(batch);
    return res.status(200).json(result);
  } catch (e) {
    const msg = e?.message || String(e);
    if (msg.includes('Failed to query active users')) {
      return res.status(500).json({ error: msg });
    }
    return res.status(400).json({ error: msg });
  }
}
