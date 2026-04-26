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
  if (!canvasEl || typeof Chart === 'undefined') return null;
  const chart = new Chart(canvasEl.getContext('2d'), {
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
      spanGaps: false,
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
          ticks: { color: TICK_COLOR, font: FONT, maxTicksLimit: 24 },
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
  return chart;
}

/**
 * Update the historical chart with bucketed data.
 * @param {Chart} chart - Chart.js instance returned by initHistoricalChart
 * @param {string[]} labels - x-axis labels
 * @param {{ ph: number[], do: number[], turb: number[], temp: number[] }} data - per-metric arrays
 * @param {string} activeMetric - 'all' | 'ph' | 'do' | 'turb' | 'temp'
 */
export function updateHistoricalChart(chart, labels, data, activeMetric) {
  if (!chart) return;
  const visibility = {
    ph:   activeMetric === 'all' || activeMetric === 'ph',
    do:   activeMetric === 'all' || activeMetric === 'do',
    turb: activeMetric === 'all' || activeMetric === 'turb',
    temp: activeMetric === 'all' || activeMetric === 'temp',
  };
  const keys = ['ph', 'do', 'turb', 'temp'];

  // If labels/data are null, only toggle visibility (metric tab switch)
  if (labels !== null && data !== null) {
    chart.data.labels = labels;
    keys.forEach((k, i) => {
      chart.data.datasets[i].data = data[k] || [];
    });
  }

  keys.forEach((k, i) => {
    chart.data.datasets[i].hidden = !visibility[k];
  });
  chart.update('active');
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
