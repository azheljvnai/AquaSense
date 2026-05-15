# AquaSense — Backend test cases

This document lists **manual and automated acceptance cases for the Express backend** (`backend/server.js`), supporting libraries (`backend/lib/`, `backend/notifications/`), and operational scripts. The SPA (`public/`) is **out of scope** here; track browser UI cases separately using the same step-table format if needed.

**How to use:** Execute the steps, record **Actual Result**, then set **Status** to **Pass** or **Fail** (use **Not run** only when the step was skipped).

---

## Execution summary (machine run)

| Command | When | Outcome |
|--------|------|---------|
| `npm test` (full Vitest) | 2026-05-13 | **Fail** — 194 passed, 1 failed (`tests/historical-data-preservation.property.test.js`, Property 2.4: dashboard metric icon `style` assertion; `getAttribute('style')` was null). |
| `npx vitest run --exclude tests/historical-data-preservation.property.test.js` | 2026-05-13 | **Pass** — 25 files, 190 tests (sanity only; not a product gate). |

The failing test exercises **frontend DOM** expectations; backend route logic is still covered by other suites. Treat **full `npm test`** as the release gate until that test is fixed or quarantined.

---

## Feature: Automated regression (Vitest)

### TC-BE-AUTO-001 — Full unit and integration suite

**Title:** Root Vitest regression (`npm test`)

**Test Case Description:** P0 — Run the repository Vitest suite to guard alert dispatch, notifications, feeding/history UI modules, UniSMS, EmailJS env parsing, and related behavior exercised under `tests/`.

**Verify the** `npm test` command completes with exit code 0 and every test reports Pass.

**Pre-condition:** Repository dependencies installed (`npm install` at repo root; `npm run install:backend` if backend deps are missing).

**Test Scenario:** Verify that the automated suite reflects the current codebase and catches regressions before release.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | From repo root `d:\AquaSense`, run `npm test`. | Process exits with code 0; Vitest reports all tests passed. | Exit code 1. One failed test: `tests/historical-data-preservation.property.test.js` — Property 2.4 (`getAttribute('style')` is null on `.metric-icon`). 194 other tests passed in the same run. | Fail |

---

## Feature: Public config and static hosting

### TC-BE-HTTP-001 — Public `/api/config` payload

**Title:** Safe client configuration JSON

**Test Case Description:** P0 — The server exposes Firebase client fields and device defaults without leaking service accounts or UniSMS secrets.

**Verify the** `GET /api/config` response shape and absence of private credentials.

**Pre-condition:** Backend process running (`npm start` from repo root); `.env` populated for Firebase URL and client keys as used in your environment.

**Test Scenario:** Verify that unauthenticated clients can read only the intended public configuration.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | `GET http://localhost:3000/api/config` (no `Authorization` header). | HTTP 200; JSON includes `firebaseDatabaseUrl`, `deviceId`, nested `firebase` object (apiKey, authDomain, projectId, etc.). | Not run (server not started in this session). | Not run |
| 2 | Inspect response body for secrets. | No `UNISMS_SECRET_KEY`, no service account JSON, no private signing keys. | Not run | Not run |

### TC-BE-HTTP-002 — Firebase emulator flags in config

**Title:** Emulator settings in `/api/config`

**Test Case Description:** P1 — When emulators are enabled via env, the client receives emulator host and port hints.

**Verify the** `firebase.useFirebaseEmulators` and related fields when `USE_FIREBASE_EMULATORS` is set.

**Pre-condition:** Backend running; `.env` includes `USE_FIREBASE_EMULATORS=true` or `1` for this check.

**Test Scenario:** Verify that local emulator workflows receive correct flags from the server.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | Set `USE_FIREBASE_EMULATORS=true`, restart server, `GET /api/config`. | `firebase.useFirebaseEmulators` is true; `firebaseEmulatorHost`, `firestoreEmulatorPort`, `authEmulatorPort` present. | Not run | Not run |

### TC-BE-HTTP-003 — Legacy dashboard URL redirect

**Title:** `/dashboard.html` redirects to SPA root

**Test Case Description:** P0 — Old bookmarks must land on the single-page app entry.

**Verify the** HTTP redirect from the legacy path to `/`.

