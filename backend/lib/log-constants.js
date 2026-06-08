/**
 * System log enums — keep in sync with public/js/constants/log-constants.js
 */

export const LOG_SOURCES = new Set(['user', 'feeding', 'sensor', 'alert', 'system', 'error']);

export const LOG_SEVERITIES = new Set(['info', 'warning', 'error', 'critical']);

export const LOG_EVENT_TYPES = new Set([
  'user.login',
  'user.logout',
  'user.register',
  'user.profile_update',
  'user.password_change',
  'dashboard.access',
  'dashboard.refresh',
  'user.assistance_request',
  'feeding.schedule_create',
  'feeding.schedule_update',
  'feeding.schedule_delete',
  'feeding.manual',
  'feeding.automated',
  'feeding.servo',
  'feeding.complete',
  'feeding.failure',
  'sensor.reading',
  'sensor.calibration',
  'sensor.disconnect',
  'sensor.reconnect',
  'alert.threshold',
  'alert.generated',
  'alert.notification_sent',
  'alert.acknowledged',
  'alert.resolved',
  'system.startup',
  'system.shutdown',
  'system.wifi',
  'system.firebase',
  'system.sync',
  'error.api',
  'error.database',
  'error.sensor',
  'error.feeding',
  'error.unhandled',
  'audit.logs_cleared',
]);

export const AUDIT_EVENT_TYPE = 'audit.logs_cleared';

export const SYSTEM_LOGS_COLLECTION = 'system_logs';

export const DESCRIPTION_MAX = 500;

export const METADATA_MAX_BYTES = 8000;
