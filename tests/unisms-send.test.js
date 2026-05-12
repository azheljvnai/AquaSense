import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendUniSms } from '../backend/lib/unisms.js';

describe('sendUniSms', () => {
  const prevKey = process.env.UNISMS_SECRET_KEY;

  beforeEach(() => {
    process.env.UNISMS_SECRET_KEY = 'test-secret';
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    process.env.UNISMS_SECRET_KEY = prevKey;
    delete globalThis.fetch;
  });

  it('returns ok when UniSMS accepts the payload', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ message: { reference_id: 'ref-1' } }),
    });

    const r = await sendUniSms({
      recipient: '+639171234567',
      content: 'x'.repeat(50),
      metadata: { source: 'test' },
    });

    expect(r.ok).toBe(true);
    expect(r.reference_id).toBe('ref-1');
    expect(globalThis.fetch).toHaveBeenCalled();
  });
});
