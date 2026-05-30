/**
 * Water quality alerts — debounce (client, mirrors server alert-sensitivity.test.js).
 * Module: public/js/alert-sensitivity.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createBreachTracker,
  setSensitivityMs,
  getSensitivityMs,
  SENSITIVITY_MS,
} from '../public/js/alert-sensitivity.js';

describe('alert sensitivity (client)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSensitivityMs(SENSITIVITY_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
    setSensitivityMs(SENSITIVITY_MS);
  });

  it('does not fire on the first breach reading', () => {
    const tracker = createBreachTracker();
    expect(tracker.hasPersisted('cfg1', 'temp', 'warning')).toBe(false);
  });

  it('fires after the breach persists for sensitivity window', () => {
    const tracker = createBreachTracker(60_000);
    tracker.hasPersisted('cfg1', 'temp', 'warning');
    vi.advanceTimersByTime(59_999);
    expect(tracker.hasPersisted('cfg1', 'temp', 'warning')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(tracker.hasPersisted('cfg1', 'temp', 'warning')).toBe(true);
  });

  it('resets when the reading returns to normal', () => {
    const tracker = createBreachTracker(60_000);
    tracker.hasPersisted('cfg1', 'ph', 'critical');
    vi.advanceTimersByTime(30_000);
    expect(tracker.hasPersisted('cfg1', 'ph', null)).toBe(false);
    expect(tracker.hasPersisted('cfg1', 'ph', 'critical')).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(tracker.hasPersisted('cfg1', 'ph', 'critical')).toBe(true);
  });

  it('setSensitivityMs(0) fires immediately on second check', () => {
    setSensitivityMs(0);
    expect(getSensitivityMs()).toBe(0);
    const tracker = createBreachTracker();
    tracker.hasPersisted('cfg1', 'do', 'warning');
    expect(tracker.hasPersisted('cfg1', 'do', 'warning')).toBe(true);
  });
});
