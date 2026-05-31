/**
 * Feeding — randomized schedule invariants (property-based).
 * Module: public/js/features/feeding.js (fast-check)
 * Demo: schedule math holds for many random inputs, not just fixed examples.
 */
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('../public/js/firebase-client.js', () => ({
  fbDatabase: vi.fn(() => ({})),
  fbRef: vi.fn(),
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
  _nextScheduleIndex,
  _scheduleStatus,
  _nextOccurrenceMs,
  _nextScheduleTime,
  _feedsTodayCount,
} from '../public/js/features/feeding.js';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

describe('feeding schedule — property-based', () => {
  it('_scheduleStatus returns upcoming or scheduled and respects 30-min boundary', () => {
    const VALID = new Set(['upcoming', 'scheduled']);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        fc.array(fc.integer({ min: 0, max: 6 }), { minLength: 0, maxLength: 7 }),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        (schedH, schedM, days, nowDay, nowH, nowM) => {
          const timeStr = `${String(schedH).padStart(2, '0')}:${String(schedM).padStart(2, '0')}`;
          const nowMs = new Date(2023, 0, 1 + nowDay, nowH, nowM, 0).getTime();
          const uniqueDays = [...new Set(days)];
          const status = _scheduleStatus(timeStr, uniqueDays, nowMs);
          if (!VALID.has(status)) return false;
          const effectiveDays = uniqueDays.length > 0 ? uniqueDays : ALL_DAYS;
          const nextMs = _nextOccurrenceMs(timeStr, effectiveDays, nowMs);
          if (nextMs === null) return status === 'scheduled';
          const diffToNext = (nextMs - nowMs) / 60000;
          if (diffToNext <= 30 && status !== 'upcoming') return false;
          if (diffToNext > 30 && status !== 'scheduled') return false;
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('_nextScheduleIndex suffix is strictly greater than all existing indices', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 50 }), { minLength: 0, maxLength: 20 }),
        (indices) => {
          const unique = [...new Set(indices)];
          const next = _nextScheduleIndex(unique);
          if (unique.length === 0) return next === 0;
          return next === Math.max(...unique) + 1;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('_feedsTodayCount is never greater than total entries', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            ts: fc.integer({ min: 0, max: 2_000_000_000_000 }),
            type: fc.constantFrom('Manual', 'Scheduled'),
          }),
          { minLength: 0, maxLength: 50 },
        ),
        (entries) => _feedsTodayCount(entries) <= entries.length,
      ),
      { numRuns: 200 },
    );
  });

  it('_nextScheduleTime returns null or a timestamp strictly greater than now', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            index: fc.integer({ min: 0, max: 10 }),
            time: fc.tuple(
              fc.integer({ min: 0, max: 23 }),
              fc.integer({ min: 0, max: 59 }),
            ).map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`),
            days: fc.array(fc.integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 7 }),
          }),
          { minLength: 0, maxLength: 10 },
        ),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        (schedules, nowDay, nowH, nowM) => {
          const nowMs = new Date(2023, 0, 1 + nowDay, nowH, nowM, 0).getTime();
          const cleaned = schedules.map((s) => ({
            ...s,
            days: [...new Set(s.days)],
          }));
          const result = _nextScheduleTime(cleaned, nowMs);
          if (result === null) return true;
          return result > nowMs;
        },
      ),
      { numRuns: 200 },
    );
  });
});
