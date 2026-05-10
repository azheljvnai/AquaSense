/**
 * Feeding_Module — live Firebase RTDB-driven feeding management.
 *
 * Firebase RTDB paths (matching ESP32 firmware):
 *   /devices/{id}/feeding/manualFeed          boolean — set true to trigger feed
 *   /devices/{id}/feeding/schedules/times/0   "HH:MM" — schedule slot 0
 *   /devices/{id}/feeding/schedules/times/1   "HH:MM" — schedule slot 1
 *   ...
 *   /devices/{id}/feedLog/{timestamp-key}/reason     string
 *   /devices/{id}/feedLog/{timestamp-key}/timestamp  string "YYYY-MM-DD HH:MM:SS"
 */
import { initFeedingChart } from '../charts.js';
import {
  fbDatabase,
  fbRef,
  fbOnValue,
  fbSet,
  fbGet,
} from '../firebase-client.js';

// ── Module-level state ────────────────────────────────────────────────────────
let _deviceId          = null;   // active device ID
let _listeners         = [];     // RTDB unsubscribe functions
let _schedules         = [];     // [{ index, time }] sorted by time
let _logEntries        = [];     // [{ ts, type }] sorted descending, max 20
let _feedChart         = null;   // Chart.js instance
let _manualFeedTimeout = null;   // 10-second timeout handle
let _editingIndex      = null;   // schedule index being edited (null = new)
let _dispensing        = false;  // true while waiting for ESP32 to reset manualFeed

// ── Public API ────────────────────────────────────────────────────────────────

export function init() {
  // Initialise chart
  const canvasEl = document.getElementById('feed-chart');
  if (canvasEl) _feedChart = initFeedingChart(canvasEl);

  // Wire manual feed button
  const manualBtn = document.getElementById('feed-manual-btn');
  if (manualBtn) manualBtn.addEventListener('click', _triggerManualFeed);

  // Wire schedule form buttons
  document.getElementById('feed-add-schedule-btn')?.addEventListener('click', () => {
    _editingIndex = null;
    const input = document.getElementById('feed-schedule-input');
    if (input) input.value = '';
    _showScheduleError('');
    document.getElementById('feed-schedule-form').style.display = '';
  });
  document.getElementById('feed-schedule-confirm')?.addEventListener('click', _saveSchedule);
  document.getElementById('feed-schedule-cancel')?.addEventListener('click', () => {
    document.getElementById('feed-schedule-form').style.display = 'none';
    _showScheduleError('');
  });

  // Hide "no pond" message and show feeding content
  const noPondEl = document.getElementById('feed-no-pond');
  if (noPondEl) noPondEl.style.display = 'none';
  const contentEl = document.getElementById('feed-content');
  if (contentEl) contentEl.style.display = '';

  // Initialize with device001 directly
  _deviceId = 'device001';
  _subscribe('device001');

  // Listen for configuration changes to display config name
  window.addEventListener('config-changed', _updateConfigDisplay);
  _updateConfigDisplay(); // Initial update
}

// ── Subscribe / Teardown ──────────────────────────────────────────────────────

