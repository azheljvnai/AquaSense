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
let connectStarted = false;

const STORAGE_FB_URL = 'aquasense.fbUrl.v1';
const STORAGE_AUTO_CONNECT = 'aquasense.autoConnect.v1';

function badgeClassFromKey(key) {
  if (key === 'ok') return 'status-normal';
  if (key === 'warn') return 'status-warning';
  return 'status-critical';
}

function formatSensorValue(key, val) {
  if (key === 'temp') return `${val.toFixed(1)}°C`;
  if (key === 'do') return `${val.toFixed(1)} mg/L`;
  if (key === 'turb') return `${val.toFixed(1)} NTU`;
  return val.toFixed(1);
}

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
  const wqTurb = document.getElementById('wq-avg-turb');
  if (key === 'ph' && wqPh) wqPh.textContent = val.toFixed(1);
  if (key === 'temp' && wqTemp) wqTemp.textContent = val.toFixed(1) + '°C';
  if (key === 'do' && wqDo) wqDo.textContent = val.toFixed(1) + ' mg/L';
  if (key === 'turb' && wqTurb) wqTurb.textContent = val.toFixed(1) + ' NTU';

  // Water Quality (Pond 1) live values + badges
  const pondVal = document.getElementById('wq-pond-' + key);
  if (pondVal) pondVal.textContent = formatSensorValue(key, val);
  const pondBadge = document.getElementById('wq-pond-b-' + key);
  if (pondBadge) {
    pondBadge.textContent = b.l;
    pondBadge.className = `badge-pill ${badgeClassFromKey(b.c)}`;
  }
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

      // Close mobile nav after navigation
      document.body.classList.remove('sidebar-open');
    });
  });
}

function setupHamburger() {
  const btn = document.getElementById('nav-toggle');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!btn || !backdrop) return;

  const close = () => document.body.classList.remove('sidebar-open');
  const toggle = () => document.body.classList.toggle('sidebar-open');

  btn.addEventListener('click', toggle);
  backdrop.addEventListener('click', close);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
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
  const input = document.getElementById('fb-url');
  if (config.firebaseDatabaseUrl) {
    if (input) input.value = config.firebaseDatabaseUrl;
    try {
      localStorage.setItem(STORAGE_FB_URL, config.firebaseDatabaseUrl);
    } catch {
      // ignore
    }
  }
  if (config.deviceId) deviceId = config.deviceId;
  // Fallback: if backend isn't running, use last saved URL (if any)
  if (input && !input.value) {
    try {
      const saved = localStorage.getItem(STORAGE_FB_URL);
      if (saved) input.value = saved;
    } catch {
      // ignore
    }
  }

  return !!config.firebaseDatabaseUrl;
}

function connectFirebase() {
  if (connectStarted) return;
  const input = document.getElementById('fb-url');
  const url = input ? input.value.trim() : '';
  if (!url) {
    alert('Enter Firebase URL or set FIREBASE_DATABASE_URL in .env and run the backend.');
    return;
  }
  connectStarted = true;
  try {
    localStorage.setItem(STORAGE_FB_URL, url);
    localStorage.setItem(STORAGE_AUTO_CONNECT, 'true');
  } catch {
    // ignore
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
  setupHamburger();
  setupClock();
  initDashboard();
  initWaterQuality();
  initHistoricalData();
  initFeeding();
  initAlerts();
  initFarmProfile();
  initReports();
  initConfiguration();
  loadConfigAndPrefill().then((hadBackendConfig) => {
    let wantsAuto = hadBackendConfig;
    if (!wantsAuto) {
      try {
        wantsAuto = localStorage.getItem(STORAGE_AUTO_CONNECT) === 'true';
      } catch {
        wantsAuto = false;
      }
    }
    const input = document.getElementById('fb-url');
    const url = input ? input.value.trim() : '';
    if (wantsAuto && url) {
      log('Auto-connecting to Firebase...');
      connectFirebase();
    } else {
      log('Dashboard ready. Click Connect to start.');
    }
  });
}

init();
