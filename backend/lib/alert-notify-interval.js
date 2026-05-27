/**
 * Minimum interval between email/SMS reminders for the same parameter + severity.
 * Override via ALERT_NOTIFY_INTERVAL_MS (milliseconds).
 */
export const NOTIFY_INTERVAL_MS =
  Number(process.env.ALERT_NOTIFY_INTERVAL_MS) || 5 * 60 * 1000;
