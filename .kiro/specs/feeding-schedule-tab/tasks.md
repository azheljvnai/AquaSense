# Implementation Plan: Feeding Schedule Tab

## Overview

Replace the static `#page-feeding` section with a fully dynamic, Firebase RTDB-driven
feeding management hub. All logic lives in `feeding.js` (Feeding_Module). Changes touch
four files: `charts.js`, `index.html`, `feeding.js`, and `app.css`, plus a new
property-based test file.

## Tasks

- [x] 1. Update `charts.js` — return Chart instance and rename dataset label
  - [x] 1.1 Make `initFeedingChart` return the Chart.js instance (currently returns nothing)
    - Change `new Chart(...)` to `return new Chart(...)`
    - Change early-return guard from `return;` to `return null;`
    - Update dataset label from `'Consumption (kg)'` to `'Feed Events'`
    - _Requirements: 6.2_

- [x] 2. Replace static `#page-feeding` HTML in `public/index.html`
  - [x] 2.1 Swap the static section with the dynamic structure from the design
    - Add `#feed-no-pond` empty-state div
    - Add `#feed-content` wrapper with metric cards (`#feed-metric-today`, `#feed-metric-last`, `#feed-metric-active`, `#feed-metric-next`)
    - Add schedule list card with `#feed-add-schedule-btn`, `#feed-schedule-form`, `#feed-schedule-list`
    - Add weekly chart card with `#feed-chart` canvas
    - Add manual feed card with `#feed-manual-btn` and `#feed-manual-status`
    - Add feed log card with `#feed-log-list`
    - _Requirements: 1.1, 3.1, 4.1, 5.1, 6.1, 8.3_

- [x] 3. Add CSS for new feeding tab elements to `public/css/app.css`
  - [x] 3.1 Add `.feed-log-row`, `.feed-log-type` badge styles, and schedule list item action button styles
    - `.feed-log-row` — flex row with gap, padding, border-bottom
    - `.feed-log-type` base + `--manual` (blue) and `--auto` (green) modifier classes
    - `.feed-schedule-list .actions` — flex gap for edit/delete icon buttons
    - `.feed-schedule-list .sched-icon` — status icon circle styles
    - `.input-field` — generic input style for the schedule time input
    - _Requirements: 1.2, 1.3, 1.4, 4.4_

