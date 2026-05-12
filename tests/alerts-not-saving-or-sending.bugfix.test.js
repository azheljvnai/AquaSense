// tests/alerts-not-saving-or-sending.bugfix.test.js
// Bugfix: alerts-not-saving-or-sending — Bug Condition Exploration Test
// This test MUST FAIL on unfixed code - failure confirms the bug exists
// DO NOT attempt to fix the test or the code when it fails
// This test encodes the expected behavior - it will validate the fix when it passes

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';

// ─── Mock ES module dependencies ─────────────────────────────────────────────

const { mockFirestoreOps, mockNotificationOps } = vi.hoisted(() => ({
  mockFirestoreOps: {
    addDocCalls: [],
    updateDocCalls: [],
    getDocsCalls: [],
  },
  mockNotificationOps: {
    handleAlertCalls: [],
    sendEmailCalls: [],
    sendSmsCalls: [],
  },
}));

vi.mock('../public/js/features/notifications.js', async () => {
  const mod = await vi.importActual('../public/js/features/notifications.js');
  return {
    ...mod,
    handleAlert: vi.fn(async (alert) => {
      mockNotificationOps.handleAlertCalls.push(alert);
      return mod.handleAlert(alert);
    }),
  };
});

// Mock Firebase client
vi.mock('../public/js/firebase-client.js', () => ({
  fbAuth: vi.fn(() => ({ currentUser: { uid: 'test-user-1' } })),
  fbFirestore: vi.fn(() => ({})),
  fbCollection: vi.fn((db, collectionName) => ({ _collection: collectionName })),
  fbAddDoc: vi.fn((collection, data) => {
    mockFirestoreOps.addDocCalls.push({ collection: collection._collection, data });
    return Promise.resolve({ id: `mock-${Date.now()}` });
  }),
  fbUpdateDoc: vi.fn((docRef, data) => {
    mockFirestoreOps.updateDocCalls.push({ docRef, data });
    return Promise.resolve();
  }),
  fbDoc: vi.fn((db, ...path) => ({ _path: path.join('/') })),
  fbGetDoc: vi.fn(() => Promise.resolve({ exists: () => false, data: () => ({}) })),
  fbSetDoc: vi.fn(() => Promise.resolve()),
  fbGetDocs: vi.fn((query) => {
    mockFirestoreOps.getDocsCalls.push({ query });
    // Return empty array of alerts (simulating no existing alerts in Firestore)
    return Promise.resolve({ 
      forEach: (callback) => {
        // No documents to iterate over
      },
      docs: [] 
    });
  }),
  fbQuery: vi.fn((collection, ...conditions) => ({ _collection: collection._collection, _conditions: conditions })),
  fbWhere: vi.fn((field, op, value) => ({ field, op, value })),
  fbOrderBy: vi.fn((field, direction) => ({ field, direction })),
  fbLimit: vi.fn((n) => ({ _limit: n })),
  fbServerTimestamp: vi.fn(() => ({ _serverTimestamp: true })),
  fbGetIdToken: vi.fn(() => Promise.resolve('mock-token')),
  fbOnSnapshot: vi.fn(() => () => {}),
}));

// Mock pond-config.js
vi.mock('../public/js/pond-config.js', () => ({
  getBadgeForSpecies: vi.fn((key, val) => {
    // Simulate threshold violations for test cases
    if (key === 'ph' && val > 8.5) return { c: 'danger', l: 'Critical' };
    if (key === 'do' && val < 5) return { c: 'danger', l: 'Critical' };
    if (key === 'temp' && val > 32) return { c: 'danger', l: 'Critical' };
    if (key === 'turb' && val > 50) return { c: 'danger', l: 'Critical' };
    return { c: 'ok', l: 'Normal' };
  }),
  getActiveThresholds: vi.fn(() => ({
    ph: { optimalMin: 6.5, optimalMax: 8.5 },
    do: { optimalMin: 5 },
    turb: { optimalMax: 50 },
    temp: { optimalMin: 25, optimalMax: 32 },
  })),
  getActiveSpecies: vi.fn(() => 'tilapia'),
  getActivePondId: vi.fn(() => 'test-pond-001'),
}));

// Mock pond-context.js
vi.mock('../public/js/pond-context.js', () => ({
  getActivePond: vi.fn(() => ({ id: 'test-pond-001', name: 'Test Pond' })),
}));

