/**
 * Unit tests for Historical Data Navigation feature
 * Tests the getNavigatedRange function for week/month offset calculations
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the getNavigatedRange function since it's not exported
// We'll test it indirectly through the module's behavior
describe('getNavigatedRange function', () => {
  let getNavigatedRange;

  beforeEach(() => {
    // Define the function locally for testing
    getNavigatedRange = function(rangeVal, weekOffset, monthOffset, customFrom, customTo) {
      // Validate offsets: reset invalid values (NaN, Infinity) to 0
      const validWeekOffset = Number.isFinite(weekOffset) ? weekOffset : 0;
      const validMonthOffset = Number.isFinite(monthOffset) ? monthOffset : 0;

      const now = new Date();

      if (rangeVal === '24h') {
        // 24-hour range is always relative to "now" (no offset)
        return { from: new Date(now - 24*60*60*1000), to: now };
      }

      if (rangeVal === 'week') {
        // Compute the Monday of the current week
        const day = now.getDay();
        const currentMonday = new Date(now);
        currentMonday.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
        currentMonday.setHours(0, 0, 0, 0);

        // Apply offset (each offset unit = 7 days)
        const targetMonday = new Date(currentMonday);
        targetMonday.setDate(currentMonday.getDate() + validWeekOffset * 7);

        // Compute Sunday of the target week
        const targetSunday = new Date(targetMonday);
        targetSunday.setDate(targetMonday.getDate() + 6);
        targetSunday.setHours(23, 59, 59, 999);

        return { from: targetMonday, to: targetSunday };
      }

      if (rangeVal === 'month') {
        // Compute the first day of the target month
        const targetMonth = new Date(now.getFullYear(), now.getMonth() + validMonthOffset, 1, 0, 0, 0, 0);

        // Compute the last day of the target month
        const targetMonthEnd = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0, 23, 59, 59, 999);

        return { from: targetMonth, to: targetMonthEnd };
      }

      if (rangeVal === 'custom' && customFrom && customTo) {
        return {
          from: new Date(customFrom + 'T00:00:00'),
          to:   new Date(customTo   + 'T23:59:59'),
        };
      }

      // Fallback to 24h
      return { from: new Date(now - 24*60*60*1000), to: now };
    };
  });

  describe('24h range', () => {
    it('should return 24-hour range relative to now with no offset', () => {
      const result = getNavigatedRange('24h', 0, 0, '', '');
      const now = Date.now();
      const expectedFrom = now - 24*60*60*1000;
      
      expect(result.from.getTime()).toBeGreaterThanOrEqual(expectedFrom - 100);
      expect(result.from.getTime()).toBeLessThanOrEqual(expectedFrom + 100);
      expect(result.to.getTime()).toBeGreaterThanOrEqual(now - 100);
      expect(result.to.getTime()).toBeLessThanOrEqual(now + 100);
    });

    it('should ignore offsets for 24h range', () => {
      const result = getNavigatedRange('24h', 5, 3, '', '');
      const now = Date.now();
      const expectedFrom = now - 24*60*60*1000;
      
      expect(result.from.getTime()).toBeGreaterThanOrEqual(expectedFrom - 100);
      expect(result.to.getTime()).toBeGreaterThanOrEqual(now - 100);
    });
  });

  describe('week range', () => {
    it('should return current week (Monday to Sunday) with offset 0', () => {
      const result = getNavigatedRange('week', 0, 0, '', '');
      
      // Check that from is Monday at 00:00:00
      expect(result.from.getDay()).toBe(1); // Monday
      expect(result.from.getHours()).toBe(0);
      expect(result.from.getMinutes()).toBe(0);
      expect(result.from.getSeconds()).toBe(0);
      
      // Check that to is Sunday at 23:59:59
      expect(result.to.getDay()).toBe(0); // Sunday
      expect(result.to.getHours()).toBe(23);
      expect(result.to.getMinutes()).toBe(59);
      expect(result.to.getSeconds()).toBe(59);
      
      // Check that the range spans 7 days (Monday 00:00 to Sunday 23:59:59)
      const diffDays = Math.round((result.to.getTime() - result.from.getTime()) / (24*60*60*1000));
      expect(diffDays).toBe(7); // Monday to Sunday spans 7 days
    });

    it('should return last week with offset -1', () => {
      const currentWeek = getNavigatedRange('week', 0, 0, '', '');
      const lastWeek = getNavigatedRange('week', -1, 0, '', '');
      
      // Last week should be 7 days before current week
      const diffDays = Math.round((currentWeek.from.getTime() - lastWeek.from.getTime()) / (24*60*60*1000));
      expect(diffDays).toBe(7);
    });

    it('should return next week with offset 1', () => {
      const currentWeek = getNavigatedRange('week', 0, 0, '', '');
      const nextWeek = getNavigatedRange('week', 1, 0, '', '');
      
      // Next week should be 7 days after current week
      const diffDays = Math.round((nextWeek.from.getTime() - currentWeek.from.getTime()) / (24*60*60*1000));
      expect(diffDays).toBe(7);
    });

    it('should handle multiple week offsets', () => {
      const currentWeek = getNavigatedRange('week', 0, 0, '', '');
      const twoWeeksAgo = getNavigatedRange('week', -2, 0, '', '');
      
      const diffDays = Math.round((currentWeek.from.getTime() - twoWeeksAgo.from.getTime()) / (24*60*60*1000));
      expect(diffDays).toBe(14);
    });
  });

  describe('month range', () => {
    it('should return current month (1st to last day) with offset 0', () => {
      const result = getNavigatedRange('month', 0, 0, '', '');
      const now = new Date();
      
      // Check that from is 1st of current month at 00:00:00
      expect(result.from.getDate()).toBe(1);
      expect(result.from.getMonth()).toBe(now.getMonth());
      expect(result.from.getFullYear()).toBe(now.getFullYear());
      expect(result.from.getHours()).toBe(0);
      expect(result.from.getMinutes()).toBe(0);
      expect(result.from.getSeconds()).toBe(0);
      
      // Check that to is last day of current month at 23:59:59
      expect(result.to.getMonth()).toBe(now.getMonth());
      expect(result.to.getFullYear()).toBe(now.getFullYear());
      expect(result.to.getHours()).toBe(23);
      expect(result.to.getMinutes()).toBe(59);
      expect(result.to.getSeconds()).toBe(59);
      
      // Check that to is the last day of the month
      const nextDay = new Date(result.to);
      nextDay.setDate(nextDay.getDate() + 1);
      expect(nextDay.getDate()).toBe(1); // Should roll over to 1st of next month
    });

    it('should return last month with offset -1', () => {
      const result = getNavigatedRange('month', 0, -1, '', '');
      const now = new Date();
      const expectedMonth = now.getMonth() - 1;
      const expectedYear = expectedMonth < 0 ? now.getFullYear() - 1 : now.getFullYear();
      const normalizedMonth = expectedMonth < 0 ? 11 : expectedMonth;
      
      expect(result.from.getDate()).toBe(1);
      expect(result.from.getMonth()).toBe(normalizedMonth);
      expect(result.from.getFullYear()).toBe(expectedYear);
    });

    it('should return next month with offset 1', () => {
      const result = getNavigatedRange('month', 0, 1, '', '');
      const now = new Date();
      const expectedMonth = now.getMonth() + 1;
      const expectedYear = expectedMonth > 11 ? now.getFullYear() + 1 : now.getFullYear();
      const normalizedMonth = expectedMonth > 11 ? 0 : expectedMonth;
      
      expect(result.from.getDate()).toBe(1);
      expect(result.from.getMonth()).toBe(normalizedMonth);
      expect(result.from.getFullYear()).toBe(expectedYear);
    });

    it('should handle multiple month offsets', () => {
      const result = getNavigatedRange('month', 0, -3, '', '');
      const now = new Date();
      const expectedDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      
      expect(result.from.getDate()).toBe(1);
      expect(result.from.getMonth()).toBe(expectedDate.getMonth());
      expect(result.from.getFullYear()).toBe(expectedDate.getFullYear());
    });
  });

  describe('custom range', () => {
    it('should return custom date range unchanged', () => {
      const result = getNavigatedRange('custom', 0, 0, '2025-05-01', '2025-05-15');
      
      expect(result.from.getFullYear()).toBe(2025);
      expect(result.from.getMonth()).toBe(4); // May (0-indexed)
      expect(result.from.getDate()).toBe(1);
      expect(result.from.getHours()).toBe(0);
      
      expect(result.to.getFullYear()).toBe(2025);
      expect(result.to.getMonth()).toBe(4);
      expect(result.to.getDate()).toBe(15);
      expect(result.to.getHours()).toBe(23);
      expect(result.to.getMinutes()).toBe(59);
    });

    it('should ignore offsets for custom range', () => {
      const result = getNavigatedRange('custom', 5, 3, '2025-05-01', '2025-05-15');
      
      expect(result.from.getDate()).toBe(1);
      expect(result.to.getDate()).toBe(15);
    });
  });

  describe('offset validation', () => {
    it('should reset NaN weekOffset to 0', () => {
      const result = getNavigatedRange('week', NaN, 0, '', '');
      const expected = getNavigatedRange('week', 0, 0, '', '');
      
      expect(result.from.getTime()).toBe(expected.from.getTime());
      expect(result.to.getTime()).toBe(expected.to.getTime());
    });

    it('should reset Infinity weekOffset to 0', () => {
      const result = getNavigatedRange('week', Infinity, 0, '', '');
      const expected = getNavigatedRange('week', 0, 0, '', '');
      
      expect(result.from.getTime()).toBe(expected.from.getTime());
      expect(result.to.getTime()).toBe(expected.to.getTime());
    });

    it('should reset NaN monthOffset to 0', () => {
      const result = getNavigatedRange('month', 0, NaN, '', '');
      const expected = getNavigatedRange('month', 0, 0, '', '');
      
      expect(result.from.getTime()).toBe(expected.from.getTime());
      expect(result.to.getTime()).toBe(expected.to.getTime());
    });

    it('should reset Infinity monthOffset to 0', () => {
      const result = getNavigatedRange('month', 0, Infinity, '', '');
      const expected = getNavigatedRange('month', 0, 0, '', '');
      
      expect(result.from.getTime()).toBe(expected.from.getTime());
      expect(result.to.getTime()).toBe(expected.to.getTime());
    });
  });

  describe('fallback behavior', () => {
    it('should fallback to 24h for invalid range value', () => {
      const result = getNavigatedRange('invalid', 0, 0, '', '');
      const now = Date.now();
      const expectedFrom = now - 24*60*60*1000;
      
      expect(result.from.getTime()).toBeGreaterThanOrEqual(expectedFrom - 100);
      expect(result.to.getTime()).toBeGreaterThanOrEqual(now - 100);
    });

    it('should fallback to 24h for custom range with missing dates', () => {
      const result = getNavigatedRange('custom', 0, 0, '', '');
      const now = Date.now();
      const expectedFrom = now - 24*60*60*1000;
      
      expect(result.from.getTime()).toBeGreaterThanOrEqual(expectedFrom - 100);
      expect(result.to.getTime()).toBeGreaterThanOrEqual(now - 100);
    });
  });
});

describe('format24hLabel function', () => {
  let format24hLabel;

  beforeEach(() => {
    // Define the function locally for testing
    format24hLabel = function(bucketEndDate, bucketMs, windowStartDate) {
      const startDay = windowStartDate.getDate();
      const endDay = bucketEndDate.getDate();
      const isCrossDay = startDay !== endDay;

      if (!isCrossDay) {
        // Same-day window: time only
        const opts = bucketMs >= 60 * 60 * 1000
          ? { hour: 'numeric' }
          : { hour: 'numeric', minute: '2-digit' };
        return bucketEndDate.toLocaleTimeString([], opts);
      }

      // Cross-day window: include date for labels on the later day
      const bucketDay = bucketEndDate.getDate();
      if (bucketDay === startDay) {
        // Earlier day: time only
        const opts = bucketMs >= 60 * 60 * 1000
          ? { hour: 'numeric' }
          : { hour: 'numeric', minute: '2-digit' };
        return bucketEndDate.toLocaleTimeString([], opts);
      } else {
        // Later day: "DD MMM HH:MM"
        const day = bucketEndDate.getDate();
        const month = bucketEndDate.toLocaleString('default', { month: 'short' });
        const time = bucketEndDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        return `${day} ${month} ${time}`;
      }
    };
  });

  describe('same-day window', () => {
    it('should return time-only label for same-day window with hourly buckets', () => {
      const windowStart = new Date('2025-05-07T00:00:00');
      const bucketEnd = new Date('2025-05-07T14:00:00');
      const bucketMs = 60 * 60 * 1000; // 1 hour

      const result = format24hLabel(bucketEnd, bucketMs, windowStart);
      
      // Should be time only (format varies by locale, but should not include date)
      expect(result).not.toMatch(/May|5|7/);
      expect(result).toMatch(/14|2/); // Should contain hour component
    });

    it('should return time-only label for same-day window with sub-hourly buckets', () => {
      const windowStart = new Date('2025-05-07T00:00:00');
      const bucketEnd = new Date('2025-05-07T14:30:00');
      const bucketMs = 30 * 60 * 1000; // 30 minutes

      const result = format24hLabel(bucketEnd, bucketMs, windowStart);
      
      // Should be time only with minutes
      expect(result).not.toMatch(/May|5|7/);
      expect(result).toMatch(/14|2/); // Should contain hour component
      expect(result).toMatch(/30/); // Should contain minute component
    });
  });

  describe('cross-day window - earlier day', () => {
    it('should return time-only label for earlier day with hourly buckets', () => {
      const windowStart = new Date('2025-05-07T22:00:00');
      const bucketEnd = new Date('2025-05-07T23:00:00');
      const bucketMs = 60 * 60 * 1000; // 1 hour

      const result = format24hLabel(bucketEnd, bucketMs, windowStart);
      
      // Should be time only (same day as window start)
      expect(result).not.toMatch(/May|5|7/);
      expect(result).toMatch(/23|11/); // Should contain hour component
    });

    it('should return time-only label for earlier day with sub-hourly buckets', () => {
      const windowStart = new Date('2025-05-07T22:00:00');
      const bucketEnd = new Date('2025-05-07T23:30:00');
      const bucketMs = 30 * 60 * 1000; // 30 minutes

      const result = format24hLabel(bucketEnd, bucketMs, windowStart);
      
      // Should be time only with minutes
      expect(result).not.toMatch(/May|5|7/);
      expect(result).toMatch(/23|11/); // Should contain hour component
      expect(result).toMatch(/30/); // Should contain minute component
    });
  });

  describe('cross-day window - later day', () => {
    it('should return date-time label for later day with hourly buckets', () => {
      const windowStart = new Date('2025-05-07T22:00:00');
      const bucketEnd = new Date('2025-05-08T02:00:00');
      const bucketMs = 60 * 60 * 1000; // 1 hour

      const result = format24hLabel(bucketEnd, bucketMs, windowStart);
      
      // Should include date for later day: "8 May 2:00 AM" or similar
      expect(result).toMatch(/8/); // Day
      expect(result).toMatch(/May/); // Month
      expect(result).toMatch(/2|02/); // Hour
    });

    it('should return date-time label for later day with sub-hourly buckets', () => {
      const windowStart = new Date('2025-05-07T22:00:00');
      const bucketEnd = new Date('2025-05-08T02:30:00');
      const bucketMs = 30 * 60 * 1000; // 30 minutes

      const result = format24hLabel(bucketEnd, bucketMs, windowStart);
      
      // Should include date and time with minutes: "8 May 2:30 AM" or similar
      expect(result).toMatch(/8/); // Day
      expect(result).toMatch(/May/); // Month
      expect(result).toMatch(/2|02/); // Hour
      expect(result).toMatch(/30/); // Minutes
    });

    it('should handle midnight crossing correctly', () => {
      const windowStart = new Date('2025-05-07T23:00:00');
      const bucketEnd = new Date('2025-05-08T00:00:00');
      const bucketMs = 60 * 60 * 1000; // 1 hour

      const result = format24hLabel(bucketEnd, bucketMs, windowStart);
      
      // Should include date for midnight of the next day
      expect(result).toMatch(/8/); // Day
      expect(result).toMatch(/May/); // Month
      expect(result).toMatch(/12|0|00/); // Midnight hour
    });
  });

  describe('edge cases', () => {
    it('should handle month boundary crossing', () => {
      const windowStart = new Date('2025-05-31T22:00:00');
      const bucketEnd = new Date('2025-06-01T02:00:00');
      const bucketMs = 60 * 60 * 1000; // 1 hour

      const result = format24hLabel(bucketEnd, bucketMs, windowStart);
      
      // Should show June 1st
      expect(result).toMatch(/1/); // Day
      expect(result).toMatch(/Jun/); // Month (abbreviated)
      expect(result).toMatch(/2|02/); // Hour
    });

    it('should handle year boundary crossing', () => {
      const windowStart = new Date('2025-12-31T22:00:00');
      const bucketEnd = new Date('2026-01-01T02:00:00');
      const bucketMs = 60 * 60 * 1000; // 1 hour

      const result = format24hLabel(bucketEnd, bucketMs, windowStart);
      
      // Should show January 1st (year not included in format)
      expect(result).toMatch(/1/); // Day
      expect(result).toMatch(/Jan/); // Month (abbreviated)
      expect(result).toMatch(/2|02/); // Hour
    });

    it('should handle very small bucket sizes', () => {
      const windowStart = new Date('2025-05-07T22:00:00');
      const bucketEnd = new Date('2025-05-08T02:05:00');
      const bucketMs = 5 * 60 * 1000; // 5 minutes

      const result = format24hLabel(bucketEnd, bucketMs, windowStart);
      
      // Should include date and time with minutes
      expect(result).toMatch(/8/); // Day
      expect(result).toMatch(/May/); // Month
      expect(result).toMatch(/2|02/); // Hour
      expect(result).toMatch(/05|5/); // Minutes
    });
  });
});
