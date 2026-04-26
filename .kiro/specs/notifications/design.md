# Design Document — Notifications (Email)

## Overview

The Notifications feature adds email delivery to AquaSense's existing alert pipeline.
When the `alerts.js` evaluation engine generates a `critical` or `warning` alert, a new
`NotificationService` module checks the current user's preferences and, if the email
channel is enabled, dispatches an email via EmailJS (client-side, free tier).

Preferences are stored in Firestore at `users/{uid}/notificationPrefs` so they survive
browser refreshes and are tied to the authenticated user rather than the device.
Every dispatched (or failed) email is logged to the `notificationLog` Firestore
collection for audit purposes.

The design is intentionally client-side-only: no new backend endpoints are required.
EmailJS is loaded as a CDN script and called directly from the browser, consistent with
the project's existing pattern of using Firebase client SDKs from gstatic.

---

## Architecture

```
sensor-data-updated (CustomEvent)
        │
        ▼
  alerts.js  ──── evaluateSensor() ────► alert object
        │                                      │
        │  dispatches                          │
        ▼                                      ▼
  NotificationService.handleAlert(alert)
        │
        ├─ loadPrefs()  ──► Firestore users/{uid}/notificationPrefs
        │
        ├─ cooldownGuard(pondId, sensorKey)   (in-memory, 15 min)
        │
        ├─ emailjs.send(templateId, params)
        │        │
        │        ├─ success ──► logToFirestore(status: 'sent')
        │        └─ failure ──► logToFirestore(status: 'failed')
        │                   └─ showToast(error)
        │
        └─ offlineQueue  (retry up to 3×, 60 s interval)
```

The `NotificationService` is a standalone ES module
(`public/js/features/notifications.js`) that is imported and initialised by `app.js`
after the user authenticates, following the same pattern as every other feature module.

---

## Components and Interfaces

### NotificationService (`public/js/features/notifications.js`)

Public API:

```js
// Called once after auth, wires up the sensor-data-updated listener
export function init()

// Load prefs from Firestore (or cache); returns NotificationPrefs
export async function loadPrefs(uid)

// Persist prefs to Firestore
export async function savePrefs(uid, prefs)

// Entry point called by alerts.js (or the sensor-data-updated handler)
// after a new alert object is created
export async function handleAlert(alert)
```

Internal helpers (not exported):

```js
// Returns true if the sensor+pond combo is within the 15-min cooldown window
function isCooledDown(pondId, sensorKey)

// Marks the current timestamp for a sensor+pond combo
function markSent(pondId, sensorKey)

// Sends via EmailJS; returns { success, error }
async function sendEmail(prefs, alert)

// Writes a record to notificationLog
async function writeLog(uid, alert, status, errorDetail)

// Adds a failed dispatch to the offline retry queue
function enqueueRetry(uid, alert)

// Processes the retry queue (called on 'online' event)
async function flushRetryQueue()

// Shows a non-blocking toast in the UI
function showToast(message, type)
```

### Notification Preferences UI

A new sub-section is added inside the existing Alerts page (`#page-alerts`).
It contains:

- Email toggle (`<input type="checkbox" id="notif-email-toggle">`)
- Email address input (`<input type="email" id="notif-email-address">`)
- Save button
- Configuration warning banner (shown when EmailJS keys are absent)

The UI reads/writes via `loadPrefs` / `savePrefs`.

### Notification Log UI

A collapsible panel at the bottom of the Alerts page shows the 50 most recent
`notificationLog` entries, with a status filter (`all` / `sent` / `failed`).

---

## Data Models

### NotificationPrefs (Firestore: `users/{uid}/notificationPrefs`)

```js
{
  email: {
    enabled: boolean,       // whether the email channel is active
    address: string,        // destination email address
  },
  updatedAt: Timestamp,
}
```

### NotificationLog entry (Firestore: `notificationLog/{autoId}`)

```js
{
  uid:        string,       // Firebase Auth UID of the user
  channel:    'email',
  alertId:    string,       // alert.id from alerts.js
  pondName:   string,
  parameter:  string,       // 'ph' | 'do' | 'turb' | 'temp'
  severity:   'critical' | 'warning',
  sentAt:     Timestamp,
  status:     'sent' | 'failed',
  errorDetail: string | null,
}
```

### EmailJS Template Parameters

The template receives these variables (mapped in the EmailJS dashboard):

```
{{to_email}}      — recipient address from prefs
{{pond_name}}     — alert.pond
{{parameter}}     — human-readable sensor label (e.g. "Dissolved O₂")
{{value}}         — formatted sensor value with unit (e.g. "4.2 mg/L")
{{severity}}      — "Critical" | "Warning"
{{threshold}}     — threshold range string (e.g. "≥ 6 mg/L")
{{timestamp}}     — ISO 8601 string of alert.ts
```

### In-Memory Cooldown State

