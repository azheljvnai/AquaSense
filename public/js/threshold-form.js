/**
 * Shared threshold form helpers for configuration create/edit modals.
 */
import { SPECIES_PRESETS } from './pond-config.js';

function fieldId(prefix, name) {
  return `${prefix}-${name}`;
}

function parseOptNum(prefix, name) {
  const el = document.getElementById(fieldId(prefix, name));
  if (!el || el.value === '') return null;
  const n = parseFloat(el.value);
  return Number.isFinite(n) ? n : null;
}

function setField(prefix, name, value) {
  const el = document.getElementById(fieldId(prefix, name));
  if (!el) return;
  el.value = value == null ? '' : value;
}

function bandSection(title, fieldsHtml) {
  return `
    <div class="threshold-band-section">
      <h4 class="threshold-band-title">${title}</h4>
      <div class="threshold-grid threshold-grid--bands">${fieldsHtml}</div>
    </div>`;
}

function numField(prefix, name, label, step = '0.1') {
  return `
    <div class="form-group">
      <label for="${fieldId(prefix, name)}">${label}</label>
      <input type="number" id="${fieldId(prefix, name)}" class="form-control" step="${step}">
    </div>`;
}

/**
 * HTML for full threshold bands (normal / warning / critical).
 * @param {string} prefix - e.g. "config" or "edit"
 */
export function thresholdBandsFormHtml(prefix) {
  const p = prefix;
  const rangeBlock = (paramLabel, base, labels) => bandSection(
    paramLabel,
    labels.map(([name, label, step]) => numField(p, `${base}-${name}`, label, step)).join(''),
  );

  return `
    ${rangeBlock('pH', 'ph', [
      ['opt-min', 'Normal min', '0.1'],
      ['opt-max', 'Normal max', '0.1'],
      ['warn-low-min', 'Warning low min', '0.1'],
      ['warn-low-max', 'Warning low max', '0.1'],
      ['warn-high-min', 'Warning high min', '0.1'],
      ['warn-high-max', 'Warning high max', '0.1'],
      ['crit-low', 'Critical below (&lt;)', '0.1'],
      ['crit-high', 'Critical above (&gt;)', '0.1'],
    ])}
    ${rangeBlock('Temperature (°C)', 'temp', [
      ['opt-min', 'Normal min', '0.1'],
      ['opt-max', 'Normal max', '0.1'],
      ['warn-low-min', 'Warning low min', '0.1'],
      ['warn-low-max', 'Warning low max', '0.1'],
      ['warn-high-min', 'Warning high min', '0.1'],
      ['warn-high-max', 'Warning high max', '0.1'],
      ['crit-low', 'Critical below (&lt;)', '0.1'],
      ['crit-high', 'Critical above (&gt;)', '0.1'],
    ])}
    ${rangeBlock('Dissolved O₂ (mg/L)', 'do', [
      ['opt-min', 'Normal min', '0.1'],
      ['opt-max', 'Normal max', '0.1'],
      ['warn-low-min', 'Warning low min', '0.1'],
      ['warn-low-max', 'Warning low max', '0.1'],
      ['warn-high-min', 'Warning high min', '0.1'],
      ['warn-high-max', 'Warning high max', '0.1'],
      ['crit-low', 'Critical below (&lt;)', '0.1'],
      ['crit-high', 'Critical above (&gt;)', '0.1'],
    ])}
    ${bandSection('Turbidity (NTU)', [
      numField(p, 'turb-opt-max', 'Normal max (≤)', '1'),
      numField(p, 'turb-warn-max', 'Warning max (≤)', '1'),
      numField(p, 'turb-crit-max', 'Critical max (≤)', '1'),
    ].join(''))}
  `;
}

export function fillThresholdForm(prefix, thresholds) {
  const t = thresholds;
  if (!t) return;

  const ph = t.ph || {};
  setField(prefix, 'ph-opt-min', ph.optimalMin);
  setField(prefix, 'ph-opt-max', ph.optimalMax);
  setField(prefix, 'ph-warn-low-min', ph.acceptable1Min);
  setField(prefix, 'ph-warn-low-max', ph.acceptable1Max);
  setField(prefix, 'ph-warn-high-min', ph.acceptable2Min);
  setField(prefix, 'ph-warn-high-max', ph.acceptable2Max);
  setField(prefix, 'ph-crit-low', ph.stress1Max);
  setField(prefix, 'ph-crit-high', ph.stress2Min);

  const temp = t.temp || {};
  setField(prefix, 'temp-opt-min', temp.optimalMin);
  setField(prefix, 'temp-opt-max', temp.optimalMax);
  setField(prefix, 'temp-warn-low-min', temp.acceptable1Min);
  setField(prefix, 'temp-warn-low-max', temp.acceptable1Max);
  setField(prefix, 'temp-warn-high-min', temp.acceptable2Min);
  setField(prefix, 'temp-warn-high-max', temp.acceptable2Max);
  setField(prefix, 'temp-crit-low', temp.stress1Max);
  setField(prefix, 'temp-crit-high', temp.stress2Min);

  const d = t.do || {};
  setField(prefix, 'do-opt-min', d.optimalMin);
  setField(prefix, 'do-opt-max', d.optimalMax);
  setField(prefix, 'do-warn-low-min', d.acceptable1Min);
  setField(prefix, 'do-warn-low-max', d.acceptable1Max);
  setField(prefix, 'do-warn-high-min', d.acceptable2Min);
  setField(prefix, 'do-warn-high-max', d.acceptable2Max);
  setField(prefix, 'do-crit-low', d.stress1Max);
  setField(prefix, 'do-crit-high', d.stress2Min);

  const turb = t.turb || {};
  setField(prefix, 'turb-opt-max', turb.optimalMax);
  setField(prefix, 'turb-warn-max', turb.acceptableMax);
  setField(prefix, 'turb-crit-max', turb.stressMax);
}

