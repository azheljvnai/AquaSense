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
    save: document.getElementById('cfg-save'),

    // Thresholds + temperature (top cards)
    thPhMin: document.getElementById('cfg-th-ph-min'),
    thPhMax: document.getElementById('cfg-th-ph-max'),
    thDoMin: document.getElementById('cfg-th-do-min'),
    thTurbMax: document.getElementById('cfg-th-turb-max'),
    tempMin: document.getElementById('cfg-temp-min'),
    tempMax: document.getElementById('cfg-temp-max'),
    tempOpt: document.getElementById('cfg-temp-opt'),
    tempSens: document.getElementById('cfg-temp-sens'),
  };

  const KEY = 'aquasense.settings.v1';
  const defaults = {
    tempMin: 20,
    tempMax: 26,
    tempOpt: 23,
    tempSens: 65,
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
      tempMin: Number(els.tempMin?.value) || defaults.tempMin,
      tempMax: Number(els.tempMax?.value) || defaults.tempMax,
      tempOpt: Number(els.tempOpt?.value) || defaults.tempOpt,
      tempSens: Number(els.tempSens?.value) || defaults.tempSens,
    };
  }

  function applyState(s) {
    // tempMin/tempMax are driven by the active pond config — only apply from localStorage if no active config
    if (!getActiveThresholds()) {
      if (els.tempMin) els.tempMin.value = String(s.tempMin ?? defaults.tempMin);
      if (els.tempMax) els.tempMax.value = String(s.tempMax ?? defaults.tempMax);
    }
    if (els.tempOpt) els.tempOpt.value = String(s.tempOpt ?? defaults.tempOpt);
    if (els.tempSens) els.tempSens.value = String(s.tempSens ?? defaults.tempSens);

    // Theme controls were removed from the Configuration UI.
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
  if (els.save) {
    els.save.addEventListener('click', () => {
      if (!canEditConfig()) {
        alert('Access denied: Owner or Admin required to save configuration.');
        return;
      }
      save();
    });
  }

  // Auto-save on changes when enabled
  const watch = [
    els.tempMin, els.tempMax, els.tempOpt, els.tempSens,
    els.thPhMin, els.thPhMax, els.thDoMin, els.thTurbMax,
  ].filter(Boolean);

  for (const el of watch) {
    el.addEventListener('change', () => {
      // Auto-save controls were removed from the Configuration UI.
      // Keep local settings applied and thresholds in sync as the user edits.
      applyState(readState());
      saveThresholdInputs();
    });
  }
}
