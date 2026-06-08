/**
 * Client-side log user labels — keep in sync with backend/lib/log-user-display.js
 */
import { EVAL_RESPONDENTS } from '../constants/eval-users.js';

const _usersById = new Map(EVAL_RESPONDENTS.map((r) => [r.userId, r.userName]));

/**
 * @param {{ id: string, displayName?: string, email?: string }[]} users — from User Management
 */
export function setFarmUsersForLogs(users) {
  for (const r of EVAL_RESPONDENTS) {
    _usersById.set(r.userId, r.userName);
  }
  for (const u of users || []) {
    const name = (u.displayName || u.email || '').trim();
    if (u.id && name) _usersById.set(u.id, name);
  }
}

function defaultLabelForSource(source) {
  if (source === 'user' || source === 'feeding') return null;
  return 'System';
}

/**
 * @param {{ userId?: string|null, userName?: string|null, source?: string }} item
 */
export function formatLogUser(item) {
  const trimmed = String(item?.userName || '').trim();
  if (trimmed) return trimmed;

  const uid = item?.userId;
  if (uid && _usersById.has(uid)) return _usersById.get(uid);

  const fallback = defaultLabelForSource(item?.source);
  if (fallback) return fallback;

  if (uid) return trimmed || 'System';
  return 'System';
}
