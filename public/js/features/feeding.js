/**
 * Feeding_Module — live Firebase RTDB-driven feeding management.
 * Replaces all static content in #page-feeding with real data.
 */
import { initFeedingChart } from '../charts.js';
import {
  fbDatabase,
  fbRef,
  fbOnValue,
  fbSet,
  fbGet,
} from '../firebase-client.js';
import { getActivePond } from '../pond-context.js';

// ── Module-level state ────────────────────────────────────────────────────────
let _deviceId          = null;   // active device ID
let _listeners         = [];     // RTDB unsubscribe functions
let _schedules         = [];     // [{ key, time, days }] sorted by time
let _logEntries        = [];     // [{ ts, type }] sorted descending, max 20
let _feedChart         = null;   // Chart.js instance
let _manualFeedTimeout = null;   // 10-second timeout handle
let _editingKey        = null;   // schedule key being edited (null = new)
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
    _editingKey = null;
    const input = document.getElementById('feed-schedule-input');
    if (input) input.value = '';
    // Reset all day checkboxes to checked (default: every day)
    for (let i = 0; i <= 6; i++) {
      const checkbox = document.getElementById(`feed-day-${i}`);
      if (checkbox) checkbox.checked = true;
    }
    _showScheduleError('');
    document.getElementById('feed-schedule-form').style.display = '';
  });
  document.getElementById('feed-schedule-confirm')?.addEventListener('click', _saveSchedule);
  document.getElementById('feed-schedule-cancel')?.addEventListener('click', () => {
    document.getElementById('feed-schedule-form').style.display = 'none';
    _showScheduleError('');
  });

  // Listen for active pond changes
  window.addEventListener('active-pond-changed', (e) => {
    const pond = e.detail?.pond;
    if (!pond?.id) {
      _teardown();
      const noPond = document.getElementById('feed-no-pond');
      const content = document.getElementById('feed-content');
      if (noPond) noPond.style.display = '';
      if (content) content.style.display = 'none';
      return;
    }
    const noPond = document.getElementById('feed-no-pond');
    const content = document.getElementById('feed-content');
    if (noPond) noPond.style.display = 'none';
    if (content) content.style.display = '';
    _teardown();
    _deviceId = pond.id;
    _subscribe(pond.id);
  });

  // Bootstrap with currently active pond
  const current = getActivePond();
  if (current?.id) {
    const noPond = document.getElementById('feed-no-pond');
    const content = document.getElementById('feed-content');
    if (noPond) noPond.style.display = 'none';
    if (content) content.style.display = '';
    _deviceId = current.id;
    _subscribe(current.id);
  } else {
    const noPond = document.getElementById('feed-no-pond');
    const content = document.getElementById('feed-content');
    if (noPond) noPond.style.display = '';
    if (content) content.style.display = 'none';
  }
}

// ── Subscribe / Teardown ──────────────────────────────────────────────────────