function _subscribe(deviceId) {
  const db = fbDatabase();

  // 1. Schedules listener — /feeding/schedules/times
  const timesRef = fbRef(db, `/devices/${deviceId}/feeding/schedules/times`);
  const unsubSchedules = fbOnValue(timesRef, (snap) => {
    _schedules = _parseSchedules(snap);
    _renderScheduleList();
    _updateMetricCards();
  }, (err) => console.error('[feeding] schedules listener error', err));
  _listeners.push(unsubSchedules);

  // 2. Feed log listener — /feedLog (firmware writes here; app also writes here)
  const logRef = fbRef(db, `/devices/${deviceId}/feedLog`);
  const unsubLog = fbOnValue(logRef, (snap) => {
    const entries = [];
    snap.forEach((child) => {
      const val = child.val();
      if (!val) return;
      // Firmware writes: { reason: "MANUAL"|"SCHED N", timestamp: "YYYY-MM-DD HH:MM:SS" }
      // App writes:      { reason: "Manual"|"Scheduled", timestamp: "YYYY-MM-DD HH:MM:SS" }
      if (typeof val.timestamp === 'string') {
        const ts = _parseTimestamp(val.timestamp);
        if (ts) {
          const rawReason = (val.reason || '').toUpperCase();
          const type = rawReason.startsWith('MANUAL') || rawReason === 'MANUAL' ? 'Manual' : 'Scheduled';
          entries.push({ ts, type });
        }
      }
    });
    entries.sort((a, b) => b.ts - a.ts);
    _logEntries = entries.slice(0, 20);
    _renderFeedLog();
    _updateMetricCards();
    _updateWeeklyChart();
  }, (err) => console.error('[feeding] feedLog listener error', err));
  _listeners.push(unsubLog);

  // 3. manualFeed listener
  const manualRef = fbRef(db, `/devices/${deviceId}/feeding/manualFeed`);
  const unsubManual = fbOnValue(manualRef, (snap) => {
    _syncFeedButton(snap.val());
  }, (err) => console.error('[feeding] manualFeed listener error', err));
  _listeners.push(unsubManual);
}

function _teardown() {
  _listeners.forEach((unsub) => { try { unsub(); } catch { /* ignore */ } });
  _listeners = [];
  _schedules = [];
  _logEntries = [];

  // Clear timeout
  if (_manualFeedTimeout) { clearTimeout(_manualFeedTimeout); _manualFeedTimeout = null; }
  _dispensing = false;

  // Reset UI
  const schedList = document.getElementById('feed-schedule-list');
  if (schedList) schedList.innerHTML = '';
  const logList = document.getElementById('feed-log-list');
  if (logList) logList.innerHTML = '';
  ['feed-metric-today', 'feed-metric-last', 'feed-metric-active', 'feed-metric-next'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  });
  const manualBtn = document.getElementById('feed-manual-btn');
  if (manualBtn) { manualBtn.disabled = false; manualBtn.textContent = '▶ Manual Feed'; }
  const manualStatus = document.getElementById('feed-manual-status');
  if (manualStatus) manualStatus.textContent = '';
  document.getElementById('feed-schedule-form').style.display = 'none';
}

// ── Schedule helpers ──────────────────────────────────────────────────────────

/**
 * Parse the /feeding/schedules/times snapshot.
 * Firebase stores numeric-keyed children as an array-like object:
 *   { "0": "07:00", "1": "12:00", "2": "18:00" }
 * Returns [{ index: 0, time: "07:00" }, ...]
 */
function _parseSchedules(snapshot) {
  const result = [];
  snapshot.forEach((child) => {
    const index = parseInt(child.key, 10);
    const val   = child.val();
    if (!isNaN(index) && typeof val === 'string' && /^\d{2}:\d{2}$/.test(val)) {
      result.push({ index, time: val });
    }
  });
  result.sort((a, b) => a.time.localeCompare(b.time));
  return result;
}

/**
 * Parse "YYYY-MM-DD HH:MM:SS" timestamp string → Unix ms.
 * Returns null if unparseable.
 */
function _parseTimestamp(str) {
  // "2025-05-10 14:30:00" → replace space with T for ISO parsing
  const iso = str.replace(' ', 'T');
  const ms  = Date.parse(iso);
  return isNaN(ms) ? null : ms;
}

export function _scheduleStatus(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const now     = new Date();
  const schedMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
  const diffMin = (schedMs - now.getTime()) / 60000;
  if (diffMin < 0)   return 'completed';
  if (diffMin <= 30) return 'upcoming';
  return 'scheduled';
}

