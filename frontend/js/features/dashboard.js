/**
 * Dashboard feature: main chart.
 */
import { initDashboardChart } from '../charts.js';

export function init() {
  const chartEl = document.getElementById('chart');
  if (chartEl) initDashboardChart(chartEl);
}
