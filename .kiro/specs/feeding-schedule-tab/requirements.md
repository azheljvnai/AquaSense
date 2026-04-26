# Requirements Document

## Introduction

The Feeding tab in the CrayFarm aquaculture monitoring dashboard currently displays hardcoded static data. This feature replaces all static content with live, Firebase-driven data and adds new sections to make the tab a complete feeding management hub. The tab will show real schedule times read from Firebase RTDB, derive metric cards from available data, display a feed event log, provide manual feed control, and enforce role-based access so that farmers can view and trigger feeds while owners and admins can also create, edit, and delete schedules.

## Glossary

- **Feeding_Tab**: The `#page-feeding` section of the CrayFarm SPA.
- **Schedule**: A named time entry (e.g. "08:00") stored in Firebase RTDB at `/devices/{deviceId}/feeding/scheduleN` that triggers an automatic feed event on the ESP32.
- **Feed_Event**: A record of a completed or triggered feed, stored in Firebase RTDB at `/devices/{deviceId}/feeding/log/{timestamp}`.
- **Manual_Feed**: An on-demand feed triggered by setting `/devices/{deviceId}/feeding/manualFeed = true` in Firebase RTDB.
- **Feed_Log**: The ordered list of Feed_Events stored under `/devices/{deviceId}/feeding/log/`.
- **Schedule_List**: The UI component in the Feeding_Tab that renders today's schedules with their completion status.
- **Metric_Card**: A summary tile showing a single derived feeding statistic (e.g. feeds today, last fed time).
- **Weekly_Chart**: The Chart.js bar chart showing feed event counts or activity per day for the past 7 days.
- **RBAC**: Role-Based Access Control. Roles are `farmer`, `owner`, and `admin`. Permissions are defined in `app.js → getPermissions()`.
- **canEditSchedules**: RBAC permission flag — `true` for `owner` and `admin` roles only.
- **canTriggerFeed**: RBAC permission flag — `true` for all roles.
- **Firebase_RTDB**: Firebase Realtime Database, the primary data store for device state and feed events.
- **Feeding_Module**: `public/js/features/feeding.js`, the JS module responsible for all Feeding_Tab logic.
- **ESP32**: The embedded device that executes feed commands and resets `manualFeed` to `false` upon completion.

---

## Requirements

### Requirement 1: Dynamic Schedule List

**User Story:** As a farmer, I want to see today's feeding schedules with real times and live completion status, so that I know which feeds have happened and which are still pending.

#### Acceptance Criteria

1. WHEN the Feeding_Tab is displayed, THE Feeding_Module SHALL read all schedule entries from Firebase RTDB at `/devices/{deviceId}/feeding/` and render them in the Schedule_List.
2. WHEN the current local time is past a schedule's time, THE Feeding_Module SHALL display that schedule item with a "completed" status indicator.
3. WHEN the current local time is within 30 minutes before a schedule's time, THE Feeding_Module SHALL display that schedule item with a "upcoming" status indicator.
4. WHEN the current local time is more than 30 minutes before a schedule's time, THE Feeding_Module SHALL display that schedule item with a "scheduled" status indicator.
5. WHEN no schedules exist in Firebase RTDB for the active device, THE Feeding_Module SHALL display an empty-state message in the Schedule_List.
6. WHEN Firebase RTDB emits an updated value for any schedule entry, THE Feeding_Module SHALL re-render the Schedule_List within 2 seconds without a full page reload.

---

### Requirement 2: Schedule Management (Add / Edit / Delete)

**User Story:** As an owner or admin, I want to add, edit, and delete feeding schedules beyond the fixed two slots, so that I can configure the exact feeding times the farm requires.

#### Acceptance Criteria