- [x] 4. Rewrite `public/js/features/feeding.js` — full Feeding_Module
  - [x] 4.1 Set up module-level state and `init()` entry point
    - Declare `_deviceId`, `_listeners`, `_schedules`, `_logEntries`, `_feedChart`, `_manualFeedTimeout`
    - `init()`: initialise chart from `#feed-chart`, wire `active-pond-changed` event, call `_subscribe` if pond already active
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 4.2 Implement `_subscribe()` and `_teardown()`
    - `_subscribe(deviceId)`: attach three `onValue` listeners (feeding node, log, manualFeed); push unsubscribes to `_listeners`
    - `_teardown()`: call all unsubscribes, clear arrays, reset UI to empty/default state
    - _Requirements: 8.1, 8.2_

  - [x] 4.3 Implement schedule helpers and `_renderScheduleList()`
    - `_scheduleStatus(timeStr)` — returns `'completed'` | `'upcoming'` | `'scheduled'` per 30-min boundary rule
    - `_parseSchedules(snapshot)` — filter `scheduleN` keys, return sorted `[{key, time}]`
    - `_renderScheduleList()` — build `<li>` elements with status icon, 12-hour time, and RBAC-gated edit/delete buttons
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.4, 2.6, 2.8, 7.2, 7.3_

  - [ ]* 4.4 Write property test for `_scheduleStatus` (Property 1)
    - **Property 1: Schedule status is mutually exclusive and exhaustive**
    - **Validates: Requirements 1.2, 1.3, 1.4**

  - [x] 4.5 Implement `_renderFeedLog()`
    - Build `.feed-log-row` divs from `_logEntries` (max 20, descending)
    - Apply type badge classes: `feed-log-type--manual` (blue), `feed-log-type--auto` (green)
    - Default unknown/missing type to `'Auto'`
    - Show empty-state paragraph when no entries
    - _Requirements: 4.2, 4.4, 4.5, 4.7_

  - [x] 4.6 Implement metric card helpers and `_updateMetricCards()`
    - `_nextScheduleTime(schedules)` — return first future schedule ms or null
    - `_updateMetricCards()` — derive and set all four metric card values
    - Format "Next Feed" as countdown: "in Xm", "in Xh Ym (HH:MM AM/PM)"
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [ ]* 4.7 Write property test for `_nextScheduleTime` (Property 4)
    - **Property 4: Next Feed derivation is always a future time or null**
    - **Validates: Requirements 5.4, 5.6**

  - [ ]* 4.8 Write property test for Feeds Today count (Property 3)
    - **Property 3: Feeds Today count is consistent with log entries**
    - **Validates: Requirement 5.1**

  - [x] 4.9 Implement `_updateWeeklyChart()`
    - Fetch all log entries for past 7 days via `get()` (not limited to `_logEntries` slice)
    - Compute per-day counts for rolling 7-day window labelled by short day name
    - Update `_feedChart.data.labels` and dataset data, call `_feedChart.update('active')`
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 4.10 Implement manual feed control
    - `_writeFeedLog(deviceId, type)` — write `{ts, type}` to RTDB log path
    - `_triggerManualFeed()` — check `canTriggerFeed`, write log, set `manualFeed=true`, disable button, start 10s timeout
    - `_syncFeedButton(val)` — handle ESP32 reset: clear timeout, re-enable button, show status
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.6, 7.4_

  - [x] 4.11 Implement schedule CRUD operations
    - `_nextScheduleKey(existingKeys)` — compute next `scheduleN` key
    - Add schedule: show form, validate HH:MM, write to RTDB, hide form
    - Edit schedule: pre-fill form with existing time, write to same key on save
    - Delete schedule: call `remove()` on RTDB ref
    - RBAC guard: check `canEditSchedules` before any write; `console.warn` and return if false
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 7.5_

  - [ ]* 4.12 Write property test for `_nextScheduleKey` (Property 2)
    - **Property 2: Next schedule key is always greater than all existing keys**
    - **Validates: Requirements 2.3, 2.10**

- [x] 5. Write property-based tests in `tests/feeding.property.test.js`
  - [x] 5.1 Implement Property 1 test — `_scheduleStatus` is mutually exclusive and exhaustive
    - Generate random HH:MM strings and current-time offsets
    - Assert result is exactly one of `'completed'`, `'upcoming'`, `'scheduled'`
    - Assert 30-minute boundary is respected
    - _Requirements: 1.2, 1.3, 1.4_

  - [x] 5.2 Implement Property 2 test — `_nextScheduleKey` suffix is strictly greater
    - Generate random sets of `scheduleN` keys
    - Assert returned key not in set and numeric suffix > max existing
    - _Requirements: 2.3, 2.10_

  - [x] 5.3 Implement Property 3 test — Feeds Today count consistency
    - Generate random log entry arrays with random timestamps
    - Assert count equals filtered entries within today's midnight–midnight window
    - Assert count ≤ total entries
    - _Requirements: 5.1_

  - [x] 5.4 Implement Property 4 test — `_nextScheduleTime` returns null or future
    - Generate random schedule arrays and current times
    - Assert result is null or strictly greater than current time
    - _Requirements: 5.4, 5.6_

- [x] 6. Final checkpoint — Ensure all tests pass
  - Run `npm test` and confirm all property tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties defined in the design
- The `_writeFeedLog` / RTDB round-trip (Property 5 from design) is an integration test and is not included here as it requires a live Firebase emulator