// ─── Bug Condition Exploration Test ──────────────────────────────────────────
// Property 1: Bug Condition - Alerts Not Persisted and Notifications Not Sent
//
// **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**
//
// For any sensor reading where the bug condition holds (threshold violation creates an alert),
// the fixed system SHALL persist the alert to the Firestore `alerts` collection with all
// required fields (id, ts, key, val, severity, badge, label, description, pond, resolved, createdAt)
// and SHALL send notifications to all active users who have enabled the corresponding
// notification channels (email/SMS).
//
// EXPECTED OUTCOME ON UNFIXED CODE: Tests FAIL
// - Alert is created in localStorage (this works)
// - Alert is NOT persisted to Firestore alerts collection (this IS the bug)
// - handleAlert() is called (this works)
// - No notifications are sent to active users (this IS the bug)
//
// EXPECTED OUTCOME ON FIXED CODE: Tests PASS
// - Alert is created in localStorage
// - Alert IS persisted to Firestore alerts collection
// - handleAlert() is called
// - Notifications ARE sent to all active users with enabled channels

describe('Alerts Not Saving or Sending — Bug Condition Exploration', () => {
  let dom;
  let window;
  let document;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockFirestoreOps.addDocCalls = [];
    mockFirestoreOps.updateDocCalls = [];
    mockFirestoreOps.getDocsCalls = [];
    mockNotificationOps.handleAlertCalls = [];
    mockNotificationOps.sendEmailCalls = [];
    mockNotificationOps.sendSmsCalls = [];

    // Load the real HTML
    const html = readFileSync('public/index.html', 'utf-8');
    dom = new JSDOM(html, {
      runScripts: 'dangerously',
      resources: 'usable',
      url: 'http://localhost',
    });
    window = dom.window;
    document = dom.window.document;

    // Setup localStorage mock (JSDOM's localStorage is read-only, so we mock on globalThis)
    const localStorageMock = (() => {
      let store = {};
      return {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; },
        clear: () => { store = {}; },
      };
    })();

    if (typeof window.navigator !== 'undefined') {
      try {
        Object.defineProperty(window.navigator, 'onLine', {
          value: true,
          writable: true,
          configurable: true,
        });
      } catch { /* ignore */ }
    }
    vi.stubGlobal('navigator', { onLine: true });

    const fetchMock = vi.fn((url, init) => {
      const u = String(url || '');
      if (u.includes('/api/notifications/dispatch-alert')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              ok: true,
              processed: 1,
              smsSent: 0,
              emailSent: 0,
              skipped: 0,
              errors: [],
            }),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    window.fetch = fetchMock;

    // Stub requestAnimationFrame
    window.requestAnimationFrame = vi.fn(cb => cb());

    // Stub window.dispatchEvent to prevent Event constructor issues in JSDOM
    const originalDispatchEvent = window.dispatchEvent.bind(window);
    window.dispatchEvent = vi.fn((event) => {
      // Allow our test events through
      if (event && event.type === 'sensor-data-updated') {
        return originalDispatchEvent(event);
      }
      // Stub other events (like 'alerts-updated') to prevent JSDOM Event constructor errors
      return true;
    });

    // Set global document and window for the module
    globalThis.document = document;
    globalThis.window = window;
    globalThis.localStorage = localStorageMock;
  });

  afterEach(() => {
    if (dom) {
      dom.window.close();
    }
    vi.unstubAllGlobals();
    // Restore globals
    globalThis.document = undefined;
    globalThis.window = undefined;
    globalThis.localStorage = undefined;
  });

  /**
   * Property 1 — Test 1: Alert should be persisted to Firestore alerts collection
   *
   * isBugCondition: alertCreated(sensorReading) AND NOT alertPersistedToFirestore(sensorReading)
   *
   * On UNFIXED code: fbAddDoc NOT called with alerts collection → FAILS
   * On FIXED code:   fbAddDoc IS called with alerts collection → PASSES
   */
  it('Test 1: Alert should be persisted to Firestore alerts collection when threshold is exceeded', async () => {
    const { fbAddDoc } = await import('../public/js/firebase-client.js');
    const { init } = await import('../public/js/features/alerts.js');

    // Initialize alerts module
    init();

    // Allow async operations to complete
    await new Promise(r => setTimeout(r, 50));

    // Simulate sensor reading that exceeds threshold (pH 9.5 for Tilapia)
    const sensorData = { ph: 9.5, doV: 6.0, turb: 30, temp: 28 };
    const event = new window.CustomEvent('sensor-data-updated', { detail: sensorData });
    window.dispatchEvent(event);

    // Allow alert creation and Firestore write to complete
    await new Promise(r => setTimeout(r, 100));

    // On UNFIXED code: fbAddDoc is NOT called with alerts collection → FAILS
    // On FIXED code:   fbAddDoc IS called with alerts collection → PASSES
    const alertsCollectionCalls = mockFirestoreOps.addDocCalls.filter(
      call => call.collection === 'alerts'
    );

    expect(alertsCollectionCalls.length).toBeGreaterThan(0);

    // Verify the alert data structure
    const alertData = alertsCollectionCalls[0].data;
    expect(alertData).toMatchObject({
      id: expect.any(String),
      ts: expect.any(Number),
      key: 'ph',
      val: 9.5,
      severity: 'critical',
      badge: 'danger',
      label: expect.stringContaining('pH'),
      description: expect.stringContaining('9.5'),
      pond: 'Test Pond',
      resolved: false,
      createdAt: expect.objectContaining({ _serverTimestamp: true }),
    });
  });

  /**
   * Property 1 — Test 2: Alert should exist in localStorage (baseline behavior)
   *
   * This test verifies that the existing localStorage behavior works correctly.
   * This should pass on both unfixed and fixed code.
   */
  it('Test 2: Alert should be stored in localStorage when threshold is exceeded', async () => {
    const { init } = await import('../public/js/features/alerts.js');

    // Initialize alerts module
    init();

    // Allow async operations to complete
    await new Promise(r => setTimeout(r, 50));

    // Simulate sensor reading that exceeds threshold (pH 9.5 for Tilapia)
    const sensorData = { ph: 9.5, doV: 6.0, turb: 30, temp: 28 };
    const event = new window.CustomEvent('sensor-data-updated', { detail: sensorData });
    window.dispatchEvent(event);

    // Allow alert creation to complete
    await new Promise(r => setTimeout(r, 100));

    // Verify alert is in localStorage
    const storedAlerts = JSON.parse(localStorage.getItem('aquasense.alerts.v1') || '[]');
    expect(storedAlerts.length).toBeGreaterThan(0);

    const phAlert = storedAlerts.find(a => a.key === 'ph');
    expect(phAlert).toBeDefined();
    expect(phAlert).toMatchObject({
      key: 'ph',
      val: 9.5,
      severity: 'critical',
      badge: 'danger',
      pond: 'Test Pond',
      resolved: false,
    });
  });

  /**
   * Property 1 — Test 3: handleAlert() should be called when alert is created
   *
   * This test verifies that handleAlert() is invoked (baseline behavior).
   * This should pass on both unfixed and fixed code.
   */
  it('Test 3: handleAlert() should be called when alert is created', async () => {
    const { handleAlert } = await import('../public/js/features/notifications.js');
    const { init } = await import('../public/js/features/alerts.js');

    // Initialize alerts module
    init();

    // Allow async operations to complete
    await new Promise(r => setTimeout(r, 50));

    // Simulate sensor reading that exceeds threshold (pH 9.5 for Tilapia)
    const sensorData = { ph: 9.5, doV: 6.0, turb: 30, temp: 28 };
    const event = new window.CustomEvent('sensor-data-updated', { detail: sensorData });
    window.dispatchEvent(event);

    // Allow alert creation and notification dispatch to complete
    await new Promise(r => setTimeout(r, 100));

    // Verify handleAlert was called
    expect(handleAlert).toHaveBeenCalled();
    expect(mockNotificationOps.handleAlertCalls.length).toBeGreaterThan(0);

    const alertArg = mockNotificationOps.handleAlertCalls[0];
    expect(alertArg).toMatchObject({
      key: 'ph',
      val: 9.5,
      severity: 'critical',
      pond: 'Test Pond',
    });
  });

  /**
   * Property 1 — Test 4: Notifications should be sent to active users
   *
   * Fan-out runs on the server; the client SHALL POST /api/notifications/dispatch-alert.
   */
  it('Test 4: Notifications should be sent to active users when alert is created', async () => {
    const { init } = await import('../public/js/features/alerts.js');

    // Initialize alerts module
    init();

    // Allow async operations to complete
    await new Promise(r => setTimeout(r, 50));

    // Simulate sensor reading that exceeds threshold (pH 9.5 for Tilapia)
    const sensorData = { ph: 9.5, doV: 6.0, turb: 30, temp: 28 };
    const event = new window.CustomEvent('sensor-data-updated', { detail: sensorData });
    window.dispatchEvent(event);

    // Allow alert creation and notification dispatch to complete
    await new Promise(r => setTimeout(r, 150));

    const dispatchCalls = globalThis.fetch.mock.calls.filter((c) =>
      String(c[0]).includes('/api/notifications/dispatch-alert')
    );
    expect(dispatchCalls.length).toBeGreaterThan(0);
    expect(dispatchCalls[0][1]?.method).toBe('POST');
    const body = JSON.parse(dispatchCalls[0][1]?.body || '{}');
    expect(body.alert).toMatchObject({
      key: 'ph',
      val: 9.5,
      severity: 'critical',
      pond: 'Test Pond',
    });
  });

  /**
   * Property 1 — Test 5: Multiple alerts should be persisted for multiple threshold violations
   *
   * isBugCondition: Multiple alerts created AND NOT all persisted to Firestore
   *
   * On UNFIXED code: fbAddDoc called 0 times (no Firestore persistence) → FAILS
   * On FIXED code:   fbAddDoc called 3 times (pH, temp, DO all persisted) → PASSES
   */
  it('Test 5: Multiple alerts should be persisted when multiple thresholds are exceeded', async () => {
    const { init } = await import('../public/js/features/alerts.js');

    // Initialize alerts module
    init();

    // Allow async operations to complete
    await new Promise(r => setTimeout(r, 50));

    // Simulate sensor reading with multiple threshold violations
    const sensorData = { ph: 9.5, doV: 3.0, turb: 30, temp: 35 };
    const event = new window.CustomEvent('sensor-data-updated', { detail: sensorData });
    window.dispatchEvent(event);

    // Allow alert creation and Firestore writes to complete
    await new Promise(r => setTimeout(r, 150));

    // On UNFIXED code: fbAddDoc called 0 times → FAILS
    // On FIXED code:   fbAddDoc called 3 times (pH, DO, temp) → PASSES
    const alertsCollectionCalls = mockFirestoreOps.addDocCalls.filter(
      call => call.collection === 'alerts'
    );

    expect(alertsCollectionCalls.length).toBe(3);

    // Verify all three alerts are persisted
    const alertKeys = alertsCollectionCalls.map(call => call.data.key);
    expect(alertKeys).toContain('ph');
    expect(alertKeys).toContain('do');
    expect(alertKeys).toContain('temp');
  });

  /**
   * Property 1 — Test 6: Alert should use correct pond name for both legacy and new setup
   *
   * isBugCondition: Alert created with incorrect pond name
   *
   * This test verifies that alerts use the correct pond identifier from getActivePond().name
   * (legacy setup) or getActiveSpecies() (new setup).
   */
  it('Test 6: Alert should use correct pond name from active pond context', async () => {
    const { init } = await import('../public/js/features/alerts.js');

    // Initialize alerts module
    init();

    // Allow async operations to complete
    await new Promise(r => setTimeout(r, 50));

    // Simulate sensor reading that exceeds threshold
    const sensorData = { ph: 9.5, doV: 6.0, turb: 30, temp: 28 };
    const event = new window.CustomEvent('sensor-data-updated', { detail: sensorData });
    window.dispatchEvent(event);

    // Allow alert creation to complete
    await new Promise(r => setTimeout(r, 100));

    // Verify alert uses correct pond name
    const alertsCollectionCalls = mockFirestoreOps.addDocCalls.filter(
      call => call.collection === 'alerts'
    );

    if (alertsCollectionCalls.length > 0) {
      const alertData = alertsCollectionCalls[0].data;
      expect(alertData.pond).toBe('Test Pond');
    }

    // Also verify localStorage alert
    const storedAlerts = JSON.parse(localStorage.getItem('aquasense.alerts.v1') || '[]');
    const phAlert = storedAlerts.find(a => a.key === 'ph');
    expect(phAlert?.pond).toBe('Test Pond');
  });

  /**
   * Property 1 — Test 7: Cooldown should be enforced per user per sensor parameter
   *
   * This test verifies that the cooldown mechanism prevents duplicate notifications
   * within the cooldown window for the same parameter and severity.
   */
  it('Test 7: Cooldown should prevent duplicate alerts within cooldown window', async () => {
    const { init } = await import('../public/js/features/alerts.js');

    // Initialize alerts module
    init();

    // Allow async operations to complete
    await new Promise(r => setTimeout(r, 50));

    // Simulate first sensor reading that exceeds threshold
    const sensorData1 = { ph: 9.5, doV: 6.0, turb: 30, temp: 28 };
    const event1 = new window.CustomEvent('sensor-data-updated', { detail: sensorData1 });
    window.dispatchEvent(event1);

    // Allow alert creation to complete
    await new Promise(r => setTimeout(r, 100));

    // Clear mock calls
    mockFirestoreOps.addDocCalls = [];
    mockNotificationOps.handleAlertCalls = [];

    // Simulate second sensor reading with same threshold violation (within cooldown)
    const sensorData2 = { ph: 9.6, doV: 6.0, turb: 30, temp: 28 };
    const event2 = new window.CustomEvent('sensor-data-updated', { detail: sensorData2 });
    window.dispatchEvent(event2);

    // Allow processing to complete
    await new Promise(r => setTimeout(r, 100));

    // Verify no new alert was created (cooldown suppressed it)
    const alertsCollectionCalls = mockFirestoreOps.addDocCalls.filter(
      call => call.collection === 'alerts'
    );
    expect(alertsCollectionCalls.length).toBe(0);

    // Verify handleAlert was not called again
    expect(mockNotificationOps.handleAlertCalls.length).toBe(0);
  });
});
