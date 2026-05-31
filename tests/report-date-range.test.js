/**
 * Report period boundaries for weekly/monthly feeding exports.
 */
import { describe, it, expect } from 'vitest';
import { getReportDateRange } from '../public/js/report-date-range.js';

describe('getReportDateRange', () => {
  it('weekly is Mon 00:00 through Sun 23:59:59 for a Sunday anchor', () => {
    const now = new Date(2026, 4, 31, 15, 0, 0);
    const { from, to } = getReportDateRange('weekly', undefined, undefined, now);
    expect(from.getDay()).toBe(1);
    expect(from.getDate()).toBe(25);
    expect(from.getHours()).toBe(0);
    expect(to.getDay()).toBe(0);
    expect(to.getDate()).toBe(31);
    expect(to.getHours()).toBe(23);
    expect(to.getMinutes()).toBe(59);
  });

  it('monthly covers full calendar month including last day 23:59', () => {
    const now = new Date(2026, 4, 15, 12, 0, 0);
    const { from, to } = getReportDateRange('monthly', undefined, undefined, now);
    expect(from.getMonth()).toBe(4);
    expect(from.getDate()).toBe(1);
    expect(to.getMonth()).toBe(4);
    expect(to.getDate()).toBe(31);
    expect(to.getHours()).toBe(23);
  });

  it('custom range is inclusive through end of day', () => {
    const { from, to } = getReportDateRange('custom', '2026-05-01', '2026-05-31');
    expect(from.getTime()).toBe(new Date('2026-05-01T00:00:00').getTime());
    expect(to.getTime()).toBe(new Date('2026-05-31T23:59:59').getTime());
  });
});
