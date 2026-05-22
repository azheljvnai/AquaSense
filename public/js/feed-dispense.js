/**
 * Feed dispense constants and feedLog parsing (shared by feeding UI and reports).
 */

export const FEED_DISPENSE_MG_MIN = 200;
export const FEED_DISPENSE_MG_MAX = 400;
export const FEED_DISPENSE_MG_DEFAULT = 300;
export const FEED_DISPENSE_MG_RANGE_LABEL = '200-400';

/**
 * Parse RTDB timestamp string "YYYY-MM-DD HH:MM:SS" to epoch ms.
 */
export function parseFeedTimestamp(str) {
  if (typeof str !== 'string' || !str.trim()) return null;
  const iso = str.trim().replace(' ', 'T');
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Normalize amount in mg: use default when missing; clamp to [MIN, MAX].
 */
export function normalizeAmountMg(value) {
  if (value == null || value === '') return FEED_DISPENSE_MG_DEFAULT;
  const n = Number(value);
  if (!Number.isFinite(n)) return FEED_DISPENSE_MG_DEFAULT;
  return Math.min(FEED_DISPENSE_MG_MAX, Math.max(FEED_DISPENSE_MG_MIN, Math.round(n)));
}

/** True when reason indicates a real manual or scheduled feed trigger. */
export function isTriggeredDispenseReason(reason) {
  const upper = String(reason ?? '').trim().toUpperCase();
  if (!upper) return false;
  if (upper.startsWith('MANUAL')) return true;
  if (upper.startsWith('SCHED') || upper === 'SCHEDULED') return true;
  return false;
}

function dispenseTypeFromReason(reason) {
  const upper = String(reason).trim().toUpperCase();
  return upper.startsWith('MANUAL') ? 'Manual' : 'Scheduled';
}

/**
 * Parse a feedLog child value into a dispense record (manual/scheduled only).
 * @param {object} raw - { reason, timestamp, amountMg? }
 * @returns {{ ts: number, type: string, amountMg: number, timestampDisplay: string, reason: string } | null}
 */
export function parseFeedLogEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.timestamp !== 'string') return null;
  const rawReason = String(raw.reason || '').trim();
  if (!isTriggeredDispenseReason(rawReason)) return null;
  const ts = parseFeedTimestamp(raw.timestamp);
  if (ts == null) return null;
  return {
    ts,
    type: dispenseTypeFromReason(rawReason),
    amountMg: normalizeAmountMg(raw.amountMg),
    timestampDisplay: raw.timestamp.trim(),
    reason: rawReason,
  };
}

/** One dispense per second — avoids duplicate/high-frequency log noise. */
export function dedupeDispensesBySecond(entries) {
  const bySecond = new Map();
  for (const e of entries) {
    const key = Math.floor(e.ts / 1000);
    const existing = bySecond.get(key);
    if (!existing || e.ts >= existing.ts) bySecond.set(key, e);
  }
  return [...bySecond.values()].sort((a, b) => a.ts - b.ts);
}

/**
 * Format epoch ms as "YYYY-MM-DD HH:MM:SS" for display/export.
 */
export function formatFeedTimestamp(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
