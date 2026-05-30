/**
 * Water quality alerts — RTDB sensor watcher (server).
 * Module: backend/notifications/rtdb-alert-watcher.js
 * Demo: live readings evaluated per active config; notify interval suppresses spam per parameter.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockState } from './mocks/firebase-admin.js';
import { NOTIFY_INTERVAL_MS } from '../backend/lib/alert-notify-interval.js';
const { dispatchAlertsBatchToAllUsers, persistAlertsToFirestore } = vi.hoisted(() => ({
  dispatchAlertsBatchToAllUsers: vi.fn(),
  persistAlertsToFirestore: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('firebase-admin', () => import('./mocks/firebase-admin.js'));

vi.mock('../backend/notifications/dispatch-alert.js', () => ({
  dispatchAlertsBatchToAllUsers,
  persistAlertsToFirestore,
}));

/** Critical pH for tilapia preset (above stress2Min 8.81). */
const criticalPhSnapshot = { ts: 1, ph: 9.5, do: 7, turb: 10, temp: 28 };

describe('rtdb-alert-watcher per-parameter notify interval', () => {
  let processSensorSnapshotForTests;
  let _resetWatcherStateForTests;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('ALERT_SENSITIVITY_MS', '0');
    dispatchAlertsBatchToAllUsers.mockReset();
    persistAlertsToFirestore.mockReset();
    persistAlertsToFirestore.mockResolvedValue(undefined);
    dispatchAlertsBatchToAllUsers.mockResolvedValue({
      emailSent: 1,
      smsSent: 0,
      ok: true,
      notified: ['ph:critical'],
    });

    mockState.configurationsGet = async () => ({
      empty: false,
      docs: [
        {
          id: 'cfg1',
          data: () => ({ isActive: true, species: 'tilapia', name: 'Test Pond' }),
        },
      ],
    });

    const mod = await import('../backend/notifications/rtdb-alert-watcher.js');
    _resetWatcherStateForTests = mod._resetWatcherStateForTests;
    processSensorSnapshotForTests = mod.processSensorSnapshotForTests;
    _resetWatcherStateForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('dispatches once then suppresses within notify interval for same parameter/severity', async () => {
    dispatchAlertsBatchToAllUsers.mockResolvedValue({
      emailSent: 1,
      smsSent: 0,
      ok: true,
      notified: ['ph:critical'],
    });
    await processSensorSnapshotForTests(criticalPhSnapshot);
    await processSensorSnapshotForTests({ ...criticalPhSnapshot, ph: 9.51, ts: 2 });
    expect(dispatchAlertsBatchToAllUsers).toHaveBeenCalledTimes(1);
    const batch = dispatchAlertsBatchToAllUsers.mock.calls[0][0];
    expect(batch).toHaveLength(1);
    expect(batch[0].key).toBe('ph');
    expect(batch[0].severity).toBe('critical');
  });

  it('does not mark notified when dispatch sends nothing (allows retry)', async () => {
    dispatchAlertsBatchToAllUsers.mockResolvedValue({ emailSent: 0, smsSent: 0, ok: true, notified: [] });
    await processSensorSnapshotForTests(criticalPhSnapshot);
    await processSensorSnapshotForTests({ ...criticalPhSnapshot, ts: 2 });
    expect(dispatchAlertsBatchToAllUsers).toHaveBeenCalledTimes(2);
  });

  it('re-dispatches after notify interval via forceRecheck with unchanged snapshot', async () => {
    vi.useFakeTimers({ now: 0 });
    await processSensorSnapshotForTests(criticalPhSnapshot);
    expect(dispatchAlertsBatchToAllUsers).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(NOTIFY_INTERVAL_MS - 1);
    await processSensorSnapshotForTests(criticalPhSnapshot, { forceRecheck: true });
    expect(dispatchAlertsBatchToAllUsers).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2);
    dispatchAlertsBatchToAllUsers.mockResolvedValue({
      emailSent: 1,
      smsSent: 0,
      ok: true,
      notified: ['ph:critical'],
    });
    await processSensorSnapshotForTests(criticalPhSnapshot, { forceRecheck: true });
    expect(dispatchAlertsBatchToAllUsers).toHaveBeenCalledTimes(2);
  });

  it('uses independent intervals per parameter', async () => {
    vi.useFakeTimers({ now: 0 });
    const multiBreach = { ts: 1, ph: 9.5, do: 3, turb: 10, temp: 28 };
    dispatchAlertsBatchToAllUsers.mockResolvedValue({
      emailSent: 1,
      smsSent: 0,
      ok: true,
      notified: ['ph:critical', 'do:critical'],
    });
    await processSensorSnapshotForTests(multiBreach);
    expect(dispatchAlertsBatchToAllUsers).toHaveBeenCalledTimes(1);
    const firstBatch = dispatchAlertsBatchToAllUsers.mock.calls[0][0];
    expect(firstBatch.map((a) => a.key).sort()).toEqual(['do', 'ph']);

    vi.advanceTimersByTime(NOTIFY_INTERVAL_MS + 1);
    dispatchAlertsBatchToAllUsers.mockResolvedValue({
      emailSent: 1,
      smsSent: 0,
      ok: true,
      notified: ['ph:critical', 'do:critical'],
    });
    await processSensorSnapshotForTests(multiBreach, { forceRecheck: true });
    expect(dispatchAlertsBatchToAllUsers).toHaveBeenCalledTimes(2);
  });
});
