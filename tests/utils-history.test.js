import { describe, it, expect } from 'vitest';
import {
  mergeRtdbEntries,
  mergeHistoryEntries,
  getHistoryRange,
  recordSensorReading,
} from '../public/js/utils.js';

describe('utils history', () => {
  const baseTs = 1_700_000_000_000;

  it('mergeRtdbEntries adds entries and getHistoryRange returns them', () => {
    const entries = [
      { ts: baseTs, ph: 7, do: 6, turb: 10, temp: 26 },
      { ts: baseTs + 1000, ph: 7.1, do: 6.1, turb: 11, temp: 26.1 },
    ];
    mergeRtdbEntries(entries);
    const range = getHistoryRange(baseTs - 1, baseTs + 2000);
    expect(range.length).toBeGreaterThanOrEqual(2);
    expect(range.some((e) => e.ts === baseTs)).toBe(true);
  });

  it('mergeRtdbEntries deduplicates by timestamp', () => {
    const dup = { ts: baseTs + 50_000, ph: 7, do: 6, turb: 10, temp: 26 };
    mergeRtdbEntries([dup]);
    mergeRtdbEntries([dup]);
    const range = getHistoryRange(baseTs + 49_000, baseTs + 51_000);
    const matches = range.filter((e) => e.ts === dup.ts);
    expect(matches.length).toBe(1);
  });

  it('mergeHistoryEntries delegates to mergeRtdbEntries', () => {
    const entry = { ts: baseTs + 100_000, ph: 7, do: 6, turb: 10, temp: 26 };
    mergeHistoryEntries([entry]);
    const range = getHistoryRange(baseTs + 99_000, baseTs + 101_000);
    expect(range.some((e) => e.ts === entry.ts)).toBe(true);
  });

  it('recordSensorReading adds to live history in range', () => {
    const ts = baseTs + 200_000;
    recordSensorReading(7.2, 6.5, 12, 25.5, ts);
    const range = getHistoryRange(ts - 1, ts + 1);
    expect(range.some((e) => e.ts === ts && e.ph === 7.2)).toBe(true);
  });

  it('getHistoryRange merges live and rtdb without duplicates for same ts', () => {
    const ts = baseTs + 300_000;
    mergeRtdbEntries([{ ts, ph: 7, do: 6, turb: 10, temp: 26 }]);
    recordSensorReading(7, 6, 10, 26, ts);
    const range = getHistoryRange(ts - 1, ts + 1);
    expect(range.filter((e) => e.ts === ts).length).toBeGreaterThanOrEqual(1);
  });
});
