# Automated test map (for thesis defense)

This document maps **automated tests** in this repo to defense-friendly categories:
**Functional**, **Reliability/logic**, **Security-related checks**, and **Data correctness**.

Run all automated tests:

```bash
npm test
```

## Functional (software features behave correctly)

- **Routing / SPA navigation**
  - `tests/router.test.js` — path ↔ page mapping, unknown route handling.

- **Feeding feature logic**
  - `tests/feeding.test.js` — schedule/holdMs helpers and dashboard compaction (`feeding.js` exports).
  - `tests/feeding-schedule.property.test.js` — property-based invariants for schedule status, next feed, index allocation.
  - `tests/feed-dispense.test.js` — feed log parsing, amounts, dedupe (`feed-dispense.js`).
  - `tests/reports-feeding.test.js` — CSV row builder (`report-feeding-rows.js`).

- **Historical data navigation**
  - `tests/historical-data-navigation.test.js` — `getNavigatedRange` from `historical-data.js`.
  - `tests/updateNavigatorUI.test.js` — `updateNavigatorUI` from `historical-data.js`.

- **Notifications (client → server dispatch integration)**
  - `tests/notifications-dispatch.test.js` — `handleAlert()` POST `/api/notifications/dispatch-alert`.

- **Threshold forms (configuration UI)**
  - `tests/threshold-form.test.js` — validate/read/fill threshold forms.

- **Reports formatting**
  - `tests/report-format.test.js` — `escapeXml`, Excel blob export.

## Reliability / correctness of core algorithms

- **Alert timing / debouncing**
  - `tests/alert-sensitivity.test.js` — server breach tracker (`backend/lib/alert-sensitivity.js`).
  - `tests/alert-sensitivity-client.test.js` — client breach tracker (`public/js/alert-sensitivity.js`).

- **Threshold evaluation**
  - `tests/threshold-eval.test.js` — merge, badges, alert payloads (`backend/lib/threshold-eval.js`).
  - `tests/pond-config-badge.test.js` — client `getBadgeForSpecies` aligned with server eval.

- **Alert watcher behavior (server-side)**
  - `tests/rtdb-alert-watcher-interval.test.js` — notify interval per parameter; retry rules.
  - `tests/dispatch-alert-cooldown.test.js` — cooldown rules for dispatch.
  - `tests/dispatch-alert-watcher-guard.test.js` — watcher guardrails.

- **In-memory sensor history**
  - `tests/utils-history.test.js` — `mergeRtdbEntries`, `getHistoryRange`, `recordSensorReading`.

## Security-related automated checks (validation + safe behavior)

- **Input validation (server)**
  - `tests/dispatch-alert-validation.test.js` — rejects invalid alert payloads.
  - `tests/dispatch-alert-sms-ascii.test.js` — SMS content constraints.

- **API auth**
  - `tests/backend-api-auth.test.js`, `tests/api-config-exposure.test.js`.

- **Credential hygiene / config handling**
  - `tests/emailjs-env.test.js` — EmailJS env validation.

- **Password rules (client-side policy)**
  - `tests/password-rules.test.js`.

## Data correctness & parsing

- **Feed log parsing / normalization**
  - `tests/feed-dispense.test.js` — amount labels, timestamp parsing, dedupe.
  - `tests/fetch-feed-log.test.js` — range filter/merge for report feed-log extraction.
  - `tests/report-date-range.test.js` — weekly/monthly report period boundaries.

## Intentionally not unit-tested (DOM / CDN / init-only)

- `reports.js`, `config-management.js`, `farm-profile.js`, `dashboard.js`, `water-quality.js`
- `firebase-client.js` (Firebase CDN ESM), `charts.js` (Chart.js global), `app.js` entry

These are covered manually or would need browser/E2E tests.

## Vitest setup

- `vitest.config.js` — `firebase-admin` stub alias, `tests/setup.js` for minimal `window` / `document` globals.
- `tests/mocks/firebase-admin.js` — backend integration tests.

## Notes for defense slides

- **Unit tests** exercise exported pure logic from real modules.
- **Property-based tests** (`feeding-schedule.property.test.js`) add randomized robustness for schedule math.
- **Integration-style tests** use Supertest + mocked Firebase Admin for HTTP and alert dispatch.
