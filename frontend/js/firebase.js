/**
 * Firebase Realtime Database integration.
 * API paths and logic unchanged from original (DEVICE, sensors, feeding).
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getDatabase, ref, onValue, set } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { log } from './utils.js';

let fbDb = null;
let feedUnsubscribe = null;

export function getDevicePath(deviceId = 'device001') {
  return `/devices/${deviceId}`;
}

export function getDb() {
  return fbDb;
}

export function getRef() {
  return ref;
}

export function getSet() {
  return set;
}

export function getFeedUnsubscribe() {
  return feedUnsubscribe;
}

export function setFeedUnsubscribe(fn) {
  feedUnsubscribe = fn;
}

/**
 * Connect to Firebase using the given database URL.
 * Same API usage as original: DEVICE/sensors, DEVICE/feeding.
 * onSensorData(ph, do, turb, temp) is called when sensor data arrives (e.g. to updateCard + pushChart).
 */
export async function connect(firebaseUrl, deviceId, { onStatus, onSensorData, enableFeedBtn }) {
  const url = (firebaseUrl || '').trim();
  if (!url) {
    log('Enter Firebase URL or set FIREBASE_DATABASE_URL in .env', 'err');
    return;
  }
  try {
    const fbApp = initializeApp({ databaseURL: url }, 'aq-' + Date.now());
    fbDb = getDatabase(fbApp);
    const DEVICE = getDevicePath(deviceId);

    onStatus('CONNECTING', false);
    log('Connecting to Firebase...');

    onValue(ref(fbDb, DEVICE + '/sensors'), (snap) => {
      const d = snap.val();
      if (!d) return;
      onStatus('ONLINE', true);
      const cfg = document.getElementById('cfg');
      if (cfg) cfg.style.display = 'none';
      const lastUpd = document.getElementById('last-upd');
      if (lastUpd) lastUpd.textContent = new Date().toLocaleTimeString();
      const ph = parseFloat(d.ph) || 0, doV = parseFloat(d.do) || 0, turb = parseFloat(d.turb) || 0, temp = parseFloat(d.temp) || 0;
      if (onSensorData) onSensorData(ph, doV, turb, temp);
    }, (err) => {
      onStatus('ERROR', false);
      log('Firebase error: ' + err.message, 'err');
    });

    onValue(ref(fbDb, DEVICE + '/feeding'), (snap) => {
      const f = snap.val();
      if (!f) return;
      const s1 = document.getElementById('sched1');
      const s2 = document.getElementById('sched2');
      if (f.schedule1 && s1) s1.value = f.schedule1;
      if (f.schedule2 && s2) s2.value = f.schedule2;
    });

    enableFeedBtn(true);
    log('Firebase connected ✓ — feed button ready', 'feed');
  } catch (e) {
    onStatus('ERROR', false);
    log('Connection failed: ' + e.message, 'err');
  }
}

export function triggerFeed(deviceId = 'device001') {
  if (!fbDb) {
    log('Not connected to Firebase', 'err');
    return;
  }
  const btn = document.getElementById('feed-btn');
  if (!btn) return;
  const DEVICE = getDevicePath(deviceId);

  btn.classList.add('firing');
  btn.textContent = '⟳ SENDING...';
  btn.disabled = true;
  if (feedUnsubscribe) {
    feedUnsubscribe();
    feedUnsubscribe = null;
  }

  set(ref(fbDb, DEVICE + '/feeding/manualFeed'), true)
    .then(() => {
      log('Feed command sent → manualFeed = true ✓', 'feed');
      log('Waiting for ESP32 to confirm...', 'feed');
      btn.textContent = '⟳ DISPENSING...';
      feedUnsubscribe = onValue(ref(fbDb, DEVICE + '/feeding/manualFeed'), (snap) => {
        const val = snap.val();
        if (val === false || val === null) {
          if (feedUnsubscribe) {
            feedUnsubscribe();
            feedUnsubscribe = null;
          }
          btn.classList.remove('firing');
          btn.textContent = '▶ Manual Feed';
          btn.disabled = false;
          log('ESP32 confirmed feed complete ✓', 'feed');
        }
      });
      setTimeout(() => {
        if (feedUnsubscribe) {
          feedUnsubscribe();
          feedUnsubscribe = null;
          btn.classList.remove('firing');
          btn.textContent = '▶ Manual Feed';
          btn.disabled = false;
          log('Feed timeout — button unlocked (ESP32 may be offline)', 'warn');
        }
      }, 10000);
    })
    .catch((e) => {
      log('Feed error: ' + e.message, 'err');
      btn.classList.remove('firing');
      btn.textContent = '▶ Manual Feed';
      btn.disabled = false;
    });
}

export function saveSchedules(deviceId = 'device001') {
  if (!fbDb) {
    log('Not connected to Firebase', 'err');
    return;
  }
  const s1 = document.getElementById('sched1')?.value;
  const s2 = document.getElementById('sched2')?.value;
  if (s1 == null || s2 == null) return;
  const DEVICE = getDevicePath(deviceId);
  Promise.all([
    set(ref(fbDb, DEVICE + '/feeding/schedule1'), s1),
    set(ref(fbDb, DEVICE + '/feeding/schedule2'), s2),
  ])
    .then(() => log(`Schedules saved: ${s1} & ${s2} ✓`, 'feed'))
    .catch((e) => log('Save error: ' + e.message, 'err'));
}
