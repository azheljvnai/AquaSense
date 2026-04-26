# Design Document — Feeding Schedule Tab

## Overview

The Feeding tab currently renders entirely static, hardcoded data. This design replaces
all static content with live Firebase RTDB-driven data and adds new sections: a dynamic
schedule list with CRUD controls, a manual feed button, a feed event log, four derived
metric cards, and a weekly activity chart backed by real log data.

All logic lives in `public/js/features/feeding.js` (the Feeding_Module). The module
follows the same init-and-listen pattern used by every other feature module in the app.
No new backend endpoints are required.

---

## Architecture

```
window event: active-pond-changed
        │
        ▼
  feeding.js  ──── _teardown() ──► unsubscribe all RTDB listeners
        │
        ├─ _subscribeSchedules()  ──► /devices/{id}/feeding/schedule*
        │        └─ renderScheduleList()
        │
        ├─ _subscribeLog()        ──► /devices/{id}/feeding/log/
        │        └─ renderFeedLog()
        │        └─ updateMetricCards()
        │        └─ updateWeeklyChart()
        │
        ├─ _subscribeManualFeed() ──► /devices/{id}/feeding/manualFeed
        │        └─ syncFeedButton()
        │
        └─ Manual Feed button click
                 └─ _writeFeedLog() ──► /devices/{id}/feeding/log/{ts}
                 └─ set manualFeed = true
```

The module exports a single `init()` function called by `app.js` after authentication.
All internal state (active device ID, RTDB unsubscribe handles, Chart.js instance) is
held in module-level variables.

---

## Components and Interfaces

### Feeding_Module (`public/js/features/feeding.js`)

Public API:

```js
// Called once by app.js after auth. Wires up the active-pond-changed listener
// and initialises the feeding chart.
export function init()
```

Internal functions (not exported):

```js
// Subscribe to all RTDB paths for the given deviceId.
// Stores unsubscribe handles in _listeners[].
function _subscribe(deviceId)

// Unsubscribe all active RTDB listeners and reset UI to empty state.
function _teardown()

// Read schedule keys (schedule1, schedule2, schedule3, …) from the snapshot
// and return a sorted array of { key, time } objects.
function _parseSchedules(snapshot)

// Determine status for a schedule time string ("HH:MM"):
// "completed" | "upcoming" (within 30 min) | "scheduled"
function _scheduleStatus(timeStr)

// Re-render the #feed-schedule-list <ul> from the current _schedules array.
function _renderScheduleList()

// Re-render the #feed-log-list element from the current _logEntries array.
function _renderFeedLog()

// Recompute and update all four metric card DOM elements.
function _updateMetricCards()

// Recompute per-day counts for the past 7 days and update the Weekly_Chart.
function _updateWeeklyChart()

// Sync the Manual Feed button state based on the current manualFeed RTDB value.
function _syncFeedButton(manualFeedVal)

// Write a manual feed log entry to RTDB and set manualFeed = true.
async function _triggerManualFeed()

// Write a single log entry: { ts, type } to /devices/{id}/feeding/log/{ts}
async function _writeFeedLog(deviceId, type)

// Return the next schedule time string after now, or null if none today.
function _nextScheduleTime(schedules)

// Format a ms timestamp as a locale date+time string.
function _fmtTimestamp(ms)

// Show an inline validation error near the schedule input.
function _showScheduleError(msg)

// Find the next available scheduleN key (e.g. "schedule3") given existing keys.
function _nextScheduleKey(existingKeys)
```

### Module-Level State

```js
let _deviceId   = null;          // active device ID
let _listeners  = [];            // array of RTDB unsubscribe functions
let _schedules  = [];            // [{ key, time }] sorted by time
let _logEntries = [];            // [{ ts, type }] sorted descending, max 20
let _feedChart  = null;          // Chart.js instance for the weekly bar chart
let _manualFeedTimeout = null;   // setTimeout handle for the 10 s timeout guard
```

---

## HTML Structure Changes (`#page-feeding`)

The existing static HTML in `#page-feeding` is replaced with the following structure.
IDs are chosen to be stable targets for the JS module.

