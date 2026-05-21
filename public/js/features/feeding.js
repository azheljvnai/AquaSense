/**
 * Feeding_Module — live Firebase RTDB-driven feeding management.
 *
 * Firebase RTDB paths (matching ESP32 firmware):
 *   /devices/{id}/feeding/manualFeed          boolean — set true to trigger feed
 *   /devices/{id}/feeding/schedules/times/0   "HH:MM" — schedule slot 0
 *   /devices/{id}/feeding/schedules/days/0   [0..6] — repeat days (0=Sun)
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
import { log } from '../utils.js';
import {
  showAppToast,
  showAlertModal,
  showConfirmModal,
  escHtml,
} from '../ui/modal-ui.js';

// ── Module-level state ────────────────────────────────────────────────────────
let _deviceId          = null;   // active device ID
let _listeners         = [];     // RTDB unsubscribe functions
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let _schedules         = [];     // [{ index, time, days }] sorted by time
let _timesByIndex      = {};
let _daysByIndex       = {};
let _logEntries        = [];     // [{ ts, type }] sorted descending, max 20
let _feedChart         = null;   // Chart.js instance
let _manualFeedTimeout = null;   // 10-second timeout handle
let _editingIndex      = null;   // schedule index being edited (null = new)
let _formSnapshot      = null;   // { time, days } when add/edit form is open
let _dispensing        = false;  // true while waiting for ESP32 to reset manualFeed
let _firebaseConnected = false;  // RTDB connect state (dashboard feed-btn gate)

// ── Public API ────────────────────────────────────────────────────────────────

export function init(deviceId = 'device001') {
  const canvasEl = document.getElementById('feed-chart');
  if (canvasEl) _feedChart = initFeedingChart(canvasEl);

  document.getElementById('feed-manual-btn')?.addEventListener('click', triggerManualFeed);
  document.getElementById('feed-btn')?.addEventListener('click', triggerManualFeed);
  document.getElementById('dash-save-schedules')?.addEventListener('click', _saveDashboardSchedules);

  const extraEl = document.getElementById('dashboard-feed-extra');
  if (extraEl) {
    extraEl.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof window.navigateTo === 'function') window.navigateTo('feeding');
    });
  }

  document.getElementById('feed-add-schedule-btn')?.addEventListener('click', () => {
    _editingIndex = null;
    const input = document.getElementById('feed-schedule-input');
    if (input) input.value = '';
    _setDayCheckboxes(ALL_DAYS);
    _clearScheduleFieldError();
    _openScheduleForm();
  });
  document.getElementById('feed-schedule-confirm')?.addEventListener('click', _saveSchedule);
  document.getElementById('feed-schedule-cancel')?.addEventListener('click', _cancelScheduleForm);
  document.getElementById('feed-schedule-input')?.addEventListener('input', _clearScheduleFieldError);
  for (let d = 0; d <= 6; d++) {
    document.getElementById(`feed-day-${d}`)?.addEventListener('change', _clearScheduleFieldError);
  }

  const noPondEl = document.getElementById('feed-no-pond');
  if (noPondEl) noPondEl.style.display = 'none';
  const contentEl = document.getElementById('feed-content');
  if (contentEl) contentEl.style.display = '';

  _deviceId = deviceId || 'device001';
  if (_listeners.length) _teardown();
  _subscribe(_deviceId);
  _migrateLegacySchedules(_deviceId);

  window.addEventListener('config-changed', _updateConfigDisplay);
  _updateConfigDisplay();
}

/** Called from firebase connect/disconnect to gate the dashboard feed button. */
export function setFirebaseConnected(connected) {
  _firebaseConnected = connected;
  if (!_dispensing) _applyFeedButtonConnectedState();
}

// ── Subscribe / Teardown ──────────────────────────────────────────────────────

function _subscribe(deviceId) {
  const db = fbDatabase();

  // 1. Schedules listeners — times + repeat days
  _timesByIndex = {};
  _daysByIndex = {};
  const timesRef = fbRef(db, `/devices/${deviceId}/feeding/schedules/times`);
  const unsubTimes = fbOnValue(timesRef, (snap) => {
    _timesByIndex = _parseTimesMap(snap);
    _rebuildSchedules();
  }, (err) => console.error('[feeding] schedules/times listener error', err));
  _listeners.push(unsubTimes);

  const daysRef = fbRef(db, `/devices/${deviceId}/feeding/schedules/days`);
  const unsubDays = fbOnValue(daysRef, (snap) => {
    _daysByIndex = _parseDaysMap(snap);
    _rebuildSchedules();
  }, (err) => console.error('[feeding] schedules/days listener error', err));
  _listeners.push(unsubDays);

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
  _timesByIndex = {};
  _daysByIndex = {};
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
  _closeScheduleForm();
}

