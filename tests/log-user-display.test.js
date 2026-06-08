import { describe, it, expect } from 'vitest';
import { resolveLogUserDisplay, defaultLabelForSource } from '../backend/lib/log-user-display.js';

describe('log-user-display', () => {
  it('resolves eval respondent by userId', () => {
    const name = resolveLogUserDisplay(
      { userId: 'eval-respondent-03', userName: null, source: 'user' },
      new Map(),
    );
    expect(name).toBe('User3');
  });

  it('uses Firestore display name when userName missing', () => {
    const map = new Map([['uid-farmer', 'Maria Santos']]);
    expect(
      resolveLogUserDisplay({ userId: 'uid-farmer', userName: null, source: 'user' }, map),
    ).toBe('Maria Santos');
  });

  it('labels automated system events as System', () => {
    expect(defaultLabelForSource('system')).toBe('System');
    expect(
      resolveLogUserDisplay({ userId: null, userName: null, source: 'system' }, new Map()),
    ).toBe('System');
  });
});