```html
<section id="page-feeding" class="page-section">
  <h1 class="page-title">Feeding</h1>

  <!-- No-pond placeholder (shown when no device is selected) -->
  <div id="feed-no-pond" style="display:none" class="empty-state">
    No pond selected. Choose a pond from the topbar to view feeding data.
  </div>

  <!-- Main content (hidden when no pond selected) -->
  <div id="feed-content">

    <!-- Metric Cards -->
    <div class="feed-metrics">
      <div class="metric-card">
        <div class="value" id="feed-metric-today">—</div>
        <div class="label">Feeds Today</div>
      </div>
      <div class="metric-card">
        <div class="value" id="feed-metric-last">—</div>
        <div class="label">Last Fed</div>
      </div>
      <div class="metric-card">
        <div class="value" id="feed-metric-active">—</div>
        <div class="label">Schedules Active</div>
      </div>
      <div class="metric-card">
        <div class="value" id="feed-metric-next">—</div>
        <div class="label">Next Feed</div>
      </div>
    </div>

    <!-- Schedule + Chart row -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">

      <!-- Schedule List card -->
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 class="card-title" style="margin:0">Today's Feeding Schedule</h3>
          <!-- Shown only when canEditSchedules -->
          <button id="feed-add-schedule-btn" class="btn btn-primary" style="display:none">
            <svg class="icon icon-16"><use href="#icon-plus"/></svg> Add Schedule
          </button>
        </div>
        <!-- Inline add/edit form (hidden by default) -->
        <div id="feed-schedule-form" style="display:none;margin-bottom:12px;">
          <input id="feed-schedule-input" type="time" class="input-field" />
          <button id="feed-schedule-confirm" class="btn btn-primary btn-sm">Save</button>
          <button id="feed-schedule-cancel" class="btn btn-outline btn-sm">Cancel</button>
          <div id="feed-schedule-error" style="color:var(--red-dark);font-size:0.8rem;display:none;"></div>
        </div>
        <ul id="feed-schedule-list" class="feed-schedule-list"></ul>
      </div>

      <!-- Weekly Chart card -->
      <div class="card">
        <h3 class="card-title">Weekly Feed Activity</h3>
        <div class="feed-chart-wrap"><canvas id="feed-chart"></canvas></div>
      </div>
    </div>

    <!-- Manual Feed + Feed Log row -->
    <div style="display:grid;grid-template-columns:auto 1fr;gap:24px;margin-top:24px;align-items:start;">

      <!-- Manual Feed card -->
      <div class="card" style="min-width:200px;">
        <h3 class="card-title">Manual Feed</h3>
        <button id="feed-manual-btn" class="btn btn-primary" style="width:100%;">
          ▶ Manual Feed
        </button>
        <div id="feed-manual-status" style="font-size:0.8rem;color:var(--text-muted);margin-top:8px;"></div>
      </div>

      <!-- Feed Log card -->
      <div class="card">
        <h3 class="card-title">Feed Log</h3>
        <div id="feed-log-list" style="max-height:260px;overflow-y:auto;font-size:0.85rem;"></div>
      </div>
    </div>

  </div><!-- /#feed-content -->
</section>
```

---

## Firebase RTDB Listener Setup and Teardown

### Subscription

`_subscribe(deviceId)` is called whenever the active device changes. It attaches three
`onValue` listeners and pushes each unsubscribe function into `_listeners`:

1. **Schedules listener** — `onValue(ref(db, /devices/{id}/feeding))` — fires on any
   change under the feeding node. The handler filters keys matching `/^schedule\d+$/`,
   builds `_schedules`, calls `_renderScheduleList()`, `_updateMetricCards()`.

2. **Log listener** — `onValue(ref(db, /devices/{id}/feeding/log))` — fires when any
   log entry is added or changed. The handler collects all children, sorts descending by
   `ts`, slices to 20, stores in `_logEntries`, then calls `_renderFeedLog()`,
   `_updateMetricCards()`, `_updateWeeklyChart()`.

3. **manualFeed listener** — `onValue(ref(db, /devices/{id}/feeding/manualFeed))` —
   fires when the ESP32 resets the flag. Calls `_syncFeedButton(val)`.

### Teardown

`_teardown()` iterates `_listeners`, calls each unsubscribe function, clears the array,
resets `_schedules`, `_logEntries`, and resets all UI elements to their empty/default
state. Called before every new `_subscribe()` call and when no pond is selected.

---

## Schedule List Rendering

`_renderScheduleList()` builds `<li>` elements from `_schedules` sorted by time
(HH:MM string comparison). For each entry:

