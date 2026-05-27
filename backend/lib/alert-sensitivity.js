/** Minimum time a warning/critical reading must persist before alerting. */
export const SENSITIVITY_MS = 60 * 1000;

/**
 * Tracks how long each sensor has remained at a given severity.
 * Alerts should only fire once the breach has persisted for SENSITIVITY_MS.
 */
export function createBreachTracker(sensitivityMs = SENSITIVITY_MS) {
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

  /**
   * @returns {boolean} True when the breach has persisted long enough to alert.
   */
  function hasPersisted(scopeId, sensorKey, severity) {
    if (!severity) {
      clearForSensor(scopeId, sensorKey);
      return false;
    }
    if (sensitivityMs <= 0) return true;

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

    return now - started >= sensitivityMs;
  }

  return { hasPersisted, clearForSensor, clearForScope };
}