// ── Schedule helpers ──────────────────────────────────────────────────────────

function _parseTimesMap(snapshot) {
  const result = {};
  snapshot.forEach((child) => {
    const index = parseInt(child.key, 10);
    const val   = child.val();
    if (!isNaN(index) && typeof val === 'string' && /^\d{2}:\d{2}$/.test(val)) {
      result[index] = val;
    }
  });
  return result;
}

function _parseDaysVal(val) {
  if (Array.isArray(val)) return normalizeDays(val.map((n) => Number(n)));
  if (typeof val === 'string' && val.trim()) {
    return normalizeDays(val.split(',').map((n) => Number(n.trim())));
  }
  return [...ALL_DAYS];
}

function _parseDaysMap(snapshot) {
  const result = {};
  snapshot.forEach((child) => {
    const index = parseInt(child.key, 10);
    if (!isNaN(index)) result[index] = _parseDaysVal(child.val());
  });
  return result;
}

function _rebuildSchedules() {
  const indices = new Set([
    ...Object.keys(_timesByIndex).map(Number),
    ...Object.keys(_daysByIndex).map(Number),
  ]);
  _schedules = [...indices]
    .map((index) => {
      const time = _timesByIndex[index];
      if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) return null;
      return {
        index,
        time,
        days: normalizeDays(_daysByIndex[index] ?? ALL_DAYS),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.time.localeCompare(b.time));
  _renderScheduleList();
  _hydrateDashboardInputs();
  _updateMetricCards();
}

export function normalizeDays(days) {
  if (!Array.isArray(days)) return [];
  return [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
}

export function formatScheduleDaysLabel(days) {
  const normalized = normalizeDays(days);
  if (normalized.length === 0) return 'No days selected';
  if (normalized.length === 7) return 'Every day';
  return normalized.map((d) => DAY_LABELS[d]).join(', ');
}

function _getSelectedDays() {
  const days = [];
  for (let d = 0; d <= 6; d++) {
    const cb = document.getElementById(`feed-day-${d}`);
    if (cb?.checked) days.push(d);
  }
  return days;
}

function _setDayCheckboxes(days) {
  const normalized = normalizeDays(days);
  for (let d = 0; d <= 6; d++) {
    const cb = document.getElementById(`feed-day-${d}`);
    if (cb) cb.checked = normalized.includes(d);
  }
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

/** Next occurrence (ms) for a recurring schedule; null if no valid days. */
export function _nextOccurrenceMs(timeStr, days, nowMs = Date.now()) {
  const normalized = normalizeDays(days);
  if (normalized.length === 0) return null;

  const now = new Date(nowMs);
  const todayDay = now.getDay();
  const [h, m] = timeStr.split(':').map(Number);
  let best = null;

  normalized.forEach((day) => {
    let daysAhead = day - todayDay;
    if (daysAhead < 0) daysAhead += 7;
    const d = new Date(now);
    d.setDate(d.getDate() + daysAhead);
    d.setHours(h, m, 0, 0);
    let ms = d.getTime();
    if (ms <= nowMs) ms += 7 * 86400000;
    if (best === null || ms < best) best = ms;
  });

  return best;
}

/** Recurring schedules: upcoming or scheduled (never completed / not-today). */
export function _scheduleStatus(timeStr, days = ALL_DAYS, nowMs = Date.now()) {
  const normalized = normalizeDays(days);
  const effectiveDays = normalized.length > 0 ? normalized : ALL_DAYS;
  const nextMs = _nextOccurrenceMs(timeStr, effectiveDays, nowMs);
  if (nextMs === null) return 'scheduled';

  const diffMin = (nextMs - nowMs) / 60000;
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
    ul.innerHTML = '<li class="empty-state empty-state--tight text-sm muted">No schedules configured for this device.</li>';
    return;
  }

  ul.innerHTML = _schedules.map(({ index, time, days }) => {
    const status = _scheduleStatus(time, days);
    const iconClass = status === 'upcoming' ? 'sched-icon--upcoming' : 'sched-icon--scheduled';
    const iconSvg = '<svg class="icon icon-16"><use href="#icon-clock"/></svg>';
    const statusLabel = status === 'upcoming'
      ? '<span class="status-pending">upcoming</span>'
      : '<span class="status-pending">scheduled</span>';
    const daysLabel = formatScheduleDaysLabel(days);
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
      <div class="feed-sched-li-main">
        <div class="feed-sched-li-head">
          <span class="time">${_fmt12h(time)}</span>
          ${statusLabel}
        </div>
        <span class="sched-days">${escHtml(daysLabel)}</span>
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
      if (action === 'delete') _confirmDeleteSchedule(index);
    });
  });
}