**Pre-condition:** Backend running.

**Test Scenario:** Verify that users opening the legacy URL are redirected correctly.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | Request `GET http://localhost:3000/dashboard.html` (browser or `curl -I`). | Redirect to `/` (3xx Location `/` or equivalent). | Not run | Not run |

### TC-BE-HTTP-004 — Cache-Control on static responses

**Title:** No-store caching for development-friendly reloads

**Test Case Description:** P1 — Responses include `Cache-Control: no-store` per server middleware.

**Verify the** header on HTML and asset responses.

**Pre-condition:** Backend running.

**Test Scenario:** Verify that static assets are not cached aggressively during development.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | `GET /` and `GET /js/app.js` (or main CSS). | HTTP 200; `Cache-Control: no-store` on responses. | Not run | Not run |

### TC-BE-HTTP-005 — SPA deep-link fallback

**Title:** Unknown GET paths serve `index.html`

**Test Case Description:** P2 — Client-side routes that are not real files should receive the SPA shell.

**Verify the** fallback for a non-file path.

**Pre-condition:** Backend running.

**Test Scenario:** Verify that deep links do not return 404 for the SPA.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | `GET http://localhost:3000/some/deep/nonfile` (path not a static file). | Returns `index.html` body (SPA shell). | Not run | Not run |

---

## Feature: Authentication middleware

### TC-BE-AUTH-001 — Bearer token required

**Title:** Protected routes reject missing Authorization

**Test Case Description:** P0 — Routes using `verifyToken` return 401 without a Bearer token.

**Verify the** JSON error for missing `Authorization`.

**Pre-condition:** Backend running; Firebase Admin initialised (otherwise 503 on Admin-dependent routes).

**Test Scenario:** Verify that anonymous callers cannot read protected APIs.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | `GET /api/configurations` with no `Authorization` header. | HTTP 401; message indicates missing Authorization. | Not run | Not run |

### TC-BE-AUTH-002 — Invalid or expired token

**Title:** Malformed Firebase ID token rejected

**Test Case Description:** P0 — Invalid tokens must not pass `verifyToken`.

**Verify the** 401 response body for bad Bearer values.

**Pre-condition:** Backend running; Admin initialised.

**Test Scenario:** Verify that stolen or garbage tokens cannot access protected APIs.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | `GET /api/configurations` with `Authorization: Bearer invalid`. | HTTP 401; body indicates invalid or expired token. | Not run | Not run |

### TC-BE-AUTH-003 — Admin SDK not initialised

**Title:** Degraded mode when Admin fails startup

**Test Case Description:** P0 — If Admin SDK did not initialise, token verification cannot run.

**Verify the** 503 response on protected routes when `admin.apps` is empty.

**Pre-condition:** Start server with invalid/missing Firebase Admin credentials so init logs a warning and apps stay empty.

**Test Scenario:** Verify graceful failure when the server cannot talk to Firebase Admin.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | Call any `verifyToken` route (e.g. `GET /api/configurations`) with or without token. | HTTP 503; error explains Admin SDK not initialised. | Not run | Not run |

---

## Feature: Notifications API (`/api/notifications`)

### TC-BE-NOTIF-001 — POST SMS happy path

**Title:** UniSMS send with valid body

**Test Case Description:** P1 — Authenticated SMS send returns success when UniSMS is configured.

**Verify the** `POST /api/notifications/sms` success JSON.

**Pre-condition:** Valid Firebase ID token; `UNISMS_SECRET_KEY` set; recipient in supported format.

**Test Scenario:** Verify that an authorised user can trigger an SMS through the backend.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | `POST /api/notifications/sms` with JSON `{ "recipient": "+639...", "content": "test" }` and `Authorization: Bearer <token>`. | HTTP 200; `success: true`; `reference_id` present. | `npm test` 2026-05-13: `tests/unisms-send.test.js` **Pass** (unit/mocked paths). | Pass |
| 2 | Omit `recipient` or use empty string. | HTTP 400; recipient required. | Covered by Vitest / `sendUniSms` validation: **Pass**. | Pass |
| 3 | Omit `content` or empty. | HTTP 400; content required. | Covered by Vitest: **Pass**. | Pass |
| 4 | Content longer than 160 GSM characters. | HTTP 400 (length). | Covered by Vitest: **Pass**. | Pass |
| 5 | UniSMS not configured (`UNISMS_SECRET_KEY` unset). | HTTP 503; not configured message. | Covered by Vitest: **Pass**. | Pass |

