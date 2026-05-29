/**
 * Unit tests for getNavigatedRange (exported from historical-data.js).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../public/js/charts.js', () => ({
  initHistoricalChart: vi.fn(() => null),
  updateHistoricalChart: vi.fn(),
}));
vi.mock('../public/js/utils.js', () => ({
  getHistoryRange: vi.fn(() => []),
  spkData: { ph: [], do: [], turb: [], temp: [] },
  mergeRtdbEntries: vi.fn(),
  getBadge: vi.fn(() => ({ c: 'ok', l: 'Normal' })),
}));

import { getNavigatedRange } from '../public/js/features/historical-data.js';

describe('getNavigatedRange', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-28T14:30:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('24h range', () => {
    it('returns 24-hour range relative to now with no offset', () => {
      const result = getNavigatedRange('24h', 0, 0, '', '');
      const now = Date.now();
      const expectedFrom = now - 24 * 60 * 60 * 1000;
      expect(result.from.getTime()).toBe(expectedFrom);
      expect(result.to.getTime()).toBe(now);
    });

    it('ignores offsets for 24h range', () => {
      const result = getNavigatedRange('24h', 5, 3, '', '');
      const now = Date.now();
      expect(result.from.getTime()).toBe(now - 24 * 60 * 60 * 1000);
      expect(result.to.getTime()).toBe(now);
    });
  });

  describe('week range', () => {
    it('returns current week Monday–Sunday with offset 0', () => {
      const result = getNavigatedRange('week', 0, 0, '', '');
      expect(result.from.getDay()).toBe(1);
      expect(result.from.getHours()).toBe(0);
      expect(result.to.getDay()).toBe(0);
      expect(result.to.getHours()).toBe(23);
      expect(result.to.getMinutes()).toBe(59);
    });

    it('shifts week by weekOffset', () => {
      const current = getNavigatedRange('week', 0, 0, '', '');
      const prev = getNavigatedRange('week', -1, 0, '', '');
      const diffDays = (current.from - prev.from) / (24 * 60 * 60 * 1000);
      expect(diffDays).toBe(7);
    });
  });

  describe('month range', () => {
    it('returns current month bounds with offset 0', () => {
      const result = getNavigatedRange('month', 0, 0, '', '');
      expect(result.from.getDate()).toBe(1);
      expect(result.from.getMonth()).toBe(4);
      expect(result.to.getMonth()).toBe(4);
      expect(result.to.getDate()).toBe(31);
    });

    it('shifts month by monthOffset', () => {
      const result = getNavigatedRange('month', 0, -1, '', '');
      expect(result.from.getMonth()).toBe(3);
      expect(result.from.getFullYear()).toBe(2026);
    });
  });

  describe('custom range', () => {
    it('parses custom from/to dates', () => {
      const result = getNavigatedRange('custom', 0, 0, '2026-05-01', '2026-05-15');
      expect(result.from.getFullYear()).toBe(2026);
      expect(result.from.getMonth()).toBe(4);
      expect(result.from.getDate()).toBe(1);
      expect(result.to.getDate()).toBe(15);
      expect(result.to.getHours()).toBe(23);
    });
  });

  describe('invalid offsets', () => {
    it('treats NaN weekOffset as 0', () => {
      const a = getNavigatedRange('week', NaN, 0, '', '');
      const b = getNavigatedRange('week', 0, 0, '', '');
      expect(a.from.getTime()).toBe(b.from.getTime());
    });

    it('treats Infinity monthOffset as 0', () => {
      const a = getNavigatedRange('month', 0, Infinity, '', '');
      const b = getNavigatedRange('month', 0, 0, '', '');
      expect(a.from.getTime()).toBe(b.from.getTime());
    });
  });

  describe('fallback', () => {
    it('falls back to 24h for unknown rangeVal', () => {
      const result = getNavigatedRange('unknown', 0, 0, '', '');
      const now = Date.now();
      expect(result.from.getTime()).toBe(now - 24 * 60 * 60 * 1000);
    });
  });
});
