import { describe, it, expect } from 'vitest';
import { buildSmsContent } from '../backend/notifications/dispatch-alert.js';

describe('buildSmsContent (UniSMS-safe ASCII)', () => {
  const base = {
    id: 'x',
    ts: Date.now(),
    val: 3.5,
    severity: 'critical',
    pond: 'NorthPond',
    resolved: false,
  };

  it('uses ASCII-only labels and units for DO', () => {
    const s = buildSmsContent({ ...base, key: 'do' });
    expect(s).toContain('Dissolved O2');
    expect(s).not.toContain('₂');
    expect(s).toMatch(/^[\x00-\x7F]+$/);
  });

  it('uses ASCII-only units for temperature', () => {
    const s = buildSmsContent({ ...base, key: 'temp', val: 35.2 });
    expect(s).toContain(' C');
    expect(s).not.toContain('°');
    expect(s).toMatch(/^[\x00-\x7F]+$/);
  });

  it('sanitizes non-ASCII pond names for the SMS body', () => {
    const s = buildSmsContent({ ...base, key: 'ph', val: 9.1, pond: 'Lagúna-1' });
    expect(s).toMatch(/^[\x00-\x7F]+$/);
    expect(s).toContain('Lag');
  });
});