function _fmt12h(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

function _renderScheduleList() {
  const ul = document.getElementById('feed-schedule-list');
  if (!ul) return;

  const perms = window._rbacPerms || { canEditSchedules: false };

  // Show/hide Add button
  const addBtn = document.getElementById('feed-add-schedule-btn');
  if (addBtn) addBtn.style.display = perms.canEditSchedules ? '' : 'none';

  if (_schedules.length === 0) {
    ul.innerHTML = '<li style="color:var(--text-muted);font-size:0.85rem;padding:12px 0;">No schedules configured for this device.</li>';
    return;
  }

  ul.innerHTML = _schedules.map(({ index, time }) => {
    const status = _scheduleStatus(time);
    const iconClass = status === 'completed' ? 'sched-icon--done'
      : status === 'upcoming' ? 'sched-icon--upcoming'
      : 'sched-icon--scheduled';
    const iconSvg = status === 'completed'
      ? '<svg class="icon icon-16"><use href="#icon-check"/></svg>'
      : '<svg class="icon icon-16"><use href="#icon-clock"/></svg>';
    const statusLabel = status === 'completed' ? '<span class="status-done">completed</span>'
      : status === 'upcoming' ? '<span class="status-pending">upcoming</span>'
      : '<span class="status-pending">scheduled</span>';
    const actions = perms.canEditSchedules
      ? `<span class="actions">
           <button class="um-btn-icon" data-action="edit" data-index="${index}" title="Edit">
             <svg class="icon icon-14"><use href="#icon-edit"/></svg>
           </button>
           <button class="um-btn-icon danger" data-action="delete" data-index="${index}" title="Delete">
             <svg class="icon icon-14"><use href="#icon-trash"/></svg>
           </button>
         </span>`
      : '';
    return `<li>
      <span class="sched-icon ${iconClass}">${iconSvg}</span>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:2px;">
          <span class="time">${_fmt12h(time)}</span>
          ${statusLabel}
        </div>
        <span class="sched-days">Every day</span>
      </div>
      ${actions}
    </li>`;
  }).join('');

  // Wire edit/delete buttons
  ul.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const index  = parseInt(btn.dataset.index, 10);
      if (action === 'edit')   _startEditSchedule(index);
      if (action === 'delete') _deleteSchedule(index);
    });
  });
}

function _startEditSchedule(index) {
  const sched = _schedules.find((s) => s.index === index);
  if (!sched) return;
  _editingIndex = index;
  const input = document.getElementById('feed-schedule-input');
  if (input) input.value = sched.time;
  _showScheduleError('');
  document.getElementById('feed-schedule-form').style.display = '';
}

async function _saveSchedule() {
  const perms = window._rbacPerms || { canEditSchedules: false };
  if (!perms.canEditSchedules) {
    console.warn('Permission denied: canEditSchedules required');
    return;
  }
  const input   = document.getElementById('feed-schedule-input');
  const timeVal = input ? input.value.trim() : '';
  if (!/^\d{2}:\d{2}$/.test(timeVal)) {
    _showScheduleError('Please enter a valid time (HH:MM).');
    return;
  }

  const db = fbDatabase();

  // Determine the index slot to write to
  const index = _editingIndex !== null
    ? _editingIndex
    : _nextScheduleIndex(_schedules.map((s) => s.index));

  try {
    // Write the time string to /feeding/schedules/times/<index>
    await fbSet(fbRef(db, `/devices/${_deviceId}/feeding/schedules/times/${index}`), timeVal);
    document.getElementById('feed-schedule-form').style.display = 'none';
    _editingIndex = null;
    _showScheduleError('');
  } catch (err) {
    _showScheduleError('Save failed: ' + (err?.message || String(err)));
  }
}

async function _deleteSchedule(index) {
  const perms = window._rbacPerms || { canEditSchedules: false };
  if (!perms.canEditSchedules) {
    console.warn('Permission denied: canEditSchedules required');
    return;
  }
  try {
    const db = fbDatabase();
    // Remove the slot by setting null, then compact remaining slots
    const remaining = _schedules
      .filter((s) => s.index !== index)
      .sort((a, b) => a.time.localeCompare(b.time));

    // Rebuild the times object from scratch so indices stay contiguous
    const newTimes = {};
    remaining.forEach((s, i) => { newTimes[i] = s.time; });

    await fbSet(fbRef(db, `/devices/${_deviceId}/feeding/schedules/times`), remaining.length ? newTimes : null);
  } catch (err) {
    console.error('[feeding] delete schedule error', err);
  }
}

export function _nextScheduleIndex(existingIndices) {
  if (existingIndices.length === 0) return 0;
  return Math.max(...existingIndices) + 1;
}

