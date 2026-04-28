/**
 * Pond Configuration System
 * All writes go through the backend API (Admin SDK — bypasses Firestore rules).
 * Reads use the backend API too for consistency.
 *
 * Firebase Collections (managed server-side):
 *   ponds/                  — pond documents
 *   configurations/         — global species preset documents
 *   pond_configurations/    — assigned configs per pond
 *   sensor_data/            — sensor readings tagged with pond_id + config_id
 */
import { fbGetIdToken, fbFirestore, fbAddDoc, fbCollection, fbServerTimestamp } from './firebase-client.js';

// ─── Species Presets ──────────────────────────────────────────────────────────

export const SPECIES_PRESETS = {
  crayfish: {
    name: 'Crayfish',
    species: 'crayfish',
    thresholds: {
      ph:   { optimalMin: 6.5,  optimalMax: 8.5,
              acceptable1Min: null, acceptable1Max: 6.49, acceptable2Min: 8.51, acceptable2Max: null,
              stress1Min: null,     stress1Max: null,     stress2Min: null,     stress2Max: null },
      temp: { optimalMin: 20,   optimalMax: 30,
              acceptable1Min: null, acceptable1Max: 19.99, acceptable2Min: 30.01, acceptable2Max: null,
              stress1Min: null,     stress1Max: null,      stress2Min: null,      stress2Max: null },
      do:   { optimalMin: 5,    acceptableMin: null, stressMin: null },
      turb: { optimalMax: 40,   acceptableMax: 90,  stressMax: 100, warnMax: null },
    },
  },
  tilapia: {
    name: 'Tilapia',
    species: 'tilapia',
    thresholds: {
      ph:   { optimalMin: 6.5,  optimalMax: 8.5,
              acceptable1Min: null, acceptable1Max: 6.49, acceptable2Min: 8.51, acceptable2Max: null,
              stress1Min: null,     stress1Max: null,     stress2Min: null,     stress2Max: null },
      temp: { optimalMin: 25,   optimalMax: 32,
              acceptable1Min: null, acceptable1Max: 24.99, acceptable2Min: 32.01, acceptable2Max: null,
              stress1Min: null,     stress1Max: null,      stress2Min: null,      stress2Max: null },
      do:   { optimalMin: 5,    acceptableMin: null, stressMin: null },
      turb: { optimalMax: 50,   acceptableMax: 75,  stressMax: 100, warnMax: null },
    },
  },
  catfish: {
    name: 'Catfish',
    species: 'catfish',
    thresholds: {
      ph:   { optimalMin: 6.5,  optimalMax: 9.0,
              acceptable1Min: null, acceptable1Max: 6.49, acceptable2Min: 9.01, acceptable2Max: null,
              stress1Min: null,     stress1Max: null,     stress2Min: null,     stress2Max: null },
      temp: { optimalMin: 25,   optimalMax: 32,
              acceptable1Min: null, acceptable1Max: 24.99, acceptable2Min: 32.01, acceptable2Max: null,
              stress1Min: null,     stress1Max: null,      stress2Min: null,      stress2Max: null },
      do:   { optimalMin: 5,    acceptableMin: 3,   stressMin: null },
      turb: { optimalMax: 70,   acceptableMax: 100, stressMax: null, warnMax: null },
    },
  },
  shrimp: {
    name: 'Shrimp',
    species: 'shrimp',
    thresholds: {
      ph:   { optimalMin: 7.2,  optimalMax: 8.5,
              acceptable1Min: null, acceptable1Max: 7.19, acceptable2Min: 8.51, acceptable2Max: null,
              stress1Min: null,     stress1Max: null,     stress2Min: null,     stress2Max: null },
      temp: { optimalMin: 28,   optimalMax: 31,
              acceptable1Min: null, acceptable1Max: 27.99, acceptable2Min: 31.01, acceptable2Max: null,
              stress1Min: null,     stress1Max: null,      stress2Min: null,      stress2Max: null },
      do:   { optimalMin: 3,    acceptableMin: null, stressMin: null },
      turb: { optimalMax: 25,   acceptableMax: 50,  stressMax: 100, warnMax: null },
    },
  },
};

// ─── API helper ───────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const token = await fbGetIdToken();
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ─── Active Pond/Config State ─────────────────────────────────────────────────

let _activePondId     = null;
let _activeConfigId   = null;
let _activeSpecies    = 'crayfish';
let _activeThresholds = SPECIES_PRESETS.crayfish.thresholds;

const _listeners = new Set();

export function getActivePondId()     { return _activePondId; }
export function getActiveConfigId()   { return _activeConfigId; }
export function getActiveSpecies()    { return _activeSpecies; }
export function getActiveThresholds() { return _activeThresholds; }

export function onPondConfigChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function _notify() {
  for (const fn of _listeners) {
    try { fn({ pondId: _activePondId, configId: _activeConfigId, species: _activeSpecies, thresholds: _activeThresholds }); }
    catch { /* ignore */ }
  }
  window.dispatchEvent(new CustomEvent('pond-config-changed', {
    detail: { pondId: _activePondId, configId: _activeConfigId, species: _activeSpecies },
  }));
  window.dispatchEvent(new CustomEvent('thresholds-changed'));
}

export function applyConfig(cfg) {
  if (!cfg) return;
  const species = cfg.species || 'crayfish';
  const preset  = SPECIES_PRESETS[species] || SPECIES_PRESETS.crayfish;
  _activeSpecies    = species;
  _activeThresholds = cfg.thresholds ? { ...preset.thresholds, ...cfg.thresholds } : preset.thresholds;
  _notify();
}

