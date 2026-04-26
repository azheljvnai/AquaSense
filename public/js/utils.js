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
    if (val <= 20) return { c: 'ok',         l: 'Clear / Optimal' };
    if (val <= 40) return { c: 'acceptable', l: 'Slightly Turbid / Acceptable' };
    if (val <= 70) return { c: 'stress',     l: 'Moderate / Stress Risk' };
    if (val <= 90) return { c: 'warn',       l: 'High / Poor' };
    return                { c: 'danger',     l: 'Critical' };
  }
  if (key === 'temp') {
    if (val >= 20 && val <= 26) return { c: 'ok',        l: 'Optimal' };
    if ((val >= 17 && val <= 19) || (val >= 27 && val <= 29)) return { c: 'acceptable', l: 'Acceptable' };
    if ((val >= 14 && val <= 16) || (val >= 30 && val <= 32)) return { c: 'stress',     l: 'Stress Risk' };
    return                                                            { c: 'danger',     l: 'Critical' };
  }
  if (key === 'ph') {
    if (val >= 6.5 && val <= 8.5) return { c: 'ok',        l: 'Optimal' };
    if ((val >= 6.0 && val < 6.5) || (val > 8.5 && val <= 9.0)) return { c: 'acceptable', l: 'Acceptable' };
    if ((val >= 5.5 && val < 6.0) || (val > 9.0 && val <= 9.5)) return { c: 'stress',     l: 'Stress Risk' };
    return                                                               { c: 'danger',     l: 'Critical' };
  }
  if (key === 'do') {
    if (val > 6)              return { c: 'ok',         l: 'Optimal' };
    if (val >= 5 && val <= 6) return { c: 'acceptable', l: 'Acceptable' };
    if (val >= 3 && val < 5)  return { c: 'stress',     l: 'Stress Risk' };
    return                           { c: 'danger',     l: 'Critical' };
  }
  const t = thresh[key];
  if (!t) return { c: 'ok', l: 'Normal' };
  if (val >= t.ok[0] && val <= t.ok[1]) return { c: 'ok', l: 'Optimal' };
  return { c: 'danger', l: 'Critical' };
}

export const spkData = { ph: [], do: [], turb: [], temp: [] };
export const spkCol = { ph: '#22c55e', do: '#3b82f6', turb: '#eab308', temp: '#ef4444' };

// ---------------------------------------------------------------------------
// Sensor History — persists timestamped readings to localStorage
// Each entry: { ts: number (ms), ph: number, do: number, turb: number, temp: number }
// Keeps up to MAX_HISTORY entries; prunes entries older than MAX_AGE_DAYS days.
// ---------------------------------------------------------------------------
const STORAGE_KEY_HISTORY = 'aquasense.sensorHistory.v1';
const MAX_HISTORY = 5000;
const MAX_AGE_DAYS = 35; // keep ~5 weeks so monthly reports always have data

let _history = [];

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    if (raw) _history = JSON.parse(raw);
  } catch {
    _history = [];
  }
}

function pruneHistory() {
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  _history = _history.filter((e) => e.ts >= cutoff);
  if (_history.length > MAX_HISTORY) _history = _history.slice(-MAX_HISTORY);
}

function saveHistory() {
  try {
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(_history));
  } catch {
    // quota exceeded — trim aggressively and retry once
    _history = _history.slice(-Math.floor(MAX_HISTORY / 2));
    try { localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(_history)); } catch { /* ignore */ }
  }
}

loadHistory();

/**
 * Merge entries fetched from RTDB into local history (deduplicates by ts).
 * Call this after fetchHistoryFromRTDB to keep localStorage in sync.
 */
export function mergeHistoryEntries(entries) {
  if (!entries || !entries.length) return;
  const existing = new Set(_history.map(e => e.ts));
  let added = 0;
  for (const e of entries) {
    if (!existing.has(e.ts)) {
      _history.push(e);
      added++;
    }
  }
  if (added > 0) {
    _history.sort((a, b) => a.ts - b.ts);
    pruneHistory();
    saveHistory();
  }
}

/**
 * Record a full sensor snapshot. Called from app.js whenever all four
 * sensor values are available (after each Firebase update cycle).
 */
export function recordSensorReading(ph, doVal, turb, temp, ts) {
  pruneHistory();
  _history.push({ ts: ts && Number.isFinite(ts) ? ts : Date.now(), ph, do: doVal, turb, temp });
  saveHistory();
}

/**
 * Returns all stored readings within [fromMs, toMs] (inclusive).
 */
export function getHistoryRange(fromMs, toMs) {
  return _history.filter((e) => e.ts >= fromMs && e.ts <= toMs);
}

/**
 * Returns the full history array (read-only copy).
 */
export function getAllHistory() {
  return [..._history];
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
