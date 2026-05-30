/**
 * Feeding — schedules, hold duration, next feed, dashboard RTDB maps.
 * Module: public/js/features/feeding.js
 * Demo: automated feeding times, weekday rules, log filtering, slot compaction.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../public/js/firebase-client.js', () => ({
  fbDatabase: vi.fn(() => ({})),
  fbRef: vi.fn((_, path) => ({ path })),
  fbOnValue: vi.fn(),
  fbSet: vi.fn(() => Promise.resolve()),
  fbGet: vi.fn(() => Promise.resolve({ exists: () => false, val: () => null })),
}));
vi.mock('../public/js/charts.js', () => ({ initFeedingChart: vi.fn(() => null) }));
vi.mock('../public/js/ui/modal-ui.js', () => ({
  showAppToast: vi.fn(),
  showAlertModal: vi.fn(),
  showConfirmModal: vi.fn(),
  escHtml: (s) => String(s ?? ''),
}));
vi.mock('../public/js/utils.js', () => ({ log: vi.fn() }));

import {
  HOLD_MS_DEFAULT,
  HOLD_MS_MAX,
  HOLD_MS_PRESETS,
  parseHoldMs,
  formatHoldMsLabel,
  formatHoldMsSummary,
  resolveHoldMsFromForm,
  holdMsToSelectState,
  formatTime12hFrom24h,
  parseDaysVal,
  normalizeDays,
  formatScheduleDaysLabel,
  isScheduleActiveToday,
  matchesActiveSchedule,
  shouldKeepFeedLogEntry,
  buildCompactedScheduleMaps,
  _nextScheduleIndex,
  hasDuplicateScheduleTime,
  _nextOccurrenceMs,
  _scheduleStatus,
  _nextScheduleTime,
  _feedsTodayCount,
} from '../public/js/features/feeding.js';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

// Motor run time (ms) for each dispense — form validation and presets
describe('feeding module — holdMs', () => {
  it('parseHoldMs accepts positive integers up to HOLD_MS_MAX', () => {
    expect(parseHoldMs(1500)).toBe(1500);
    expect(parseHoldMs('2000')).toBe(2000);
    expect(parseHoldMs(HOLD_MS_MAX)).toBe(HOLD_MS_MAX);
    expect(parseHoldMs(0)).toBeNull();
    expect(parseHoldMs(HOLD_MS_MAX + 1)).toBeNull();
    expect(parseHoldMs('abc')).toBeNull();
  });

  it('formatHoldMsLabel and formatHoldMsSummary', () => {
    expect(formatHoldMsLabel(1000)).toBe('1000 ms');
    expect(formatHoldMsLabel(null)).toBe('—');
    expect(formatHoldMsSummary(2000)).toBe('Feed duration: 2000 ms');
  });

  it('resolveHoldMsFromForm resolves presets and custom', () => {
    expect(resolveHoldMsFromForm('3000', '')).toEqual({ ok: true, ms: 3000 });
    expect(resolveHoldMsFromForm('999', '')).toEqual({ ok: false, error: 'Select a valid feed duration.' });
    expect(resolveHoldMsFromForm('custom', '750')).toEqual({ ok: true, ms: 750 });
    expect(resolveHoldMsFromForm('custom', '')).toMatchObject({ ok: false });
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

// Which weekdays a schedule runs; parse formats from UI and Firebase
describe('feeding module — schedule days', () => {
  it('normalizeDays deduplicates and sorts', () => {
    expect(normalizeDays([3, 1, 3, 5])).toEqual([1, 3, 5]);
    expect(normalizeDays([99, -1])).toEqual([]);
  });

  it('parseDaysVal reads array, CSV, and Firebase-style maps', () => {
    expect(parseDaysVal([0, 2, 4])).toEqual([0, 2, 4]);
    expect(parseDaysVal('0,2,4')).toEqual([0, 2, 4]);
    expect(parseDaysVal({ 0: true, 2: true, 4: true })).toEqual([0, 2, 4]);
    expect(parseDaysVal({})).toEqual([]);
  });

  it('formatScheduleDaysLabel', () => {
    expect(formatScheduleDaysLabel(ALL_DAYS)).toBe('Every day');
    expect(formatScheduleDaysLabel([1, 3, 5])).toBe('Mon, Wed, Fri');
    expect(formatScheduleDaysLabel([])).toBe('No days selected');
  });

  it('formatTime12hFrom24h', () => {
    expect(formatTime12hFrom24h('19:00')).toBe('07:00 PM');
    expect(formatTime12hFrom24h('07:00')).toBe('07:00 AM');
  });
});

// Does this timestamp fall on an active schedule day/time (±2 min tolerance)?
describe('feeding module — schedule matching', () => {
  const schedules = [{ index: 0, time: '19:00', days: [0, 2, 4, 6] }];

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

// RTDB schedule slot indices and duplicate-time prevention
describe('feeding module — schedule indexing', () => {
  it('_nextScheduleIndex returns 0 for empty list', () => {
    expect(_nextScheduleIndex([])).toBe(0);
  });

  it('_nextScheduleIndex returns max+1', () => {
    expect(_nextScheduleIndex([0, 1])).toBe(2);
  });

  it('hasDuplicateScheduleTime', () => {
    const schedules = [{ index: 0, time: '07:00' }, { index: 1, time: '12:00' }];
    expect(hasDuplicateScheduleTime(schedules, '07:00')).toBe(true);
    expect(hasDuplicateScheduleTime(schedules, '07:00', 0)).toBe(false);
    expect(hasDuplicateScheduleTime(schedules, '12:00', 0)).toBe(true);
  });
});

// Upcoming vs scheduled status, next occurrence, feeds counted for today
describe('feeding module — next feed helpers', () => {
  it('_scheduleStatus never returns completed', () => {
    const now = new Date(2025, 4, 21, 15, 0, 0);
    const status = _scheduleStatus('08:00', ALL_DAYS, now.getTime());
    expect(status).not.toBe('completed');
    expect(['scheduled', 'upcoming']).toContain(status);
  });

  it('_nextOccurrenceMs returns future ms for valid days', () => {
    const now = new Date(2026, 4, 28, 10, 0, 0).getTime();
    const next = _nextOccurrenceMs('19:00', [4], now);
    expect(next).toBeTypeOf('number');
    expect(next).toBeGreaterThan(now);
  });

  it('_nextScheduleTime picks earliest future slot', () => {
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

  it('_feedsTodayCount filters by schedule when provided', () => {
    const start = new Date();
    start.setHours(12, 0, 0, 0);
    const schedules = [{ index: 0, time: '12:00', days: ALL_DAYS }];
    const entries = [
      { ts: start.getTime(), type: 'Scheduled' },
      { ts: start.getTime() - 86400000, type: 'Scheduled' },
      { ts: start.getTime(), type: 'Manual' },
    ];
    expect(_feedsTodayCount(entries, schedules)).toBe(2);
  });
});

// Merge dashboard time inputs with extra schedules for Firebase write
describe('feeding module — buildCompactedScheduleMaps', () => {
  it('merges dashboard slots with extra schedules and compacts indices', () => {
    const schedules = [
      { index: 0, time: '07:00', days: ALL_DAYS },
      { index: 1, time: '12:00', days: ALL_DAYS },
      { index: 2, time: '20:00', days: ALL_DAYS },
    ];
    const { times, days, count } = buildCompactedScheduleMaps('08:00', '18:00', schedules);
    expect(count).toBe(3);
    expect(times).toEqual({ 0: '08:00', 1: '18:00', 2: '20:00' });
    expect(days[0]).toEqual(ALL_DAYS);
  });

  it('clears slot when dashboard input is empty', () => {
    const schedules = [
      { index: 0, time: '07:00', days: ALL_DAYS },
      { index: 1, time: '18:00', days: ALL_DAYS },
    ];
    const { times, count } = buildCompactedScheduleMaps('', '19:00', schedules);
    expect(count).toBe(1);
    expect(times).toEqual({ 0: '19:00' });
  });
});