function _captureFormSnapshot() {
  return {
    time: document.getElementById('feed-schedule-input')?.value.trim() || '',
    days: normalizeDays(_getSelectedDays()),
  };
}

function _isFormDirty() {
  if (!_formSnapshot) return false;
  const cur = _captureFormSnapshot();
  return cur.time !== _formSnapshot.time
    || cur.days.join(',') !== _formSnapshot.days.join(',');
}

function _openScheduleForm() {
  document.getElementById('feed-schedule-form').style.display = '';
  _formSnapshot = _captureFormSnapshot();
}

function _closeScheduleForm() {
  document.getElementById('feed-schedule-form').style.display = 'none';
  _editingIndex = null;
  _formSnapshot = null;
  _clearScheduleFieldError();
}

function _startEditSchedule(index) {
  const sched = _schedules.find((s) => s.index === index);
  if (!sched) return;
  _editingIndex = index;
  const input = document.getElementById('feed-schedule-input');
  if (input) input.value = sched.time;
  _setDayCheckboxes(sched.days);
  _clearScheduleFieldError();
  _openScheduleForm();
}

function _cancelScheduleForm() {
  if (!_isFormDirty()) {
    _closeScheduleForm();
    return;
  }
  showConfirmModal({
    title: 'Discard changes?',
    message: 'Unsaved changes will be lost.',
    confirmLabel: 'Discard',
    cancelLabel: 'Keep editing',
    destructive: true,
    onConfirm: async () => { _closeScheduleForm(); },
  });
}

async function _saveScheduleAtIndex(index, timeVal, days) {
  const db = fbDatabase();
  const normalizedDays = normalizeDays(days);
  await fbSet(fbRef(db, `/devices/${_deviceId}/feeding/schedules/times/${index}`), timeVal);
  await fbSet(fbRef(db, `/devices/${_deviceId}/feeding/schedules/days/${index}`), normalizedDays);
}

async function _saveSchedule() {
  const perms = window._rbacPerms || { canEditSchedules: false };
  if (!perms.canEditSchedules) {
    console.warn('Permission denied: canEditSchedules required');
    return;
  }
  const input   = document.getElementById('feed-schedule-input');
  const timeVal = input ? input.value.trim() : '';

  if (!timeVal) {
    if (input) input.reportValidity();
    _setScheduleFieldError('Time is required.');
    return;
  }
  if (!/^\d{2}:\d{2}$/.test(timeVal)) {
    if (input) input.reportValidity();
    _setScheduleFieldError('Please enter a valid time (HH:MM).');
    return;
  }

  const days = _getSelectedDays();
  if (days.length === 0) {
    _setScheduleFieldError('Select at least one day.', { focusDays: true });
    return;
  }

  const excludeIndex = _editingIndex !== null ? _editingIndex : null;
  if (hasDuplicateScheduleTime(_schedules, timeVal, excludeIndex)) {
    showAlertModal({
      title: 'Duplicate schedule',
      message: `A schedule at ${_fmt12h(timeVal)} already exists.`,
      variant: 'warning',
    });
    return;
  }

  const isEdit = _editingIndex !== null;
  const index = isEdit
    ? _editingIndex
    : _nextScheduleIndex(_schedules.map((s) => s.index));

  const summary = `${_fmt12h(timeVal)} (${formatScheduleDaysLabel(days)})`;

  showConfirmModal({
    title: isEdit ? 'Save changes?' : 'Add schedule?',
    message: isEdit
      ? `Save changes to ${summary}?`
      : `Add schedule for ${summary}?`,
    confirmLabel: 'Save',
    onConfirm: async () => {
      await _saveScheduleAtIndex(index, timeVal, days);
      _closeScheduleForm();
      showAppToast(
        isEdit ? `Schedule updated: ${summary}.` : `Schedule added: ${summary}.`,
        'success',
      );
    },
  });
}

