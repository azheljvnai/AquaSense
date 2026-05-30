/**
 * Water quality alerts — debounce / persistence (server).
 * Module: backend/lib/alert-sensitivity.js
 * Demo: one bad reading does not notify; ~60s sustained breach does; reset on return to normal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBreachTracker } from '../backend/lib/alert-sensitivity.js';

describe('alert sensitivity breach tracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // First call with warning severity → timer started, hasPersisted still false
  it('does not fire on the first breach reading', () => {
    const tracker = createBreachTracker(60_000);
    expect(tracker.hasPersisted('cfg1', 'temp', 'warning')).toBe(false);
  });

  // After 60_000 ms at same severity → true (ready to dispatch / show persisted alert)
  it('fires after the breach persists for 60 seconds', () => {
    const tracker = createBreachTracker(60_000);
    tracker.hasPersisted('cfg1', 'temp', 'warning');
    vi.advanceTimersByTime(59_999);
    expect(tracker.hasPersisted('cfg1', 'temp', 'warning')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(tracker.hasPersisted('cfg1', 'temp', 'warning')).toBe(true);
  });

  // Passing null severity (back to normal) clears timer; must wait full window again
  it('resets when the reading returns to normal', () => {
    const tracker = createBreachTracker(60_000);
    tracker.hasPersisted('cfg1', 'ph', 'critical');
    vi.advanceTimersByTime(30_000);
    expect(tracker.hasPersisted('cfg1', 'ph', null)).toBe(false);
    expect(tracker.hasPersisted('cfg1', 'ph', 'critical')).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(tracker.hasPersisted('cfg1', 'ph', 'critical')).toBe(true);
  });

  // warning → critical escalation uses a fresh 60s timer (escalation can notify separately)
  it('starts a separate timer when severity escalates', () => {
    const tracker = createBreachTracker(60_000);
    tracker.hasPersisted('cfg1', 'do', 'warning');
    vi.advanceTimersByTime(30_000);
    expect(tracker.hasPersisted('cfg1', 'do', 'critical')).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect(tracker.hasPersisted('cfg1', 'do', 'critical')).toBe(false);
    vi.advanceTimersByTime(30_000);
    expect(tracker.hasPersisted('cfg1', 'do', 'critical')).toBe(true);
  });
});
