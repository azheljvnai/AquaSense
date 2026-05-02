/**
 * Firebase Realtime Database integration.
 * Uses the shared Firebase app instance from firebase-client.js.
 */
import { fbDatabase, fbRef as ref, fbOnValue as onValue, fbSet as set, fbRtdbQuery as rtdbQuery, fbOrderByChild as orderByChild, fbOrderByKey as orderByKey, fbStartAt as startAt, fbEndAt as endAt, fbGet as get } from './firebase-client.js';
import { fbOnAuthStateChanged, fbFirestore, fbDoc, fbGetDoc } from './firebase-client.js';
import { log, recordSensorReading } from './utils.js';

let fbDb = null;
let feedUnsubscribe = null;
let role = 'farmer';

// Called by app.js after Firebase is initialized to track the user's role.
export function initRoleTracking() {
  try {
    fbOnAuthStateChanged(async (u) => {
      if (!u) {
        role = 'farmer';
        return;
      }
      try {
        const fs = fbFirestore();
        const snap = await fbGetDoc(fbDoc(fs, 'users', u.uid));
        const raw = (snap.exists() ? (snap.data()?.role || 'farmer') : 'farmer').toString().toLowerCase();
        // Migrate legacy role names
        if (raw === 'manager') role = 'owner';
        else if (raw === 'viewer') role = 'farmer';
        else role = raw;
      } catch {
        role = 'farmer';
      }
    });
  } catch {
    // auth not initialized yet; role stays farmer
  }
}