async function _saveDashboardSchedules() {
  const perms = window._rbacPerms || { canEditSchedules: false };
  if (!perms.canEditSchedules) {
    log('Permission denied: Owner/Admin required to change schedules.', 'warn');
    return;
  }
  if (!_deviceId) return;

  const t0 = document.getElementById('dash-sched-0')?.value.trim() || '';
  const t1 = document.getElementById('dash-sched-1')?.value.trim() || '';
  const timeRe = /^\d{2}:\d{2}$/;

  if (t0 && !timeRe.test(t0)) {
    log('Schedule 1: enter a valid time (HH:MM).', 'warn');
    return;
  }
  if (t1 && !timeRe.test(t1)) {
    log('Schedule 2: enter a valid time (HH:MM).', 'warn');
    return;
  }

  const byIndex = {};
  _schedules.forEach((s) => {
    byIndex[s.index] = { time: s.time, days: s.days };
  });

  if (t0) {
    byIndex[0] = { time: t0, days: byIndex[0]?.days ?? [...ALL_DAYS] };
  } else {
    delete byIndex[0];
  }
  if (t1) {
    byIndex[1] = { time: t1, days: byIndex[1]?.days ?? [...ALL_DAYS] };
  } else {
    delete byIndex[1];
  }

  const sorted = Object.entries(byIndex)
    .map(([idx, entry]) => ({ index: parseInt(idx, 10), time: entry.time, days: entry.days }))
    .sort((a, b) => a.time.localeCompare(b.time));

  const newTimes = {};
  const newDays = {};
  sorted.forEach((s, i) => {
    newTimes[i] = s.time;
    newDays[i] = normalizeDays(s.days);
  });

  try {
    const db = fbDatabase();
    await fbSet(
      fbRef(db, `/devices/${_deviceId}/feeding/schedules/times`),
      sorted.length ? newTimes : null,
    );
    await fbSet(
      fbRef(db, `/devices/${_deviceId}/feeding/schedules/days`),
      sorted.length ? newDays : null,
    );
    showAppToast(
      sorted.length
        ? `Dashboard schedules saved (${sorted.length} active).`
        : 'All feeding schedules cleared.',
      'success',
    );
  } catch (err) {
    showAppToast('Save error: ' + (err?.message || String(err)), 'error');
  }
}

function _hydrateDashboardInputs() {
  const active = document.activeElement;
  const inputs = [0, 1].map((i) => document.getElementById(`dash-sched-${i}`));
  if (inputs.some((inp) => inp && inp === active)) return;

  const byIndex = {};
  _schedules.forEach((s) => { byIndex[s.index] = s.time; });

  inputs.forEach((inp, i) => {
    if (inp) inp.value = byIndex[i] || '';
  });

  _updateDashboardExtras();
}

function _updateDashboardExtras() {
  const extraEl = document.getElementById('dashboard-feed-extra');
  const nextEl  = document.getElementById('dashboard-feed-next');
  const more    = Math.max(0, _schedules.length - 2);

  if (extraEl) {
    if (more > 0) {
      extraEl.style.display = '';
      extraEl.textContent = `+${more} more — manage in Feeding`;
    } else {
      extraEl.style.display = 'none';
      extraEl.textContent = '';
    }
  }

  if (nextEl) {
    const nextMs = _nextScheduleTime(_schedules);
    nextEl.textContent = nextMs ? `Next feed ${_fmtCountdown(nextMs)}` : '';
    nextEl.style.display = nextMs ? '' : 'none';
  }
}

async function _migrateLegacySchedules(deviceId) {
  try {
    const db = fbDatabase();
    const feedingRef = fbRef(db, `/devices/${deviceId}/feeding`);
    const snap = await fbGet(feedingRef);
    const f = snap.val();
    if (!f) return;

    const timesSnap = await fbGet(fbRef(db, `/devices/${deviceId}/feeding/schedules/times`));
    const hasTimes = timesSnap.exists() && timesSnap.val() != null
      && Object.keys(timesSnap.val()).length > 0;

    if (hasTimes) return;

    const legacy = [f.schedule1, f.schedule2].filter((t) => typeof t === 'string' && /^\d{2}:\d{2}$/.test(t));
    if (legacy.length === 0) return;

    const newTimes = {};
    const newDays = {};
    legacy.forEach((t, i) => {
      newTimes[i] = t;
      newDays[i] = [...ALL_DAYS];
    });
    await fbSet(fbRef(db, `/devices/${deviceId}/feeding/schedules/times`), newTimes);
    await fbSet(fbRef(db, `/devices/${deviceId}/feeding/schedules/days`), newDays);
    await fbSet(fbRef(db, `/devices/${deviceId}/feeding/schedule1`), null);
    await fbSet(fbRef(db, `/devices/${deviceId}/feeding/schedule2`), null);
    log('Migrated legacy feeding schedules to unified format ✓', 'feed');
  } catch (err) {
    console.warn('[feeding] legacy schedule migration skipped', err);
  }
}

