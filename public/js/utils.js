/**
 * Shared utilities: logging, water quality thresholds, badges, sparklines.
 */

const STORAGE_KEY_THRESH = 'aquasense.thresholds.v1';

const DEFAULT_THRESH = {
  ph:   { ok: [6.5, 8.5],  warn: [5.5, 9.5] },
  do:   { ok: [6.0, 99],   warn: [3.0, 99] },
  turb: { ok: [0, 20],     warn: [0, 90] },
  temp: { ok: [20, 26],    warn: [14, 32] },
};

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export const thresh = deepClone(DEFAULT_THRESH);

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function mergeThresholds(base, incoming) {
  for (const k of Object.keys(base)) {
    const b = base[k];
    const inc = incoming && incoming[k];
    if (!inc || typeof inc !== 'object') continue;
    for (const band of ['ok', 'warn']) {
      const arr = inc[band];
      if (!Array.isArray(arr) || arr.length !== 2) continue;
      if (!isFiniteNumber(arr[0]) || !isFiniteNumber(arr[1])) continue;
      b[band][0] = arr[0];
      b[band][1] = arr[1];
    }
  }
}

export function getThresholds() {
  return thresh;
}

export function saveThresholds(next) {
  if (!next || typeof next !== 'object') return;
  mergeThresholds(thresh, next);
  try {
    localStorage.setItem(STORAGE_KEY_THRESH, JSON.stringify(thresh));
  } catch {
    // ignore storage failures (private mode, quota, etc.)
  }
}

export function resetThresholds() {
  mergeThresholds(thresh, DEFAULT_THRESH);
  try {
    localStorage.removeItem(STORAGE_KEY_THRESH);
  } catch {
    // ignore
  }
}

// Apply saved thresholds on load (if available)
try {
  const raw = localStorage.getItem(STORAGE_KEY_THRESH);
  if (raw) mergeThresholds(thresh, JSON.parse(raw));
} catch {
  // ignore
}

/**
 * getBadge delegates to the active pond species configuration.
 * pond-config.js registers its classifier via window._pondGetBadge after init.
 * Falls back to crayfish defaults if pond-config is not yet loaded.
 */
export function getBadge(key, val) {
  if (typeof window._pondGetBadge === 'function') {
    return window._pondGetBadge(key, val);
  }
  return _crayfishBadge(key, val);
}

function _crayfishBadge(key, val) {
  if (key === 'turb') {
    if (val <= 40) return { c: 'ok',     l: 'Normal' };
    if (val <= 90) return { c: 'warn',   l: 'Warning' };
    return                { c: 'danger', l: 'Critical' };
  }
  if (key === 'temp') {
    if (val >= 20 && val <= 30) return { c: 'ok',     l: 'Normal' };
    return                              { c: 'danger', l: 'Critical' };
  }
  if (key === 'ph') {
    if (val >= 6.5 && val <= 8.5) return { c: 'ok',     l: 'Normal' };
    return                                { c: 'danger', l: 'Critical' };
  }
  if (key === 'do') {
    if (val >= 5) return { c: 'ok',     l: 'Normal' };
    return               { c: 'danger', l: 'Critical' };
  }
  const t = thresh[key];
  if (!t) return { c: 'ok', l: 'Normal' };
  if (val >= t.ok[0] && val <= t.ok[1]) return { c: 'ok', l: 'Normal' };
  return { c: 'danger', l: 'Critical' };
}

export const spkData = { ph: [], do: [], turb: [], temp: [] };
export const spkCol = { ph: '#22c55e', do: '#3b82f6', turb: '#eab308', temp: '#ef4444' };

// ---------------------------------------------------------------------------
// Sensor History — two-tier storage:
//
//   localStorage (_liveHistory): short-term real-time buffer (~2 hours).
//     Written by recordSensorReading() on every live sensor update.
//     Pruned to MAX_HISTORY entries / MAX_BUFFER_HOURS hours so it never
//     grows large enough to evict older readings.
//
//   RTDB: authoritative long-term store (written by ESP32).
//     Historical views (week / month / custom) always query RTDB directly
//     via fetchHistoryFromRTDB() and merge the result into _history for the
//     current page session only — RTDB data is never written back to
//     localStorage, so it can never displace the real-time buffer.
//
// Each entry: { ts: number (ms), ph, do, turb, temp }
// ---------------------------------------------------------------------------
const STORAGE_KEY_HISTORY = 'aquasense.sensorHistory.v1';
const MAX_HISTORY    = 2000;  // ~1–2 h at 30-second intervals
const MAX_BUFFER_HOURS = 2;   // prune localStorage to this rolling window

