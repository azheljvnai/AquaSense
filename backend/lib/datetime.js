/** Default farm timezone for alert email timestamps and display. */
export const MANILA_TZ = 'Asia/Manila';

/**
 * Epoch ms → wall-clock "YYYY-MM-DD HH:MM:SS" in the given IANA timezone.
 */
export function formatWallClockInTimeZone(ms, timeZone = MANILA_TZ) {
  const d = new Date(Number(ms) || Date.now());
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);

  const get = (type) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}
