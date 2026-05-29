/**
 * Feed dispense constants and feedLog parsing (shared by feeding UI and reports).
 */

export const FEED_DISPENSE_MG_MIN = 200;
export const FEED_DISPENSE_MG_MAX = 300;
export const FEED_DISPENSE_MG_DEFAULT = 250;
export const FEED_DISPENSE_MG_ESTIMATE = 250;
export const FEED_DISPENSE_AMOUNT_LABEL = '~200-300mg';
export const FEED_DISPENSE_MG_RANGE_LABEL = '~200-300mg';

/**
 * Parse RTDB timestamp string "YYYY-MM-DD HH:MM:SS" as local wall-clock time.
 */
export function parseFeedTimestamp(str) {
  if (typeof str !== 'string' || !str.trim()) return null;
  const trimmed = str.trim();
  const local = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/,
  );
  if (local) {
    const y = Number(local[1]);
    const mo = Number(local[2]);
    const d = Number(local[3]);
    const h = Number(local[4]);
    const mi = Number(local[5]);
    const s = Number(local[6]);
    const ms = new Date(y, mo - 1, d, h, mi, s).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const iso = trimmed.replace(' ', 'T');
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Total amount label for N dispenses, e.g. 2 → "~400-600mg". */
export function formatFeedAmountTotalDisplay(dispenseCount) {
  const n = Math.max(0, Math.floor(Number(dispenseCount) || 0));
  if (n === 0) return '—';
  const min = n * FEED_DISPENSE_MG_MIN;
  const max = n * FEED_DISPENSE_MG_MAX;
  return `~${min}-${max}mg`;
}

/** Display label for RTDB amountMg (string estimate or legacy number). */
export function formatFeedAmountDisplay(value) {
  if (value == null || value === '') return FEED_DISPENSE_AMOUNT_LABEL;
  const s = String(value).trim();
  if (s.includes('~')) return s.includes('mg') ? s : `${s}mg`;
  return FEED_DISPENSE_AMOUNT_LABEL;
}

/** Numeric estimate for report totals (legacy numbers clamped; label uses midpoint). */
export function amountMgEstimateFromStored(value) {
  if (value == null || value === '') return FEED_DISPENSE_MG_ESTIMATE;
  const s = String(value).trim();
  if (s.includes('~')) return FEED_DISPENSE_MG_ESTIMATE;
  const n = Number(value);
  if (!Number.isFinite(n)) return FEED_DISPENSE_MG_ESTIMATE;
  return Math.min(FEED_DISPENSE_MG_MAX, Math.max(FEED_DISPENSE_MG_MIN, Math.round(n)));
}

/**
 * Normalize legacy numeric amount in mg; new entries use FEED_DISPENSE_AMOUNT_LABEL string.
 */
export function normalizeAmountMg(value) {
  return amountMgEstimateFromStored(value);
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
 * @returns {{ ts: number, type: string, amountDisplay: string, amountMgEstimate: number, timestampDisplay: string, reason: string } | null}
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
    amountDisplay: formatFeedAmountDisplay(raw.amountMg),
    amountMgEstimate: amountMgEstimateFromStored(raw.amountMg),
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