1. WHERE `canEditSchedules` is true, THE Feeding_Tab SHALL display an "Add Schedule" button in the Schedule_List section.
2. WHEN an owner or admin activates the "Add Schedule" button, THE Feeding_Module SHALL present an input for a time value and a confirm action.
3. WHEN a valid time is confirmed, THE Feeding_Module SHALL write the new schedule to Firebase RTDB under `/devices/{deviceId}/feeding/` using a key of the form `scheduleN` (where N is the next available integer suffix, starting from 3 for new entries) and update the Schedule_List.
4. WHERE `canEditSchedules` is true, THE Feeding_Tab SHALL display an edit control on each schedule item in the Schedule_List.
5. WHEN an owner or admin activates the edit control on a schedule item, THE Feeding_Module SHALL allow the time value to be changed and saved back to Firebase RTDB at the same key.
6. WHERE `canEditSchedules` is true, THE Feeding_Tab SHALL display a delete control on each schedule item in the Schedule_List.
7. WHEN an owner or admin activates the delete control on a schedule item, THE Feeding_Module SHALL remove that schedule entry from Firebase RTDB and remove it from the Schedule_List.
8. IF `canEditSchedules` is false, THEN THE Feeding_Tab SHALL hide the Add, Edit, and Delete controls from the Schedule_List.
9. IF a time value submitted for a new or edited schedule is not a valid HH:MM time string, THEN THE Feeding_Module SHALL display an inline validation error and SHALL NOT write to Firebase RTDB.
10. THE Feeding_Module SHALL preserve existing `schedule1` and `schedule2` keys without migration; new schedules added by the user SHALL use keys `schedule3`, `schedule4`, and so on with incrementing numeric suffixes.

---

### Requirement 3: Manual Feed Control in the Feeding Tab

**User Story:** As a farmer, I want a manual feed button directly in the Feeding tab, so that I can trigger an immediate feed without navigating to the dashboard.

#### Acceptance Criteria

1. THE Feeding_Tab SHALL contain a "Manual Feed" button visible to all authenticated roles.
2. WHEN a user activates the Manual Feed button, THE Feeding_Module SHALL set `/devices/{deviceId}/feeding/manualFeed = true` in Firebase RTDB.
3. WHILE `manualFeed` is `true` in Firebase RTDB, THE Feeding_Module SHALL disable the Manual Feed button and display a "Dispensing…" state.
4. WHEN Firebase RTDB reports `manualFeed` has been reset to `false` or `null` by the ESP32, THE Feeding_Module SHALL re-enable the Manual Feed button and display a success indicator.
5. IF the ESP32 does not reset `manualFeed` within 10 seconds, THEN THE Feeding_Module SHALL re-enable the Manual Feed button and display a timeout warning.

---

### Requirement 4: Feed Event Log

**User Story:** As a farmer or owner, I want to see a log of recent feed events with timestamps, so that I can verify feeds occurred and review feeding history.

#### Acceptance Criteria

1. THE Feeding_Tab SHALL contain a Feed Log section displaying the most recent feed events for the active device.
2. WHEN the Feeding_Tab is displayed, THE Feeding_Module SHALL read feed events from Firebase RTDB at `/devices/{deviceId}/feeding/log/` ordered by timestamp descending and render the 20 most recent entries.
3. WHEN a new feed event is written to Firebase RTDB, THE Feeding_Module SHALL prepend it to the Feed Log within 2 seconds without a full page reload.
4. WHEN a feed event entry is rendered, THE Feeding_Module SHALL display the event timestamp formatted as a human-readable local date and time, and the event type (e.g. "Auto" or "Manual").
5. WHEN no feed events exist in Firebase RTDB for the active device, THE Feeding_Module SHALL display an empty-state message in the Feed Log section.
6. WHEN a user activates the Manual Feed button, THE Feeding_Module SHALL write a log entry to `/devices/{deviceId}/feeding/log/{timestamp}` with the event type set to "Manual" and the timestamp set to the current time in milliseconds.
7. THE Feeding_Module SHALL display feed log entries regardless of whether they were written by the browser or by the ESP32; the Feed Log SHALL render whatever entries exist at `/devices/{deviceId}/feeding/log/`.

---

### Requirement 5: Dynamic Metric Cards