- Calls `_scheduleStatus(time)` to get `"completed"` | `"upcoming"` | `"scheduled"`.
- Renders a status icon (green check for completed, blue clock for others).
- Renders the time formatted as 12-hour (e.g. "06:00 AM").
- If `window._rbacPerms.canEditSchedules` is true, renders edit (pencil) and delete (×)
  icon buttons with `data-key` attributes.

Status logic in `_scheduleStatus(timeStr)`:

```js
function _scheduleStatus(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const now = new Date();
  const schedMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
  const diffMin = (schedMs - now.getTime()) / 60000;
  if (diffMin < 0)   return 'completed';
  if (diffMin <= 30) return 'upcoming';
  return 'scheduled';
}
```

Empty state: if `_schedules` is empty, renders a single `<li>` with the message
"No schedules configured for this device."

---

## Manual Feed Control

The Manual Feed button (`#feed-manual-btn`) is wired in `init()`. On click:

1. Checks `window._rbacPerms.canTriggerFeed` — logs a warning and returns if false.
2. Calls `_writeFeedLog(deviceId, 'Manual')` to write the log entry first.
3. Calls `set(ref(db, /devices/{id}/feeding/manualFeed), true)`.
4. Disables the button, sets text to "⟳ Dispensing…".
5. Starts a 10-second `setTimeout` that re-enables the button and shows a timeout
   warning if the ESP32 has not reset `manualFeed` by then.

The `manualFeed` RTDB listener (`_syncFeedButton`) handles the ESP32 reset:
- When value becomes `false` or `null`: clears the timeout, re-enables the button,
  shows "Feed complete ✓" in `#feed-manual-status`.

`_writeFeedLog(deviceId, type)`:

```js
async function _writeFeedLog(deviceId, type) {
  const ts = Date.now();
  await set(ref(db, `/devices/${deviceId}/feeding/log/${ts}`), { ts, type });
}
```

Note: `triggerFeed` in `firebase.js` targets `#feed-btn` (the dashboard button). The
Feeding tab uses its own `#feed-manual-btn` and manages state independently, avoiding
any coupling to the dashboard's button.

---

## Feed Log Rendering

`_renderFeedLog()` builds the `#feed-log-list` content from `_logEntries` (max 20,
sorted descending by `ts`):

Each entry renders as a row:

```html
<div class="feed-log-row">
  <span class="feed-log-type feed-log-type--manual">Manual</span>
  <span class="feed-log-time">Jun 12, 2025, 14:32:05</span>
</div>
```

Type badge colour: "Manual" → blue, "Auto" → green, unknown → grey.

Empty state: a centred paragraph "No feed events recorded yet."

---

## Metric Card Derivation

`_updateMetricCards()` derives all four values from `_schedules` and `_logEntries`:

| Card | ID | Derivation |
|---|---|---|
| Feeds Today | `#feed-metric-today` | Count entries in `_logEntries` where `ts` falls within today's calendar day (midnight–midnight local time). |
| Last Fed | `#feed-metric-last` | `_logEntries[0].ts` formatted as local time (HH:MM), or "—" if empty. |
| Schedules Active | `#feed-metric-active` | `_schedules.length`, or "—" if 0. |
| Next Feed | `#feed-metric-next` | `_nextScheduleTime(_schedules)` — finds the first schedule time after now today; formats as "in Xh Ym" or "HH:MM AM/PM". "—" if none. |

`_nextScheduleTime` implementation:

```js
function _nextScheduleTime(schedules) {
  const now = new Date();
  const todayMs = (h, m) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
  const future = schedules
    .map(s => { const [h, m] = s.time.split(':').map(Number); return todayMs(h, m); })
    .filter(ms => ms > now.getTime())
    .sort((a, b) => a - b);
  return future.length ? future[0] : null;
}
```

The "Next Feed" display formats the result as a countdown string:
- < 60 min: "in Xm"
- ≥ 60 min: "in Xh Ym"
- Exact time also shown in parentheses: "in 2h 15m (06:00 AM)"

---

## Weekly Chart Update

`_updateWeeklyChart()` replaces the static data in `initFeedingChart` with real counts.

The function:
1. Computes the start of each of the past 7 calendar days (Mon–Sun or rolling 7 days
   ending today, labelled by short day name).
2. Counts `_logEntries` entries whose `ts` falls within each day's midnight–midnight
   window. (Note: `_logEntries` only holds the 20 most recent; for the weekly chart a
   separate one-time `get()` query fetches all log entries from the past 7 days.)
