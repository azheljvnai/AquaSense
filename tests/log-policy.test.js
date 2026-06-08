import { describe, it, expect, beforeEach } from 'vitest';
import {
  isRuntimeLogAllowed,
  shouldDedupeLog,
  BLOCKED_RUNTIME_EVENT_TYPES,
} from '../backend/lib/log-policy.js';

describe('log-policy', () => {
  let seen;

  beforeEach(() => {
    seen = new Map();
  });

  it('blocks routine sensor.reading at runtime', () => {
    expect(BLOCKED_RUNTIME_EVENT_TYPES.has('sensor.reading')).toBe(true);
    expect(isRuntimeLogAllowed('sensor.reading')).toBe(false);
    expect(isRuntimeLogAllowed('sensor.reading', { allowSeed: true })).toBe(true);
    expect(isRuntimeLogAllowed('sensor.disconnect')).toBe(true);
  });

  it('dedupes repeated dashboard.access within interval', () => {
    expect(shouldDedupeLog('dashboard.access', 'user-1', seen)).toBe(false);
    expect(shouldDedupeLog('dashboard.access', 'user-1', seen)).toBe(true);
    expect(shouldDedupeLog('dashboard.access', 'user-2', seen)).toBe(false);
  });
});
