import { describe, it, expect } from 'vitest';
import {
  FEED_DISPENSE_MG_MIN,
  FEED_DISPENSE_MG_MAX,
  FEED_DISPENSE_MG_ESTIMATE,
  FEED_DISPENSE_AMOUNT_LABEL,
  formatFeedAmountDisplay,
  formatFeedAmountTotalDisplay,
  amountMgEstimateFromStored,
  isTriggeredDispenseReason,
  normalizeAmountMg,
  parseFeedLogEntry,
  parseFeedTimestamp,
  dedupeDispensesBySecond,
} from '../public/js/feed-dispense.js';

describe('feed-dispense', () => {
  it('formatFeedAmountTotalDisplay scales range by dispense count', () => {
    expect(formatFeedAmountTotalDisplay(0)).toBe('—');
    expect(formatFeedAmountTotalDisplay(1)).toBe('~200-300mg');
    expect(formatFeedAmountTotalDisplay(2)).toBe('~400-600mg');
    expect(formatFeedAmountTotalDisplay(3)).toBe('~600-900mg');
  });

  it('formatFeedAmountDisplay returns ~200-300mg for missing and legacy numeric', () => {
    expect(formatFeedAmountDisplay(undefined)).toBe(FEED_DISPENSE_AMOUNT_LABEL);
    expect(formatFeedAmountDisplay(300)).toBe(FEED_DISPENSE_AMOUNT_LABEL);
    expect(formatFeedAmountDisplay('~200-300mg')).toBe('~200-300mg');
  });

  it('amountMgEstimateFromStored uses midpoint for label and clamps legacy numbers', () => {
    expect(amountMgEstimateFromStored('~200-300mg')).toBe(FEED_DISPENSE_MG_ESTIMATE);
    expect(amountMgEstimateFromStored(undefined)).toBe(FEED_DISPENSE_MG_ESTIMATE);
    expect(amountMgEstimateFromStored(100)).toBe(FEED_DISPENSE_MG_MIN);
    expect(amountMgEstimateFromStored(500)).toBe(FEED_DISPENSE_MG_MAX);
    expect(amountMgEstimateFromStored(250.4)).toBe(250);
  });

  it('normalizeAmountMg matches estimate helper', () => {
    expect(normalizeAmountMg('~200-300mg')).toBe(FEED_DISPENSE_MG_ESTIMATE);
    expect(normalizeAmountMg(320)).toBe(300);
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
      { ts: 1000, type: 'Manual', amountDisplay: '~200-300mg', amountMgEstimate: 250, timestampDisplay: 't1', reason: 'Manual' },
      { ts: 1000, type: 'Manual', amountDisplay: '~200-300mg', amountMgEstimate: 250, timestampDisplay: 't2', reason: 'Manual' },
      { ts: 2000, type: 'Scheduled', amountDisplay: '~200-300mg', amountMgEstimate: 250, timestampDisplay: 't3', reason: 'SCHED 1' },
    ]);
    expect(out).toHaveLength(2);
  });

  it('parseFeedLogEntry maps manual and scheduled with amount label', () => {
    const manual = parseFeedLogEntry({
      reason: 'MANUAL',
      timestamp: '2026-05-22 08:00:00',
      amountMg: '~200-300mg',
    });
    expect(manual?.type).toBe('Manual');
    expect(manual?.amountDisplay).toBe('~200-300mg');
    expect(manual?.amountMgEstimate).toBe(FEED_DISPENSE_MG_ESTIMATE);

    const sched = parseFeedLogEntry({
      reason: 'SCHED 1',
      timestamp: '2026-05-22 12:00:00',
    });
    expect(sched?.type).toBe('Scheduled');
    expect(sched?.amountDisplay).toBe(FEED_DISPENSE_AMOUNT_LABEL);
    expect(sched?.amountMgEstimate).toBe(FEED_DISPENSE_MG_ESTIMATE);

    const legacy = parseFeedLogEntry({
      reason: 'MANUAL',
      timestamp: '2026-05-22 08:00:00',
      amountMg: 320,
    });
    expect(legacy?.amountDisplay).toBe(FEED_DISPENSE_AMOUNT_LABEL);
    expect(legacy?.amountMgEstimate).toBe(300);
  });
});
