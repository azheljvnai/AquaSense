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
  - `tests/feeding-unified.test.js` — unified feeding behavior (schedules/manual/log logic).
  - `tests/reports-feeding.test.js` — feeding report row/aggregation behavior.
  - `tests/historical-data-navigation.test.js` — navigation logic for historical data views.

- **Notifications (client → server dispatch integration)**
  - `tests/notifications-dispatch.test.js` — `handleAlert()` sends POST `/api/notifications/dispatch-alert` with correct payload.

## Reliability / correctness of core algorithms

- **Property-based tests (high coverage via randomized inputs)**
  - `tests/feeding.property.test.js` — invariants for schedules (next occurrence, “feeds today”, key generation).

- **Alert timing / debouncing**
  - `tests/alert-sensitivity.test.js` — breach must persist for sensitivity window before alerting.

- **Alert watcher behavior (server-side)**
  - `tests/rtdb-alert-watcher-interval.test.js` — notify interval per parameter; retry rules.
  - `tests/dispatch-alert-cooldown.test.js` — cooldown rules for dispatch (suppression & re-alert).
  - `tests/dispatch-alert-watcher-guard.test.js` — watcher guardrails.

## Security-related automated checks (validation + safe behavior)

- **Input validation (server)**
  - `tests/dispatch-alert-validation.test.js` — rejects invalid alert payloads.
  - `tests/dispatch-alert-sms-ascii.test.js` — SMS content constraints / encoding expectations.

- **Credential hygiene / config handling**
  - `tests/emailjs-env.test.js` — EmailJS env validation behavior.

- **Password rules (client-side policy)**
  - `tests/password-rules.test.js` — password complexity + confirm matching rules.

## Data correctness & parsing

- **Feed log parsing / normalization**
  - `tests/feed-dispense.test.js` — feed amount clamping, timestamp parsing, dedupe behavior.

---

## Notes for defense slides

- A strong defense framing is: **unit tests** (pure logic), **property-based tests** (randomized robustness), and **integration-like tests** (client dispatch function calling backend endpoint).
- If you add API tests + perf/security/accuracy scripts (next tasks), link them here too.

