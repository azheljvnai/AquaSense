import { describe, it, expect } from 'vitest';
import { buildFeedingCsvRows } from '../public/js/features/report-feeding-rows.js';

describe('feeding report rows', () => {
  const range = { label: 'Today (2026-05-22)' };

  it('includes dispense log columns and excludes legacy metrics', () => {
    const rows = buildFeedingCsvRows([], range);
    const flat = rows.flat().join('|');
    expect(flat).toContain('dispense_time');
    expect(flat).toContain('amount_mg');
    expect(flat).toContain('total_dispenses');
    expect(flat).not.toContain('feed_efficiency');
    expect(flat).not.toContain('stock');
    expect(flat).not.toContain('total_feed_kg');
  });

  it('lists each dispense with time and amount', () => {
    const dispenses = [
      {
        timestampDisplay: '2026-05-22 08:00:15',
        type: 'Scheduled',
        amountMg: 300,
        reason: 'SCHED 1',
      },
      {
        timestampDisplay: '2026-05-22 18:30:00',
        type: 'Manual',
        amountMg: 280,
        reason: 'Manual',
      },
    ];
    const rows = buildFeedingCsvRows(dispenses, range);
    expect(rows).toContainEqual(['2026-05-22 08:00:15', 'Scheduled', '300', 'SCHED 1']);
    expect(rows).toContainEqual(['total_dispenses', '2']);
    expect(rows).toContainEqual(['total_amount_mg', '580']);
  });
});
