import { describe, it, expect } from 'vitest';
import { validateDispatchAlertBody } from '../backend/notifications/dispatch-alert.js';

describe('validateDispatchAlertBody', () => {
  const base = {
    id: 'ph-1',
    ts: Date.now(),
    key: 'ph',
    val: 9.0,
    severity: 'critical',
    pond: 'Pond A',
    resolved: false,
  };

  it('accepts a valid alert', () => {
    expect(validateDispatchAlertBody(base)).toBeNull();
  });

  it('rejects resolved alerts', () => {
    expect(validateDispatchAlertBody({ ...base, resolved: true })).toBeTruthy();
  });

  it('rejects missing key', () => {
    expect(validateDispatchAlertBody({ ...base, key: '' })).toBeTruthy();
  });
});
