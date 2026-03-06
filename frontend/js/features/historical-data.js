/**
 * Historical Data feature: weekly chart and range selector.
 */
import { initHistoricalChart } from '../charts.js';

export function init() {
  const histEl = document.getElementById('hist-chart');
  if (histEl) initHistoricalChart(histEl);
}