let _liveHistory = [];
let _rtdbHistory = [];

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    if (raw) _liveHistory = JSON.parse(raw);
  } catch {
    _liveHistory = [];
  }
}

/** Prune the localStorage buffer to the last MAX_BUFFER_HOURS hours. */
function pruneHistory() {
  const cutoff = Date.now() - MAX_BUFFER_HOURS * 60 * 60 * 1000;
  _liveHistory = _liveHistory.filter((e) => e.ts >= cutoff);
  if (_liveHistory.length > MAX_HISTORY) _liveHistory = _liveHistory.slice(-MAX_HISTORY);
}

function saveHistory() {
  try {
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(_liveHistory));
  } catch {
    // quota exceeded — trim aggressively and retry once
    _liveHistory = _liveHistory.slice(-Math.floor(MAX_HISTORY / 2));
    try { localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(_liveHistory)); } catch { /* ignore */ }
  }
}

loadHistory();

/**
 * Merge RTDB entries into the in-memory history for the current page session.
 *
 * Unlike mergeHistoryEntries(), this does NOT write to localStorage and does
 * NOT prune — RTDB data is authoritative and must not be evicted by the
 * short-term buffer logic. The merged data is available to getHistoryRange()
 * for the lifetime of the current page load only.
 */
export function mergeRtdbEntries(entries) {
  if (!entries || !entries.length) return;
  const existing = new Set(_rtdbHistory.map(e => e.ts));
  let added = 0;
  for (const e of entries) {
    if (!existing.has(e.ts)) {
      _rtdbHistory.push(e);
      added++;
    }
  }
  if (added > 0) {
    _rtdbHistory.sort((a, b) => a.ts - b.ts);
    // Do NOT call pruneHistory() or saveHistory() here — RTDB data must not
    // be written to localStorage or pruned by the real-time buffer logic.
  }
}

/**
 * @deprecated Use mergeRtdbEntries() for RTDB data.
 * Kept for backward compatibility with any callers that haven't been updated.
 * Behaves identically to mergeRtdbEntries() — in-memory only, no localStorage write.
 */
export function mergeHistoryEntries(entries) {
  mergeRtdbEntries(entries);
}

/**
 * Record a full sensor snapshot. Called from app.js whenever all four
 * sensor values are available (after each Firebase update cycle).
 */
export function recordSensorReading(ph, doVal, turb, temp, ts) {
  pruneHistory();
  _liveHistory.push({ ts: ts && Number.isFinite(ts) ? ts : Date.now(), ph, do: doVal, turb, temp });
  saveHistory();
}

/**
 * Returns all stored readings within [fromMs, toMs] (inclusive).
 */
export function getHistoryRange(fromMs, toMs) {
  const inRange = (e) => e.ts >= fromMs && e.ts <= toMs;
  const live = _liveHistory.filter(inRange);
  const rtdb = _rtdbHistory.filter(inRange);
  if (!live.length) return rtdb;
  if (!rtdb.length) return live;

  // Merge two sorted-ish arrays, dedupe by ts (RTDB wins if both exist).
  const byTs = new Map();
  for (const e of live) byTs.set(e.ts, e);
  for (const e of rtdb) byTs.set(e.ts, e);
  return Array.from(byTs.values()).sort((a, b) => a.ts - b.ts);
}

/**
 * Returns the full history array (read-only copy).
 */
export function getAllHistory() {
  const byTs = new Map();
  for (const e of _liveHistory) byTs.set(e.ts, e);
  for (const e of _rtdbHistory) byTs.set(e.ts, e);
  return Array.from(byTs.values()).sort((a, b) => a.ts - b.ts);
}

export function drawSpark(id, data, color) {
  const svg = document.getElementById('sp-' + id);
  if (!svg || data.length < 2) return;
  const W = svg.clientWidth || 220;
  const H = 28;
  const mn = Math.min(...data);
  const mx = Math.max(...data);
  const rng = mx - mn || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * W;
      const y = H - ((v - mn) / rng) * (H - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  svg.innerHTML = `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.85"/>`;
}

export function log(msg, type = '') {
  const ul = document.getElementById('loglist');
  if (!ul) return;
  const li = document.createElement('li');
  li.className = 'l' + type;
  const time = new Date().toTimeString().split(' ')[0];
  li.innerHTML = `<span class="lt">${time}</span><span class="lm">${msg}</span>`;
  ul.prepend(li);
  while (ul.children.length > 60) ul.removeChild(ul.lastChild);
}