function canControlFeeding() {
  // All roles can trigger manual feed
  return role === 'admin' || role === 'owner' || role === 'farmer';
}

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
    // The RTDB URL comes from Firebase app config; we still accept the provided URL for UI/back-compat.
    fbDb = fbDatabase();
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

      // History persistence is handled by ESP32 firmware (see ESP32_HISTORY_SETUP.md)
      // Frontend only updates UI and localStorage cache
      const ts = d.ts ? Number(d.ts) : Date.now();

      if (onSensorData) onSensorData(ph, doV, turb, temp, ts);
    }, (err) => {      onStatus('ERROR', false);
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
  if (!canControlFeeding()) {
    log('Permission denied: Owner/Admin required to trigger feeding.', 'warn');
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



/**
 * Fetch history entries from RTDB for a given time range.
 * Returns an array of { ts, ph, do, turb, temp } sorted by ts ascending.
 *
 * Uses orderByChild('ts') + startAt/endAt for efficient range queries.
 */
export async function fetchHistoryFromRTDB(deviceId, fromMs, toMs) {
  // Allow reports/graphs to query history even if connect() hasn't run yet.
  // fbDatabase() will succeed as soon as initFirebase() has been called.
  if (!fbDb) {
    try { fbDb = fbDatabase(); } catch { return []; }
  }
  try {
    const histRef = ref(fbDb, `/devices/${deviceId}/history`);

    const toNum = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const parseTimestamp = (value) => {
      if (value == null || value === '') return null;
      const n = Number(value);
      if (Number.isFinite(n)) {
        return n > 0 && n < 100000000000 ? n * 1000 : n;
      }
      const normalized = String(value).trim().replace(' ', 'T');
      const ms = Date.parse(normalized);
      return Number.isFinite(ms) ? ms : null;
    };
    const toKeyStamp = (ms) => {
      const d = new Date(ms);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    };
    const toKeyStampAlt = (ms) => {
      // Some RTDB setups use keys like "YYYY-MM-DD HH:MM:SS"
      const d = new Date(ms);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };
    const firstNumber = (...values) => {
      for (const v of values) {
        const n = toNum(v);
        if (n != null) return n;
      }
      return null;
    };
    const parseRawEntry = (raw, keyFallback) => {
      const obj = raw && typeof raw === 'object' ? raw : {};
      const ts = parseTimestamp(obj.ts ?? obj.timestamp ?? obj.time ?? obj.createdAt ?? keyFallback);
      if (!Number.isFinite(ts)) return null;
      return {
        ts,
        ph: firstNumber(obj.ph, obj.pH, obj.PH),
        do: firstNumber(obj.do, obj.dO, obj.dissolvedOxygen, obj.dissolved_oxygen, obj.oxygen),
        turb: firstNumber(obj.turb, obj.turbidity, obj.ntu),
        temp: firstNumber(obj.temp, obj.temperature, obj.waterTemp),
      };
    };
    const parseEntry = (child) => parseRawEntry(child.val() || {}, child.key);

    /**
     * Some deployments store history grouped by date/hour (nested objects) instead
     * of a flat list of entries. This flattens common nested shapes:
     *   /history/YYYY-MM-DD/{entryKey:{...}}
     *   /history/YYYY-MM-DD_HH/{entryKey:{...}}
     *   /history/{pushId}/{...}
     */
    const collectEntriesFromSnapshot = (snap) => {
      const out = [];
      if (!snap?.exists?.() || !snap.exists()) return out;

      // Snapshot might itself be a single entry object (not a map of children)
      try {
        const rootVal = snap.val?.();
        const rootEntry = parseRawEntry(rootVal, null);
        if (rootEntry) out.push(rootEntry);
      } catch {
        // ignore
      }

      snap.forEach((child) => {
        const raw = child.val();

        // 1) Flat entry
        const direct = parseRawEntry(raw, child.key);
        if (direct) {
          out.push(direct);
          return;
        }

        // 2) Nested map of entries (date bucket, hour bucket, etc.)
        if (raw && typeof raw === 'object') {
          for (const [k, v] of Object.entries(raw)) {
            const nested = parseRawEntry(v, k);
            if (nested) out.push(nested);
          }
        }
      });

      return out;
    };

    // Preferred: ESP32-style key stored as YYYY-MM-DD_HH-MM-SS
    const q3 = rtdbQuery(
      histRef,
      orderByKey(),
      startAt(toKeyStamp(fromMs)),
      endAt(toKeyStamp(toMs)),
    );
    const snap3 = await get(q3);
    const entries3 = collectEntriesFromSnapshot(snap3).filter(e => e.ts >= fromMs && e.ts <= toMs);
    if (entries3.length) return entries3.sort((a, b) => a.ts - b.ts);

    // Fallback: alternate key format "YYYY-MM-DD HH:MM:SS"
    const q3b = rtdbQuery(
      histRef,
      orderByKey(),
      startAt(toKeyStampAlt(fromMs)),
      endAt(toKeyStampAlt(toMs)),
    );
    const snap3b = await get(q3b);
    const entries3b = collectEntriesFromSnapshot(snap3b).filter(e => e.ts >= fromMs && e.ts <= toMs);
    if (entries3b.length) return entries3b.sort((a, b) => a.ts - b.ts);

    // Fallback: ts child (works for frontend-generated numeric `ts` entries)
    const q1 = rtdbQuery(histRef, orderByChild('ts'), startAt(fromMs), endAt(toMs));
    const snap1 = await get(q1);
    const entries1 = collectEntriesFromSnapshot(snap1).filter(e => e.ts >= fromMs && e.ts <= toMs);
    if (entries1.length) return entries1.sort((a, b) => a.ts - b.ts);

    // Fallback: timestamp-as-key (common pattern: /history/{tsMs})
    const q2 = rtdbQuery(histRef, orderByKey(), startAt(String(fromMs)), endAt(String(toMs)));
    const snap2 = await get(q2);
    const entries2 = collectEntriesFromSnapshot(snap2).filter(e => e.ts >= fromMs && e.ts <= toMs);
    if (entries2.length) return entries2.sort((a, b) => a.ts - b.ts);

    // Final fallback: fetch everything and filter client-side for legacy shapes.
    const snap4 = await get(histRef);
    const entries4 = collectEntriesFromSnapshot(snap4).filter(e => e.ts >= fromMs && e.ts <= toMs);
    if (entries4.length) return entries4.sort((a, b) => a.ts - b.ts);

    return [];
  } catch (e) {
    log('History fetch error: ' + e.message, 'err');
    return [];
  }
}

export function saveSchedules(deviceId = 'device001') {  if (!fbDb) {
    log('Not connected to Firebase', 'err');
    return;
  }
  if (!canControlFeeding()) {
    log('Permission denied: Owner/Admin required to change schedules.', 'warn');
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
