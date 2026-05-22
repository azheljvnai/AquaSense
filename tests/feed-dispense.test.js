import { describe, it, expect } from 'vitest';
import {
  FEED_DISPENSE_MG_MIN,
  FEED_DISPENSE_MG_MAX,
  FEED_DISPENSE_MG_DEFAULT,
  isTriggeredDispenseReason,
  normalizeAmountMg,
  parseFeedLogEntry,
  parseFeedTimestamp,
  dedupeDispensesBySecond,
} from '../public/js/feed-dispense.js';

describe('feed-dispense', () => {
  it('normalizeAmountMg returns default when missing', () => {
    expect(normalizeAmountMg(undefined)).toBe(FEED_DISPENSE_MG_DEFAULT);
    expect(normalizeAmountMg('')).toBe(FEED_DISPENSE_MG_DEFAULT);
  });

  it('normalizeAmountMg clamps to 200-400', () => {
    expect(normalizeAmountMg(100)).toBe(FEED_DISPENSE_MG_MIN);
    expect(normalizeAmountMg(500)).toBe(FEED_DISPENSE_MG_MAX);
    expect(normalizeAmountMg(250.4)).toBe(250);
  });

  it('parseFeedTimestamp parses RTDB format', () => {
    const ms = parseFeedTimestamp('2026-05-22 14:30:00');
    expect(ms).toBeTypeOf('number');
    expect(Number.isFinite(ms)).toBe(true);
  });

  it('isTriggeredDispenseReason accepts manual and scheduled only', () => {
    expect(isTriggeredDispenseReason('MANUAL')).toBe(true);
    expect(isTriggeredDispenseReason('SCHED 1')).toBe(true);
    expect(isTriggeredDispenseReason('Scheduled')).toBe(true);
    expect(isTriggeredDispenseReason('')).toBe(false);
    expect(isTriggeredDispenseReason('sensor_update')).toBe(false);
  });

  it('parseFeedLogEntry rejects non-trigger reasons', () => {
    expect(parseFeedLogEntry({
      reason: 'heartbeat',
      timestamp: '2026-05-22 08:00:00',
    })).toBeNull();
  });

  it('dedupeDispensesBySecond keeps one entry per second', () => {
    const out = dedupeDispensesBySecond([
      { ts: 1000, type: 'Manual', amountMg: 300, timestampDisplay: 't1', reason: 'Manual' },
      { ts: 1000, type: 'Manual', amountMg: 300, timestampDisplay: 't2', reason: 'Manual' },
      { ts: 2000, type: 'Scheduled', amountMg: 300, timestampDisplay: 't3', reason: 'SCHED 1' },
    ]);
    expect(out).toHaveLength(2);
  });

  it('parseFeedLogEntry maps manual and scheduled types', () => {
    const manual = parseFeedLogEntry({
      reason: 'MANUAL',
      timestamp: '2026-05-22 08:00:00',
      amountMg: 320,
    });
    expect(manual?.type).toBe('Manual');
    expect(manual?.amountMg).toBe(320);

    const sched = parseFeedLogEntry({
      reason: 'SCHED 1',
      timestamp: '2026-05-22 12:00:00',
    });
    expect(sched?.type).toBe('Scheduled');
    expect(sched?.amountMg).toBe(FEED_DISPENSE_MG_DEFAULT);
  });
});
