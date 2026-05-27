/** Minimum time a warning/critical reading must persist before alerting. */
export const SENSITIVITY_MS = 60 * 1000;

let _sensitivityMs = SENSITIVITY_MS;

/** Test hook — set to 0 to fire alerts immediately in unit tests. */
export function setSensitivityMs(ms) {
  _sensitivityMs = ms;
}

export function getSensitivityMs() {
  return _sensitivityMs;
}

function resolveSensitivityMs(sensitivityMs) {
  if (typeof sensitivityMs === 'function') return sensitivityMs();
  if (sensitivityMs != null) return sensitivityMs;
  return getSensitivityMs();
}

/**
 * Tracks how long each sensor has remained at a given severity.
 */
export function createBreachTracker(sensitivityMs) {
  const _since = new Map();

  function trackKey(scopeId, sensorKey, severity) {
    return `${scopeId}:${sensorKey}:${severity}`;
  }

  function clearForSensor(scopeId, sensorKey) {
    const prefix = `${scopeId}:${sensorKey}:`;
    for (const k of _since.keys()) {
      if (k.startsWith(prefix)) _since.delete(k);
    }
  }

  function clearForScope(scopeId) {
    const prefix = `${scopeId}:`;
    for (const k of _since.keys()) {
      if (k.startsWith(prefix)) _since.delete(k);
    }
  }

  function hasPersisted(scopeId, sensorKey, severity) {
    const ms = resolveSensitivityMs(sensitivityMs);

    if (!severity) {
      clearForSensor(scopeId, sensorKey);
      return false;
    }
    if (ms <= 0) return true;

    const k = trackKey(scopeId, sensorKey, severity);
    const now = Date.now();
    const started = _since.get(k);

    if (started == null) {
      _since.set(k, now);
      for (const other of ['warning', 'critical']) {
        if (other !== severity) _since.delete(trackKey(scopeId, sensorKey, other));
      }
      return false;
    }

    for (const other of ['warning', 'critical']) {
      if (other !== severity) _since.delete(trackKey(scopeId, sensorKey, other));
    }

    return now - started >= ms;
  }

  return { hasPersisted, clearForSensor, clearForScope };
}
