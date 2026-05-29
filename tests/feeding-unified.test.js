// tests/feeding-unified.test.js
import { describe, it, expect } from 'vitest';
import { parseFeedTimestamp } from '../public/js/feed-dispense.js';

// Pure holdMs helpers mirrored from feeding.js (avoid Chart.js / CDN imports)
const HOLD_MS_DEFAULT = 1000;
const HOLD_MS_MAX = 60000;
const HOLD_MS_PRESETS = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000];

function parseHoldMs(val) {
  const n = typeof val === 'number' ? val : parseInt(String(val ?? '').trim(), 10);
  if (!Number.isInteger(n) || n < 1 || n > HOLD_MS_MAX) return null;
  return n;
}

function formatHoldMsLabel(ms) {
  const parsed = parseHoldMs(ms);
  if (parsed === null) return '—';
  return `${parsed} ms`;
}

function formatHoldMsSummary(ms) {
  const parsed = parseHoldMs(ms) ?? HOLD_MS_DEFAULT;
  return `Feed duration: ${formatHoldMsLabel(parsed)}`;
}

function resolveHoldMsFromForm(selectValue, customValue) {
  const sel = String(selectValue ?? '').trim();
  if (sel !== 'custom') {
    const ms = parseInt(sel, 10);
    if (HOLD_MS_PRESETS.includes(ms)) return { ok: true, ms };
    return { ok: false, error: 'Select a valid feed duration.' };
  }
  const raw = String(customValue ?? '').trim();
  if (!raw) return { ok: false, error: 'Enter a duration in milliseconds.' };
  const ms = parseHoldMs(raw);
  if (ms === null) {
    return { ok: false, error: `Duration must be a whole number from 1 to ${HOLD_MS_MAX} ms.` };
  }
  return { ok: true, ms };
}

function holdMsToSelectState(ms) {
  const parsed = parseHoldMs(ms) ?? HOLD_MS_DEFAULT;
  if (HOLD_MS_PRESETS.includes(parsed)) return { mode: 'preset', preset: parsed };
  return { mode: 'custom', ms: parsed };
}