3. Calls `_feedChart.data.labels = dayLabels` and updates the dataset data array, then
   `_feedChart.update('active')`.

The chart Y-axis label changes from "Consumption (kg)" to "Feed Events" since the log
stores event counts, not weight.

`initFeedingChart` in `charts.js` is updated to return the Chart.js instance so
`feeding.js` can hold a reference and call `update()` on it.

---

## Schedule CRUD Operations

### Add Schedule

1. User clicks `#feed-add-schedule-btn` → `#feed-schedule-form` becomes visible,
   `_editingKey` is set to `null` (new mode).
2. User enters a time and clicks Save.
3. `_nextScheduleKey(existingKeys)` computes the next key:
   ```js
   function _nextScheduleKey(existingKeys) {
     const nums = existingKeys
       .map(k => parseInt(k.replace('schedule', ''), 10))
       .filter(n => !isNaN(n));
     const max = nums.length ? Math.max(...nums) : 0;
     return `schedule${max + 1}`;
   }
   ```
4. Validates the time input (must match `/^\d{2}:\d{2}$/`). Shows error if invalid.
5. Writes `set(ref(db, /devices/{id}/feeding/{key}), timeStr)`.
6. Hides the form. The RTDB listener fires and re-renders the list.

### Edit Schedule

1. User clicks the edit button on a list item (has `data-key` attribute).
2. `#feed-schedule-form` becomes visible, input pre-filled with current time,
   `_editingKey` is set to the item's key.
3. On Save: validates, writes to the same key, hides form.

### Delete Schedule

1. User clicks the delete button on a list item.
2. Calls `remove(ref(db, /devices/{id}/feeding/{key}))`.
3. RTDB listener fires and re-renders.

---

## RBAC Integration

RBAC permissions are read from `window._rbacPerms` (set by `app.js → applyRoleGuards()`
before `init()` is called).

```js
const perms = window._rbacPerms || { canEditSchedules: false, canTriggerFeed: true };
```

Guards applied:
- `#feed-add-schedule-btn`: `style.display = perms.canEditSchedules ? '' : 'none'`
- Edit/delete buttons on each `<li>`: only rendered when `perms.canEditSchedules`
- Before any RTDB write in `_triggerManualFeed`: check `perms.canTriggerFeed`
- Before any schedule write/delete: check `perms.canEditSchedules`; if false, log a
  `console.warn('Permission denied: canEditSchedules required')` and return early.

---

## Active Device Context

`init()` listens for the `active-pond-changed` window event (dispatched by
`pond-context.js` when the user switches ponds in the topbar):

```js
window.addEventListener('active-pond-changed', (e) => {
  const pond = e.detail?.pond;
  if (!pond?.id) {
    _teardown();
    document.getElementById('feed-no-pond').style.display = '';
    document.getElementById('feed-content').style.display = 'none';
    return;
  }
  document.getElementById('feed-no-pond').style.display = 'none';
  document.getElementById('feed-content').style.display = '';
  _teardown();
  _deviceId = pond.id;
  _subscribe(pond.id);
});
```

On initial `init()`, the current active pond is read from `pond-context.js`
(`getActivePond()`) and `_subscribe` is called immediately if a pond is already selected.

---

## `charts.js` Change

`initFeedingChart` currently creates a Chart.js instance but does not return it.
It must be updated to return the instance so `feeding.js` can hold a reference:

```js
// Before
export function initFeedingChart(canvasEl) {
  if (!canvasEl || typeof Chart === 'undefined') return;
  new Chart(...);
}

// After
export function initFeedingChart(canvasEl) {
  if (!canvasEl || typeof Chart === 'undefined') return null;
  return new Chart(...);
}
```

The Y-axis label dataset label is also updated from `'Consumption (kg)'` to
`'Feed Events'`.

---

## Data Models

### Schedule entry (Firebase RTDB)

```
/devices/{deviceId}/feeding/schedule1  →  "06:00"   (string, HH:MM)
/devices/{deviceId}/feeding/schedule2  →  "18:00"
/devices/{deviceId}/feeding/schedule3  →  "12:00"   (new entries start at 3)
```

Existing `schedule1` / `schedule2` keys are preserved as-is. New keys follow the
`scheduleN` pattern with incrementing N.

### Feed log entry (Firebase RTDB)

```
/devices/{deviceId}/feeding/log/{timestamp_ms}  →  { ts: number, type: "Manual" | "Auto" }
```

