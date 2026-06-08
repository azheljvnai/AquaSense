/**
 * System log enums — keep in sync with backend/lib/log-constants.js
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

/** Grouped options for filter dropdowns */
export const EVENT_TYPE_OPTIONS = [
  { value: '', label: 'All event types' },
  { value: 'user.login', label: 'User login' },
  { value: 'user.logout', label: 'User logout' },
  { value: 'user.register', label: 'User registration' },
  { value: 'user.profile_update', label: 'Profile update' },
  { value: 'user.password_change', label: 'Password change' },
  { value: 'dashboard.access', label: 'Dashboard access' },
  { value: 'dashboard.refresh', label: 'Dashboard refresh' },
  { value: 'user.assistance_request', label: 'Assistance request' },
  { value: 'feeding.schedule_create', label: 'Schedule created' },
  { value: 'feeding.schedule_update', label: 'Schedule updated' },
  { value: 'feeding.schedule_delete', label: 'Schedule deleted' },
  { value: 'feeding.manual', label: 'Manual feeding' },
  { value: 'feeding.automated', label: 'Automated feeding' },
  { value: 'feeding.servo', label: 'Servo command' },
  { value: 'feeding.complete', label: 'Feeding complete' },
  { value: 'feeding.failure', label: 'Feeding failure' },
  { value: 'sensor.reading', label: 'Sensor reading' },
  { value: 'sensor.calibration', label: 'Sensor calibration' },
  { value: 'sensor.disconnect', label: 'Sensor disconnected' },
  { value: 'sensor.reconnect', label: 'Sensor reconnected' },
  { value: 'alert.threshold', label: 'Threshold exceeded' },
  { value: 'alert.generated', label: 'Alert generated' },
  { value: 'alert.notification_sent', label: 'Notification sent' },
  { value: 'alert.acknowledged', label: 'Alert acknowledged' },
  { value: 'alert.resolved', label: 'Alert resolved' },
  { value: 'system.startup', label: 'System startup' },
  { value: 'system.shutdown', label: 'System shutdown' },
  { value: 'system.wifi', label: 'Wi-Fi status' },
  { value: 'system.firebase', label: 'Firebase connection' },
  { value: 'system.sync', label: 'System sync' },
  { value: 'error.api', label: 'API error' },
  { value: 'error.database', label: 'Database error' },
  { value: 'error.sensor', label: 'Sensor error' },
  { value: 'error.feeding', label: 'Feeding error' },
  { value: 'error.unhandled', label: 'Unhandled error' },
  { value: 'audit.logs_cleared', label: 'Logs cleared (audit)' },
];

export const SOURCE_OPTIONS = [
  { value: '', label: 'All sources' },
  { value: 'user', label: 'User' },
  { value: 'feeding', label: 'Feeding' },
  { value: 'sensor', label: 'Sensor' },
  { value: 'alert', label: 'Alert' },
  { value: 'system', label: 'System' },
  { value: 'error', label: 'Error' },
];

export const SEVERITY_OPTIONS = [
  { value: '', label: 'All severities' },
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning' },
  { value: 'error', label: 'Error' },
  { value: 'critical', label: 'Critical' },
];

/** Severity chips (excludes empty “all” option). */
export const SEVERITY_CHIPS = SEVERITY_OPTIONS.filter((o) => o.value);

/** Source chips for quick filtering. */
export const SOURCE_CHIPS = SOURCE_OPTIONS.filter((o) => o.value);

/** Event types grouped for the advanced filter dropdown. */
export const EVENT_TYPE_GROUPS = [
  {
    label: 'User & dashboard',
    options: [
      { value: 'user.login', label: 'Login' },
      { value: 'user.logout', label: 'Logout' },
      { value: 'user.register', label: 'Registration' },
      { value: 'user.profile_update', label: 'Profile update' },
      { value: 'user.password_change', label: 'Password change' },
      { value: 'user.assistance_request', label: 'Assistance request' },
      { value: 'dashboard.access', label: 'Dashboard access' },
      { value: 'dashboard.refresh', label: 'Dashboard refresh' },
    ],
  },
  {
    label: 'Feeding',
    options: [
      { value: 'feeding.schedule_create', label: 'Schedule created' },
      { value: 'feeding.schedule_update', label: 'Schedule updated' },
      { value: 'feeding.schedule_delete', label: 'Schedule deleted' },
      { value: 'feeding.manual', label: 'Manual feeding' },
      { value: 'feeding.automated', label: 'Automated feeding' },
      { value: 'feeding.servo', label: 'Servo command' },
      { value: 'feeding.complete', label: 'Feeding complete' },
      { value: 'feeding.failure', label: 'Feeding failure' },
    ],
  },
  {
    label: 'Sensors & alerts',
    options: [
      { value: 'sensor.reading', label: 'Sensor reading' },
      { value: 'sensor.calibration', label: 'Sensor calibration' },
      { value: 'sensor.disconnect', label: 'Sensor disconnected' },
      { value: 'sensor.reconnect', label: 'Sensor reconnected' },
      { value: 'alert.threshold', label: 'Threshold exceeded' },
      { value: 'alert.generated', label: 'Alert generated' },
      { value: 'alert.notification_sent', label: 'Notification sent' },
      { value: 'alert.acknowledged', label: 'Alert acknowledged' },
      { value: 'alert.resolved', label: 'Alert resolved' },
    ],
  },
  {
    label: 'System & audit',
    options: [
      { value: 'system.startup', label: 'System startup' },
      { value: 'system.shutdown', label: 'System shutdown' },
      { value: 'system.wifi', label: 'Wi-Fi status' },
      { value: 'system.firebase', label: 'Firebase connection' },
      { value: 'system.sync', label: 'System sync' },
      { value: 'error.api', label: 'API error' },
      { value: 'error.database', label: 'Database error' },
      { value: 'error.sensor', label: 'Sensor error' },
      { value: 'error.feeding', label: 'Feeding error' },
      { value: 'error.unhandled', label: 'Unhandled error' },
      { value: 'audit.logs_cleared', label: 'Logs cleared (audit)' },
    ],
  },
];