/** Re-render schedule list after RBAC permissions are applied (fixes hidden Add/Edit on first load). */
export function refreshFeedingScheduleUi() {
  _renderScheduleList();
}

function _confirmDeleteSchedule(index) {
  const perms = window._rbacPerms || { canEditSchedules: false };
  if (!perms.canEditSchedules) {
    console.warn('Permission denied: canEditSchedules required');
    return;
  }
  const sched = _schedules.find((s) => s.index === index);
  if (!sched) return;

  const timeLabel = _fmt12h(sched.time);
  const daysLabel = formatScheduleDaysLabel(sched.days);

  showConfirmModal({
    title: 'Delete schedule?',
    message: `Remove ${timeLabel} (${daysLabel})?`,
    confirmLabel: 'Delete',
    destructive: true,
    onConfirm: async () => {
      await _deleteSchedule(index);
      showAppToast(`Schedule deleted: ${timeLabel} (${daysLabel}).`, 'success');
    },
  });
}

async function _deleteSchedule(index) {
  const perms = window._rbacPerms || { canEditSchedules: false };
  if (!perms.canEditSchedules) {
    console.warn('Permission denied: canEditSchedules required');
    return;
  }
  const db = fbDatabase();
  const remaining = _schedules
    .filter((s) => s.index !== index)
    .sort((a, b) => a.time.localeCompare(b.time));

  const newTimes = {};
  const newDays = {};
  remaining.forEach((s, i) => {
    newTimes[i] = s.time;
    newDays[i] = normalizeDays(s.days);
  });

  await fbSet(
    fbRef(db, `/devices/${_deviceId}/feeding/schedules/times`),
    remaining.length ? newTimes : null,
  );
  await fbSet(
    fbRef(db, `/devices/${_deviceId}/feeding/schedules/days`),
    remaining.length ? newDays : null,
  );
}

export function _nextScheduleIndex(existingIndices) {
  if (existingIndices.length === 0) return 0;
  return Math.max(...existingIndices) + 1;
}

export function hasDuplicateScheduleTime(schedules, timeVal, excludeIndex = null) {
  return schedules.some(
    (s) => s.time === timeVal && (excludeIndex === null || s.index !== excludeIndex),
  );
}

function _clearScheduleFieldError() {
  const input = document.getElementById('feed-schedule-input');
  if (input) {
    input.classList.remove('input-field--error');
    input.removeAttribute('aria-invalid');
  }
  document.querySelector('.feed-day-selector')?.classList.remove('feed-day-selector--error');
  const el = document.getElementById('feed-schedule-error');
  if (el) {
    el.textContent = '';
    el.style.display = 'none';
  }
}

