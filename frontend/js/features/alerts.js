/**
 * Alerts feature: summary cards, notification settings, and dynamic threshold display.
 */
import { getThresholds } from '../utils.js';

export function init() {
  const email = document.getElementById('alert-email');
  const sms = document.getElementById('alert-sms');
  const push = document.getElementById('alert-push');

  const KEY = 'aquasense.settings.v1';

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch {
      return {};
    }
  }

  function save(next) {
    const cur = load();
    const merged = { ...cur, ...next };
    try {
      localStorage.setItem(KEY, JSON.stringify(merged));
    } catch {
      // ignore
    }
  }

  if (email || sms || push) {
    const s = load();
    if (email && typeof s.email === 'boolean') email.checked = s.email;
    if (sms && typeof s.sms === 'boolean') sms.checked = s.sms;
    if (push && typeof s.push === 'boolean') push.checked = s.push;

    email?.addEventListener('change', () => save({ email: !!email.checked }));
    sms?.addEventListener('change', () => save({ sms: !!sms.checked }));
    push?.addEventListener('change', () => save({ push: !!push.checked }));
  }

  // Render threshold display and keep it in sync
  function renderThresholds() {
    const t = getThresholds();
    const ph   = document.getElementById('alert-th-ph');
    const temp = document.getElementById('alert-th-temp');
    const doEl = document.getElementById('alert-th-do');
    const turb = document.getElementById('alert-th-turb');

    if (ph)   ph.textContent   = `${t.ph.ok[0]} – ${t.ph.ok[1]}`;
    if (temp) temp.textContent = `${t.temp.ok[0]} – ${t.temp.ok[1]} °C`;
    if (doEl) doEl.textContent = `≥ ${t.do.ok[0]} mg/L`;
    if (turb) turb.textContent = `≤ ${t.turb.ok[1]} NTU`;
  }

  renderThresholds();
  window.addEventListener('thresholds-changed', renderThresholds);
}
