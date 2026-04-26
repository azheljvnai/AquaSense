/**
 * Feeding feature: schedule list and weekly consumption chart.
 */
import { initFeedingChart } from '../charts.js';

export function init() {
  const feedEl = document.getElementById('feed-chart');
  if (feedEl) initFeedingChart(feedEl);
}
