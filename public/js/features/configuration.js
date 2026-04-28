/**
 * Configuration feature: persist UI settings locally (no API changes).
 * Editing is restricted to admin and owner roles.
 */
import { getThresholds, resetThresholds, saveThresholds } from '../utils.js';
import { getActiveThresholds, getActiveSpecies } from '../pond-config.js';

function canEditConfig() {
  const perms = window._rbacPerms;
  return !perms || perms.canEditConfig; // default allow if perms not yet set
}

/** Convert the active pond config's rich threshold structure into the flat ok/warn bands used by utils.js */
function syncActiveConfigToUtils() {
  const t = getActiveThresholds();
  if (!t) return;
  saveThresholds({
    ph:   { ok: [t.ph?.optimalMin   ?? 6.5, t.ph?.optimalMax   ?? 8.5],
            warn: [t.ph?.acceptable1Min ?? 6.0, t.ph?.acceptable2Max ?? 9.0] },
    do:   { ok: [t.do?.optimalMin   ?? 5.0, 99],
            warn: [t.do?.acceptableMin ?? 4.0, 99] },
    turb: { ok: [0, t.turb?.optimalMax  ?? 20],
            warn: [0, t.turb?.acceptableMax ?? 40] },
    temp: { ok: [t.temp?.optimalMin ?? 20, t.temp?.optimalMax ?? 26],
            warn: [t.temp?.acceptable1Min ?? 17, t.temp?.acceptable2Max ?? 29] },
  });
}

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
    tempMax: 26,
    tempOpt: 23,
    tempSens: 65,
    tempMonitor: true,
  };

  function populateThresholdInputs() {
    // Prefer the active pond config's thresholds; fall back to utils.js (localStorage)
    const active = getActiveThresholds();
    if (active) {
      // Water Quality Thresholds — use optimal band from active config
      if (els.thPhMin)   els.thPhMin.value   = String(active.ph?.optimalMin   ?? 6.5);
      if (els.thPhMax)   els.thPhMax.value   = String(active.ph?.optimalMax   ?? 8.5);
      if (els.thDoMin)   els.thDoMin.value   = String(active.do?.optimalMin   ?? 5.0);
      if (els.thTurbMax) els.thTurbMax.value = String(active.turb?.optimalMax ?? 20);
      // Temperature Settings — use optimal band from active config
      if (els.tempMin) els.tempMin.value = String(active.temp?.optimalMin ?? 20);
      if (els.tempMax) els.tempMax.value = String(active.temp?.optimalMax ?? 26);
      // Optimal midpoint
      if (els.tempOpt) {
        const mid = ((active.temp?.optimalMin ?? 20) + (active.temp?.optimalMax ?? 26)) / 2;
        els.tempOpt.value = String(mid);
      }
    } else {
      // Fallback: use utils.js thresholds (localStorage)
      const t = getThresholds();
      if (els.thPhMin)   els.thPhMin.value   = String(t.ph.ok[0]);
      if (els.thPhMax)   els.thPhMax.value   = String(t.ph.ok[1]);
      if (els.thDoMin)   els.thDoMin.value   = String(t.do.ok[0]);
      if (els.thTurbMax) els.thTurbMax.value = String(t.turb.ok[1]);
      if (els.tempMin)   els.tempMin.value   = String(t.temp.ok[0]);
      if (els.tempMax)   els.tempMax.value   = String(t.temp.ok[1]);
    }
    // Show which preset/species is driving these values
    updatePresetLabel();
  }

  function updatePresetLabel() {
    const species = getActiveSpecies();
    const label = document.getElementById('cfg-active-preset-label');
    if (!label) return;
    const names = { crayfish: 'Crayfish', tilapia: 'Tilapia', catfish: 'Catfish', shrimp: 'Shrimp' };
    label.textContent = species ? `Active preset: ${names[species] || species}` : 'No active config';
  }

  function saveThresholdInputs() {
    const toNum = (el, fallback) => {
      const n = Number(el?.value);
      return Number.isFinite(n) ? n : fallback;
    };

    const t = getThresholds();
    const phMin   = toNum(els.thPhMin,   t.ph.ok[0]);
    const phMax   = toNum(els.thPhMax,   t.ph.ok[1]);
    const doMin   = toNum(els.thDoMin,   t.do.ok[0]);
    const turbMax = toNum(els.thTurbMax, t.turb.ok[1]);
    const tempMin = toNum(els.tempMin,   t.temp.ok[0]);
    const tempMax = toNum(els.tempMax,   t.temp.ok[1]);

    saveThresholds({
      ph:   { ok: [phMin, phMax] },
      do:   { ok: [doMin, t.do.ok[1]] },
      turb: { ok: [t.turb.ok[0], turbMax] },
      temp: { ok: [tempMin, tempMax] },
    });

    // Notify any listeners that thresholds changed
    window.dispatchEvent(new CustomEvent('thresholds-changed'));
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
    // tempMin/tempMax are driven by the active pond config — only apply from localStorage if no active config
    if (!getActiveThresholds()) {
      if (els.tempMin) els.tempMin.value = String(s.tempMin ?? defaults.tempMin);
      if (els.tempMax) els.tempMax.value = String(s.tempMax ?? defaults.tempMax);
    }
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
    window.dispatchEvent(new CustomEvent('thresholds-changed'));
  }

  applyState(load());
  // Sync active pond config thresholds into utils.js and populate form
  syncActiveConfigToUtils();
  populateThresholdInputs();

  // Re-populate whenever the active pond config changes
  window.addEventListener('pond-config-changed', () => {
    syncActiveConfigToUtils();
    populateThresholdInputs();
  });

  // Also re-populate when the active pond itself changes (e.g. topbar switch)
  // This covers the case where pond-config-changed fires before configuration.js
  // has finished initialising, or when switching to a pond with no active config.
  window.addEventListener('active-pond-changed', () => {
    syncActiveConfigToUtils();
    populateThresholdInputs();
  });

  // Save button
  els.save.addEventListener('click', () => {
    if (!canEditConfig()) {
      alert('Access denied: Owner or Admin required to save configuration.');
      return;
    }
    save();
  });

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
