// tests/notifications-all-parameters-bugfix.test.js
// Validates that handleAlert delegates fan-out to POST /api/notifications/dispatch-alert
// (server notifies all active users) for every sensor parameter.

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';

vi.mock('../public/js/firebase-client.js', () => ({
  fbGetIdToken: vi.fn(() => Promise.resolve('mock-token')),
}));

describe('Notification Alerts All Parameters — dispatch-alert integration', () => {
  let handleAlert;

  beforeAll(async () => {
    const mod = await import('../public/js/features/notifications.js');
    handleAlert = mod.handleAlert;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('navigator', { onLine: true });
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            ok: true,
            processed: 3,
            smsSent: 3,
            emailSent: 0,
            skipped: 0,
            errors: [],
          }),
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete globalThis.fetch;
  });

  it('DO breach triggers one dispatch-alert request with alert payload', async () => {
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
    const dispatchCalls = globalThis.fetch.mock.calls.filter((c) =>
      String(c[0]).includes('/api/notifications/dispatch-alert')
    );
    expect(dispatchCalls.length).toBe(1);
    expect(JSON.parse(dispatchCalls[0][1].body).alert.key).toBe('do');
  });

  it('Temperature breach triggers one dispatch-alert request', async () => {
    const alert = {
      id: 'alert2',
      key: 'temp',
      val: 35,
      severity: 'warning',
      pond: 'Pond B',
      ts: Date.now(),
      resolved: false,
    };
    await handleAlert(alert);
    const dispatchCalls = globalThis.fetch.mock.calls.filter((c) =>
      String(c[0]).includes('/api/notifications/dispatch-alert')
    );
    expect(dispatchCalls.length).toBe(1);
    expect(JSON.parse(dispatchCalls[0][1].body).alert.key).toBe('temp');
  });

  it('Turbidity breach triggers one dispatch-alert request', async () => {
    const alert = {
      id: 'alert3',
      key: 'turb',
      val: 80,
      severity: 'critical',
      pond: 'Pond C',
      ts: Date.now(),
      resolved: false,
    };
    await handleAlert(alert);
    const dispatchCalls = globalThis.fetch.mock.calls.filter((c) =>
      String(c[0]).includes('/api/notifications/dispatch-alert')
    );
    expect(dispatchCalls.length).toBe(1);
    expect(JSON.parse(dispatchCalls[0][1].body).alert.key).toBe('turb');
  });

  it('pH breach triggers one dispatch-alert request (same path as other parameters)', async () => {
    const alert = {
      id: 'alert4',
      key: 'ph',
      val: 9.0,
      severity: 'critical',
      pond: 'Pond D',
      ts: Date.now(),
      resolved: false,
    };
    await handleAlert(alert);
    const dispatchCalls = globalThis.fetch.mock.calls.filter((c) =>
      String(c[0]).includes('/api/notifications/dispatch-alert')
    );
    expect(dispatchCalls.length).toBe(1);
    expect(JSON.parse(dispatchCalls[0][1].body).alert.key).toBe('ph');
  });

  it('does not call dispatch when there is no auth token', async () => {
    const { fbGetIdToken } = await import('../public/js/firebase-client.js');
    fbGetIdToken.mockRejectedValueOnce(new Error('No authenticated user.'));
    const alert = {
      id: 'alert5',
      key: 'ph',
      val: 9.0,
      severity: 'critical',
      pond: 'Pond E',
      ts: Date.now(),
      resolved: false,
    };
    await handleAlert(alert);
    const dispatchCalls = globalThis.fetch.mock.calls.filter((c) =>
      String(c[0]).includes('/api/notifications/dispatch-alert')
    );
    expect(dispatchCalls.length).toBe(0);
    fbGetIdToken.mockResolvedValue('mock-token');
  });

  it('sequential handleAlert for multiple parameters produces ordered dispatch calls', async () => {
    const alerts = [
      { id: 'a1', key: 'ph', val: 9, severity: 'critical', pond: 'P', ts: Date.now(), resolved: false },
      { id: 'a2', key: 'do', val: 2, severity: 'critical', pond: 'P', ts: Date.now(), resolved: false },
      { id: 'a3', key: 'temp', val: 36, severity: 'warning', pond: 'P', ts: Date.now(), resolved: false },
    ];
    for (const alert of alerts) {
      await handleAlert(alert);
    }
    const dispatchCalls = globalThis.fetch.mock.calls.filter((c) =>
      String(c[0]).includes('/api/notifications/dispatch-alert')
    );
    expect(dispatchCalls.length).toBe(3);
    expect(JSON.parse(dispatchCalls[0][1].body).alert.key).toBe('ph');
    expect(JSON.parse(dispatchCalls[1][1].body).alert.key).toBe('do');
    expect(JSON.parse(dispatchCalls[2][1].body).alert.key).toBe('temp');
  });

  it('all parameters use the same dispatch endpoint', async () => {
    const parameters = ['ph', 'do', 'temp', 'turb'];

    for (const param of parameters) {
      vi.clearAllMocks();
      globalThis.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              ok: true,
              processed: 3,
              smsSent: 0,
              emailSent: 0,
              skipped: 0,
              errors: [],
            }),
        })
      );

      const alert = {
        id: `alert-${param}`,
        key: param,
        val: param === 'ph' ? 9.0 : param === 'do' ? 3.0 : param === 'temp' ? 35 : 80,
        severity: 'warning',
        pond: 'Test Pond',
        ts: Date.now(),
        resolved: false,
      };

      await handleAlert(alert);

      const dispatchCalls = globalThis.fetch.mock.calls.filter((c) =>
        String(c[0]).includes('/api/notifications/dispatch-alert')
      );
      expect(dispatchCalls.length).toBe(1);
      expect(JSON.parse(dispatchCalls[0][1].body).alert.key).toBe(param);
    }
  });
});