function _subscribe(deviceId) {
  const db = fbDatabase();

  // 1. Schedules listener — whole feeding node
  const feedingRef = fbRef(db, `/devices/${deviceId}/feeding`);
  const unsubFeeding = fbOnValue(feedingRef, (snap) => {
    _schedules = _parseSchedules(snap);
    _renderScheduleList();
    _updateMetricCards();
  }, (err) => console.error('[feeding] schedules listener error', err));
  _listeners.push(unsubFeeding);

  // 2. Log listener
  const logRef = fbRef(db, `/devices/${deviceId}/feeding/log`);
  const unsubLog = fbOnValue(logRef, (snap) => {
    const entries = [];
    snap.forEach((child) => {
      const val = child.val();
      if (val && typeof val.ts === 'number') {
        entries.push({ ts: val.ts, type: val.type || 'Auto' });
      }
    });
    entries.sort((a, b) => b.ts - a.ts);
    _logEntries = entries.slice(0, 20);
    _renderFeedLog();
    _updateMetricCards();
    _updateWeeklyChart();
  }, (err) => console.error('[feeding] log listener error', err));
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

function _parseSchedules(snapshot) {
  const result = [];
  snapshot.forEach((child) => {
    if (/^schedule\d+$/.test(child.key)) {
      const val = child.val();
      // Backward compatibility: handle both string (legacy) and object format
      if (typeof val === 'string' && /^\d{2}:\d{2}$/.test(val)) {
        // Legacy format: treat as every day
        result.push({ key: child.key, time: val, days: [0, 1, 2, 3, 4, 5, 6] });
      } else if (val && typeof val === 'object' && typeof val.time === 'string' && /^\d{2}:\d{2}$/.test(val.time)) {
        // New format: { time, days }
        const days = Array.isArray(val.days) ? val.days : [0, 1, 2, 3, 4, 5, 6];
        result.push({ key: child.key, time: val.time, days });
      }
    }
  });
  result.sort((a, b) => a.time.localeCompare(b.time));
  return result;
}

export function _scheduleStatus(timeStr, days) {
  const [h, m] = timeStr.split(':').map(Number);
  const now = new Date();
  const todayDay = now.getDay(); // 0 = Sunday, 6 = Saturday
  
  // Check if schedule applies to today
  if (!days || !days.includes(todayDay)) {
    return 'not-today';
  }
  
  const schedMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
  const diffMin = (schedMs - now.getTime()) / 60000;
  if (diffMin < 0)   return 'completed';
  if (diffMin <= 30) return 'upcoming';
  return 'scheduled';
}

function _fmt12h(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

function _fmtDays(days) {
  if (!days || days.length === 0) return 'Never';
  if (days.length === 7) return 'Every day';
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days.map(d => dayNames[d]).join(', ');
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

  ul.innerHTML = _schedules.map(({ key, time, days }) => {
    const status = _scheduleStatus(time, days);
    const iconClass = status === 'completed' ? 'sched-icon--done'
      : status === 'upcoming' ? 'sched-icon--upcoming'
      : status === 'not-today' ? 'sched-icon--inactive'
      : 'sched-icon--scheduled';
    const iconSvg = status === 'completed'
      ? '<svg class="icon icon-16"><use href="#icon-check"/></svg>'
      : '<svg class="icon icon-16"><use href="#icon-clock"/></svg>';
    const statusLabel = status === 'completed' ? '<span class="status-done">completed</span>'
      : status === 'upcoming' ? '<span class="status-pending">upcoming</span>'
      : status === 'not-today' ? '<span class="status-inactive">not today</span>'
      : '<span class="status-pending">scheduled</span>';
    const daysLabel = `<span class="sched-days">${_fmtDays(days)}</span>`;
    const actions = perms.canEditSchedules
      ? `<span class="actions">
           <button class="um-btn-icon" data-action="edit" data-key="${key}" title="Edit">
             <svg class="icon icon-14"><use href="#icon-edit"/></svg>
           </button>
           <button class="um-btn-icon danger" data-action="delete" data-key="${key}" title="Delete">
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
        ${daysLabel}
      </div>
      ${actions}
    </li>`;
  }).join('');

  // Wire edit/delete buttons
  ul.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const key = btn.dataset.key;
      if (action === 'edit') _startEditSchedule(key);
      if (action === 'delete') _deleteSchedule(key);
    });
  });
}

function _startEditSchedule(key) {
  const sched = _schedules.find((s) => s.key === key);
  if (!sched) return;
  _editingKey = key;
  const input = document.getElementById('feed-schedule-input');
  if (input) input.value = sched.time;
  
  // Set day checkboxes
  for (let i = 0; i <= 6; i++) {
    const checkbox = document.getElementById(`feed-day-${i}`);
    if (checkbox) {
      checkbox.checked = sched.days && sched.days.includes(i);
    }
  }
  
  _showScheduleError('');
  document.getElementById('feed-schedule-form').style.display = '';
}

async function _saveSchedule() {
  const perms = window._rbacPerms || { canEditSchedules: false };
  if (!perms.canEditSchedules) {
    console.warn('Permission denied: canEditSchedules required');
    return;
  }
  const input = document.getElementById('feed-schedule-input');
  const timeVal = input ? input.value.trim() : '';
  if (!/^\d{2}:\d{2}$/.test(timeVal)) {
    _showScheduleError('Please enter a valid time (HH:MM).');
    return;
  }
  
  // Collect selected days
  const days = [];
  for (let i = 0; i <= 6; i++) {
    const checkbox = document.getElementById(`feed-day-${i}`);
    if (checkbox && checkbox.checked) {
      days.push(i);
    }
  }
  
  if (days.length === 0) {
    _showScheduleError('Please select at least one day.');
    return;
  }
  
  const db = fbDatabase();
  const key = _editingKey || _nextScheduleKey(_schedules.map((s) => s.key));
  try {
    // Write as object: { time, days }
    await fbSet(fbRef(db, `/devices/${_deviceId}/feeding/${key}`), { time: timeVal, days });
    document.getElementById('feed-schedule-form').style.display = 'none';
    _editingKey = null;
    _showScheduleError('');
  } catch (err) {
    _showScheduleError('Save failed: ' + (err?.message || String(err)));
  }
}

async function _deleteSchedule(key) {
  const perms = window._rbacPerms || { canEditSchedules: false };
  if (!perms.canEditSchedules) {
    console.warn('Permission denied: canEditSchedules required');
    return;
  }
  try {
    const db = fbDatabase();
    // Use set(null) to remove — equivalent to remove()
    await fbSet(fbRef(db, `/devices/${_deviceId}/feeding/${key}`), null);
  } catch (err) {
    console.error('[feeding] delete schedule error', err);
  }
}

export function _nextScheduleKey(existingKeys) {
  const nums = existingKeys
    .map((k) => parseInt(k.replace('schedule', ''), 10))
    .filter((n) => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return `schedule${max + 1}`;
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
    const rawType = type || 'Auto';
    const typeClass = rawType.toLowerCase() === 'manual' ? 'feed-log-type--manual'
      : rawType.toLowerCase() === 'auto' ? 'feed-log-type--auto'
      : 'feed-log-type--unknown';
    return `<div class="feed-log-row">
      <span class="feed-log-type ${typeClass}">${rawType}</span>
      <span class="feed-log-time">${_fmtTimestamp(ts)}</span>
    </div>`;
  }).join('');
}