**User Story:** As a farmer, I want the metric cards at the top of the Feeding tab to show real data, so that I can quickly assess today's feeding activity.

#### Acceptance Criteria

1. WHEN the Feeding_Tab is displayed, THE Feeding_Module SHALL derive the "Feeds Today" metric by counting Feed_Events in the Feed_Log whose timestamp falls within the current calendar day and display it in the corresponding Metric_Card.
2. WHEN the Feeding_Tab is displayed, THE Feeding_Module SHALL derive the "Last Fed" metric from the most recent Feed_Event timestamp in the Feed_Log and display it as a formatted local time in the corresponding Metric_Card.
3. WHEN the Feeding_Tab is displayed, THE Feeding_Module SHALL derive the "Schedules Active" metric by counting the schedule entries present in Firebase RTDB for the active device and display it in the corresponding Metric_Card.
4. WHEN the Feeding_Tab is displayed, THE Feeding_Module SHALL derive the "Next Feed" metric by finding the next upcoming schedule time (relative to the current local time) from the schedule entries in Firebase RTDB and display a countdown or formatted time until that feed in the corresponding Metric_Card.
5. WHEN no Feed_Events exist in the Feed_Log, THE Feeding_Module SHALL display "—" in the "Last Fed" and "Feeds Today" Metric_Cards.
6. WHEN no future schedule exists for the current day, THE Feeding_Module SHALL display "—" in the "Next Feed" Metric_Card.
7. WHEN Firebase RTDB data changes, THE Feeding_Module SHALL update all Metric_Cards within 2 seconds to reflect the latest values.

---

### Requirement 6: Weekly Feed Activity Chart

**User Story:** As an owner, I want the weekly chart to reflect actual feed event activity, so that I can see feeding patterns over the past 7 days.

#### Acceptance Criteria

1. WHEN the Feeding_Tab is displayed, THE Feeding_Module SHALL read Feed_Events from Firebase RTDB for the past 7 calendar days and compute a per-day event count.
2. WHEN the per-day counts are computed, THE Feeding_Module SHALL update the Weekly_Chart with the real data, replacing any static placeholder values.
3. WHEN no Feed_Events exist for a given day in the 7-day window, THE Feeding_Module SHALL render that day's bar with a value of 0.
4. WHEN the active device changes, THE Feeding_Module SHALL reload the Weekly_Chart data for the newly selected device.

---

### Requirement 7: Role-Based Access Enforcement

**User Story:** As a system admin, I want the Feeding tab to enforce RBAC so that farmers cannot modify schedules, while owners and admins retain full control.

#### Acceptance Criteria

1. THE Feeding_Tab SHALL derive the current user's permissions from `window._rbacPerms` (set by `app.js → applyRoleGuards()`).
2. WHERE `canEditSchedules` is false, THE Feeding_Module SHALL render all schedule items as read-only with no edit or delete controls visible.
3. WHERE `canEditSchedules` is false, THE Feeding_Module SHALL hide the "Add Schedule" button.
4. WHERE `canTriggerFeed` is true, THE Feeding_Module SHALL enable the Manual Feed button for the current user.
5. IF a user with `canEditSchedules = false` attempts to invoke a schedule write operation (e.g. via browser console), THEN THE Feeding_Module SHALL reject the operation and log a permission-denied warning.

---

### Requirement 8: Active Device Context

**User Story:** As a user managing multiple ponds, I want the Feeding tab to always show data for the currently selected pond/device, so that I am not looking at the wrong pond's feeding data.

#### Acceptance Criteria

1. WHEN the active pond changes (via the topbar pond selector), THE Feeding_Module SHALL unsubscribe from the previous device's Firebase RTDB listeners and subscribe to the new device's paths.
2. WHEN the active pond changes, THE Feeding_Module SHALL clear and re-render the Schedule_List, Feed Log, Metric_Cards, and Weekly_Chart for the new device.
3. WHEN no active pond is selected, THE Feeding_Module SHALL display a "No pond selected" placeholder in the Feeding_Tab and disable the Manual Feed button.
