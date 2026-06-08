/**
 * Which events may be written to system_logs at runtime (not seed scripts).
 * Matches user choice: significant sensor events only — no routine readings.
 */

/** Event types that must never be written from live app traffic. */
export const BLOCKED_RUNTIME_EVENT_TYPES = new Set(['sensor.reading']);

/** Minimum interval between identical event types (per dedupe key). */
export const LOG_DEDUPE_MS = {
  'dashboard.access': 30 * 60 * 1000,
  'user.login': 24 * 60 * 60 * 1000,
  'system.firebase': 2 * 60 * 1000,
  'sensor.disconnect': 5 * 60 * 1000,
  'sensor.reconnect': 5 * 60 * 1000,
  'error.unhandled': 30 * 1000,
  'feeding.complete': 5 * 1000,
  'alert.threshold': 5 * 60 * 1000,
  'alert.generated': 5 * 60 * 1000,
};

/**
 * @param {string} eventType
 * @param {object} [options]
 * @param {boolean} [options.allowSeed] — seed scripts may write blocked types
 */
export function isRuntimeLogAllowed(eventType, { allowSeed = false } = {}) {
  if (!eventType) return false;
  if (!allowSeed && BLOCKED_RUNTIME_EVENT_TYPES.has(eventType)) return false;
  return true;
}

/**
 * @param {string} eventType
 * @param {string} dedupeKey
 * @param {Map<string, number>} seen — mutable last-written timestamps
 */
export function shouldDedupeLog(eventType, dedupeKey, seen) {
  const minMs = LOG_DEDUPE_MS[eventType];
  if (!minMs) return false;
  const key = `${eventType}:${dedupeKey}`;
  const last = seen.get(key);
  const now = Date.now();
  if (last != null && now - last < minMs) return true;
  seen.set(key, now);
  return false;
}

/**
 * @param {object} payload
 * @returns {string}
 */
export function logDedupeKey(payload) {
  const meta = payload?.metadata;
  if (meta?.alertId) return String(meta.alertId);
  if (meta?.configId) return String(meta.configId);
  if (meta?.key && meta?.val != null) return `${meta.key}:${meta.val}`;
  if (payload?.userId) return String(payload.userId);
  return payload?.description || 'default';
}
