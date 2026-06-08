/**
 * Runtime system log policy — keep in sync with backend/lib/log-policy.js
 */

export const BLOCKED_RUNTIME_EVENT_TYPES = new Set(['sensor.reading']);

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

export function isRuntimeLogAllowed(eventType) {
  if (!eventType) return false;
  return !BLOCKED_RUNTIME_EVENT_TYPES.has(eventType);
}

const _seen = new Map();

export function shouldDedupeLog(eventType, dedupeKey) {
  const minMs = LOG_DEDUPE_MS[eventType];
  if (!minMs) return false;
  const key = `${eventType}:${dedupeKey}`;
  const last = _seen.get(key);
  const now = Date.now();
  if (last != null && now - last < minMs) return true;
  _seen.set(key, now);
  return false;
}

export function logDedupeKey(payload) {
  const meta = payload?.metadata;
  if (meta?.alertId) return String(meta.alertId);
  if (meta?.configId) return String(meta.configId);
  if (meta?.key && meta?.val != null) return `${meta.key}:${meta.val}`;
  if (payload?.userId) return String(payload.userId);
  return payload?.description || 'default';
}

/** Call on sign-out so the next session can log login again. */
export function resetLogDedupeState() {
  _seen.clear();
}