// ─── getBadge — species-aware ─────────────────────────────────────────────────

export function getBadgeForSpecies(key, val) {
  const t = _activeThresholds;

  if (key === 'turb') {
    const tb = t.turb;
    if (val <= tb.optimalMax)    return { c: 'ok',     l: 'Normal' };
    if (val <= tb.acceptableMax) return { c: 'warn',   l: 'Warning' };
    return                              { c: 'danger', l: 'Critical' };
  }

  if (key === 'do') {
    const db = t.do;
    if (val >= db.optimalMin)                                return { c: 'ok',     l: 'Normal' };
    if (db.acceptableMin && val >= db.acceptableMin)         return { c: 'warn',   l: 'Warning' };
    return                                                          { c: 'danger', l: 'Critical' };
  }

  if (key === 'temp') {
    const tb = t.temp;
    if (val >= tb.optimalMin && val <= tb.optimalMax) return { c: 'ok', l: 'Normal' };
    return { c: 'danger', l: 'Critical' };
  }

  if (key === 'ph') {
    const pb = t.ph;
    if (val >= pb.optimalMin && val <= pb.optimalMax) return { c: 'ok', l: 'Normal' };
    return { c: 'danger', l: 'Critical' };
  }

  return { c: 'ok', l: 'Normal' };
}

// ─── Ponds ────────────────────────────────────────────────────────────────────

export async function getPonds() {
  return api('GET', '/api/ponds');
}

export async function createPond(data) {
  return api('POST', '/api/ponds', data);
}

export async function updatePond(pondId, data) {
  return api('PATCH', `/api/ponds/${pondId}`, data);
}

export async function deletePond(pondId) {
  return api('DELETE', `/api/ponds/${pondId}`);
}

// ─── Global Configurations ────────────────────────────────────────────────────

export async function getConfigurations() {
  return api('GET', '/api/configurations');
}

export async function seedSpeciesPresets() {
  for (const [species, preset] of Object.entries(SPECIES_PRESETS)) {
    await api('POST', '/api/configurations', {
      id: species, name: preset.name, species, thresholds: preset.thresholds,
    }).catch(() => { 
      // If it already exists, update it with the new thresholds
      return api('PATCH', `/api/configurations/${species}`, {
        name: preset.name, species, thresholds: preset.thresholds,
      }).catch(() => { /* ignore update failures */ });
    });
  }
}

export async function updateSpeciesPresets() {
  // Force update all existing presets with new parameter values
  for (const [species, preset] of Object.entries(SPECIES_PRESETS)) {
    try {
      await api('PATCH', `/api/configurations/${species}`, {
        name: preset.name, species, thresholds: preset.thresholds,
      });
    } catch (e) {
      // If it doesn't exist, create it
      await api('POST', '/api/configurations', {
        id: species, name: preset.name, species, thresholds: preset.thresholds,
      }).catch(() => { /* ignore creation failures */ });
    }
  }
}

// ─── Pond Configurations ──────────────────────────────────────────────────────

export async function getPondConfigurations(pondId) {
  return api('GET', `/api/pond-configurations?pondId=${encodeURIComponent(pondId)}`);
}

export async function assignConfigToPond(pondId, configData) {
  return api('POST', '/api/pond-configurations', { pondId, ...configData });
}

export async function setActivePondConfig(pondId, pondConfigId) {
  await api('POST', `/api/pond-configurations/${pondConfigId}/activate`);
  // Load and apply the newly active config
  const configs = await getPondConfigurations(pondId);
  const active  = configs.find(c => c.id === pondConfigId);
  if (active) {
    _activePondId   = pondId;
    _activeConfigId = pondConfigId;
    applyConfig(active);
  }
}

export async function updatePondConfiguration(pondConfigId, data) {
  return api('PATCH', `/api/pond-configurations/${pondConfigId}`, data);
}

export async function deletePondConfiguration(pondConfigId) {
  return api('DELETE', `/api/pond-configurations/${pondConfigId}`);
}

export async function deactivatePondConfig(pondId, pondConfigId) {
  await api('POST', `/api/pond-configurations/${pondConfigId}/deactivate`);
  // Clear active state
  _activeConfigId   = null;
  _activeSpecies    = 'crayfish';
  _activeThresholds = SPECIES_PRESETS.crayfish.thresholds;
  _notify();
}

export async function loadActivePondConfig(pondId) {
  _activePondId = pondId;
  const configs = await getPondConfigurations(pondId);
  const active  = configs.find(c => c.isActive) || null;
  if (active) {
    _activeConfigId = active.id;
    applyConfig(active);
  } else {
    _activeConfigId   = null;
    _activeSpecies    = 'crayfish';
    _activeThresholds = SPECIES_PRESETS.crayfish.thresholds;
    _notify();
  }
  return active;
}

// ─── Sensor Data ──────────────────────────────────────────────────────────────

/**
 * Record a sensor reading tagged with the active pond and configuration.
 * Writes directly to Firestore sensor_data — requires rules to allow authenticated writes,
 * OR falls back silently if rules block it (local history in utils.js is always recorded).
 */
export async function recordPondSensorReading(ph, doVal, turb, temp) {
  if (!_activePondId) return;
  try {
    await fbAddDoc(fbCollection(fbFirestore(), 'sensor_data'), {
      pond_id:          _activePondId,
      configuration_id: _activeConfigId || null,
      species:          _activeSpecies,
      timestamp:        fbServerTimestamp(),
      values:           { ph, do: doVal, turb, temp },
    });
  } catch {
    // Non-critical — local history still recorded via utils.js
  }
}
