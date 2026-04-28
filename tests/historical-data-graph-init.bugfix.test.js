// tests/historical-data-graph-init.bugfix.test.js
// Bugfix: historical-data-graph-init — Bug Condition Exploration Test
// This test MUST FAIL on unfixed code - failure confirms the bug exists
// DO NOT attempt to fix the test or the code when it fails
// This test encodes the expected behavior - it will validate the fix when it passes

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';

// ─── Mock ES module dependencies ─────────────────────────────────────────────
// Mock the modules that historical-data.js imports so we can run init() in JSDOM

vi.mock('../public/js/charts.js', () => ({
  initHistoricalChart: vi.fn(() => ({
    resize: vi.fn(),
    data: { labels: [], datasets: [] },
    update: vi.fn(),
  })),
  updateHistoricalChart: vi.fn(),
}));

vi.mock('../public/js/utils.js', () => ({
  getHistoryRange: vi.fn(() => []),
  getThresholds: vi.fn(() => ({
    ph:   { ok: [6.5, 8.5], warn: [6.0, 9.0] },
    do:   { ok: [5.0, 12.0], warn: [4.0, 14.0] },
    turb: { ok: [0, 50], warn: [0, 100] },
    temp: { ok: [20, 30], warn: [15, 35] },
  })),
  saveThresholds: vi.fn(),
  resetThresholds: vi.fn(),
  spkData: { ph: [], do: [], turb: [], temp: [] },
  mergeHistoryEntries: vi.fn(),
}));

// ─── Bug Condition Exploration Test ──────────────────────────────────────────
// Property 1: Bug Condition - 24h Default on Initialization
//
// **Validates: Requirements 1.1, 1.2, 1.3**
//
// For any navigation to the Historical Data page, the fixed init() function
// SHALL set activeRange to '24h', sync the <select> element to '24h', and
// trigger a fetch for the last 24 hours of sensor data.
//
// EXPECTED OUTCOME ON UNFIXED CODE: Tests FAIL
// - activeRange is 'week' instead of '24h' after init()
// - hist-range select shows 'week' (HTML has selected on week option)
// - fetchHistoryFromRTDB is called with start-of-week timestamp instead of now-24h
//
// EXPECTED OUTCOME ON FIXED CODE: Tests PASS

