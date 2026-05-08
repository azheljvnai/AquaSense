// tests/utils-history-rtdb-preservation.bugfix.test.js
// Bugfix: historical-data-rtdb-prune-leak — Regression test
//
// Ensures live buffer pruning (2h rolling) never deletes RTDB-merged history,
// while keeping localStorage semantics for real-time data.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

function makeLocalStorage() {
  let store = {};
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
  };
}

describe('Utils history storage — RTDB entries survive live pruning', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('mergeRtdbEntries data remains queryable after many recordSensorReading() calls', async () => {
    // Provide DOM + localStorage before importing utils.js (it reads localStorage on module load).
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.localStorage = makeLocalStorage();

    const utils = await import('../public/js/utils.js');

    const now = Date.now();
    const oldRtdbTs = now - (20 * 24 * 60 * 60 * 1000); // 20 days ago
    utils.mergeRtdbEntries([{ ts: oldRtdbTs, ph: 7.1, do: 8.2, turb: 10, temp: 24 }]);

    // Simulate many live updates over time so pruneHistory runs repeatedly.
    // Put these outside the 2h window so pruning would aggressively drop them.
    for (let i = 0; i < 400; i++) {
      const ts = now - (6 * 60 * 60 * 1000) - i * 30_000; // ~6h ago, stepping back
      utils.recordSensorReading(7.0, 8.0, 12.0, 25.0, ts);
    }

    // The RTDB entry should still be present in range queries.
    const from = oldRtdbTs - 1_000;
    const to = oldRtdbTs + 1_000;
    const range = utils.getHistoryRange(from, to);

    expect(range.some(e => e.ts === oldRtdbTs)).toBe(true);
  });
});

