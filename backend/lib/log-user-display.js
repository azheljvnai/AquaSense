/**
 * Resolve system log user labels for API responses.
 * Evaluation respondents (User1–User10) + Firestore users + System for automated events.
 */
import { EVAL_RESPONDENTS } from './eval-users.js';

export { EVAL_RESPONDENTS };

export const SYSTEM_LOG_USER_FILTER_SYSTEM = '__system__';

const EVAL_BY_ID = new Map(EVAL_RESPONDENTS.map((r) => [r.userId, r.userName]));

/** @param {string} [source] */
export function defaultLabelForSource(source) {
  if (source === 'user' || source === 'feeding') return null;
  return 'System';
}

/**
 * @param {object} item — serialized log
 * @param {Map<string, string>} usersById — Firestore userId → displayName
 */
export function resolveLogUserDisplay(item, usersById) {
  const trimmed = String(item?.userName || '').trim();
  if (trimmed) return trimmed;

  const uid = item?.userId;
  if (uid) {
    if (EVAL_BY_ID.has(uid)) return EVAL_BY_ID.get(uid);
    if (usersById?.has(uid)) return usersById.get(uid);
    return trimmed || null;
  }

  return defaultLabelForSource(item?.source) || null;
}

/**
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {object[]} items
 */
export async function enrichLogItemsWithUserNames(db, items) {
  if (!items?.length) return items;

  const usersById = new Map(EVAL_BY_ID);
  const needLookup = new Set();

  for (const item of items) {
    const uid = item.userId;
    if (!uid || usersById.has(uid) || String(item.userName || '').trim()) continue;
    needLookup.add(uid);
  }

  await Promise.all(
    [...needLookup].map(async (uid) => {
      try {
        const snap = await db.collection('users').doc(uid).get();
        if (!snap.exists) return;
        const d = snap.data();
        const name = (d.displayName || d.email || '').trim();
        if (name) usersById.set(uid, name);
      } catch {
        /* ignore lookup errors */
      }
    }),
  );

  return items.map((item) => {
    const display = resolveLogUserDisplay(item, usersById);
    return display ? { ...item, userName: display } : item;
  });
}
