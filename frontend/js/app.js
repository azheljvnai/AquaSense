/**
 * App entry: navigation, clock, config, Firebase wiring, and feature inits.
 */
import { getConfig } from './config.js';
import { connect, triggerFeed, saveSchedules } from './firebase.js';
import { log } from './utils.js';
import { getBadge, spkData, spkCol, drawSpark } from './utils.js';
import { pushChart } from './charts.js';
import { init as initDashboard } from './features/dashboard.js';
import { init as initWaterQuality } from './features/water-quality.js';
import { init as initHistoricalData } from './features/historical-data.js';
import { init as initFeeding } from './features/feeding.js';
import { init as initAlerts } from './features/alerts.js';
import { init as initFarmProfile } from './features/farm-profile.js';
import { init as initReports } from './features/reports.js';
import { init as initConfiguration } from './features/configuration.js';

let deviceId = 'device001';

function setStatus(lbl, online) {
  const lblEl = document.getElementById('fb-lbl');
  if (lblEl) lblEl.textContent = lbl;
  const d = document.getElementById('feed-dot');
  if (d) d.className = 'dot' + (online ? '' : ' off');
}

function enableFeedBtn(on) {
  const btn = document.getElementById('feed-btn');
  const dot = document.getElementById('feed-dot');
  const note = document.getElementById('feed-note-txt');
  if (btn) btn.disabled = !on;
  if (dot) dot.className = 'dot' + (on ? '' : ' off');
  if (note) note.textContent = on ? 'Firebase connected — button locks until ESP32 confirms' : 'Connect to Firebase to enable feed button';
}

/** Used by firebase when sensor data arrives. */
export function updateCard(key, val) {
  const el = document.getElementById('v-' + key);
  const bd = document.getElementById('b-' + key);
  if (!el) return;
  el.textContent = val.toFixed(1);
  const b = getBadge(key, val);
  if (bd) {
    bd.className = 'scard-badge ' + b.c;
    bd.textContent = b.l;
  }
  spkData[key].push(val);
  if (spkData[key].length > 30) spkData[key].shift();
  drawSpark(key, spkData[key], spkCol[key]);
  if (b.c === 'danger') log(`${key.toUpperCase()} CRITICAL: ${val.toFixed(1)}`, 'err');
  else if (b.c === 'warn') log(`${key.toUpperCase()} WARNING: ${val.toFixed(1)}`, 'warn');
  const wqPh = document.getElementById('wq-avg-ph');
  const wqTemp = document.getElementById('wq-avg-temp');
  const wqDo = document.getElementById('wq-avg-do');
  if (key === 'ph' && wqPh) wqPh.textContent = val.toFixed(1);
  if (key === 'temp' && wqTemp) wqTemp.textContent = val.toFixed(1) + '°C';
  if (key === 'do' && wqDo) wqDo.textContent = val.toFixed(1) + ' mg/L';
}

function setupNavigation() {
  document.querySelectorAll('.sidebar-nav a[data-page]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const page = a.getAttribute('data-page');
      document.querySelectorAll('.sidebar-nav a').forEach((x) => x.classList.remove('active'));
      a.classList.add('active');
      document.querySelectorAll('.page-section').forEach((s) => s.classList.remove('active'));
      const el = document.getElementById('page-' + page);
      if (el) el.classList.add('active');
    });
  });
}

function setupClock() {
  setInterval(() => {
    const el = document.getElementById('hclock');
    if (el) el.textContent = new Date().toTimeString().split(' ')[0];
  }, 1000);
}

async function loadConfigAndPrefill() {
  const config = await getConfig();
  if (config.firebaseDatabaseUrl) {
    const input = document.getElementById('fb-url');
    if (input) input.value = config.firebaseDatabaseUrl;
  }
  if (config.deviceId) deviceId = config.deviceId;
}

function connectFirebase() {
  const input = document.getElementById('fb-url');
  const url = input ? input.value.trim() : '';
  if (!url) {
    alert('Enter Firebase URL or set FIREBASE_DATABASE_URL in .env and run the backend.');
    return;
  }
  connect(url, deviceId, {
    onStatus: setStatus,
    onSensorData: (ph, doV, turb, temp) => {
      updateCard('ph', ph);
      updateCard('do', doV);
      updateCard('turb', turb);
      updateCard('temp', temp);
      pushChart(ph, doV, turb, temp);
    },
    enableFeedBtn,
  });
}

window.connectFirebase = connectFirebase;
window.triggerFeed = () => triggerFeed(deviceId);
window.saveSchedules = () => saveSchedules(deviceId);

function init() {
  setupNavigation();
  setupClock();
  initDashboard();
  initWaterQuality();
  initHistoricalData();
  initFeeding();
  initAlerts();
  initFarmProfile();
  initReports();
  initConfiguration();
  loadConfigAndPrefill();
  log('Dashboard ready. Click Connect to start.');
}

init();
