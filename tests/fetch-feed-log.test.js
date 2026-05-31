/**
 * Feed log range merge/filter (reports + firebase fetch).
 */
import { describe, it, expect } from 'vitest';
import {
  parseFeedLogEntry,
  filterDispensesInRange,
  mergeFeedLogDispenseLists,
} from '../public/js/feed-dispense.js';
import { getReportDateRange } from '../public/js/report-date-range.js';

function entry(tsStr, reason = 'Scheduled') {
  return parseFeedLogEntry({ reason, timestamp: tsStr, amountMg: '~200-300mg' });
}

describe('feed log range helpers', () => {
  it('filterDispensesInRange includes month boundaries', () => {
    const may = [
      entry('2026-05-01 07:00:00'),
      entry('2026-05-31 19:00:00'),
      entry('2026-04-30 19:00:00'),
      entry('2026-06-01 07:00:00'),
    ].filter(Boolean);
    const { from, to } = getReportDateRange('monthly', undefined, undefined, new Date(2026, 4, 15));
    const inRange = filterDispensesInRange(may, from.getTime(), to.getTime());
    expect(inRange.map((e) => e.timestampDisplay)).toEqual([
      '2026-05-01 07:00:00',
      '2026-05-31 19:00:00',
    ]);
  });

  it('mergeFeedLogDispenseLists unions partial keyed-query results', () => {
    const sat = entry('2026-05-09 19:00:00');
    const sun = entry('2026-05-10 19:00:00');
    const partialQ1 = [sat];
    const partialQ2 = [];
    const fullScan = [sat, sun];
    const { from, to } = getReportDateRange('weekly', undefined, undefined, new Date(2026, 4, 9));
    const merged = mergeFeedLogDispenseLists(partialQ1, partialQ2, fullScan);
    const inRange = filterDispensesInRange(merged, from.getTime(), to.getTime());
    expect(inRange.length).toBe(2);
    expect(inRange[0].timestampDisplay).toBe('2026-05-09 19:00:00');
    expect(inRange[1].timestampDisplay).toBe('2026-05-10 19:00:00');
  });

  it('dedupes duplicate second from overlapping query strategies', () => {
    const e = entry('2026-05-16 19:00:00');
    const merged = mergeFeedLogDispenseLists([e], [e], [e]);
    expect(merged.length).toBe(1);
  });
});
