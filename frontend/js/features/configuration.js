/**
 * Configuration feature: persist UI settings locally (no API changes).
 */
import { getThresholds, resetThresholds, saveThresholds } from '../utils.js';

export function init() {
  const els = {
    email: document.getElementById('cfg-email'),
    sms: document.getElementById('cfg-sms'),
    push: document.getElementById('cfg-push'),
    dailySummary: document.getElementById('cfg-daily-summary'),
    notifFrequency: document.getElementById('cfg-notif-frequency'),
    refresh: document.getElementById('cfg-refresh'),
    timezone: document.getElementById('cfg-timezone'),
    datefmt: document.getElementById('cfg-datefmt'),
    units: document.getElementById('cfg-units'),
    dark: document.getElementById('cfg-dark'),
    autosave: document.getElementById('cfg-autosave'),
    retention: document.getElementById('cfg-retention'),
    backup: document.getElementById('cfg-backup'),
    exportfmt: document.getElementById('cfg-exportfmt'),
    export: document.getElementById('cfg-export'),
    clear: document.getElementById('cfg-clear'),
    reset: document.getElementById('cfg-reset'),
    save: document.getElementById('cfg-save'),

    // Thresholds + temperature (top cards)
    thPhMin: document.getElementById('cfg-th-ph-min'),
    thPhMax: document.getElementById('cfg-th-ph-max'),
    thDoMin: document.getElementById('cfg-th-do-min'),
    thTurbMax: document.getElementById('cfg-th-turb-max'),
    autoAdjust: document.getElementById('cfg-auto-adjust'),
    tempMin: document.getElementById('cfg-temp-min'),
    tempMax: document.getElementById('cfg-temp-max'),
    tempOpt: document.getElementById('cfg-temp-opt'),
    tempSens: document.getElementById('cfg-temp-sens'),
    tempMonitor: document.getElementById('cfg-temp-monitor'),
  };

  if (!els.save) return;

  const KEY = 'aquasense.settings.v1';
  const defaults = {
    email: true,
    sms: true,
    push: false,
    dailySummary: true,
    notifFrequency: 'immediate',
    refresh: '30',
    timezone: 'Central (CST)',
    datefmt: 'MM/DD/YYYY',
    units: 'Imperial',
    dark: false,
    autosave: true,
    retention: '1 year',
    backup: 'Daily',
    exportfmt: 'CSV',

    autoAdjust: false,
    tempMin: 20,
    tempMax: 24,
    tempOpt: 22.5,
    tempSens: 65,
    tempMonitor: true,
  };

  function populateThresholdInputs() {
    const t = getThresholds();
    if (els.thPhMin) els.thPhMin.value = String(t.ph.ok[0]);
    if (els.thPhMax) els.thPhMax.value = String(t.ph.ok[1]);
    if (els.thDoMin) els.thDoMin.value = String(t.do.ok[0]);
    if (els.thTurbMax) els.thTurbMax.value = String(t.turb.ok[1]);
  }

  function saveThresholdInputs() {
    const toNum = (el, fallback) => {
      const n = Number(el?.value);
      return Number.isFinite(n) ? n : fallback;
    };

    const t = getThresholds();
    const phMin = toNum(els.thPhMin, t.ph.ok[0]);
    const phMax = toNum(els.thPhMax, t.ph.ok[1]);
    const doMin = toNum(els.thDoMin, t.do.ok[0]);
    const turbMax = toNum(els.thTurbMax, t.turb.ok[1]);

    // Keep the warn bands as-is; only update the values this UI exposes.
    saveThresholds({
      ph: { ok: [phMin, phMax] },
      do: { ok: [doMin, t.do.ok[1]] },
      turb: { ok: [t.turb.ok[0], turbMax] },
    });
  }

  function readState() {
    return {
      email: !!els.email?.checked,
      sms: !!els.sms?.checked,
      push: !!els.push?.checked,
      dailySummary: !!els.dailySummary?.checked,
      notifFrequency: els.notifFrequency?.value || defaults.notifFrequency,
      refresh: els.refresh?.value || defaults.refresh,
      timezone: els.timezone?.value || defaults.timezone,
      datefmt: els.datefmt?.value || defaults.datefmt,
      units: els.units?.value || defaults.units,
      dark: !!els.dark?.checked,
      autosave: !!els.autosave?.checked,
      retention: els.retention?.value || defaults.retention,
      backup: els.backup?.value || defaults.backup,
      exportfmt: els.exportfmt?.value || defaults.exportfmt,

      autoAdjust: !!els.autoAdjust?.checked,
      tempMin: Number(els.tempMin?.value) || defaults.tempMin,
      tempMax: Number(els.tempMax?.value) || defaults.tempMax,
      tempOpt: Number(els.tempOpt?.value) || defaults.tempOpt,
      tempSens: Number(els.tempSens?.value) || defaults.tempSens,
      tempMonitor: !!els.tempMonitor?.checked,
    };
  }

  function applyState(s) {
    if (els.email) els.email.checked = !!s.email;
    if (els.sms) els.sms.checked = !!s.sms;
    if (els.push) els.push.checked = !!s.push;
    if (els.dailySummary) els.dailySummary.checked = !!s.dailySummary;
    if (els.notifFrequency) els.notifFrequency.value = s.notifFrequency ?? defaults.notifFrequency;
    if (els.refresh) els.refresh.value = s.refresh ?? defaults.refresh;
    if (els.timezone) els.timezone.value = s.timezone ?? defaults.timezone;
    if (els.datefmt) els.datefmt.value = s.datefmt ?? defaults.datefmt;
    if (els.units) els.units.value = s.units ?? defaults.units;
    if (els.dark) els.dark.checked = !!s.dark;
    if (els.autosave) els.autosave.checked = s.autosave ?? true;
    if (els.retention) els.retention.value = s.retention ?? defaults.retention;
    if (els.backup) els.backup.value = s.backup ?? defaults.backup;
    if (els.exportfmt) els.exportfmt.value = s.exportfmt ?? defaults.exportfmt;

    if (els.autoAdjust) els.autoAdjust.checked = !!s.autoAdjust;
    if (els.tempMin) els.tempMin.value = String(s.tempMin ?? defaults.tempMin);
    if (els.tempMax) els.tempMax.value = String(s.tempMax ?? defaults.tempMax);
    if (els.tempOpt) els.tempOpt.value = String(s.tempOpt ?? defaults.tempOpt);
    if (els.tempSens) els.tempSens.value = String(s.tempSens ?? defaults.tempSens);
    if (els.tempMonitor) els.tempMonitor.checked = s.tempMonitor ?? true;

    document.body.classList.toggle('theme-dark', !!s.dark);
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults;
      return { ...defaults, ...JSON.parse(raw) };
    } catch {
      return defaults;
    }
  }

  function save() {
    const s = readState();
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      // ignore
    }
    applyState(s);
    saveThresholdInputs();
  }

  function reset() {
    applyState(defaults);
    try {
      localStorage.removeItem(KEY);
    } catch {
      // ignore
    }
    resetThresholds();
    populateThresholdInputs();
  }

  applyState(load());
  populateThresholdInputs();

  // Save button
  els.save.addEventListener('click', save);

  // Auto-save on changes when enabled
  const watch = [
    els.email, els.sms, els.push, els.dailySummary,
    els.notifFrequency, els.refresh, els.timezone, els.datefmt, els.units,
    els.dark, els.autosave,
    els.retention, els.backup, els.exportfmt,

    els.autoAdjust, els.tempMin, els.tempMax, els.tempOpt, els.tempSens, els.tempMonitor,
    els.thPhMin, els.thPhMax, els.thDoMin, els.thTurbMax,
  ].filter(Boolean);

  for (const el of watch) {
    el.addEventListener('change', () => {
      if (els.autosave?.checked) save();
      else {
        applyState(readState());
        // keep thresholds in sync with the visible values even before save
        saveThresholdInputs();
      }
    });
  }

  // Data buttons (placeholder actions)
  els.export?.addEventListener('click', () => alert('Export started (demo UI).'));
  els.clear?.addEventListener('click', () => alert('Cache cleared (demo UI).'));
  els.reset?.addEventListener('click', reset);
}