// ── Metric Cards ──────────────────────────────────────────────────────────────

export function _nextScheduleTime(schedules) {
  const now = new Date();
  const todayDay = now.getDay();
  
  // Helper to get ms for a specific day and time
  const getMs = (dayOffset, h, m) => {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  
  const candidates = [];
  
  schedules.forEach((s) => {
    const [h, m] = s.time.split(':').map(Number);
    const days = s.days || [0, 1, 2, 3, 4, 5, 6];
    
    // Check each day in the schedule
    days.forEach((day) => {
      // Calculate how many days ahead this day is
      let daysAhead = day - todayDay;
      if (daysAhead < 0) daysAhead += 7; // Next week
      
      const ms = getMs(daysAhead, h, m);
      
      // Only include if it's in the future
      if (ms > now.getTime()) {
        candidates.push(ms);
      }
    });
  });
  
  if (candidates.length === 0) return null;
  
  // Return the earliest future occurrence
  return Math.min(...candidates);
}

function _fmtCountdown(ms) {
  const now = Date.now();
  const diffMin = Math.round((ms - now) / 60000);
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  const timeLabel = _fmt12h(new Date(ms).toTimeString().slice(0, 5));
  if (h === 0) return `in ${m}m (${timeLabel})`;
  return `in ${h}h ${m}m (${timeLabel})`;
}

export function _feedsTodayCount(logEntries) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfDay = startOfDay + 86400000;
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

  // Build 7-day window (rolling, ending today)
  const DAY_MS = 86400000;
  const now = new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push({
      label: d.toLocaleDateString(undefined, { weekday: 'short' }),
      start: d.getTime(),
      end: d.getTime() + DAY_MS,
    });
  }

  // Fetch all log entries for the 7-day window via a one-time get()
  let allEntries = [];
  try {
    const db = fbDatabase();
    const logRef = fbRef(db, `/devices/${_deviceId}/feeding/log`);
    const snap = await fbGet(logRef);
    snap.forEach((child) => {
      const val = child.val();
      if (val && typeof val.ts === 'number') allEntries.push(val.ts);
    });
  } catch (err) {
    console.error('[feeding] weekly chart fetch error', err);
    // Fall back to in-memory entries
    allEntries = _logEntries.map((e) => e.ts);
  }

  const counts = days.map(({ start, end }) =>
    allEntries.filter((ts) => ts >= start && ts < end).length
  );

  _feedChart.data.labels = days.map((d) => d.label);
  _feedChart.data.datasets[0].data = counts;
  _feedChart.update('active');
}

// ── Manual Feed ───────────────────────────────────────────────────────────────

async function _writeFeedLog(deviceId, type) {
  const ts = Date.now();
  const db = fbDatabase();
  await fbSet(fbRef(db, `/devices/${deviceId}/feeding/log/${ts}`), { ts, type });
}

async function _triggerManualFeed() {
  const perms = window._rbacPerms || { canTriggerFeed: true };
  if (!perms.canTriggerFeed) {
    console.warn('[feeding] Permission denied: canTriggerFeed required');
    return;
  }
  if (!_deviceId) return;

  const btn = document.getElementById('feed-manual-btn');
  const statusEl = document.getElementById('feed-manual-status');

  try {
    await _writeFeedLog(_deviceId, 'Manual');
    const db = fbDatabase();
    await fbSet(fbRef(db, `/devices/${_deviceId}/feeding/manualFeed`), true);

    if (btn) { btn.disabled = true; btn.textContent = '⟳ Dispensing…'; }
    if (statusEl) statusEl.textContent = '';
    _dispensing = true;

    // 10-second timeout guard
    _manualFeedTimeout = setTimeout(() => {
      _manualFeedTimeout = null;
      _dispensing = false;
      if (btn) { btn.disabled = false; btn.textContent = '▶ Manual Feed'; }
      if (statusEl) statusEl.textContent = 'Timeout — ESP32 may be offline';
    }, 10000);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = '▶ Manual Feed'; }
    if (statusEl) statusEl.textContent = 'Error: ' + (err?.message || String(err));
  }
}

function _syncFeedButton(manualFeedVal) {
  const btn = document.getElementById('feed-manual-btn');
  const statusEl = document.getElementById('feed-manual-status');

  if (!manualFeedVal) {
    // ESP32 reset the flag — clear timeout and re-enable
    if (_manualFeedTimeout) {
      clearTimeout(_manualFeedTimeout);
      _manualFeedTimeout = null;
    }
    if (btn) { btn.disabled = false; btn.textContent = '▶ Manual Feed'; }
    if (statusEl && _dispensing) statusEl.textContent = 'Feed complete ✓';
    _dispensing = false;
  }
}