function formatTime12hFrom24h(hhmm) {
  const parts = String(hhmm ?? '').trim().split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '—';
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

function parseDaysVal(val) {
  if (Array.isArray(val)) return normalizeDays(val.map((n) => Number(n)));
  if (typeof val === 'string' && val.trim()) {
    return normalizeDays(val.split(',').map((n) => Number(n.trim())));
  }
  if (val && typeof val === 'object') {
    const fromTruthy = Object.entries(val)
      .filter(([, v]) => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true')
      .map(([k]) => Number(k))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    if (fromTruthy.length > 0) return normalizeDays(fromTruthy);
    const keyNums = Object.keys(val)
      .map((k) => Number(k))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    if (keyNums.length > 0) return normalizeDays(keyNums);
    return [];
  }
  return [...ALL_DAYS];
}

function isScheduleActiveToday(days, nowMs = Date.now()) {
  const normalized = normalizeDays(days);
  if (normalized.length === 0) return false;
  return normalized.includes(new Date(nowMs).getDay());
}

function matchesActiveSchedule(ts, schedules, toleranceMin = 2) {
  if (!schedules?.length) return false;
  const d = new Date(ts);
  const day = d.getDay();
  const logMin = d.getHours() * 60 + d.getMinutes();
  for (const s of schedules) {
    const days = normalizeDays(s.days ?? []);
    if (days.length === 0 || !days.includes(day)) continue;
    const [sh, sm] = s.time.split(':').map(Number);
    if (!Number.isFinite(sh) || !Number.isFinite(sm)) continue;
    const schedMin = sh * 60 + sm;
    if (Math.abs(logMin - schedMin) <= toleranceMin) return true;
  }
  return false;
}

function shouldKeepFeedLogEntry(entry, schedules) {
  if (!entry) return false;
  if (entry.type === 'Manual') return true;
  if (!schedules?.length) return true;
  return matchesActiveSchedule(entry.ts, schedules);
}

// Pure helpers mirrored from feeding.js (avoid importing module with Chart.js CDN deps)
function _nextScheduleIndex(existingIndices) {
  if (existingIndices.length === 0) return 0;
  return Math.max(...existingIndices) + 1;
}

function hasDuplicateScheduleTime(schedules, timeVal, excludeIndex = null) {
  return schedules.some(
    (s) => s.time === timeVal && (excludeIndex === null || s.index !== excludeIndex),
  );
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function normalizeDays(days) {
  if (!Array.isArray(days)) return [];
  return [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
}

function formatScheduleDaysLabel(days) {
  const normalized = normalizeDays(days);
  if (normalized.length === 0) return 'No days selected';
  if (normalized.length === 7) return 'Every day';
  return normalized.map((d) => DAY_LABELS[d]).join(', ');
}

function _nextOccurrenceMs(timeStr, days, nowMs = Date.now()) {
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

function _scheduleStatus(timeStr, days, nowMs = Date.now()) {
  const normalized = normalizeDays(days);
  const effectiveDays = normalized.length > 0 ? normalized : ALL_DAYS;
  const nextMs = _nextOccurrenceMs(timeStr, effectiveDays, nowMs);
  if (nextMs === null) return 'scheduled';
  const diffMin = (nextMs - nowMs) / 60000;
  if (diffMin <= 30) return 'upcoming';
  return 'scheduled';
}

function _nextScheduleTime(schedules, nowMs = Date.now()) {
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

function _feedsTodayCount(logEntries, schedules = []) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfDay = startOfDay + 86400000;
  return logEntries.filter((e) => {
    if (e.ts < startOfDay || e.ts >= endOfDay) return false;
    return shouldKeepFeedLogEntry(e, schedules);
  }).length;
}

function compactDashboardSlots(schedules, t0, t1) {
  const byIndex = {};
  schedules.forEach((s) => { byIndex[s.index] = s.time; });
  if (t0) byIndex[0] = t0;
  else delete byIndex[0];
  if (t1) byIndex[1] = t1;
  else delete byIndex[1];
  const sorted = Object.entries(byIndex)
    .map(([idx, time]) => ({ index: parseInt(idx, 10), time }))
    .sort((a, b) => a.time.localeCompare(b.time));
  const newTimes = {};
  sorted.forEach((s, i) => { newTimes[i] = s.time; });
  return newTimes;
}

describe('feeding unified — schedule helpers', () => {
  it('_nextScheduleIndex returns 0 for empty list', () => {
    expect(_nextScheduleIndex([])).toBe(0);
  });

  it('_nextScheduleIndex returns max+1', () => {
    expect(_nextScheduleIndex([0, 1])).toBe(2);
  });

  it('hasDuplicateScheduleTime returns false on empty list', () => {
    expect(hasDuplicateScheduleTime([], '07:00')).toBe(false);
  });

  it('hasDuplicateScheduleTime detects duplicate when adding', () => {
    const schedules = [{ index: 0, time: '07:00' }, { index: 1, time: '12:00' }];
    expect(hasDuplicateScheduleTime(schedules, '07:00')).toBe(true);
    expect(hasDuplicateScheduleTime(schedules, '18:00')).toBe(false);
  });

  it('hasDuplicateScheduleTime allows same time when excludeIndex matches', () => {
    const schedules = [{ index: 0, time: '07:00' }, { index: 1, time: '12:00' }];
    expect(hasDuplicateScheduleTime(schedules, '07:00', 0)).toBe(false);
  });

  it('hasDuplicateScheduleTime blocks when another index has same time', () => {
    const schedules = [{ index: 0, time: '07:00' }, { index: 1, time: '12:00' }];
    expect(hasDuplicateScheduleTime(schedules, '12:00', 0)).toBe(true);
  });

  it('formatScheduleDaysLabel shows Every day for all seven days', () => {
    expect(formatScheduleDaysLabel(ALL_DAYS)).toBe('Every day');
  });

  it('formatScheduleDaysLabel lists selected weekdays only', () => {
    expect(formatScheduleDaysLabel([1, 3, 5])).toBe('Mon, Wed, Fri');
  });

  it('_scheduleStatus never returns completed for recurring schedules', () => {
    const now = new Date(2025, 4, 21, 15, 0, 0);
    const pastToday = _scheduleStatus('08:00', ALL_DAYS, now.getTime());
    expect(pastToday).not.toBe('completed');
    expect(['scheduled', 'upcoming']).toContain(pastToday);
  });

  it('_nextScheduleTime picks earliest future slot today', () => {
    const now = new Date();
    const h = now.getHours();
    const futureH = (h + 2) % 24;
    const pastH = (h + 22) % 24;
    const pad = (n) => String(n).padStart(2, '0');
    const schedules = [
      { index: 0, time: `${pad(pastH)}:00`, days: ALL_DAYS },
      { index: 1, time: `${pad(futureH)}:30`, days: ALL_DAYS },
    ];
    const next = _nextScheduleTime(schedules);
    expect(next).not.toBeNull();
    const nextDate = new Date(next);
    expect(nextDate.getHours()).toBe(futureH);
    expect(nextDate.getMinutes()).toBe(30);
  });
});

describe('feeding unified — dashboard save compaction', () => {
  it('merges dashboard slots with extra schedules and compacts indices', () => {
    const schedules = [
      { index: 0, time: '07:00' },
      { index: 1, time: '12:00' },
      { index: 2, time: '20:00' },
    ];
    expect(compactDashboardSlots(schedules, '08:00', '18:00')).toEqual({
      0: '08:00',
      1: '18:00',
      2: '20:00',
    });
  });

  it('clears slot when dashboard input is empty', () => {
    const schedules = [{ index: 0, time: '07:00' }, { index: 1, time: '18:00' }];
    expect(compactDashboardSlots(schedules, '', '19:00')).toEqual({ 0: '19:00' });
  });
});

describe('feeding unified — feeds today count', () => {
  it('counts entries within calendar day', () => {
    const start = new Date();
    start.setHours(12, 0, 0, 0);
    const entries = [
      { ts: start.getTime(), type: 'Manual' },
      { ts: start.getTime() - 86400000, type: 'Manual' },
    ];
    expect(_feedsTodayCount(entries)).toBe(1);
  });
});

describe('feeding unified — holdMs helpers', () => {
  it('parseHoldMs accepts positive integers up to HOLD_MS_MAX', () => {
    expect(parseHoldMs(1500)).toBe(1500);
    expect(parseHoldMs('2000')).toBe(2000);
    expect(parseHoldMs(HOLD_MS_MAX)).toBe(HOLD_MS_MAX);
    expect(parseHoldMs(0)).toBeNull();
    expect(parseHoldMs(HOLD_MS_MAX + 1)).toBeNull();
    expect(parseHoldMs('abc')).toBeNull();
  });

  it('formatHoldMsLabel uses ms only', () => {
    expect(formatHoldMsLabel(1000)).toBe('1000 ms');
    expect(formatHoldMsLabel(1500)).toBe('1500 ms');
    expect(formatHoldMsLabel(null)).toBe('—');
  });

  it('formatHoldMsSummary prefixes feed duration', () => {
    expect(formatHoldMsSummary(2000)).toBe('Feed duration: 2000 ms');
  });

  it('resolveHoldMsFromForm resolves presets', () => {
    expect(resolveHoldMsFromForm('3000', '')).toEqual({ ok: true, ms: 3000 });
    expect(resolveHoldMsFromForm('999', '')).toEqual({ ok: false, error: 'Select a valid feed duration.' });
  });

  it('resolveHoldMsFromForm resolves custom values', () => {
    expect(resolveHoldMsFromForm('custom', '750')).toEqual({ ok: true, ms: 750 });
    expect(resolveHoldMsFromForm('custom', '')).toEqual({ ok: false, error: 'Enter a duration in milliseconds.' });
    expect(resolveHoldMsFromForm('custom', '0')).toMatchObject({ ok: false });
    expect(resolveHoldMsFromForm('custom', String(HOLD_MS_MAX + 1))).toMatchObject({ ok: false });
  });

  it('holdMsToSelectState maps presets and custom', () => {
    expect(holdMsToSelectState(2500)).toEqual({ mode: 'preset', preset: 2500 });
    expect(holdMsToSelectState(750)).toEqual({ mode: 'custom', ms: 750 });
    expect(holdMsToSelectState(null)).toEqual({ mode: 'preset', preset: HOLD_MS_DEFAULT });
  });

  it('HOLD_MS_PRESETS spans 500–5000 in 500 ms steps', () => {
    expect(HOLD_MS_PRESETS).toEqual([500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000]);
  });
});

describe('feeding unified — schedule day parsing and matching', () => {
  const schedules = [{ index: 0, time: '19:00', days: [0, 2, 4, 6] }];

  it('parseDaysVal reads Firebase-style day maps', () => {
    expect(parseDaysVal({ 0: true, 2: true, 4: true, 6: true })).toEqual([0, 2, 4, 6]);
    expect(parseDaysVal({})).toEqual([]);
  });

  it('formatTime12hFrom24h converts 19:00 to 7:00 PM', () => {
    expect(formatTime12hFrom24h('19:00')).toBe('07:00 PM');
    expect(formatTime12hFrom24h('07:00')).toBe('07:00 AM');
  });

  it('isScheduleActiveToday respects weekday', () => {
    const thu = new Date(2026, 4, 28, 12, 0, 0).getTime();
    const wed = new Date(2026, 4, 27, 12, 0, 0).getTime();
    expect(isScheduleActiveToday([0, 2, 4, 6], thu)).toBe(true);
    expect(isScheduleActiveToday([0, 2, 4, 6], wed)).toBe(false);
  });

  it('matchesActiveSchedule requires day and time slot', () => {
    const thu1900 = new Date(2026, 4, 28, 19, 0, 0).getTime();
    const thu2105 = new Date(2026, 4, 28, 21, 5, 0).getTime();
    const wed1900 = new Date(2026, 4, 27, 19, 0, 0).getTime();
    expect(matchesActiveSchedule(thu1900, schedules)).toBe(true);
    expect(matchesActiveSchedule(thu2105, schedules)).toBe(false);
    expect(matchesActiveSchedule(wed1900, schedules)).toBe(false);
  });

  it('shouldKeepFeedLogEntry keeps manual and matching scheduled', () => {
    const thu1900 = new Date(2026, 4, 28, 19, 0, 0).getTime();
    const wed1900 = new Date(2026, 4, 27, 19, 0, 0).getTime();
    expect(shouldKeepFeedLogEntry({ type: 'Manual', ts: wed1900 }, schedules)).toBe(true);
    expect(shouldKeepFeedLogEntry({ type: 'Scheduled', ts: thu1900 }, schedules)).toBe(true);
    expect(shouldKeepFeedLogEntry({ type: 'Scheduled', ts: wed1900 }, schedules)).toBe(false);
  });
});

describe('feeding unified — parseFeedTimestamp', () => {
  it('parses YYYY-MM-DD HH:MM:SS as local time', () => {
    const ts = parseFeedTimestamp('2026-05-28 19:00:00');
    const d = new Date(ts);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4);
    expect(d.getDate()).toBe(28);
    expect(d.getHours()).toBe(19);
    expect(d.getMinutes()).toBe(0);
  });
});
