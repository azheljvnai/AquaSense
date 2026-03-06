/**
 * Dashboard feature: main chart and population placeholder.
 */
import { initDashboardChart } from '../charts.js';

export function init() {
  const chartEl = document.getElementById('chart');
  if (chartEl) initDashboardChart(chartEl);
  const popEl = document.getElementById('v-population');
  if (popEl) popEl.textContent = '—';
}
