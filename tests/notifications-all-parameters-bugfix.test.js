// tests/notifications-all-parameters-bugfix.test.js
// Bug Condition Exploration Test
// CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists
// DO NOT attempt to fix the test or the code when it fails
// NOTE: This test encodes the expected behavior - it will validate the fix when it passes after implementation

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Notification Alerts All Parameters - Bug Condition Exploration', () => {
  let mockFirestore;
  let mockEmailjs;
  let mockBackendSms;
  let handleAlert;
  let _currentUser;
  let _cooldownMap;

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();
    _cooldownMap = new Map();
    _currentUser = null;

    // Mock Firestore
    mockFirestore = {
      collection: vi.fn(),
      doc: vi.fn(),
      getDoc: vi.fn(),
      getDocs: vi.fn(),
      setDoc: vi.fn(),
      query: vi.fn(),
      where: vi.fn(),
    };

    // Mock emailjs
    mockEmailjs = {
      send: vi.fn().mockResolvedValue({ status: 200, text: 'OK' }),
    };

    // Mock backend SMS
    mockBackendSms = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });

    // Mock global fetch for SMS
    global.fetch = mockBackendSms;
    global.emailjs = mockEmailjs;

    // Import handleAlert function (this would need to be exported from notifications.js)
    // For now, we'll simulate the buggy behavior
    handleAlert = createBuggyHandleAlert();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Simulate the BUGGY handleAlert function (current behavior)
  function createBuggyHandleAlert() {
    return async function handleAlert(alert) {
      if (alert.resolved) return;

      // BUG: Only processes _currentUser (logged-in user)
      if (!_currentUser?.uid) return;
      const uid = _currentUser.uid;

      // Load preferences for logged-in user only
      const prefs = await loadPrefs(uid);
      const channels = [];
      if (prefs.email.enabled) channels.push('email');
      if (prefs.sms.enabled) channels.push('sms');
      if (channels.length === 0) return;

      const pondId = alert.pond || 'default';
      const sensorKey = alert.key;

      // Dispatch each enabled channel
      for (const channel of channels) {
        if (isCooledDown(channel, pondId, sensorKey)) continue;
        markSent(channel, pondId, sensorKey);

        if (channel === 'email') {
          await sendEmail(prefs, alert);
        } else if (channel === 'sms') {
          // BUG: SMS only sent for pH parameter
          if (alert.key === 'ph') {
            await sendSms(uid, alert);
          }
        }
      }
    };
  }

  async function loadPrefs(uid) {
    // Mock preference loading
    return {
      email: { enabled: true, address: `user${uid}@example.com` },
      sms: { enabled: true, phone: '+1234567890' },
    };
  }

  function isCooledDown(channel, pondId, sensorKey) {
    const key = `${channel}:${pondId}:${sensorKey}`;
    const last = _cooldownMap.get(key);
    if (last == null) return false;
    return (Date.now() - last) < (15 * 60 * 1000);
  }

  function markSent(channel, pondId, sensorKey) {
    _cooldownMap.set(`${channel}:${pondId}:${sensorKey}`, Date.now());
  }

  async function sendEmail(prefs, alert) {
    await mockEmailjs.send('service_id', 'template_id', {
      to_email: prefs.email.address,
      alert_type: alert.key,
      alert_value: alert.val,
    });
  }

  async function sendSms(uid, alert) {
    await mockBackendSms('/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, alert }),
    });
  }

  // ─── Bug Condition Tests ──────────────────────────────────────────────────

  it('Bug Condition 1: DO breach does NOT send SMS alerts to all active users', async () => {
    // Setup: 3 active users with notifications enabled
    const activeUsers = [
      { uid: 'user1', status: 'active' },
      { uid: 'user2', status: 'active' },
      { uid: 'user3', status: 'active' },
    ];

    // Only user1 is logged in
    _currentUser = { uid: 'user1' };

    // Simulate DO breach
    const alert = {
      id: 'alert1',
      key: 'do',
      val: 3.5,
      severity: 'critical',
      pond: 'Pond A',
      ts: Date.now(),
      resolved: false,
    };

    await handleAlert(alert);

    // EXPECTED BEHAVIOR (will fail on unfixed code):
    // All 3 active users should receive SMS alerts
    // ACTUAL BEHAVIOR (buggy code):
    // Only logged-in user receives email, NO SMS sent (because SMS only works for pH)

    // This assertion will FAIL on unfixed code
    expect(mockBackendSms).toHaveBeenCalledTimes(3); // Should be called for all 3 users
    expect(mockEmailjs.send).toHaveBeenCalledTimes(3); // Should be called for all 3 users
  });

  it('Bug Condition 2: Temperature breach does NOT send SMS alerts to all active users', async () => {
    const activeUsers = [
      { uid: 'user1', status: 'active' },
      { uid: 'user2', status: 'active' },
      { uid: 'user3', status: 'active' },
    ];

    _currentUser = { uid: 'user1' };

    const alert = {
      id: 'alert2',
      key: 'temp',
      val: 32,
      severity: 'warning',
      pond: 'Pond B',
      ts: Date.now(),
      resolved: false,
    };

    await handleAlert(alert);

    // This assertion will FAIL on unfixed code
    expect(mockBackendSms).toHaveBeenCalledTimes(3);
    expect(mockEmailjs.send).toHaveBeenCalledTimes(3);
  });

  it('Bug Condition 3: Turbidity breach does NOT send SMS alerts to all active users', async () => {
    const activeUsers = [
      { uid: 'user1', status: 'active' },
      { uid: 'user2', status: 'active' },
      { uid: 'user3', status: 'active' },
    ];

    _currentUser = { uid: 'user1' };

    const alert = {
      id: 'alert3',
      key: 'turb',
      val: 45,
      severity: 'critical',
      pond: 'Pond C',
      ts: Date.now(),
      resolved: false,
    };

    await handleAlert(alert);

    // This assertion will FAIL on unfixed code
    expect(mockBackendSms).toHaveBeenCalledTimes(3);
    expect(mockEmailjs.send).toHaveBeenCalledTimes(3);
  });

  it('Bug Condition 4: pH breach only notifies logged-in user, not all active users', async () => {
    const activeUsers = [
      { uid: 'user1', status: 'active' },
      { uid: 'user2', status: 'active' },
      { uid: 'user3', status: 'active' },
    ];

    _currentUser = { uid: 'user1' };

    const alert = {
      id: 'alert4',
      key: 'ph',
      val: 6.2,
      severity: 'warning',
      pond: 'Pond D',
      ts: Date.now(),
      resolved: false,
    };

    await handleAlert(alert);

    // EXPECTED BEHAVIOR: All 3 active users should receive both email and SMS
    // ACTUAL BEHAVIOR: Only logged-in user (user1) receives notifications

    // This assertion will FAIL on unfixed code
    expect(mockBackendSms).toHaveBeenCalledTimes(3); // Should be called for all 3 users
    expect(mockEmailjs.send).toHaveBeenCalledTimes(3); // Should be called for all 3 users
  });

  it('Bug Condition 5: No notifications sent when no user is logged in', async () => {
    const activeUsers = [
      { uid: 'user1', status: 'active' },
      { uid: 'user2', status: 'active' },
    ];

    // No user logged in
    _currentUser = null;

    const alert = {
      id: 'alert5',
      key: 'ph',
      val: 6.0,
      severity: 'critical',
      pond: 'Pond E',
      ts: Date.now(),
      resolved: false,
    };

    await handleAlert(alert);

    // EXPECTED BEHAVIOR: All active users should still receive notifications
    // ACTUAL BEHAVIOR: No notifications sent because no user is logged in

    // This assertion will FAIL on unfixed code
    expect(mockBackendSms).toHaveBeenCalledTimes(2); // Should be called for all 2 active users
    expect(mockEmailjs.send).toHaveBeenCalledTimes(2); // Should be called for all 2 active users
  });

  // ─── Expected Behavior Documentation ──────────────────────────────────────

  it('Expected Behavior: All parameters trigger notifications for all active users', async () => {
    // This test documents what the FIXED code should do
    // It will FAIL on unfixed code and PASS after the fix is implemented

    const activeUsers = [
      { uid: 'user1', status: 'active' },
      { uid: 'user2', status: 'active' },
      { uid: 'user3', status: 'active' },
    ];

    _currentUser = { uid: 'user1' }; // Even with a logged-in user, all active users should be notified

    const parameters = ['ph', 'do', 'temp', 'turb'];

    for (const param of parameters) {
      vi.clearAllMocks();
      _cooldownMap.clear();

      const alert = {
        id: `alert-${param}`,
        key: param,
        val: param === 'ph' ? 6.5 : param === 'do' ? 4.0 : param === 'temp' ? 30 : 40,
        severity: 'warning',
        pond: 'Test Pond',
        ts: Date.now(),
        resolved: false,
      };

      await handleAlert(alert);

      // EXPECTED: All 3 active users receive both email and SMS for ANY parameter
      expect(mockEmailjs.send).toHaveBeenCalledTimes(3);
      expect(mockBackendSms).toHaveBeenCalledTimes(3);
    }
  });
});
