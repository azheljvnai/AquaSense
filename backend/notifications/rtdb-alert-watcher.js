/**

 * Watches RTDB sensor readings and dispatches email/SMS without any browser session.

 */

import admin from 'firebase-admin';

import { dispatchAlertsBatchToAllUsers, persistAlertsToFirestore } from './dispatch-alert.js';
import { createSystemLogAsync } from '../lib/system-log.js';

import { buildAlertFromReading, mergeConfigThresholds } from '../lib/threshold-eval.js';

import { SPECIES_PRESETS } from '../lib/species-presets.js';

import { createBreachTracker } from '../lib/alert-sensitivity.js';

import { NOTIFY_INTERVAL_MS } from '../lib/alert-notify-interval.js';



const _sensitivityParsed = Number(process.env.ALERT_SENSITIVITY_MS);

const SENSITIVITY_MS = Number.isFinite(_sensitivityParsed) ? _sensitivityParsed : 60 * 1000;

const REMINDER_TICK_MS = 60 * 1000;

const SENSOR_KEYS = [

  { key: 'ph', field: 'ph' },

  { key: 'do', field: 'do' },

  { key: 'turb', field: 'turb' },

  { key: 'temp', field: 'temp' },

];



let _started = false;

let _processing = false;

let _lastSensorSignature = '';

let _lastSnapshot = null;

let _reminderTimer = null;

const _notifyCooldown = new Map();

const _breachTracker = createBreachTracker(SENSITIVITY_MS);



function cooldownKey(configId, sensorKey, severity) {

  return `${configId || 'default'}:${sensorKey}:${severity}`;

}



function shouldSuppressNotify(configId, sensorKey, severity) {

  const last = _notifyCooldown.get(cooldownKey(configId, sensorKey, severity));

  if (last == null) return false;

  return Date.now() - last < NOTIFY_INTERVAL_MS;

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



async function processSensorSnapshot(d, options = {}) {

  if (!d || typeof d !== 'object') return;

  if (_processing) return;



  const { forceRecheck = false } = options;

  const sig = sensorSignature(d);

  if (!forceRecheck) {

    if (sig === _lastSensorSignature) return;

    _lastSensorSignature = sig;

  }



  if (!admin.apps.length) return;



  _processing = true;

  try {

    const fs = admin.firestore();

    const activeCfg = await loadActiveConfiguration(fs);

    if (!activeCfg?.thresholds) return;



    const readings = {

      ph: parseFloat(d.ph),

      do: parseFloat(d.do),

      turb: parseFloat(d.turb),

      temp: parseFloat(d.temp),

    };



    const pending = [];



    for (const { key, field } of SENSOR_KEYS) {

      const val = readings[field];

      if (!Number.isFinite(val)) continue;



      const alert = buildAlertFromReading(key, val, activeCfg);

      if (!alert) {

        _breachTracker.hasPersisted(activeCfg.configId, key, null);

        continue;

      }



      if (!_breachTracker.hasPersisted(activeCfg.configId, key, alert.severity)) continue;

      if (shouldSuppressNotify(activeCfg.configId, key, alert.severity)) continue;



      pending.push(alert);

    }



    if (!pending.length) return;



    try {
      const persistResult = await persistAlertsToFirestore(pending);
      if (persistResult.written > 0) {
        console.log(
          `[RTDB alert watcher] Persisted ${persistResult.written} alert(s) to Firestore (skipped ${persistResult.skipped})`
        );
        for (const alert of pending) {
          createSystemLogAsync({
            eventType: 'alert.threshold',
            severity: alert.severity === 'critical' ? 'critical' : 'warning',
            source: 'alert',
            description: `${alert.key} exceeded threshold`,
            metadata: { alertId: alert.id, key: alert.key, val: alert.val, pond: alert.pond },
          });
          createSystemLogAsync({
            eventType: 'alert.generated',
            severity: 'info',
            source: 'alert',
            description: 'Alert generated',
            metadata: { alertId: alert.id, key: alert.key, pond: alert.pond },
          });
        }
      } else if (persistResult.skipped > 0) {
        console.warn('[RTDB alert watcher] No alerts persisted — validation skipped all items');
      }
    } catch (e) {
      console.error('[RTDB alert watcher] persist alerts failed:', e?.message || e);
    }



    try {

      const result = await dispatchAlertsBatchToAllUsers(pending);

      if (result.emailSent || result.smsSent) {

        const notified = new Set(result.notified || []);

        for (const alert of pending) {

          const tag = `${alert.key}:${alert.severity}`;

          if (notified.has(tag)) {

            markNotified(activeCfg.configId, alert.key, alert.severity);

          }

        }

        console.log(

          `[RTDB alert watcher] Batch dispatched ${pending.length} parameter(s): email=${result.emailSent} sms=${result.smsSent}`

        );

      }

    } catch (e) {

      console.error('[RTDB alert watcher] dispatch failed:', e?.message || e);

    }

  } finally {

    _processing = false;

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

      const val = snap.val();

      if (val && typeof val === 'object') {

        _lastSnapshot = val;

      }

      processSensorSnapshot(val).catch((e) => {

        console.error('[RTDB alert watcher] process error:', e?.message || e);

      });

    },

    (err) => {

      console.error('[RTDB alert watcher] RTDB listener error:', err?.message || err);

    }

  );



  _reminderTimer = setInterval(() => {

    if (!_lastSnapshot) return;

    processSensorSnapshot(_lastSnapshot, { forceRecheck: true }).catch((e) => {

      console.error('[RTDB alert watcher] reminder tick error:', e?.message || e);

    });

  }, REMINDER_TICK_MS);



  _started = true;

  console.log(

    `[RTDB alert watcher] Listening on /devices/${deviceId}/sensors (sensitivity ${SENSITIVITY_MS / 1000}s, notify interval ${NOTIFY_INTERVAL_MS / 1000}s)`

  );

  return true;

}



/** @internal For tests */

export const processSensorSnapshotForTests = processSensorSnapshot;



/** @internal For tests */

export function _resetWatcherStateForTests() {

  _started = false;

  _processing = false;

  _lastSensorSignature = '';

  _lastSnapshot = null;

  _notifyCooldown.clear();

  _breachTracker.clearForScope('cfg1');

  _breachTracker.clearForScope('default');

  if (_reminderTimer) {

    clearInterval(_reminderTimer);

    _reminderTimer = null;

  }

}


