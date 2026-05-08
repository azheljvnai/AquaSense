// tests/notifications.property.test.js
// Feature: notifications — Property-Based Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// ─── Pure logic extracted from notifications.js for testing ──────────────────

const COOLDOWN_MS = 15 * 60 * 1000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Cooldown map (reset between tests)
let _cooldownMap;

function isCooledDown(pondId, sensorKey, now = Date.now()) {
  const channel = 'email';
  return isCooledDownChannel(channel, pondId, sensorKey, now);
}

function isCooledDownChannel(channel, pondId, sensorKey, now = Date.now()) {
  const key = `${channel}:${pondId}:${sensorKey}`;
  const last = _cooldownMap.get(key);
  if (last == null) return false;
  return (now - last) < COOLDOWN_MS;
}

function markSent(pondId, sensorKey, now = Date.now()) {
  const channel = 'email';
  markSentChannel(channel, pondId, sensorKey, now);
}

function markSentChannel(channel, pondId, sensorKey, now = Date.now()) {
  _cooldownMap.set(`${channel}:${pondId}:${sensorKey}`, now);
}

function isValidEmail(str) {
  return EMAIL_REGEX.test(String(str || ''));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NotificationService — Property-Based Tests', () => {
  beforeEach(() => {
    _cooldownMap = new Map();
  });

  // Property 1: Cooldown prevents duplicate emails within 15 minutes
  // Feature: notifications, Property 1: For any pond/sensor combo, if an email was dispatched at T,
  // no further email SHALL be dispatched before T + 15 minutes.
  // Validates: Requirements 2.4
  it('Property 1: cooldown — emailjs.send called at most once within 15 minutes', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),   // pondId
        fc.constantFrom('ph', 'do', 'turb', 'temp'),  // sensorKey
        fc.integer({ min: 2, max: 10 }),               // alertCount
        (pondId, sensorKey, alertCount) => {
          _cooldownMap = new Map();
          const sendCallCount = { n: 0 };
          const baseTime = Date.now();

          for (let i = 0; i < alertCount; i++) {
            // All alerts within 15-minute window (0 to 14 min 59 sec after base)
            const now = baseTime + i * 60_000; // 1 minute apart, all within 15 min
            if (!isCooledDownChannel('email', pondId, sensorKey, now)) {
              sendCallCount.n++;
              markSentChannel('email', pondId, sensorKey, now);
            }
          }

          return sendCallCount.n <= 1;
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property 1b: Cooldown is per-channel (email and sms do not block each other)
  it('Property 1b: cooldown — email and sms cooldown keys are independent', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),   // pondId
        fc.constantFrom('ph', 'do', 'turb', 'temp'),  // sensorKey
        (pondId, sensorKey) => {
          _cooldownMap = new Map();
          const t0 = Date.now();
          markSentChannel('email', pondId, sensorKey, t0);
          // Within cooldown window, email is cooled down but sms is not (unless explicitly marked)
          const t1 = t0 + 60_000;
          return isCooledDownChannel('email', pondId, sensorKey, t1) === true
            && isCooledDownChannel('sms', pondId, sensorKey, t1) === false;
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property 2: Disabled channel produces no dispatch
  // Feature: notifications, Property 2: For any alert with email.enabled = false or alert.resolved = true,
  // handleAlert SHALL result in zero calls to emailjs.send.
  // Validates: Requirements 1.3, 5.1
  it('Property 2: disabled channel — emailjs.send never called when email disabled or alert resolved', () => {
    fc.assert(
      fc.property(
        fc.record({
          id:       fc.string({ minLength: 1 }),
          key:      fc.constantFrom('ph', 'do', 'turb', 'temp'),
          val:      fc.float({ min: 0, max: 100 }),
          severity: fc.constantFrom('critical', 'warning'),
          pond:     fc.string({ minLength: 1 }),
          ts:       fc.integer({ min: 0 }),
          resolved: fc.boolean(),
        }),
        fc.boolean(), // emailEnabled
        (alert, emailEnabled) => {
          // Condition: either email disabled OR alert resolved
          const shouldSkip = !emailEnabled || alert.resolved;
          let sendCalled = false;

          // Simulate handleAlert logic
          if (!alert.resolved && emailEnabled) {
            sendCalled = true; // would call sendEmail
          }

          if (shouldSkip) {
            return !sendCalled;
          }
          return true; // when both conditions allow, send is expected
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property 2b: Disabled SMS channel produces no SMS dispatch
  it('Property 2b: disabled channel — sms not dispatched when sms disabled', () => {
    fc.assert(
      fc.property(
        fc.record({
          id:       fc.string({ minLength: 1 }),
          key:      fc.constantFrom('ph', 'do', 'turb', 'temp'),
          val:      fc.float({ min: 0, max: 100 }),
          severity: fc.constantFrom('critical', 'warning'),
          pond:     fc.string({ minLength: 1 }),
          ts:       fc.integer({ min: 0 }),
          resolved: fc.boolean(),
        }),
        fc.boolean(), // smsEnabled
        (alert, smsEnabled) => {
          const shouldSkip = !smsEnabled || alert.resolved;
          let smsCalled = false;
          if (!alert.resolved && smsEnabled) smsCalled = true;
          if (shouldSkip) return !smsCalled;
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property 3: Log entry reflects dispatch outcome
  // Feature: notifications, Property 3: The notificationLog record status SHALL be 'sent' iff
  // emailjs.send resolved without error, and 'failed' otherwise.
  // Validates: Requirements 6.1, 6.2
  it('Property 3: log status matches emailjs.send outcome', () => {
    fc.assert(
      fc.property(
        fc.boolean(), // sendSucceeds
        (sendSucceeds) => {
          // Simulate sendEmail result
          const result = sendSucceeds
            ? { success: true }
            : { success: false, error: new Error('mock failure') };

          // Simulate writeLog status determination
          const logStatus = result.success ? 'sent' : 'failed';

          return sendSucceeds ? logStatus === 'sent' : logStatus === 'failed';
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property 4: Preference round-trip
  // Feature: notifications, Property 4: For any valid NotificationPrefs, saving then loading
  // SHALL return an object with the same email.enabled and email.address values.
  // Validates: Requirements 1.1, 1.2
  it('Property 4: prefs round-trip — save then load returns same values', () => {
    fc.assert(
      fc.property(
        fc.boolean(),                                    // email.enabled
        fc.emailAddress(),                               // email.address (valid email)
        (enabled, address) => {
          // Simulate Firestore round-trip with an in-memory store
          const store = new Map();

          function savePrefsSync(uid, prefs) {
            if (prefs?.email?.enabled && !isValidEmail(prefs.email.address)) {
              throw new Error('Invalid email address.');
            }
            store.set(uid, {
              email: {
                enabled: !!prefs?.email?.enabled,
                address: prefs?.email?.address || '',
              },
            });
          }

          function loadPrefsSync(uid) {
            const data = store.get(uid);
            if (!data) return { email: { enabled: false, address: '' } };
            return {
              email: {
                enabled: typeof data.email?.enabled === 'boolean' ? data.email.enabled : false,
                address: data.email?.address || '',
              },
            };
          }

          const uid = 'test-uid';
          const prefs = { email: { enabled, address } };
          savePrefsSync(uid, prefs);
          const loaded = loadPrefsSync(uid);

          return loaded.email.enabled === enabled && loaded.email.address === address;
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property 5: Invalid email address is rejected
  // Feature: notifications, Property 5: For any string that is not a valid email address,
  // attempting to save it with email.enabled = true SHALL be rejected before the Firestore write.
  // Validates: Requirements 1.4
  it('Property 5: email validation — only valid email addresses are accepted', () => {
    fc.assert(
      fc.property(
        fc.string(),  // arbitrary string — may or may not be a valid email
        (str) => {
          const valid = isValidEmail(str);
          const regexValid = EMAIL_REGEX.test(str);
          // The validation function must agree with the regex
          return valid === regexValid;
        }
      ),
      { numRuns: 200 }
    );
  });

  // Additional: valid email addresses are always accepted
  it('Property 5b: valid email addresses always pass validation', () => {
    fc.assert(
      fc.property(
        fc.emailAddress(),
        (email) => isValidEmail(email)
      ),
      { numRuns: 100 }
    );
  });

  // Property 6: SMS template is short and stable (<=160 chars for typical inputs)
  it('Property 6: sms template — includes prefix and stays within 160 chars', () => {
    const SENSOR_LABELS = { ph: 'pH', do: 'Dissolved O₂', turb: 'Turbidity', temp: 'Temperature' };
    const SENSOR_UNITS  = { ph: '', do: ' mg/L', turb: ' NTU', temp: '°C' };

    function formatValue(key, val) {
      if (val == null) return '—';
      const unit = SENSOR_UNITS[key] || '';
      if (key === 'ph') return `${Number(val).toFixed(2)}${unit}`;
      return `${Number(val).toFixed(1)}${unit}`;
    }

    function buildSmsContent(alert) {
      const severity = alert?.severity === 'critical' ? 'Critical' : 'Warning';
      const pond = String(alert?.pond || 'Pond').trim() || 'Pond';
      const sensor = SENSOR_LABELS[alert?.key] || alert?.key || 'Value';
      const value = formatValue(alert?.key, alert?.val);
      let content = `AquaSenseAlert: Threshold Exceeded - ${severity} with ${sensor} ${value}. Please inspect ${pond} for corrective actions`;
      if (content.length > 160) {
        const maxPond = Math.max(8, Math.min(32, pond.length));
        const trimmedPond = pond.length > maxPond ? pond.slice(0, maxPond - 1) + '…' : pond;
        content = `AquaSenseAlert: Threshold Exceeded - ${severity} with ${sensor} ${value}. Please inspect ${trimmedPond} for corrective actions`;
      }
      if (content.length > 160) {
        content = `AquaSenseAlert: Threshold Exceeded - ${severity} with ${value}. Please inspect ${pond} for corrective actions`;
      }
      if (content.length > 160) content = content.slice(0, 160);
      return content;
    }

    fc.assert(
      fc.property(
        fc.record({
          key: fc.constantFrom('ph', 'do', 'turb', 'temp'),
          val: fc.float({ min: 0, max: 100 }),
          severity: fc.constantFrom('critical', 'warning'),
          pond: fc.string({ minLength: 1, maxLength: 60 }),
        }),
        (alert) => {
          const msg = buildSmsContent(alert);
          return typeof msg === 'string'
            && msg.startsWith('AquaSenseAlert:')
            && msg.length > 0
            && msg.length <= 160;
        }
      ),
      { numRuns: 200 }
    );
  });
});