### TC-BE-NOTIF-002 — POST dispatch-alert

**Title:** Server-side alert fan-out

**Test Case Description:** P0 — Alert dispatch writes logs, respects cooldown, and integrates SMS/email paths per `backend/notifications/dispatch-alert.js`.

**Verify the** behavior exercised in Vitest (`dispatch-alert-*`, `alerts-not-saving-or-sending*`, `notifications*`).

**Pre-condition:** Valid token; Firestore user documents as expected by dispatch tests; optional EmailJS/UniSMS env.

**Test Scenario:** Verify that critical alert flows remain correct after code changes.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | Run `npm test` and confirm suites under `tests/dispatch-alert*.test.js`, `tests/alerts-not-saving-or-sending*.test.js`, `tests/notifications*.test.js` pass. | All tests in those files Pass. | Full run 2026-05-13: all tests in those files **Pass** (suite exit **Fail** only because of `historical-data-preservation.property.test.js`). | Pass |
| 2 | (Manual) `POST /api/notifications/dispatch-alert` with production-like `alert` payload. | Notifications attempted per rules; cooldown respected. | Not run end-to-end against live providers in this session. | Not run |

**Implementation note:** `postDispatchAlert` is mounted after `verifyToken` only; it does **not** call `requireRole`. Any authenticated role can invoke dispatch unless you add role middleware.

---

## Feature: Users API

### TC-BE-USER-001 — PATCH own profile

**Title:** `PATCH /api/users/me`

**Test Case Description:** P0 — Authenticated user can update allowed profile and farm fields.

**Verify the** merge behavior for `displayName`, `email`, `phone`, `farm`.

**Pre-condition:** Valid ID token; Firestore `users/{uid}` exists; optional `farmId` for farm merge.

**Test Scenario:** Verify self-service profile updates.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | `PATCH /api/users/me` with at least one allowed field. | HTTP 200; `success: true`; Auth/Firestore updated for allowed keys. | Not run | Not run |
| 2 | `PATCH /api/users/me` with `{}` (no allowed fields). | HTTP 400. | Not run | Not run |

### TC-BE-USER-002 — POST create user (RBAC)

**Title:** `POST /api/users`

**Test Case Description:** P0 — Admin and owner can create users; farmer cannot; owner cannot assign admin.

**Verify the** status codes for role matrix and invalid roles.

**Pre-condition:** Separate ID tokens for admin, owner, farmer; staging project.

**Test Scenario:** Verify account creation rules match product policy.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | Admin or owner `POST /api/users` with `email`, `password`, valid `role`. | HTTP 201; returns `uid`. | Not run | Not run |
| 2 | Owner `POST /api/users` with `role: "admin"`. | HTTP 403. | Not run | Not run |
| 3 | Farmer `POST /api/users` with valid body. | HTTP 403 (requireRole). | Not run | Not run |
| 4 | Invalid `role` string. | HTTP 400. | Not run | Not run |

### TC-BE-USER-003 — PATCH disable user

**Title:** `PATCH /api/users/:uid` disabled flag

**Test Case Description:** P0 — Admin or owner can disable users; owner cannot disable admin.

**Verify the** Auth `disabled` flag and Firestore `status`.

**Pre-condition:** Admin/owner tokens; target user uids in Firestore.

**Test Scenario:** Verify account suspension rules.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | Admin or owner patches `{ "disabled": true }` on non-admin target. | HTTP 200; user disabled; Firestore `inactive`. | Not run | Not run |
| 2 | Owner patches disable on user whose Firestore role is `admin`. | HTTP 403. | Not run | Not run |
| 3 | Missing boolean `disabled`. | HTTP 400. | Not run | Not run |

### TC-BE-USER-004 — DELETE user (admin only)

**Title:** `DELETE /api/users/:uid`

**Test Case Description:** P0 — Only admin may hard-delete; owner receives 403.

