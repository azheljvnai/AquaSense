import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockState } from './mocks/firebase-admin.js';

vi.mock('../backend/lib/unisms.js', () => ({
  sendUniSms: vi.fn().mockResolvedValue({ ok: true, reference_id: 'sms-ref-1' }),
  normalizePhPhoneToE164: (phone) => {
    const s = String(phone || '').trim();
    if (s.startsWith('+')) return s;
    if (/^09\d{9}$/.test(s)) return `+63${s.slice(1)}`;
    return s;
  },
}));

vi.mock('../backend/lib/emailjs-env.js', () => ({
  getEmailJsServerEnv: () => ({
    configured: true,
    privateKey: 'priv',
    publicKey: 'pub',
    serviceId: 'svc',
    templateId: 'tpl',
    missing: [],
  }),
}));

import {
  dispatchAlertToAllUsers,
  formatAlertEmailTimestamp,
} from '../backend/notifications/dispatch-alert.js';
import { sendUniSms } from '../backend/lib/unisms.js';

const validAlert = {
  id: 'ph-test-1',
  ts: Date.now(),
  key: 'ph',
  val: 9.1,
  severity: 'critical',
  pond: 'Pond A',
  resolved: false,
};

describe('dispatchAlertToAllUsers', () => {
  beforeEach(() => {
    mockState.notificationLogGet = async () => ({ docs: [] });
    mockState.notificationLogAdd = vi.fn().mockResolvedValue({ id: 'log-1' });
    mockState.activeUsersGet = async () => ({
      empty: false,
      docs: [
        {
          id: 'user1',
          data: () => ({
            status: 'active',
            email: 'farmer@example.com',
            phone: '+639171234567',
          }),
        },
      ],
    });
    mockState.prefsGet = async () => ({
      exists: true,
      data: () => ({
        email: { enabled: true, address: 'farmer@example.com' },
        sms: { enabled: true },
      }),
    });
    sendUniSms.mockResolvedValue({ ok: true, reference_id: 'sms-ref-1' });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({}),
    });
  });

  afterEach(() => {
    delete globalThis.fetch;
  });

  it('does not fail with ReferenceError when checking cooldown (pondName/parameter)', async () => {
    const result = await dispatchAlertToAllUsers(validAlert);

    expect(result.ok).toBe(true);
    const messages = (result.errors || []).map((e) => e.message || '');
    expect(messages.some((m) => /pondName is not defined/i.test(m))).toBe(false);
    expect(messages.some((m) => /parameter is not defined/i.test(m))).toBe(false);
  });

  it('sends email and SMS when prefs are enabled and providers succeed', async () => {
    const result = await dispatchAlertToAllUsers(validAlert);

    expect(result.emailSent).toBeGreaterThanOrEqual(1);
    expect(result.smsSent).toBeGreaterThanOrEqual(1);
    expect(globalThis.fetch).toHaveBeenCalled();
    expect(sendUniSms).toHaveBeenCalled();
    expect(mockState.notificationLogAdd).toHaveBeenCalled();
  });

  it('sends email timestamp as Manila wall-clock, not UTC ISO', async () => {
    const ts = Date.UTC(2026, 4, 30, 1, 13, 1, 840);
    await dispatchAlertToAllUsers({ ...validAlert, ts });

    const emailCall = globalThis.fetch.mock.calls.find((c) =>
      String(c[0]).includes('api.emailjs.com')
    );
    expect(emailCall).toBeDefined();
    const body = JSON.parse(emailCall[1].body);
    expect(body.template_params.timestamp).toBe(formatAlertEmailTimestamp(ts));
    expect(body.template_params.timestamp).toBe('2026-05-30 09:13:01');
    expect(body.template_params.timestamp).not.toMatch(/Z$/);
    expect(body.template_params.timestamp).not.toContain('T');
  });
});

describe('formatAlertEmailTimestamp', () => {
  it('formats a fixed UTC instant as Asia/Manila wall-clock', () => {
    const ms = Date.UTC(2026, 4, 30, 1, 13, 1, 840);
    expect(formatAlertEmailTimestamp(ms)).toBe('2026-05-30 09:13:01');
  });
});
