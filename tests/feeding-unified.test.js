// tests/feeding-unified.test.js
import { describe, it, expect } from 'vitest';

// Pure helpers mirrored from feeding.js (avoid importing module with Chart.js CDN deps)
function _nextScheduleIndex(existingIndices) {
  if (existingIndices.length === 0) return 0;
  return Math.max(...existingIndices) + 1;
}

function _nextScheduleTime(schedules) {
  const now = new Date();
  const candidates = schedules.map((s) => {
    const [h, m] = s.time.split(':').map(Number);
    const ms = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
    return ms > now.getTime() ? ms : ms + 86400000;
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

  it('_nextScheduleTime picks earliest future slot today', () => {
    const now = new Date();
    const h = now.getHours();
    const futureH = (h + 2) % 24;
    const pastH = (h + 22) % 24;
    const pad = (n) => String(n).padStart(2, '0');
    const schedules = [
      { index: 0, time: `${pad(pastH)}:00` },
      { index: 1, time: `${pad(futureH)}:30` },
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
