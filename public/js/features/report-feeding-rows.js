import {
  FEED_DISPENSE_MG_RANGE_LABEL,
  formatFeedAmountDisplay,
  formatFeedAmountTotalDisplay,
} from '../feed-dispense.js';

/** @param {Array<{ timestampDisplay: string, type: string, amountDisplay?: string, amountMgEstimate?: number, reason: string }>} dispenses */
export function buildFeedingCsvRows(dispenses, range) {
  const totalAmount = formatFeedAmountTotalDisplay(dispenses.length);
  const rows = [
    ['--- FEEDING ---'],
    ['metric', 'value'],
    ['period_label', range.label],
    ['total_dispenses', String(dispenses.length)],
    ['total_amount', totalAmount],
    ['expected_range_per_dispense', FEED_DISPENSE_MG_RANGE_LABEL],
    [],
    ['--- DISPENSE LOG ---'],
    ['dispense_time', 'feed_type', 'amount', 'reason'],
  ];
  if (dispenses.length) {
    for (const d of dispenses) {
      const amount = d.amountDisplay ?? formatFeedAmountDisplay(d.amountMg);
      rows.push([d.timestampDisplay, d.type, amount, d.reason]);
    }
  } else {
    rows.push(['(no dispenses recorded for this period)', '', '', '']);
  }
  return rows;
}
