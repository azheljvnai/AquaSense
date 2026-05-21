// tests/feeding-unified.test.js
import { describe, it, expect } from 'vitest';

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

function _feedsTodayCount(logEntries) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfDay = startOfDay + 86400000;
  return logEntries.filter((e) => e.ts >= startOfDay && e.ts < endOfDay).length;
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
