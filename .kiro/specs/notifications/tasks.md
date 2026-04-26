# Tasks — Notifications (Email)

## Task List

- [ ] 1. EmailJS integration setup
  - [x] 1.1 Add EmailJS CDN script tag to `public/index.html` (before the closing `</body>`)
  - [x] 1.2 Expose `EMAILJS_PUBLIC_KEY`, `EMAILJS_SERVICE_ID`, and `EMAILJS_TEMPLATE_ID` via the `/api/config` backend endpoint (read from `.env`)
  - [x] 1.3 Update `public/js/config.js` `getConfig()` to return the three EmailJS values
  - [ ] 1.4 Create the EmailJS email template in the EmailJS dashboard with the variables: `{{to_email}}`, `{{pond_name}}`, `{{parameter}}`, `{{value}}`, `{{severity}}`, `{{threshold}}`, `{{timestamp}}`

- [ ] 2. NotificationService module
  - [x] 2.1 Create `public/js/features/notifications.js` with the exported `init`, `loadPrefs`, `savePrefs`, and `handleAlert` functions
  - [x] 2.2 Implement `loadPrefs(uid)` — reads `users/{uid}/notificationPrefs` from Firestore; returns a default prefs object if the document does not exist
  - [x] 2.3 Implement `savePrefs(uid, prefs)` — validates the email address when `email.enabled` is `true`, then writes to Firestore with `serverTimestamp()`
  - [x] 2.4 Implement the in-memory cooldown guard (`isCooledDown` / `markSent`) using a `Map` keyed by `${pondId}:${sensorKey}` with a 15-minute window
  - [x] 2.5 Implement `sendEmail(prefs, alert)` — calls `emailjs.send(serviceId, templateId, params, publicKey)` and returns `{ success, error }`
  - [x] 2.6 Implement `writeLog(uid, alert, status, errorDetail)` — writes a record to the `notificationLog` Firestore collection
  - [x] 2.7 Implement `handleAlert(alert)` — orchestrates prefs check → cooldown check → resolved check → `sendEmail` → `writeLog` → toast on failure
  - [x] 2.8 Implement the offline retry queue using `sessionStorage` (`enqueueRetry`, `flushRetryQueue`); flush on `window` `online` event; max 3 attempts, 60-second interval

- [ ] 3. Alert pipeline integration
  - [x] 3.1 Import `init as initNotifications` and `handleAlert` from `notifications.js` in `public/js/app.js`
  - [x] 3.2 Call `initNotifications()` inside the `onAuthStateChanged` callback in `app.js`, after the user profile is loaded
  - [x] 3.3 In the `sensor-data-updated` handler in `alerts.js`, call `handleAlert(alert)` for each new alert object produced by `evaluateSensor`

- [ ] 4. Notification preferences UI
  - [x] 4.1 Add a "Email Notifications" settings panel to the Alerts page section in `public/index.html` containing: email toggle checkbox (`id="notif-email-toggle"`), email address input (`id="notif-email-address"`), save button (`id="notif-prefs-save"`), and a configuration warning banner (`id="notif-config-warning"`)
  - [x] 4.2 In `notifications.js` `init()`, populate the UI from `loadPrefs`, wire the save button to `savePrefs`, and pre-populate the email field with the Firebase Auth user's email on first open
  - [x] 4.3 Show the configuration warning banner and disable the email toggle when `EMAILJS_PUBLIC_KEY` is absent from the config

- [ ] 5. Notification log UI
  - [x] 5.1 Add a "Notification Log" collapsible panel to the Alerts page in `public/index.html` with a status filter (`id="notif-log-filter"`) and a list container (`id="notif-log-list"`)
  - [x] 5.2 Implement `renderNotificationLog(uid, statusFilter)` in `notifications.js` — queries the 50 most recent `notificationLog` records for the current user (ordered by `sentAt` descending), filtered by status, and renders them into `#notif-log-list`
  - [x] 5.3 Wire the status filter change event to re-render the log

- [ ] 6. Property-based tests
  - [x] 6.1 Install `fast-check` as a dev dependency (`npm install --save-dev fast-check`)
  - [x] 6.2 Write property test for Property 1 (cooldown): for any `(pondId, sensorKey, alertCount)`, simulate `alertCount` alerts within 15 minutes and assert `emailjs.send` is called at most once
  - [x] 6.3 Write property test for Property 2 (disabled channel): for any alert with `email.enabled = false` or `alert.resolved = true`, assert `emailjs.send` call count is 0
  - [x] 6.4 Write property test for Property 3 (log reflects outcome): for any alert, mock `emailjs.send` to succeed or fail randomly, assert log `status` matches mock outcome
  - [x] 6.5 Write property test for Property 4 (prefs round-trip): for any valid `NotificationPrefs`, save then load and assert field equality (use Firestore emulator or mock)
  - [x] 6.6 Write property test for Property 5 (email validation): for any arbitrary string, assert only strings matching the email regex are accepted by the validation function

- [ ] 7. Firestore rules and indexes
  - [x] 7.1 Update `firestore.rules` to allow authenticated users to read/write their own `users/{uid}/notificationPrefs` document
  - [x] 7.2 Update `firestore.rules` to allow authenticated users to create `notificationLog` records and read their own records (matched by `uid`)
  - [x] 7.3 Add a composite index to `firestore.indexes.json` for `notificationLog` on `(uid ASC, sentAt DESC)` to support the log query