**Verify the** RBAC on delete.

**Pre-condition:** Admin and owner tokens; disposable test uid for delete.

**Test Scenario:** Verify permanent removal is restricted to admin.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | Admin `DELETE /api/users/:uid`. | HTTP 200; Auth user and Firestore doc removed. | Not run | Not run |
| 2 | Owner `DELETE /api/users/:uid`. | HTTP 403. | Not run | Not run |

### TC-BE-USER-005 — Legacy role normalisation

**Title:** Firestore `manager` / `viewer` mapped in `verifyToken`

**Test Case Description:** P1 — Legacy roles map to `owner` / `farmer` for `req.auth.role`.

**Verify the** effective role after token verification.

**Pre-condition:** User doc with `role: "manager"` or `"viewer"`.

**Test Scenario:** Verify backward compatibility for old role strings.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | Sign in as legacy user; call any route that exposes effective role (or log server-side). | `manager` → `owner`, `viewer` → `farmer` in `req.auth.role`. | Not run | Not run |

---

## Feature: Global species configurations (`/api/configurations`)

### TC-BE-CFG-001 — CRUD and activate

**Title:** Configuration collection API

**Test Case Description:** P0 — List, create, activate, delete rules for global configurations (not pond-scoped).

**Verify the** HTTP semantics documented in `server.js` for configurations routes.

**Pre-condition:** Authenticated admin or owner; Firestore access.

**Test Scenario:** Verify species preset management used by the configuration UI.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | `GET /api/configurations` with valid token. | HTTP 200; JSON list. | Not run | Not run |
| 2 | `POST /api/configurations` with new `species` data (admin/owner). | HTTP 201; new id. | Not run | Not run |
| 3 | `POST` with duplicate preset `id` if your payload supplies conflicting id. | HTTP 409 when id conflicts (per server logic). | Not run | Not run |
| 4 | `POST /api/configurations/:id/activate`. | Exactly one `isActive: true` in collection. | Not run | Not run |
| 5 | `DELETE` active configuration id. | HTTP 400; cannot delete active. | Not run | Not run |
| 6 | `DELETE` inactive id. | HTTP 200. | Not run | Not run |
| 7 | `DELETE` unknown id. | HTTP 404. | Not run | Not run |

---

## Feature: Ponds and pond configurations (Firestore APIs)

These routes exist in the current `server.js`; include them if your deployment still uses pond-based data.

### TC-BE-POND-001 — Ponds CRUD

**Title:** `/api/ponds`

**Test Case Description:** P1 — List/create/update/delete ponds with role checks (`requireRole` on mutating routes where applicable).

**Verify the** pond documents in Firestore match API responses.

**Pre-condition:** Valid tokens; Admin initialised.

**Test Scenario:** Verify pond lifecycle for integrations still using this model.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | `GET /api/ponds` | HTTP 200; array of ponds. | Not run | Not run |
| 2 | `POST /api/ponds` as owner/admin with `name`. | HTTP 201; new id. | Not run | Not run |
| 3 | `DELETE /api/ponds/:id` as farmer (if tested). | Expect 403 for non-admin per route definition (delete requires admin). | Not run | Not run |

### TC-BE-POND-002 — Pond configurations and activate

**Title:** `/api/pond-configurations`

**Test Case Description:** P1 — Per-pond configuration list/create/update/activate/deactivate/delete.

**Verify the** `pondId` query requirement on GET and activation exclusivity.

**Pre-condition:** Existing `pondId`; admin/owner token for mutations.

**Test Scenario:** Verify pond-specific species/thresholds management.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | `GET /api/pond-configurations` without `pondId`. | HTTP 400. | Not run | Not run |
| 2 | `GET /api/pond-configurations?pondId=<id>` | HTTP 200; list. | Not run | Not run |
| 3 | `POST .../:id/activate` | Single active config per pond after batch update. | Not run | Not run |

### TC-BE-MIGRATE-001 — Backup and rollback (admin)

**Title:** `/api/migrate/backup` and `/api/migrate/rollback`

**Test Case Description:** P2 — Admin-only migration helpers for ponds data.

**Verify the** 403 for non-admin and successful backup metadata on happy path.

