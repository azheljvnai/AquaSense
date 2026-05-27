import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('firebase-admin', () => import('./mocks/firebase-admin.js'));

describe('postDispatchAlert server watcher guard', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.FIREBASE_DATABASE_URL = 'https://test.firebaseio.com';
    delete process.env.RTDB_ALERT_WATCHER;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllEnvs();
  });

  it('skips client dispatch when RTDB watcher is enabled', async () => {
    const { isServerWatcherEnabled, postDispatchAlert } = await import(
      '../backend/notifications/dispatch-alert.js'
    );
    expect(isServerWatcherEnabled()).toBe(true);

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    await postDispatchAlert(
      {
        body: {
          alert: {
            id: 'ph-1',
            ts: Date.now(),
            key: 'ph',
            val: 9,
            severity: 'critical',
            pond: 'Pond',
            resolved: false,
          },
        },
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        skipped: true,
        reason: 'server_watcher_enabled',
      })
    );
  });

  it('allows client dispatch when watcher is disabled via env', async () => {
    process.env.RTDB_ALERT_WATCHER = 'false';
    vi.resetModules();
    const { isServerWatcherEnabled } = await import('../backend/notifications/dispatch-alert.js');
    expect(isServerWatcherEnabled()).toBe(false);
  });
});
