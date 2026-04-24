/**
 * Chart.js instances and helpers — modernized styling.
 */
const MAX_H = 20;

let dashChart = null;

const GRID_COLOR = 'rgba(148,163,184,0.12)';
const TICK_COLOR = '#94a3b8';
const FONT = { family: 'Inter, sans-serif', size: 10 };

export function getMaxHistory() {
  return MAX_H;
}

export function initDashboardChart(canvasEl) {
  if (!canvasEl || typeof Chart === 'undefined') return null;
  dashChart = new Chart(canvasEl.getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'pH',
          data: [],
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.06)',
          tension: 0.45,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2,
          fill: true,
        },
        {
          label: 'DO',
          data: [],
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34,197,94,0.06)',
          tension: 0.45,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2,
          fill: true,
        },
        {
          label: 'Turb',
          data: [],
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245,158,11,0.06)',
          tension: 0.45,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2,
          fill: true,
        },
        {
          label: 'Temp',
          data: [],
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239,68,68,0.06)',
          tension: 0.45,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 350, easing: 'easeInOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.9)',
          titleColor: '#e2e8f0',
          bodyColor: '#94a3b8',
          borderColor: 'rgba(148,163,184,0.2)',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          titleFont: { ...FONT, weight: '600' },
          bodyFont: FONT,
        },
      },
      scales: {
        x: {
          ticks: { color: TICK_COLOR, font: FONT, maxTicksLimit: 8 },
          grid: { color: GRID_COLOR },
          border: { color: GRID_COLOR },
        },
        y: {
          ticks: { color: TICK_COLOR, font: FONT },
          grid: { color: GRID_COLOR },
          border: { color: GRID_COLOR },
        },
      },
    },
  });
  return dashChart;
}

export function pushChart(ph, doV, turb, temp) {
  if (!dashChart) return;
  const t = new Date().toTimeString().split(':').slice(0, 2).join(':');
  dashChart.data.labels.push(t);
  [ph, doV, turb, temp].forEach((v, i) => dashChart.data.datasets[i].data.push(Number(v)));
  if (dashChart.data.labels.length > MAX_H) {
    dashChart.data.labels.shift();
    dashChart.data.datasets.forEach((d) => d.data.shift());
  }
  dashChart.update('active');
}

export function initHistoricalChart(canvasEl) {
  if (!canvasEl || typeof Chart === 'undefined') return;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  new Chart(canvasEl.getContext('2d'), {
    type: 'line',
    data: {
      labels: days,
      datasets: [
        {
          label: 'O₂ (mg/L)',
          data: [8.2, 8.4, 8.3, 8.5, 8.4, 8.6, 8.6],
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34,197,94,0.08)',
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: '#22c55e',
          borderWidth: 2,
          fill: true,
        },
        {
          label: 'Temp (°C)',
          data: [22.2, 22.5, 22.4, 22.8, 22.6, 22.6, 22.6],
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239,68,68,0.08)',
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: '#ef4444',
          borderWidth: 2,
          fill: true,
        },
        {
          label: 'pH',
          data: [7.0, 7.1, 7.2, 7.1, 7.2, 7.2, 7.2],
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.08)',
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: '#3b82f6',
          borderWidth: 2,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: TICK_COLOR, font: FONT, usePointStyle: true, pointStyleWidth: 8, padding: 16 },
        },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.9)',
          titleColor: '#e2e8f0',
          bodyColor: '#94a3b8',
          borderColor: 'rgba(148,163,184,0.2)',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
        },
      },
      scales: {
        x: { ticks: { color: TICK_COLOR, font: FONT }, grid: { color: GRID_COLOR }, border: { color: GRID_COLOR } },
        y: { ticks: { color: TICK_COLOR, font: FONT }, grid: { color: GRID_COLOR }, border: { color: GRID_COLOR } },
      },
    },
  });
}

export function initFeedingChart(canvasEl) {
  if (!canvasEl || typeof Chart === 'undefined') return;
  new Chart(canvasEl.getContext('2d'), {
    type: 'bar',
    data: {
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      datasets: [{
        label: 'Consumption (kg)',
        data: [85, 88, 86, 90, 84, 86, 86],
        backgroundColor: 'rgba(59,130,246,0.75)',
        borderColor: '#3b82f6',
        borderWidth: 1.5,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.9)',
          titleColor: '#e2e8f0',
          bodyColor: '#94a3b8',
          borderColor: 'rgba(148,163,184,0.2)',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
        },
      },
      scales: {
        x: { ticks: { color: TICK_COLOR, font: FONT }, grid: { display: false }, border: { color: GRID_COLOR } },
        y: { beginAtZero: true, ticks: { color: TICK_COLOR, font: FONT }, grid: { color: GRID_COLOR }, border: { color: GRID_COLOR } },
      },
    },
  });
}