The key is the Unix timestamp in milliseconds (string). The value object contains:
- `ts` — same timestamp as a number (for ordering)
- `type` — `"Manual"` (written by the browser) or `"Auto"` (written by the ESP32)

---

## Correctness Properties

### Property 1: Schedule status is mutually exclusive and exhaustive

For any valid HH:MM time string and any current time, `_scheduleStatus` SHALL return
exactly one of `"completed"`, `"upcoming"`, or `"scheduled"`, and the result SHALL be
consistent with the 30-minute boundary rule.

**Validates: Requirements 1.2, 1.3, 1.4**

### Property 2: Next schedule key is always greater than all existing keys

For any set of existing `scheduleN` keys, `_nextScheduleKey` SHALL return a key whose
numeric suffix is strictly greater than the maximum existing suffix, and the returned
key SHALL NOT already exist in the set.

**Validates: Requirement 2.3, 2.10**

### Property 3: Feeds Today count is consistent with log entries

For any array of log entries, the "Feeds Today" count SHALL equal the number of entries
whose `ts` falls within the current calendar day, and SHALL be ≤ the total number of
entries in the array.

**Validates: Requirement 5.1**

### Property 4: Next Feed derivation is always a future time or null

For any array of schedule entries and any current time, `_nextScheduleTime` SHALL return
either `null` (no future schedule today) or a timestamp strictly greater than the
current time.

**Validates: Requirement 5.4, 5.6**

### Property 5: Log entry round-trip

For any `{ ts, type }` object written by `_writeFeedLog`, reading back the entry at
`/devices/{deviceId}/feeding/log/{ts}` SHALL return an object with the same `ts` and
`type` values.

**Validates: Requirement 4.6**

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| No active pond | `#feed-no-pond` shown; `#feed-content` hidden; Manual Feed button disabled |
| Firebase RTDB read error | Console error logged; UI retains last known state |
| Schedule write fails | Inline error shown near the form; form stays open |
| Manual feed write fails | Button re-enabled; error message shown in `#feed-manual-status` |
| ESP32 does not reset manualFeed within 10 s | Timeout fires; button re-enabled; "Timeout — ESP32 may be offline" shown |
| `canEditSchedules = false` + direct write attempt | `console.warn` logged; write aborted silently |
| Invalid time input | Inline error shown; RTDB write blocked |
| Log entry has no `type` field (legacy ESP32 entries) | Rendered as "Auto" by default |

---

## Testing Strategy

### Unit Tests

- `_scheduleStatus` — verify boundary conditions: exactly at schedule time, 1 min
  before, 30 min before, 31 min before, 1 hour before.
- `_nextScheduleKey` — verify with empty set, set with gaps, set with schedule1/2 only.
- `_nextScheduleTime` — verify returns null when all schedules are in the past, returns
  the nearest future time when multiple future schedules exist.
- `_updateMetricCards` derivation logic — verify "Feeds Today" count with entries
  spanning midnight boundaries.
- Time formatting helpers — verify `_fmtTimestamp` output for known timestamps.

### Property-Based Tests

Use [fast-check](https://github.com/dubzzz/fast-check). Each property runs ≥ 100
iterations.

- **Property 1** — Generate random HH:MM strings and random "current time" offsets;
  assert `_scheduleStatus` returns exactly one of the three valid values and respects
  the 30-minute boundary.
- **Property 2** — Generate random sets of existing `scheduleN` keys; assert
  `_nextScheduleKey` returns a key not in the set with a strictly larger suffix.
- **Property 3** — Generate random arrays of log entries with random timestamps; assert
  "Feeds Today" count equals the filtered count for today's date range.
- **Property 4** — Generate random schedule arrays and random current times; assert
  `_nextScheduleTime` returns null or a value > current time.

### Integration Tests

- Verify that switching active pond tears down old listeners and subscribes to the new
  device path (using Firebase emulator).
- Verify that a manual feed write appears in the feed log within 2 seconds.
- Verify that the schedule list re-renders when a new schedule is added via RTDB.

### Manual / Smoke Tests

- Confirm "No pond selected" placeholder appears when no pond is active.
- Confirm Add/Edit/Delete controls are hidden for the `farmer` role.
- Confirm the 10-second timeout warning appears when Firebase is disconnected.
- Confirm the weekly chart updates after a manual feed is triggered.
