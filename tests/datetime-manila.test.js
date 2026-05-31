import { describe, it, expect } from 'vitest';
import { formatWallClockInTimeZone, MANILA_TZ } from '../backend/lib/datetime.js';

describe('formatWallClockInTimeZone', () => {
  it('formats UTC instant as Asia/Manila wall-clock', () => {
    const ms = Date.UTC(2026, 4, 30, 1, 13, 1);
    expect(formatWallClockInTimeZone(ms, MANILA_TZ)).toBe('2026-05-30 09:13:01');
  });

  it('defaults to Asia/Manila when timezone omitted', () => {
    const ms = Date.UTC(2026, 0, 1, 16, 0, 0);
    expect(formatWallClockInTimeZone(ms)).toBe('2026-01-02 00:00:00');
  });
});