function _setScheduleFieldError(message, { focusDays = false } = {}) {
  const input = document.getElementById('feed-schedule-input');
  if (!focusDays && input) {
    input.classList.add('input-field--error');
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }
  if (focusDays) {
    document.querySelector('.feed-day-selector')?.classList.add('feed-day-selector--error');
    document.getElementById('feed-day-0')?.focus();
  }
  const el = document.getElementById('feed-schedule-error');
  if (el) {
    el.textContent = message;
    el.style.display = 'block';
  }
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
    container.innerHTML = '<p class="empty-state empty-state--tight muted">No feed events recorded yet.</p>';
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

export function _nextScheduleTime(schedules, nowMs = Date.now()) {
  const now = new Date(nowMs);
  const todayDay = now.getDay();
  const candidates = [];

  schedules.forEach((s) => {
    const [h, m] = s.time.split(':').map(Number);
    const days = normalizeDays(s.days ?? ALL_DAYS);
    days.forEach((day) => {
      let daysAhead = day - todayDay;
      if (daysAhead < 0) daysAhead += 7;
      const d = new Date(now);
      d.setDate(d.getDate() + daysAhead);
      d.setHours(h, m, 0, 0);
      const ms = d.getTime();
      if (ms > nowMs) candidates.push(ms);
    });
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

export async function triggerManualFeed() {
  const perms = window._rbacPerms || { canTriggerFeed: true };
  if (!perms.canTriggerFeed) {
    log('Permission denied: cannot trigger feeding.', 'warn');
    return;
  }
  if (!_deviceId) return;

  const tabBtn   = document.getElementById('feed-manual-btn');
  const dashBtn  = document.getElementById('feed-btn');
  const statusEl = document.getElementById('feed-manual-status');
  const feedNote = document.getElementById('feed-note-txt');

  const setDispensing = () => {
    if (tabBtn)  { tabBtn.disabled = true; tabBtn.textContent = '⟳ Dispensing…'; }
    if (dashBtn) {
      dashBtn.disabled = true;
      dashBtn.classList.add('firing');
      dashBtn.textContent = '⟳ DISPENSING...';
    }
    if (statusEl) statusEl.textContent = '';
    if (feedNote) feedNote.textContent = 'Waiting for ESP32 to confirm...';
    _dispensing = true;
  };

  const resetButtons = (timeoutMsg) => {
    if (tabBtn)  { tabBtn.disabled = false; tabBtn.textContent = '▶ Manual Feed'; }
    if (dashBtn) {
      dashBtn.classList.remove('firing');
      dashBtn.textContent = '▶ Manual Feed';
    }
    _dispensing = false;
    _applyFeedButtonConnectedState();
    if (statusEl && timeoutMsg) statusEl.textContent = timeoutMsg;
    if (feedNote && timeoutMsg) feedNote.textContent = timeoutMsg;
    else if (feedNote && _firebaseConnected) feedNote.textContent = 'Firebase connected — button locks until ESP32 confirms';
  };

  try {
    setDispensing();
    await _writeFeedLog(_deviceId, 'Manual');
    const db = fbDatabase();
    await fbSet(fbRef(db, `/devices/${_deviceId}/feeding/manualFeed`), true);
    log('Feed command sent → manualFeed = true ✓', 'feed');

    if (_manualFeedTimeout) clearTimeout(_manualFeedTimeout);
    _manualFeedTimeout = setTimeout(() => {
      _manualFeedTimeout = null;
      resetButtons('Timeout — ESP32 may be offline');
      log('Feed timeout — button unlocked (ESP32 may be offline)', 'warn');
    }, 10000);
  } catch (err) {
    resetButtons('Error: ' + (err?.message || String(err)));
    log('Feed error: ' + (err?.message || String(err)), 'err');
  }
}

function _applyFeedButtonConnectedState() {
  const dashBtn = document.getElementById('feed-btn');
  const dot     = document.getElementById('feed-dot');
  const note    = document.getElementById('feed-note-txt');
  const tabBtn  = document.getElementById('feed-manual-btn');

  if (dashBtn && !_dispensing) dashBtn.disabled = !_firebaseConnected;
  if (tabBtn && !_dispensing) tabBtn.disabled = false;
  if (dot) dot.className = 'dot' + (_firebaseConnected ? '' : ' off');
  if (note && !_dispensing) {
    note.textContent = _firebaseConnected
      ? 'Firebase connected — button locks until ESP32 confirms'
      : 'Connect to Firebase to enable feed button';
  }
}

function _syncFeedButton(manualFeedVal) {
  const tabBtn   = document.getElementById('feed-manual-btn');
  const dashBtn  = document.getElementById('feed-btn');
  const statusEl = document.getElementById('feed-manual-status');
  const feedNote = document.getElementById('feed-note-txt');

  if (!manualFeedVal) {
    if (_manualFeedTimeout) {
      clearTimeout(_manualFeedTimeout);
      _manualFeedTimeout = null;
    }
    if (tabBtn)  { tabBtn.disabled = false; tabBtn.textContent = '▶ Manual Feed'; }
    if (dashBtn) {
      dashBtn.classList.remove('firing');
      dashBtn.textContent = '▶ Manual Feed';
    }
    _dispensing = false;
    _applyFeedButtonConnectedState();
    if (statusEl) statusEl.textContent = 'Feed complete ✓';
    if (feedNote && _firebaseConnected) feedNote.textContent = 'ESP32 confirmed feed complete ✓';
    log('ESP32 confirmed feed complete ✓', 'feed');
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
