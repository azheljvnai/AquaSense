/**
 * Watches RTDB sensor readings and dispatches email/SMS without any browser session.
 */
import admin from 'firebase-admin';
import { dispatchAlertToAllUsers } from './dispatch-alert.js';
import { buildAlertFromReading, mergeConfigThresholds } from '../lib/threshold-eval.js';
import { SPECIES_PRESETS } from '../lib/species-presets.js';

const COOLDOWN_MS = 15 * 60 * 1000;
const SENSOR_KEYS = [
  { key: 'ph', field: 'ph' },
  { key: 'do', field: 'do' },
  { key: 'turb', field: 'turb' },
  { key: 'temp', field: 'temp' },
];

let _started = false;
let _lastSensorSignature = '';
const _notifyCooldown = new Map();

function cooldownKey(configId, sensorKey, severity) {
  return `${configId || 'default'}:${sensorKey}:${severity}`;
}

function shouldSuppressNotify(configId, sensorKey, severity) {
  const last = _notifyCooldown.get(cooldownKey(configId, sensorKey, severity)) || 0;
  return Date.now() - last < COOLDOWN_MS;
}

function markNotified(configId, sensorKey, severity) {
  _notifyCooldown.set(cooldownKey(configId, sensorKey, severity), Date.now());
}

function sensorSignature(d) {
  return `${d.ts}|${d.ph}|${d.do}|${d.turb}|${d.temp}`;
}

async function loadActiveConfiguration(fs) {
  const snap = await fs.collection('configurations').where('isActive', '==', true).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = doc.data();
  const species = data.species || null;
  const preset = species ? (SPECIES_PRESETS[species] || null) : null;
  const thresholds = mergeConfigThresholds(data);
  const pondLabel = species
    ? species.charAt(0).toUpperCase() + species.slice(1)
    : (data.name || doc.id);
  return {
    configId: doc.id,
    species,
    name: data.name || preset?.name || doc.id,
    thresholds,
    pondLabel,
  };
}

async function processSensorSnapshot(d) {
  if (!d || typeof d !== 'object') return;

  const sig = sensorSignature(d);
  if (sig === _lastSensorSignature) return;
  _lastSensorSignature = sig;

  if (!admin.apps.length) return;

  const fs = admin.firestore();
  const activeCfg = await loadActiveConfiguration(fs);
  if (!activeCfg?.thresholds) {
    return;
  }

  const readings = {
    ph: parseFloat(d.ph),
    do: parseFloat(d.do),
    turb: parseFloat(d.turb),
    temp: parseFloat(d.temp),
  };

  for (const { key, field } of SENSOR_KEYS) {
    const val = readings[field];
    if (!Number.isFinite(val)) continue;

    const alert = buildAlertFromReading(key, val, activeCfg);
    if (!alert) continue;

    if (shouldSuppressNotify(activeCfg.configId, key, alert.severity)) continue;

    try {
      const result = await dispatchAlertToAllUsers(alert);
      markNotified(activeCfg.configId, key, alert.severity);
      if (result.emailSent || result.smsSent) {
        console.log(
          `[RTDB alert watcher] Dispatched ${key} ${alert.severity}: email=${result.emailSent} sms=${result.smsSent}`
        );
      }
    } catch (e) {
      console.error('[RTDB alert watcher] dispatch failed:', e?.message || e);
    }
  }
}

/**
 * Subscribe to /devices/{deviceId}/sensors and evaluate thresholds on each change.
 */
export function startRtdbAlertWatcher(options = {}) {
  if (_started) return false;

  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  if (!databaseURL) {
    console.warn('[RTDB alert watcher] FIREBASE_DATABASE_URL not set — server-side alerts disabled.');
    return false;
  }

  if (!admin.apps.length) {
    console.warn('[RTDB alert watcher] Admin SDK not initialised — server-side alerts disabled.');
    return false;
  }

  const disabled =
    process.env.RTDB_ALERT_WATCHER === '0' ||
    String(process.env.RTDB_ALERT_WATCHER || '').toLowerCase() === 'false';
  if (disabled) {
    console.log('[RTDB alert watcher] Disabled via RTDB_ALERT_WATCHER=false');
    return false;
  }

  const deviceId = options.deviceId || process.env.DEVICE_ID || 'device001';
  const ref = admin.database().ref(`/devices/${deviceId}/sensors`);

  ref.on(
    'value',
    (snap) => {
      processSensorSnapshot(snap.val()).catch((e) => {
        console.error('[RTDB alert watcher] process error:', e?.message || e);
      });
    },
    (err) => {
      console.error('[RTDB alert watcher] RTDB listener error:', err?.message || err);
    }
  );

  _started = true;
  console.log(`[RTDB alert watcher] Listening on /devices/${deviceId}/sensors`);
  return true;
}
