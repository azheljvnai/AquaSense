/**
 * Configuration System (Single-Device Architecture)
 * All writes go through the backend API (Admin SDK — bypasses Firestore rules).
 * Reads use the backend API too for consistency.
 *
 * Firebase Collections (managed server-side):
 *   configurations/         — species configurations (presets + custom)
 *   sensor_data/            — sensor readings tagged with device_id + config_id
 *
 * Single Device: All sensor data is recorded under device001
 */
import { fbGetIdToken, fbFirestore, fbAddDoc, fbCollection, fbServerTimestamp } from './firebase-client.js';

// ─── Species Presets ──────────────────────────────────────────────────────────

/** Shared ph / temp / do bands (turbidity remains species-specific). */
const STANDARD_SENSOR_THRESHOLDS = {
  ph: {
    optimalMin: 6.5,
    optimalMax: 8.5,
    acceptable1Min: 6.2,
    acceptable1Max: 6.4,
    acceptable2Min: 8.6,
    acceptable2Max: 8.8,
    stress1Min: null,
    stress1Max: 6.19,
    stress2Min: 8.81,
    stress2Max: null,
  },
  temp: {
    optimalMin: 25,
    optimalMax: 31,
    acceptable1Min: 24,
    acceptable1Max: 24.5,
    acceptable2Min: 31.5,
    acceptable2Max: 32.5,
    stress1Min: null,
    stress1Max: 23.99,
    stress2Min: 32.51,
    stress2Max: null,
  },
  do: {
    optimalMin: 6,
    optimalMax: 9,
    acceptable1Min: 5,
    acceptable1Max: 6,
    acceptable2Min: 10,
    acceptable2Max: 12,
    stress1Min: null,
    stress1Max: 4.99,
    stress2Min: 12.01,
    stress2Max: null,
  },
};

/** Crayfish DO — optimal 5–8 mg/L; warning ±0.5 outside that band. */
export const CRAYFISH_DO_THRESHOLDS = {
  optimalMin: 5,
  optimalMax: 8,
  acceptable1Min: 4.5,
  acceptable1Max: 4.99,
  acceptable2Min: 8.01,
  acceptable2Max: 8.5,
  stress1Min: null,
  stress1Max: 4.49,
  stress2Min: 8.51,
  stress2Max: null,
};

