/**
 * Alerts feature: summary cards and notification settings (static; can wire to API later).
 */
export function init() {
  const email = document.getElementById('alert-email');
  const sms = document.getElementById('alert-sms');
  const push = document.getElementById('alert-push');
  if (!email && !sms && !push) return;

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

  const s = load();
  if (email && typeof s.email === 'boolean') email.checked = s.email;
  if (sms && typeof s.sms === 'boolean') sms.checked = s.sms;
  if (push && typeof s.push === 'boolean') push.checked = s.push;

  email?.addEventListener('change', () => save({ email: !!email.checked }));
  sms?.addEventListener('change', () => save({ sms: !!sms.checked }));
  push?.addEventListener('change', () => save({ push: !!push.checked }));
}
