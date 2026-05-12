/**
 * Server-side alert notification fan-out (Firebase Admin bypasses client Firestore rules).
 */
import admin from 'firebase-admin';
import { sendUniSms, normalizePhPhoneToE164 } from '../lib/unisms.js';
import { getEmailJsServerEnv } from '../lib/emailjs-env.js';

const COOLDOWN_MS = 15 * 60 * 1000; // match client alerts.js notification cooldown

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
    cooldownMs: COOLDOWN_MS,
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

async function sendEmailJsServer(prefs, alert) {
  const { privateKey, publicKey, serviceId, templateId, configured, missing } = getEmailJsServerEnv();
  if (!configured) {
    return {
      ok: false,
      error: `EmailJS server credentials not configured (missing: ${missing.join('; ')}).`,
    };
  }

  const threshold =
    typeof alert.thresholdSummary === 'string' && alert.thresholdSummary.trim()
      ? alert.thresholdSummary.trim()
      : '—';

  const template_params = {
    to_email: prefs.email.address,
    to_name: prefs.email.address.split('@')[0],
    reply_to: prefs.email.address,
    pond_name: alert.pond || '',
    parameter: SENSOR_LABELS[alert.key] || alert.key,
    value: formatValue(alert.key, alert.val),
    severity: alert.severity === 'critical' ? 'Critical' : 'Warning',
    threshold,
    timestamp: new Date(Number(alert.ts) || Date.now()).toISOString(),
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
 * Express handler: POST body `{ alert }`, Bearer auth already verified.
 */
export async function postDispatchAlert(req, res) {
  if (!admin.apps.length) {
    return res.status(503).json({ error: 'Admin SDK not initialised.' });
  }

  const { alert } = req.body || {};
  const validationError = validateDispatchAlertBody(alert);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const fs = admin.firestore();
  const pondName = alert.pond || 'default';
  const parameter = alert.key;

  let processed = 0;
  let smsSent = 0;
  let emailSent = 0;
  let skipped = 0;
  const errors = [];

  let activeSnap;
  try {
    activeSnap = await fs.collection('users').where('status', '==', 'active').get();
  } catch (e) {
    console.error('[dispatch-alert] active users query failed:', e);
    return res.status(500).json({ error: 'Failed to query active users.' });
  }

  if (activeSnap.empty) {
    return res.status(200).json({
      ok: true,
      processed: 0,
      smsSent: 0,
      emailSent: 0,
      skipped: 0,
      errors: [],
      message: 'No active users.',
    });
  }

  const emailJsEnv = getEmailJsServerEnv();
  const emailJsConfigured = emailJsEnv.configured;

  for (const userDoc of activeSnap.docs) {
    const uid = userDoc.id;
    processed += 1;

    // Default: farm alerts go to every active user on both channels (opt-out via prefs).
    let prefs = { email: { enabled: true, address: '' }, sms: { enabled: true } };
    try {
      const prefSnap = await fs.doc(`users/${uid}/notificationPrefs/settings`).get();
      if (prefSnap.exists) {
        const data = prefSnap.data();
        prefs = {
          email: {
            enabled: typeof data?.email?.enabled === 'boolean' ? data.email.enabled : true,
            address: data?.email?.address || '',
          },
          sms: {
            enabled: typeof data?.sms?.enabled === 'boolean' ? data.sms.enabled : true,
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

    const channels = [];
    if (prefs.email.enabled !== false && resolvedEmail) {
      if (emailJsConfigured) channels.push('email');
      else {
        console.warn(
          `[dispatch-alert] Would email user ${uid} but EmailJS server env is incomplete — missing: ${emailJsEnv.missing.join('; ')}. Add to repo root .env or backend/.env, then restart the server.`
        );
      }
    }
    if (prefs.sms.enabled !== false && smsCapable) channels.push('sms');

    if (!channels.length) {
      if (!emailJsConfigured && prefs.email.enabled !== false && resolvedEmail) {
        /* already warned above */
      }
      skipped += 1;
      continue;
    }

    for (const channel of channels) {
      try {
        if (await isCooledDown(fs, uid, pondName, parameter, channel, alert.severity)) {
          skipped += 1;
          continue;
        }

        if (channel === 'email') {
          if (!resolvedEmail) {
            await writeLog(fs, uid, channel, alert, 'failed', 'No email address on profile or notification prefs.');
            errors.push({ uid, channel, message: 'missing email address' });
            continue;
          }
          const r = await sendEmailJsServer({ email: { address: resolvedEmail } }, alert);
          if (r.ok) {
            await writeLog(fs, uid, channel, alert, 'sent', null);
            emailSent += 1;
          } else {
            await writeLog(fs, uid, channel, alert, 'failed', r.error || 'email failed');
            errors.push({ uid, channel, message: r.error });
          }
          continue;
        }

        // SMS (channel only added when phone is E.164-capable)
        const phone = normalizedPhone;
        const content = buildSmsContent(alert);
        const smsResult = await sendUniSms({
          recipient: phone,
          content,
          metadata: {
            source: 'aquasense',
            alertId: alert?.id || '',
            pond: alert?.pond || '',
            key: alert?.key || '',
            severity: alert?.severity || '',
          },
        });

        if (smsResult.ok) {
          await writeLog(fs, uid, channel, alert, 'sent', null);
          smsSent += 1;
        } else {
          await writeLog(fs, uid, channel, alert, 'failed', smsResult.error || 'SMS failed');
          errors.push({ uid, channel, message: smsResult.error });
        }
      } catch (e) {
        const msg = e?.message || String(e);
        errors.push({ uid, channel, message: msg });
        try {
          await writeLog(fs, uid, channel, alert, 'failed', msg);
        } catch (logErr) {
          console.error('[dispatch-alert] writeLog failed:', logErr);
        }
      }
    }
  }

  return res.status(200).json({
    ok: true,
    processed,
    smsSent,
    emailSent,
    skipped,
    errors,
  });
}