function _showScheduleError(msg) {
  const el = document.getElementById('feed-schedule-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? '' : 'none';
}

// ── Feed Log ──────────────────────────────────────────────────────────────────

function _fmtTimestamp(ms) {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function _renderFeedLog() {
  const container = document.getElementById('feed-log-list');
  if (!container) return;

  if (_logEntries.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:16px 0;">No feed events recorded yet.</p>';
    return;
  }

  container.innerHTML = _logEntries.map(({ ts, type }) => {
    const typeClass = type === 'Manual' ? 'feed-log-type--manual'
      : type === 'Scheduled' ? 'feed-log-type--auto'
      : 'feed-log-type--unknown';
    return `<div class="feed-log-row">
      <span class="feed-log-type ${typeClass}">${type}</span>
      <span class="feed-log-time">${_fmtTimestamp(ts)}</span>
    </div>`;
  }).join('');
}

// ── Metric Cards ──────────────────────────────────────────────────────────────

export function _nextScheduleTime(schedules) {
  const now = new Date();
  const candidates = schedules.map((s) => {
    const [h, m] = s.time.split(':').map(Number);
    const ms = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
    // If already passed today, wrap to tomorrow
    return ms > now.getTime() ? ms : ms + 86400000;
  });
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

function _fmtCountdown(ms) {
  const now     = Date.now();
  const diffMin = Math.round((ms - now) / 60000);
  const h       = Math.floor(diffMin / 60);
  const m       = diffMin % 60;
  const timeLabel = _fmt12h(new Date(ms).toTimeString().slice(0, 5));
  if (h === 0) return `in ${m}m (${timeLabel})`;
  return `in ${h}h ${m}m (${timeLabel})`;
}

export function _feedsTodayCount(logEntries) {
  const now        = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfDay   = startOfDay + 86400000;
  return logEntries.filter((e) => e.ts >= startOfDay && e.ts < endOfDay).length;
}

function _updateMetricCards() {
  // Feeds Today
  const todayEl = document.getElementById('feed-metric-today');
  if (todayEl) {
    const count = _feedsTodayCount(_logEntries);
    todayEl.textContent = _logEntries.length === 0 ? '—' : String(count);
  }

  // Last Fed
  const lastEl = document.getElementById('feed-metric-last');
  if (lastEl) {
    if (_logEntries.length === 0) {
      lastEl.textContent = '—';
    } else {
      const d = new Date(_logEntries[0].ts);
      lastEl.textContent = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
  }

  // Schedules Active
  const activeEl = document.getElementById('feed-metric-active');
  if (activeEl) activeEl.textContent = _schedules.length > 0 ? String(_schedules.length) : '—';

  // Next Feed
  const nextEl = document.getElementById('feed-metric-next');
  if (nextEl) {
    const nextMs = _nextScheduleTime(_schedules);
    nextEl.textContent = nextMs ? _fmtCountdown(nextMs) : '—';
  }
}

// ── Weekly Chart ──────────────────────────────────────────────────────────────

async function _updateWeeklyChart() {
  if (!_feedChart || !_deviceId) return;

  const DAY_MS = 86400000;
  const now    = new Date();
  const days   = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push({
      label: d.toLocaleDateString(undefined, { weekday: 'short' }),
      start: d.getTime(),
      end:   d.getTime() + DAY_MS,
    });
  }

  let allEntries = [];
  try {
    const db     = fbDatabase();
    const logRef = fbRef(db, `/devices/${_deviceId}/feedLog`);
    const snap   = await fbGet(logRef);
    snap.forEach((child) => {
      const val = child.val();
      if (val && typeof val.timestamp === 'string') {
        const ts = _parseTimestamp(val.timestamp);
        if (ts) allEntries.push(ts);
      }
    });
  } catch (err) {
    console.error('[feeding] weekly chart fetch error', err);
    allEntries = _logEntries.map((e) => e.ts);
  }

  const counts = days.map(({ start, end }) =>
    allEntries.filter((ts) => ts >= start && ts < end).length
  );

  _feedChart.data.labels          = days.map((d) => d.label);
  _feedChart.data.datasets[0].data = counts;
  _feedChart.update('active');
}

// ── Manual Feed ───────────────────────────────────────────────────────────────

/**
 * Write a feed log entry to /feedLog/<timestamp-key> matching the firmware format:
 *   { reason: "Manual", timestamp: "YYYY-MM-DD HH:MM:SS" }
 */
function _fmtRTDBTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
         `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function _timestampToKey(ts) {
  // "2025-05-10 14:30:00" → "2025-05-10_14-30-00"
  return ts.replace(' ', '_').replace(/:/g, '-');
}

async function _writeFeedLog(deviceId, reason) {
  const db  = fbDatabase();
  const ts  = _fmtRTDBTimestamp(new Date());
  const key = _timestampToKey(ts);
  await fbSet(fbRef(db, `/devices/${deviceId}/feedLog/${key}`), { reason, timestamp: ts });
}

async function _triggerManualFeed() {
  const perms = window._rbacPerms || { canTriggerFeed: true };
  if (!perms.canTriggerFeed) {
    console.warn('[feeding] Permission denied: canTriggerFeed required');
    return;
  }
  if (!_deviceId) return;

  const btn      = document.getElementById('feed-manual-btn');
  const statusEl = document.getElementById('feed-manual-status');

  try {
    // Log first, then set the flag so the ESP32 picks it up
    await _writeFeedLog(_deviceId, 'Manual');
    const db = fbDatabase();
    await fbSet(fbRef(db, `/devices/${_deviceId}/feeding/manualFeed`), true);

    if (btn)      { btn.disabled = true; btn.textContent = '⟳ Dispensing…'; }
    if (statusEl) statusEl.textContent = '';
    _dispensing = true;

    // 10-second timeout guard in case ESP32 is offline
    _manualFeedTimeout = setTimeout(() => {
      _manualFeedTimeout = null;
      _dispensing        = false;
      if (btn)      { btn.disabled = false; btn.textContent = '▶ Manual Feed'; }
      if (statusEl) statusEl.textContent = 'Timeout — ESP32 may be offline';
    }, 10000);
  } catch (err) {
    if (btn)      { btn.disabled = false; btn.textContent = '▶ Manual Feed'; }
    if (statusEl) statusEl.textContent = 'Error: ' + (err?.message || String(err));
  }
}

function _syncFeedButton(manualFeedVal) {
  const btn      = document.getElementById('feed-manual-btn');
  const statusEl = document.getElementById('feed-manual-status');

  if (!manualFeedVal) {
    // ESP32 reset the flag — clear timeout and re-enable
    if (_manualFeedTimeout) {
      clearTimeout(_manualFeedTimeout);
      _manualFeedTimeout = null;
    }
    if (btn)                    { btn.disabled = false; btn.textContent = '▶ Manual Feed'; }
    if (statusEl && _dispensing) statusEl.textContent = 'Feed complete ✓';
    _dispensing = false;
  }
}

// ── Configuration Display ─────────────────────────────────────────────────────

function _updateConfigDisplay(event) {
  const configNameEl = document.getElementById('feed-config-name');
  if (!configNameEl) return;

  // Get configuration info from the event detail or fetch from pond-config
  let configName = 'Not Configured';
  
  if (event && event.detail) {
    // Event fired from pond-config.js with detail: { configId, species }
    const { configId, species } = event.detail;
    if (configId && species) {
      // Capitalize species name for display
      configName = species.charAt(0).toUpperCase() + species.slice(1) + ' Configuration';
    }
  } else {
    // Initial load - try to get from pond-config module
    try {
      // Import getActiveConfigId and getActiveSpecies if available
      import('../pond-config.js').then(module => {
        const configId = module.getActiveConfigId();
        const species = module.getActiveSpecies();
        if (configId && species) {
          configName = species.charAt(0).toUpperCase() + species.slice(1) + ' Configuration';
        }
        configNameEl.textContent = configName;
      }).catch(() => {
        configNameEl.textContent = 'Not Configured';
      });
      return; // Exit early since we're handling async
    } catch {
      configName = 'Not Configured';
    }
  }
  
  configNameEl.textContent = configName;
}