export const SPECIES_PRESETS = {
  crayfish: {
    name: 'Crayfish',
    species: 'crayfish',
    thresholds: {
      ph:   { ...STANDARD_SENSOR_THRESHOLDS.ph },
      temp: { ...STANDARD_SENSOR_THRESHOLDS.temp },
      do:   { ...CRAYFISH_DO_THRESHOLDS },
      turb: { optimalMax: 40,   acceptableMax: 80,  stressMax: null, warnMax: null },
    },
  },
  tilapia: {
    name: 'Tilapia',
    species: 'tilapia',
    thresholds: {
      ph:   { ...STANDARD_SENSOR_THRESHOLDS.ph },
      temp: { ...STANDARD_SENSOR_THRESHOLDS.temp },
      do:   { ...STANDARD_SENSOR_THRESHOLDS.do },
      turb: { optimalMax: 50,   acceptableMax: 75,  stressMax: 100, warnMax: null },
    },
  },
  catfish: {
    name: 'Catfish',
    species: 'catfish',
    thresholds: {
      ph:   { ...STANDARD_SENSOR_THRESHOLDS.ph },
      temp: { ...STANDARD_SENSOR_THRESHOLDS.temp },
      do:   { ...STANDARD_SENSOR_THRESHOLDS.do },
      turb: { optimalMax: 70,   acceptableMax: 100, stressMax: null, warnMax: null },
    },
  },
  shrimp: {
    name: 'Shrimp',
    species: 'shrimp',
    thresholds: {
      ph:   { ...STANDARD_SENSOR_THRESHOLDS.ph },
      temp: { ...STANDARD_SENSOR_THRESHOLDS.temp },
      do:   { ...STANDARD_SENSOR_THRESHOLDS.do },
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

// ─── Active Configuration State ───────────────────────────────────────────────

let _activeConfigId    = null;
let _activeSpecies     = null;
let _activeThresholds  = null;
let _activeConfigReady = false;

const _listeners = new Set();

export function getActiveConfigId()    { return _activeConfigId; }
export function getActiveSpecies()     { return _activeSpecies; }
export function getActiveThresholds()  { return _activeThresholds; }
export function isActiveConfigReady()  { return _activeConfigReady; }

export function onConfigChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function _notify() {
  for (const fn of _listeners) {
    try { fn({ configId: _activeConfigId, species: _activeSpecies, thresholds: _activeThresholds }); }
    catch { /* ignore */ }
  }
  window.dispatchEvent(new CustomEvent('config-changed', {
    detail: { configId: _activeConfigId, species: _activeSpecies },
  }));
  window.dispatchEvent(new CustomEvent('thresholds-changed'));
}

function _finishApplyConfig(cfg) {
  if (cfg?.id) _activeConfigId = cfg.id;
  _activeConfigReady = !!(_activeConfigId && _activeThresholds);
  _notify();
  if (_activeConfigReady) {
    window.dispatchEvent(new CustomEvent('active-config-ready', {
      detail: { configId: _activeConfigId, species: _activeSpecies },
    }));
  }
}

export function applyConfig(cfg) {
  if (!cfg) {
    _activeConfigReady = false;
    return;
  }
  const species = cfg.species || null;
  const preset  = species ? (SPECIES_PRESETS[species] || null) : null;
  _activeSpecies = species;
  if (!preset) {
    _activeThresholds = cfg.thresholds || null;
    _finishApplyConfig(cfg);
    return;
  }

  const stored = cfg.thresholds || null;
  if (!stored) {
    _activeThresholds = preset.thresholds;
    _finishApplyConfig(cfg);
    return;
  }

  _activeThresholds = {
    ph:   { ...preset.thresholds.ph,   ...stored.ph },
    temp: { ...preset.thresholds.temp, ...stored.temp },
    do:   { ...preset.thresholds.do,   ...stored.do },
    turb: { ...preset.thresholds.turb, ...stored.turb },
  };
  _finishApplyConfig(cfg);
}

// ─── getBadge — species-aware ─────────────────────────────────────────────────

export function getBadgeForSpecies(key, val) {
  const t = _activeThresholds;
  if (!t) return { c: 'ok', l: '—' };

  if (key === 'turb') {
    const tb = t.turb;
    if (val <= tb.optimalMax)    return { c: 'ok',     l: 'Normal' };
    if (tb.acceptableMax && val <= tb.acceptableMax) return { c: 'warn',   l: 'Warning' };
    return                              { c: 'danger', l: 'Critical' };
  }

  if (key === 'do') {
    const db = t.do;
    const optimalMax = db.optimalMax ?? Infinity;
    if (val >= db.optimalMin && val <= optimalMax) return { c: 'ok', l: 'Normal' };
    if (db.acceptable1Min !== null && db.acceptable1Max !== null && val >= db.acceptable1Min && val <= db.acceptable1Max) {
      return { c: 'warn', l: 'Warning' };
    }
    if (db.acceptable2Min !== null && db.acceptable2Max !== null && val >= db.acceptable2Min && val <= db.acceptable2Max) {
      return { c: 'warn', l: 'Warning' };
    }
    if (db.acceptableMin != null && val >= db.acceptableMin) return { c: 'warn', l: 'Warning' };
    return { c: 'danger', l: 'Critical' };
  }

  if (key === 'temp') {
    const tb = t.temp;
    if (val >= tb.optimalMin && val <= tb.optimalMax) return { c: 'ok', l: 'Normal' };
    // Check warning ranges (acceptable1 and acceptable2)
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
    if (pb.acceptable1Min !== null && pb.acceptable1Max !== null && val >= pb.acceptable1Min && val <= pb.acceptable1Max) {
      return { c: 'warn', l: 'Warning' };
    }
    if (pb.acceptable2Min !== null && pb.acceptable2Max !== null && val >= pb.acceptable2Min && val <= pb.acceptable2Max) {
      return { c: 'warn', l: 'Warning' };
    }
    return { c: 'danger', l: 'Critical' };
  }

  return { c: 'ok', l: 'Normal' };
}

// ─── Configurations ───────────────────────────────────────────────────────────

export async function getConfigurations() {
  return api('GET', '/api/configurations');
}

export async function createConfiguration(data) {
  return api('POST', '/api/configurations', data);
}

export async function updateConfiguration(configId, data) {
  return api('PATCH', `/api/configurations/${configId}`, data);
}

export async function deleteConfiguration(configId) {
  return api('DELETE', `/api/configurations/${configId}`);
}

// ─── Active Configuration Management ──────────────────────────────────────────

export async function setActiveConfiguration(configId) {
  _activeConfigReady = false;
  await api('POST', `/api/configurations/${configId}/activate`);
  // Load and apply the newly active config
  const configs = await getConfigurations();
  const active  = configs.find(c => c.id === configId);
  if (active) {
    applyConfig(active);
    // Persist to localStorage
    localStorage.setItem('activeConfigId', configId);
  }
}

export async function deactivateConfiguration() {
  if (!_activeConfigId) return;
  _activeConfigReady = false;
  await api('POST', `/api/configurations/${_activeConfigId}/deactivate`);
  // Clear active state
  _activeConfigId   = null;
  _activeSpecies    = null;
  _activeThresholds = null;
  localStorage.removeItem('activeConfigId');
  _notify();
}

export async function loadActiveConfiguration() {
  _activeConfigReady = false;
  // Try to restore from localStorage first
  const storedConfigId = localStorage.getItem('activeConfigId');
  
  try {
    // Fetch all configurations (requires authentication)
    const configs = await getConfigurations();
    
    // Find active configuration from server
    const serverActive = configs.find(c => c.isActive) || null;
    
    // If stored config exists and matches server, use it
    if (storedConfigId && serverActive && serverActive.id === storedConfigId) {
      applyConfig(serverActive);
      return serverActive;
    }
    
    // If server has active config, use it and update localStorage
    if (serverActive) {
      applyConfig(serverActive);
      localStorage.setItem('activeConfigId', serverActive.id);
      return serverActive;
    }
    
    // If stored config exists but server doesn't have it active, check if it still exists
    if (storedConfigId) {
      const storedConfig = configs.find(c => c.id === storedConfigId);
      if (!storedConfig) {
        // Configuration was deleted, clear localStorage
        localStorage.removeItem('activeConfigId');
      }
    }
    
    // No active configuration
    _activeConfigId    = null;
    _activeSpecies     = null;
    _activeThresholds  = null;
    _activeConfigReady = false;
    _notify();
    return null;
  } catch (e) {
    // If not authenticated yet, silently fail and wait for auth
    if (e.message === 'No authenticated user.') {
      // Will be loaded after authentication via loadConfigurationsAfterAuth
      return null;
    }
    // Re-throw other errors
    throw e;
  }
}

// ─── Species Preset Management ────────────────────────────────────────────────

export async function seedSpeciesPresets() {
  for (const [species, preset] of Object.entries(SPECIES_PRESETS)) {
    await api('POST', '/api/configurations', {
      id: species, name: preset.name, species, thresholds: preset.thresholds, isPreset: true,
    }).catch(async () => { 
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
        id: species, name: preset.name, species, thresholds: preset.thresholds, isPreset: true,
      }).catch(() => { /* ignore creation failures */ });
    }
  }
}

// ─── Sensor Data (Single Device: device001) ───────────────────────────────────

/**
 * Record a sensor reading tagged with device001 and the active configuration.
 * Writes directly to Firestore sensor_data — requires rules to allow authenticated writes,
 * OR falls back silently if rules block it (local history in utils.js is always recorded).
 */
export async function recordSensorReading(ph, doVal, turb, temp) {
  try {
    await fbAddDoc(fbCollection(fbFirestore(), 'sensor_data'), {
      device_id:        'device001',
      configuration_id: _activeConfigId || null,
      species:          _activeSpecies || null,
      timestamp:        fbServerTimestamp(),
      values:           { ph, do: doVal, turb, temp },
    });
  } catch {
    // Non-critical — local history still recorded via utils.js
  }
}

// ─── Legacy Compatibility (Deprecated) ────────────────────────────────────────

/**
 * @deprecated Use getConfigurations() instead
 */
export async function getPonds() {
  console.warn('getPonds() is deprecated. Use getConfigurations() instead.');
  return [];
}

/**
 * @deprecated Pond management has been removed
 */
export async function createPond(data) {
  console.warn('createPond() is deprecated. Pond management has been removed.');
  throw new Error('Pond management has been removed. Use configuration management instead.');
}

/**
 * @deprecated Pond management has been removed
 */
export async function updatePond(pondId, data) {
  console.warn('updatePond() is deprecated. Pond management has been removed.');
  throw new Error('Pond management has been removed. Use configuration management instead.');
}

/**
 * @deprecated Pond management has been removed
 */
export async function deletePond(pondId) {
  console.warn('deletePond() is deprecated. Pond management has been removed.');
  throw new Error('Pond management has been removed. Use configuration management instead.');
}

/**
 * @deprecated Use getConfigurations() instead
 */
export async function getPondConfigurations(pondId) {
  console.warn('getPondConfigurations() is deprecated. Use getConfigurations() instead.');
  return getConfigurations();
}

/**
 * @deprecated Use createConfiguration() instead
 */
export async function assignConfigToPond(pondId, configData) {
  console.warn('assignConfigToPond() is deprecated. Use createConfiguration() instead.');
  return createConfiguration(configData);
}

/**
 * @deprecated Use setActiveConfiguration() instead
 */
export async function setActivePondConfig(pondId, pondConfigId) {
  console.warn('setActivePondConfig() is deprecated. Use setActiveConfiguration() instead.');
  return setActiveConfiguration(pondConfigId);
}

/**
 * @deprecated Use updateConfiguration() instead
 */
export async function updatePondConfiguration(pondConfigId, data) {
  console.warn('updatePondConfiguration() is deprecated. Use updateConfiguration() instead.');
  return updateConfiguration(pondConfigId, data);
}

/**
 * @deprecated Use deleteConfiguration() instead
 */
export async function deletePondConfiguration(pondConfigId) {
  console.warn('deletePondConfiguration() is deprecated. Use deleteConfiguration() instead.');
  return deleteConfiguration(pondConfigId);
}

/**
 * @deprecated Use deactivateConfiguration() instead
 */
export async function deactivatePondConfig(pondId, pondConfigId) {
  console.warn('deactivatePondConfig() is deprecated. Use deactivateConfiguration() instead.');
  return deactivateConfiguration();
}

/**
 * @deprecated Use loadActiveConfiguration() instead
 */
export async function loadActivePondConfig(pondId) {
  console.warn('loadActivePondConfig() is deprecated. Use loadActiveConfiguration() instead.');
  return loadActiveConfiguration();
}

/**
 * @deprecated Use recordSensorReading() instead
 */
export async function recordPondSensorReading(ph, doVal, turb, temp) {
  console.warn('recordPondSensorReading() is deprecated. Use recordSensorReading() instead.');
  return recordSensorReading(ph, doVal, turb, temp);
}

/**
 * @deprecated Use getActiveConfigId() instead
 */
export function getActivePondId() {
  return getActiveConfigId();
}

/**
 * @deprecated Use onConfigChange() instead
 */
export function onPondConfigChange(fn) {
  console.warn('onPondConfigChange() is deprecated. Use onConfigChange() instead.');
  return onConfigChange(fn);
}