```js
// Map keyed by `${pondId}:${sensorKey}` → last sent timestamp (ms)
const _cooldownMap = new Map();
const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
```

### Offline Retry Queue

```js
// Persisted to sessionStorage so it survives soft navigations but not tab closes
// Array of { uid, alert, attempts, nextRetryAt }
const RETRY_QUEUE_KEY = 'aquasense.notif.retryQueue.v1';
const MAX_ATTEMPTS = 3;
const RETRY_INTERVAL_MS = 60 * 1000;
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid
executions of a system — essentially, a formal statement about what the system should do.
Properties serve as the bridge between human-readable specifications and
machine-verifiable correctness guarantees.*

### Property 1: Cooldown prevents duplicate emails within 15 minutes

*For any* pond/sensor combination, if an email notification was dispatched at time T,
then no further email notification SHALL be dispatched for the same pond/sensor
combination before T + 15 minutes, regardless of how many alerts are generated in
that window.

**Validates: Requirements 2.4**

### Property 2: Disabled channel produces no dispatch

*For any* alert and any user whose `email.enabled` preference is `false`, calling
`handleAlert` SHALL result in zero calls to `emailjs.send` and zero new records in
`notificationLog`.

**Validates: Requirements 1.3, 5.1**

### Property 3: Log entry reflects dispatch outcome

*For any* alert that passes the cooldown and preference checks, the `notificationLog`
record written after the EmailJS call SHALL have `status = 'sent'` if and only if
`emailjs.send` resolved without error, and `status = 'failed'` otherwise.

**Validates: Requirements 6.1, 6.2**

### Property 4: Preference round-trip

*For any* valid `NotificationPrefs` object, saving it via `savePrefs` and then loading
it via `loadPrefs` SHALL return an object with the same `email.enabled` and
`email.address` values.

**Validates: Requirements 1.1, 1.2**

### Property 5: Invalid email address is rejected

*For any* string that is not a valid email address (i.e. does not match the RFC 5322
simplified pattern), attempting to save it as `email.address` with `email.enabled = true`
SHALL be rejected before the Firestore write, leaving the stored prefs unchanged.

**Validates: Requirements 1.4**

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| EmailJS keys not configured | Email toggle is disabled; warning banner shown in UI |
| `emailjs.send` returns error | Error logged to console; non-blocking toast shown; log record written with `status: 'failed'` |
| Firestore write fails (prefs) | Error surfaced in the preferences UI; no silent failure |
| Firestore write fails (log) | Logged to console; does not block email dispatch |
| Browser offline at dispatch time | Alert added to retry queue (max 3 attempts, 60 s interval); queue flushed on `window.online` event |
| User not authenticated | `handleAlert` exits early; no dispatch, no log write |
| Alert already resolved | `handleAlert` exits early (checks `alert.resolved`) |

---

## Testing Strategy

### Unit Tests

Focus on the pure logic functions that can be tested without a live Firebase or EmailJS
connection:

- `isCooledDown` / `markSent` — verify the 15-minute window logic with mocked timestamps
- `savePrefs` / `loadPrefs` — verify round-trip with a Firestore emulator or mock
- Email address validation — verify acceptance/rejection of valid and invalid strings
- `enqueueRetry` / `flushRetryQueue` — verify queue growth, retry counting, and
  exhaustion behaviour with mocked `emailjs.send`
- `handleAlert` with `email.enabled = false` — verify zero calls to `emailjs.send`
- `handleAlert` for a resolved alert — verify early exit

### Property-Based Tests

Use [fast-check](https://github.com/dubzzz/fast-check) (JavaScript PBT library).
Each property test runs a minimum of 100 iterations.

Tag format: `// Feature: notifications, Property N: <property text>`

- **Property 1** — Generate random `(pondId, sensorKey, alertCount)` tuples; simulate
  `alertCount` alerts within a 15-minute window; assert `emailjs.send` is called at most
  once per tuple.
- **Property 2** — Generate random alert objects with `email.enabled = false`; assert
  `emailjs.send` call count is 0.
- **Property 3** — Generate random alerts and mock `emailjs.send` to succeed or fail
  randomly; assert the written log `status` matches the mock outcome.
- **Property 4** — Generate random `NotificationPrefs` objects; save then load; assert
  field equality.
- **Property 5** — Generate arbitrary strings; assert that only strings matching the
  email regex are accepted by the validation function.

### Integration Tests

- Verify that `notificationLog` records appear in Firestore after a real `handleAlert`
  call (using the Firebase emulator).
- Verify that the Alerts page UI renders the 50 most recent log entries correctly.
- Verify that the preference toggle persists across a page reload (Firestore emulator).

### Manual / Smoke Tests

- Confirm EmailJS template renders correctly with real sensor values.
- Confirm the configuration warning banner appears when `EMAILJS_PUBLIC_KEY` is absent.
- Confirm the toast appears on a simulated EmailJS failure.
