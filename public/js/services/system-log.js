/**
 * Client-side system logging — fire-and-forget POST to /api/system-logs.
 */
import { fbGetIdToken } from '../firebase-client.js';
import { LOG_EVENT_TYPES, LOG_SEVERITIES, LOG_SOURCES } from '../constants/log-constants.js';
import {
  isRuntimeLogAllowed,
  shouldDedupeLog,
  logDedupeKey,
  resetLogDedupeState,
} from './log-policy.js';

export { resetLogDedupeState };

let _actor = { userId: null, userName: null };

/**
 * Bind current user for automatic userId/userName on createLog.
 * @param {{ uid?: string, displayName?: string, email?: string } | null} user
 */
export function setLogActor(user) {
  if (!user) {
    _actor = { userId: null, userName: null };
    return;
  }
  _actor = {
    userId: user.uid || null,
    userName: user.displayName || user.email || null,
  };
}

/**
 * @param {object} payload
 * @param {string} payload.eventType
 * @param {string} payload.severity
 * @param {string} payload.source
 * @param {string} payload.description
 * @param {string} [payload.userId]
 * @param {string} [payload.userName]
 * @param {object} [payload.metadata]
 */
export function createLog(payload) {
  if (!payload?.eventType || !payload?.severity || !payload?.source || !payload?.description) {
    return;
  }
  if (!LOG_EVENT_TYPES.has(payload.eventType)) return;
  if (!LOG_SEVERITIES.has(payload.severity)) return;
  if (!LOG_SOURCES.has(payload.source)) return;
  if (!isRuntimeLogAllowed(payload.eventType)) return;
  if (shouldDedupeLog(payload.eventType, logDedupeKey(payload))) return;

  void (async () => {
    try {
      const token = await fbGetIdToken();
      if (!token) return;

      const body = {
        eventType: payload.eventType,
        severity: payload.severity,
        source: payload.source,
        description: String(payload.description).slice(0, 500),
        userId: payload.userId ?? _actor.userId,
        userName: payload.userName ?? _actor.userName,
        metadata: payload.metadata ?? null,
      };

      await fetch('/api/system-logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      /* non-blocking */
    }
  })();
}

/** Stub for future assistance-request UI. */
export function logAssistanceRequest(metadata) {
  createLog({
    eventType: 'user.assistance_request',
    severity: 'info',
    source: 'user',
    description: 'User requested assistance',
    metadata: metadata || null,
  });
}