describe('Historical Data Graph Init — Bug Condition Exploration', () => {
  let dom;
  let window;
  let document;
  let fetchHistoryFromRTDBMock;

  beforeEach(async () => {
    // Load the real HTML
    const html = readFileSync('public/index.html', 'utf-8');
    dom = new JSDOM(html, {
      runScripts: 'dangerously',
      resources: 'usable',
      url: 'http://localhost',
    });
    window = dom.window;
    document = dom.window.document;

    // Mock Chart.js (used by charts.js internally)
    window.Chart = vi.fn(() => ({
      resize: vi.fn(),
      update: vi.fn(),
      data: { labels: [], datasets: [] },
      destroy: vi.fn(),
    }));

    // Mock fetchHistoryFromRTDB on window (called as window.fetchHistoryFromRTDB in refresh())
    fetchHistoryFromRTDBMock = vi.fn().mockResolvedValue([]);
    window.fetchHistoryFromRTDB = fetchHistoryFromRTDBMock;

    // Stub requestAnimationFrame (not available in JSDOM by default)
    window.requestAnimationFrame = vi.fn(cb => cb());
  });

  /**
   * Property 1 — Test 1: activeRange should be '24h' after init()
   *
   * isBugCondition: activeRange == 'week' after init()
   *
   * On UNFIXED code: init() sets activeRange = 'week' → test FAILS
   * On FIXED code:   init() sets activeRange = '24h'  → test PASSES
   */
  it('Test 1: activeRange should be "24h" immediately after init()', async () => {
    // Dynamically import init() so vi.mock() applies
    const { init } = await import('../public/js/features/historical-data.js');

    // Expose the document to the module scope via globalThis (JSDOM sets window)
    // The module reads `document` from the global scope at call time
    const origDocument = globalThis.document;
    const origWindow   = globalThis.window;
    globalThis.document = document;
    globalThis.window   = window;

    try {
      // Call init() — on unfixed code activeRange is set to 'week' internally
      init();

      // Allow any async refresh() to settle
      await new Promise(r => setTimeout(r, 50));

      // We cannot directly read the closure variable `activeRange`, but we can
      // observe its effect: the hist-range select element value reflects it
      // (after the fix, init() syncs rangeEl.value = '24h').
      // Test 2 covers the select element directly.
      //
      // For Test 1 we verify via the fetch call: if activeRange is '24h',
      // fetchHistoryFromRTDB must be called with from ≈ now - 24h.
      // If activeRange is 'week', from will be start-of-week (much earlier).
      const now = Date.now();
      const expected24hFrom = now - 24 * 60 * 60 * 1000;

      expect(fetchHistoryFromRTDBMock).toHaveBeenCalled();

      const callArgs = fetchHistoryFromRTDBMock.mock.calls[0];
      const actualFrom = callArgs[0]; // first argument is `from` timestamp

      // On UNFIXED code: actualFrom is start-of-week (days before now-24h) → FAILS
      // On FIXED code:   actualFrom ≈ now - 24h (within ±10 seconds)       → PASSES
      const diffSeconds = Math.abs(actualFrom - expected24hFrom) / 1000;
      expect(diffSeconds).toBeLessThanOrEqual(10);
    } finally {
      globalThis.document = origDocument;
      globalThis.window   = origWindow;
    }
  });

  /**
   * Property 1 — Test 2: hist-range select element should show '24h' after init()
   *
   * isBugCondition: document.getElementById('hist-range').value === 'week' after init()
   *
   * On UNFIXED code: HTML has <option value="week" selected> → select.value === 'week' → FAILS
   * On FIXED code:   HTML has <option value="24h" selected> (or JS sets rangeEl.value = '24h') → PASSES
   */
  it('Test 2: hist-range select element value should be "24h" after init()', async () => {
    const { init } = await import('../public/js/features/historical-data.js');

    const origDocument = globalThis.document;
    const origWindow   = globalThis.window;
    globalThis.document = document;
    globalThis.window   = window;

    try {
      init();
      await new Promise(r => setTimeout(r, 50));

      const rangeEl = document.getElementById('hist-range');
      expect(rangeEl).not.toBeNull();

      // On UNFIXED code: rangeEl.value === 'week' → FAILS
      // On FIXED code:   rangeEl.value === '24h'  → PASSES
      expect(rangeEl.value).toBe('24h');
    } finally {
      globalThis.document = origDocument;
      globalThis.window   = origWindow;
    }
  });

  /**
   * Property 1 — Test 3: fetchHistoryFromRTDB called with from ≈ now - 24h
   *
   * isBugCondition: fetchHistoryFromRTDB called with start-of-week timestamp
   *
   * On UNFIXED code: from = start of current week (Monday 00:00) → FAILS
   * On FIXED code:   from ≈ Date.now() - 24*60*60*1000 (within ±5 seconds) → PASSES
   */
  it('Test 3: fetchHistoryFromRTDB should be called with from ≈ now - 24h on init', async () => {
    const { init } = await import('../public/js/features/historical-data.js');

    const origDocument = globalThis.document;
    const origWindow   = globalThis.window;
    globalThis.document = document;
    globalThis.window   = window;

    // Reset mock call history before this test
    fetchHistoryFromRTDBMock.mockClear();

    try {
      const beforeInit = Date.now();
      init();
      await new Promise(r => setTimeout(r, 50));
      const afterInit = Date.now();

      expect(fetchHistoryFromRTDBMock).toHaveBeenCalled();

      const callArgs = fetchHistoryFromRTDBMock.mock.calls[0];
      const actualFrom = callArgs[0]; // `from` timestamp in ms

      // Expected: from is within the 24h window around init time
      const expected24hFrom = beforeInit - 24 * 60 * 60 * 1000;
      const toleranceMs = 5 * 1000; // ±5 seconds

      // On UNFIXED code: actualFrom is start-of-week (e.g. Monday 00:00:00)
      //   which is potentially days before now-24h → diffMs >> 5s → FAILS
      // On FIXED code:   actualFrom ≈ now - 24h → diffMs ≤ 5s → PASSES
      const diffMs = Math.abs(actualFrom - expected24hFrom);
      expect(diffMs).toBeLessThanOrEqual(toleranceMs);
    } finally {
      globalThis.document = origDocument;
      globalThis.window   = origWindow;
    }
  });
});
