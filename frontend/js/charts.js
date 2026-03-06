/**
 * Chart.js instances and helpers. Same logic as original dashboard.
 */
const MAX_H = 20;

let histChart = null;

export function getMaxHistory() {
  return MAX_H;
}

export function initDashboardChart(canvasEl) {
  if (!canvasEl || typeof Chart === 'undefined') return null;
  histChart = new Chart(canvasEl.getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'pH', data: [], borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.08)', tension: 0.4, pointRadius: 0, borderWidth: 1.8 },
        { label: 'DO', data: [], borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)', tension: 0.4, pointRadius: 0, borderWidth: 1.8 },
        { label: 'Turb', data: [], borderColor: '#eab308', backgroundColor: 'rgba(234,179,8,0.08)', tension: 0.4, pointRadius: 0, borderWidth: 1.8 },
        { label: 'Temp', data: [], borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.08)', tension: 0.4, pointRadius: 0, borderWidth: 1.8 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 9 } }, grid: { color: '#e2e8f0' } },
        y: { ticks: { color: '#64748b', font: { size: 9 } }, grid: { color: '#e2e8f0' } },
      },
    },
  });
  return histChart;
}

export function pushChart(ph, doV, turb, temp) {
  if (!histChart) return;
  const t = new Date().toTimeString().split(':').slice(0, 2).join(':');
  histChart.data.labels.push(t);
  [ph, doV, turb, temp].forEach((v, i) => histChart.data.datasets[i].data.push(Number(v)));
  if (histChart.data.labels.length > MAX_H) {
    histChart.data.labels.shift();
    histChart.data.datasets.forEach((d) => d.data.shift());
  }
  histChart.update();
}

export function initHistoricalChart(canvasEl) {
  if (!canvasEl || typeof Chart === 'undefined') return;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  new Chart(canvasEl.getContext('2d'), {
    type: 'line',
    data: {
      labels: days,
      datasets: [
        { label: 'O₂ (mg/L)', data: [8.2, 8.4, 8.3, 8.5, 8.4, 8.6, 8.6], borderColor: '#22c55e', tension: 0.4, pointRadius: 4 },
        { label: 'Temp (°C)', data: [22.2, 22.5, 22.4, 22.8, 22.6, 22.6, 22.6], borderColor: '#ef4444', tension: 0.4, pointRadius: 4 },
        { label: 'pH', data: [7.0, 7.1, 7.2, 7.1, 7.2, 7.2, 7.2], borderColor: '#3b82f6', tension: 0.4, pointRadius: 4 },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: {}, y: {} } },
  });
}

export function initFeedingChart(canvasEl) {
  if (!canvasEl || typeof Chart === 'undefined') return;
  new Chart(canvasEl.getContext('2d'), {
    type: 'bar',
    data: {
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      datasets: [{ label: 'Consumption (kg)', data: [85, 88, 86, 90, 84, 86, 86], backgroundColor: '#3b82f6' }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: {}, y: { beginAtZero: true } } },
  });
}
