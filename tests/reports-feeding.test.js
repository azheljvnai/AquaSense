import { describe, it, expect } from 'vitest';
import { buildFeedingCsvRows } from '../public/js/features/report-feeding-rows.js';

describe('feeding report rows', () => {
  const range = { label: 'Today (2026-05-22)' };

  it('builds header and summary rows for empty dispenses', () => {
    const rows = buildFeedingCsvRows([], range);
    const flat = rows.flat().join('|');
    expect(flat).toContain('period_label');
    expect(flat).toContain('total_dispenses');
    expect(flat).toContain('total_amount');
    expect(flat).toContain('dispense_time');
    expect(rows).toContainEqual(['total_dispenses', '0']);
    expect(rows).toContainEqual(['total_amount', '—']);
    expect(rows.some((r) => r[0]?.includes('no dispenses'))).toBe(true);
  });

  it('lists each dispense with time, type, amount, and reason', () => {
    const dispenses = [
      {
        timestampDisplay: '2026-05-22 08:00:15',
        type: 'Scheduled',
        amountDisplay: '~200-300mg',
        amountMgEstimate: 250,
        reason: 'SCHED 1',
      },
      {
        timestampDisplay: '2026-05-22 18:30:00',
        type: 'Manual',
        amountDisplay: '~200-300mg',
        amountMgEstimate: 250,
        reason: 'Manual',
      },
    ];
    const rows = buildFeedingCsvRows(dispenses, range);
    expect(rows).toContainEqual(['2026-05-22 08:00:15', 'Scheduled', '~200-300mg', 'SCHED 1']);
    expect(rows).toContainEqual(['2026-05-22 18:30:00', 'Manual', '~200-300mg', 'Manual']);
    expect(rows).toContainEqual(['total_dispenses', '2']);
    expect(rows).toContainEqual(['total_amount', '~400-600mg']);
  });

  it('falls back to formatFeedAmountDisplay when amountDisplay is missing', () => {
    const rows = buildFeedingCsvRows(
      [{
        timestampDisplay: '2026-05-22 12:00:00',
        type: 'Manual',
        amountMg: 300,
        reason: 'MANUAL',
      }],
      range,
    );
    expect(rows).toContainEqual(['2026-05-22 12:00:00', 'Manual', '~200-300mg', 'MANUAL']);
  });
});