**Pre-condition:** Admin token; staging data only.

**Test Scenario:** Verify migration endpoints before production data operations.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | Non-admin `POST /api/migrate/backup`. | HTTP 403. | Not run | Not run |
| 2 | Admin `POST /api/migrate/backup`. | HTTP 201; `backupId` and metadata. | Not run | Not run |

---

## Feature: Server-side integrations (libs + startup)

### TC-BE-INT-001 — EmailJS environment parsing

**Title:** `backend/lib/emailjs-env.js`

**Test Case Description:** P1 — Server logs readiness or missing keys without exposing secrets.

**Verify the** Vitest coverage and startup warnings.

**Pre-condition:** None for Vitest.

**Test Scenario:** Verify EmailJS server env handling.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | Run `tests/emailjs-env.test.js` via `npm test`. | All tests Pass. | Full `npm test` 2026-05-13: all tests in this file **Pass** (same run as the single failing preservation test). | Pass |

### TC-BE-INT-002 — Alert SMS ASCII and normalization

**Title:** UniSMS helper behavior

**Test Case Description:** P1 — PH normalization and GSM-safe bodies for alerts.

**Verify the** tests `tests/unisms-send.test.js`, `tests/dispatch-alert-sms-ascii.test.js`.

**Pre-condition:** `npm test`.

**Test Scenario:** Verify SMS integration edge cases.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | Run full test suite or only the two files above. | All Pass. | Full `npm test` 2026-05-13: tests in `unisms-send.test.js` and `dispatch-alert-sms-ascii.test.js` **Pass**. | Pass |

### TC-BE-INT-003 — Mark alert resolved (Firestore)

**Title:** Task 3.3 Firestore update

**Test Case Description:** P1 — Client or server flows that mark alerts resolved persist correctly.

**Verify the** `tests/task-3.3-mark-resolved-firestore.test.js` results.

**Pre-condition:** `npm test`.

**Test Scenario:** Verify resolved state matches product rules.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | Run `npm test`; ensure task-3.3 test file passes. | Pass. | Full `npm test` 2026-05-13: `tests/task-3.3-mark-resolved-firestore.test.js` **Pass**. | Pass |

---

## Feature: Operational scripts (staging)

### TC-BE-OPS-001 — Preset seeding and cleanup scripts

**Title:** `backend/scripts/*`

**Test Case Description:** P2 — Idempotent preset seed and maintenance scripts.

**Verify the** scripts run without error against staging credentials.

**Pre-condition:** Firebase Admin credentials with rights to Firestore/RTDB as required by each script.

**Test Scenario:** Verify operational tooling for data hygiene.

| Step No. | Step Details | Expected Result | Actual Result | Status |
|----------|--------------|-----------------|---------------|--------|
| 1 | Start server or run `seed-presets.js` per project docs; observe logs. | `checkAndSeedPresets` completes; no duplicate corruption. | Not run | Not run |
| 2 | Run `cleanup-duplicate-presets.js` / `cleanup-rtdb-history.js` on copies of data only. | Intended cleanup per script. | Not run | Not run |

---

## Appendix — Vitest files (traceability)

| Area | Test files |
|------|------------|
| Alert dispatch / cooldown / validation / SMS ASCII | `tests/dispatch-alert-*.test.js`, `tests/alerts-not-saving-or-sending*.test.js` |
| Notifications parameters | `tests/notifications*.test.js` |
| UniSMS | `tests/unisms-send.test.js` |
| EmailJS env | `tests/emailjs-env.test.js` |
| Mark resolved | `tests/task-3.3-mark-resolved-firestore.test.js` |
| Feeding / history / RTDB / UI (not backend-only) | `tests/feeding*.test.js`, `tests/historical-data*.test.js`, `tests/realtime-db-persistent-storage*.test.js`, `tests/utils-history-rtdb-preservation*.test.js`, `tests/updateNavigatorUI.test.js`, `tests/configuration-ui-cleanup*.test.js` |

---

## Document control

| Version | Date | Notes |
|---------|------|-------|
| 2.0 | 2026-05-13 | Backend-only cases; step-table format; execution summary and Pass/Fail/Not run from Vitest run and file-level mapping. |
