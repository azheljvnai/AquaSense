import { describe, it, expect } from 'vitest';
import { isCooledDownFromLogRows } from '../backend/notifications/dispatch-alert.js';

const COOLDOWN_MS = 15 * 60 * 1000;
const baseCtx = {
  pondName: 'PondA',
  parameter: 'ph',
  channel: 'sms',
  severity: 'critical',
  cooldownMs: COOLDOWN_MS,
};

describe('isCooledDownFromLogRows (severity-scoped)', () => {
  it('returns true when a sent log matches pond, param, channel, severity within window', () => {
    const nowMs = 1_000_000_000_000;
    const rows = [
      {
        pondName: 'PondA',
        parameter: 'ph',
        channel: 'sms',
        status: 'sent',
        severity: 'critical',
        sentAtMs: nowMs - 60_000,
      },
    ];
    expect(isCooledDownFromLogRows(rows, { ...baseCtx, nowMs })).toBe(true);
  });

  it('returns false for same parameter/channel but different severity (escalation)', () => {
    const nowMs = 1_000_000_000_000;
    const rows = [
      {
        pondName: 'PondA',
        parameter: 'ph',
        channel: 'sms',
        status: 'sent',
        severity: 'warning',
        sentAtMs: nowMs - 60_000,
      },
    ];
    expect(isCooledDownFromLogRows(rows, { ...baseCtx, nowMs, severity: 'critical' })).toBe(false);
  });

  it('ignores legacy rows with empty severity (does not cool down)', () => {
    const nowMs = 1_000_000_000_000;
    const rows = [
      {
        pondName: 'PondA',
        parameter: 'ph',
        channel: 'sms',
        status: 'sent',
        severity: '',
        sentAtMs: nowMs - 60_000,
      },
    ];
    expect(isCooledDownFromLogRows(rows, { ...baseCtx, nowMs })).toBe(false);
  });

  it('returns false when last matching send is outside cooldown window', () => {
    const nowMs = 1_000_000_000_000;
    const rows = [
      {
        pondName: 'PondA',
        parameter: 'ph',
        channel: 'sms',
        status: 'sent',
        severity: 'critical',
        sentAtMs: nowMs - COOLDOWN_MS - 1,
      },
    ];
    expect(isCooledDownFromLogRows(rows, { ...baseCtx, nowMs })).toBe(false);
  });

  it('does not treat other parameters as cooldown for this dispatch', () => {
    const nowMs = 1_000_000_000_000;
    const rows = [
      {
        pondName: 'PondA',
        parameter: 'do',
        channel: 'sms',
        status: 'sent',
        severity: 'critical',
        sentAtMs: nowMs - 30_000,
      },
    ];
    expect(isCooledDownFromLogRows(rows, { ...baseCtx, nowMs })).toBe(false);
  });

  it('ignores failed status rows', () => {
    const nowMs = 1_000_000_000_000;
    const rows = [
      {
        pondName: 'PondA',
        parameter: 'ph',
        channel: 'sms',
        status: 'failed',
        severity: 'critical',
        sentAtMs: nowMs - 30_000,
      },
    ];
    expect(isCooledDownFromLogRows(rows, { ...baseCtx, nowMs })).toBe(false);
  });
});