export function readThresholdsFromForm(prefix) {
  return {
    ph: {
      optimalMin: parseOptNum(prefix, 'ph-opt-min'),
      optimalMax: parseOptNum(prefix, 'ph-opt-max'),
      acceptable1Min: parseOptNum(prefix, 'ph-warn-low-min'),
      acceptable1Max: parseOptNum(prefix, 'ph-warn-low-max'),
      acceptable2Min: parseOptNum(prefix, 'ph-warn-high-min'),
      acceptable2Max: parseOptNum(prefix, 'ph-warn-high-max'),
      stress1Min: null,
      stress1Max: parseOptNum(prefix, 'ph-crit-low'),
      stress2Min: parseOptNum(prefix, 'ph-crit-high'),
      stress2Max: null,
    },
    temp: {
      optimalMin: parseOptNum(prefix, 'temp-opt-min'),
      optimalMax: parseOptNum(prefix, 'temp-opt-max'),
      acceptable1Min: parseOptNum(prefix, 'temp-warn-low-min'),
      acceptable1Max: parseOptNum(prefix, 'temp-warn-low-max'),
      acceptable2Min: parseOptNum(prefix, 'temp-warn-high-min'),
      acceptable2Max: parseOptNum(prefix, 'temp-warn-high-max'),
      stress1Min: null,
      stress1Max: parseOptNum(prefix, 'temp-crit-low'),
      stress2Min: parseOptNum(prefix, 'temp-crit-high'),
      stress2Max: null,
    },
    do: {
      optimalMin: parseOptNum(prefix, 'do-opt-min'),
      optimalMax: parseOptNum(prefix, 'do-opt-max'),
      acceptable1Min: parseOptNum(prefix, 'do-warn-low-min'),
      acceptable1Max: parseOptNum(prefix, 'do-warn-low-max'),
      acceptable2Min: parseOptNum(prefix, 'do-warn-high-min'),
      acceptable2Max: parseOptNum(prefix, 'do-warn-high-max'),
      stress1Min: null,
      stress1Max: parseOptNum(prefix, 'do-crit-low'),
      stress2Min: parseOptNum(prefix, 'do-crit-high'),
      stress2Max: null,
    },
    turb: {
      optimalMax: parseOptNum(prefix, 'turb-opt-max'),
      acceptableMax: parseOptNum(prefix, 'turb-warn-max'),
      stressMax: parseOptNum(prefix, 'turb-crit-max'),
      warnMax: null,
    },
  };
}

/**
 * @returns {string|null} Error message or null if valid.
 */
export function validateThresholds(thresholds) {
  const { ph, temp, do: d, turb } = thresholds;

  if (ph.optimalMin == null || ph.optimalMax == null) return 'pH normal range is required';
  if (ph.optimalMin > ph.optimalMax) return 'pH normal min must not exceed max';

  if (temp.optimalMin == null || temp.optimalMax == null) return 'Temperature normal range is required';
  if (temp.optimalMin > temp.optimalMax) return 'Temperature normal min must not exceed max';

  if (d.optimalMin == null || d.optimalMax == null) return 'Dissolved O₂ normal range is required';
  if (d.optimalMin > d.optimalMax) return 'Dissolved O₂ normal min must not exceed max';

  if (turb.optimalMax == null) return 'Turbidity normal max is required';
  if (turb.optimalMax < 0 || (turb.acceptableMax != null && turb.acceptableMax < 0)) {
    return 'Turbidity values cannot be negative';
  }

  return null;
}

/** Merge stored config thresholds with species preset (same as applyConfig). */
export function mergeConfigThresholdsForForm(config) {
  const species = config?.species || null;
  const preset = species ? (SPECIES_PRESETS[species] || null) : null;
  if (!preset) return config?.thresholds || null;
  const stored = config?.thresholds || {};
  return {
    ph: { ...preset.thresholds.ph, ...stored.ph },
    temp: { ...preset.thresholds.temp, ...stored.temp },
    do: { ...preset.thresholds.do, ...stored.do },
    turb: { ...preset.thresholds.turb, ...stored.turb },
  };
}
