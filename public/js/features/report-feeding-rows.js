import { FEED_DISPENSE_MG_RANGE_LABEL } from '../feed-dispense.js';

/** @param {Array<{ timestampDisplay: string, type: string, amountMg: number, reason: string }>} dispenses */
export function buildFeedingCsvRows(dispenses, range) {
  const totalMg = dispenses.reduce((sum, d) => sum + (d.amountMg || 0), 0);
  const rows = [
    ['--- FEEDING ---'],
    ['metric', 'value'],
    ['period_label', range.label],
    ['total_dispenses', String(dispenses.length)],
    ['total_amount_mg', String(totalMg)],
    ['expected_range_per_dispense_mg', FEED_DISPENSE_MG_RANGE_LABEL],
    [],
    ['--- DISPENSE LOG ---'],
    ['dispense_time', 'feed_type', 'amount_mg', 'reason'],
  ];
  if (dispenses.length) {
    for (const d of dispenses) {
      rows.push([d.timestampDisplay, d.type, String(d.amountMg), d.reason]);
    }
  } else {
    rows.push(['(no dispenses recorded for this period)', '', '', '']);
  }
  return rows;
}
