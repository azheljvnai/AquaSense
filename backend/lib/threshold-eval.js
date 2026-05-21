/**
 * Threshold evaluation for server-side RTDB alert watcher (mirrors client pond-config + alerts).
 */
import { SPECIES_PRESETS } from './species-presets.js';

const SENSOR_LABELS = { ph: 'pH', do: 'Dissolved O₂', turb: 'Turbidity', temp: 'Temperature' };

export function mergeConfigThresholds(cfg) {
  if (!cfg) return null;
  const species = cfg.species || null;
  const preset = species ? (SPECIES_PRESETS[species] || null) : null;
  if (!preset) return cfg.thresholds || null;
  return cfg.thresholds
    ? { ...preset.thresholds, ...cfg.thresholds }
    : preset.thresholds;
}

export function getBadgeForThresholds(key, val, thresholds) {
  const t = thresholds;
  if (!t) return { c: 'ok', l: 'Normal' };

  if (key === 'turb') {
    const tb = t.turb;
    if (val <= tb.optimalMax) return { c: 'ok', l: 'Normal' };
    if (tb.acceptableMax && val <= tb.acceptableMax) return { c: 'warn', l: 'Warning' };
    return { c: 'danger', l: 'Critical' };
  }

  if (key === 'do') {
    const db = t.do;
    if (val >= db.optimalMin) return { c: 'ok', l: 'Normal' };
    if (db.acceptableMin && val >= db.acceptableMin) return { c: 'warn', l: 'Warning' };
    return { c: 'danger', l: 'Critical' };
  }

  if (key === 'temp') {
    const tb = t.temp;
    if (val >= tb.optimalMin && val <= tb.optimalMax) return { c: 'ok', l: 'Normal' };
    if (tb.acceptable1Min !== null && tb.acceptable1Max !== null && val >= tb.acceptable1Min && val <= tb.acceptable1Max) {
      return { c: 'warn', l: 'Warning' };
    }
    if (tb.acceptable2Min !== null && tb.acceptable2Max !== null && val >= tb.acceptable2Min && val <= tb.acceptable2Max) {
      return { c: 'warn', l: 'Warning' };
    }
    return { c: 'danger', l: 'Critical' };
  }

  if (key === 'ph') {
    const pb = t.ph;
    if (val >= pb.optimalMin && val <= pb.optimalMax) return { c: 'ok', l: 'Normal' };
    return { c: 'danger', l: 'Critical' };
  }

  return { c: 'ok', l: 'Normal' };
}

function severityFromBadge(badgeClass) {
  if (badgeClass === 'danger') return 'critical';
  if (badgeClass === 'warn') return 'warning';
  return null;
}

function thresholdSummaryForKey(key, thresholds) {
  const t = thresholds;
  if (!t) return '';
  if (key === 'ph' && t.ph) return `${t.ph.optimalMin}–${t.ph.optimalMax}`;
  if (key === 'do' && t.do) return `≥ ${t.do.optimalMin} mg/L`;
  if (key === 'turb' && t.turb) return `≤ ${t.turb.optimalMax} NTU`;
  if (key === 'temp' && t.temp) return `${t.temp.optimalMin}–${t.temp.optimalMax}°C`;
  return '';
}

/**
 * Build alert payload for dispatch-alert (null if reading is within optimal range).
 */
export function buildAlertFromReading(key, val, { configId, species, thresholds, pondLabel }) {
  const badge = getBadgeForThresholds(key, val, thresholds);
  const severity = severityFromBadge(badge.c);
  if (!severity) return null;

  const label = SENSOR_LABELS[key] || key.toUpperCase();
  const speciesName = species
    ? species.charAt(0).toUpperCase() + species.slice(1)
    : '';
  const pondName = pondLabel || speciesName || 'Unknown';

  let description = '';
  if (key === 'ph' && thresholds?.ph) {
    const pb = thresholds.ph;
    description = `pH ${val.toFixed(2)} is outside the optimal range (${pb.optimalMin}–${pb.optimalMax}).`;
  } else if (key === 'do' && thresholds?.do) {
    description = `Dissolved O₂ ${val.toFixed(1)} mg/L is below optimal (≥${thresholds.do.optimalMin} mg/L).`;
  } else if (key === 'turb' && thresholds?.turb) {
    description = `Turbidity ${val.toFixed(1)} NTU exceeds optimal (≤${thresholds.turb.optimalMax} NTU).`;
  } else if (key === 'temp' && thresholds?.temp) {
    description = `Temperature ${val.toFixed(1)}°C is outside optimal range (${thresholds.temp.optimalMin}–${thresholds.temp.optimalMax}°C).`;
  }
  if (speciesName) description += ` (${speciesName} config)`;

  const severityLabel = severity === 'critical' ? 'Critical' : 'Warning';

  return {
    id: `${key}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(),
    key,
    val,
    severity,
    badge: badge.c,
    label: `${severityLabel}: ${label} in ${pondName}`,
    description,
    pond: pondName,
    resolved: false,
    thresholdSummary: thresholdSummaryForKey(key, thresholds),
    configId: configId || null,
  };
}
