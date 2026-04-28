// tests/historical-data-graph-init-preservation.property.test.js
// Bugfix: historical-data-graph-init — Preservation Property Tests
// Property 2: Preservation - Non-Init Interactions Unchanged
//
// These tests MUST PASS on unfixed code - they verify baseline behavior to preserve.
// Run on UNFIXED code to establish baseline, then re-run after fix to confirm no regressions.
//
// **Validates: Requirements 3.1, 3.2, 3.3**

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import * as fc from 'fast-check';

// ─── Mock ES module dependencies ─────────────────────────────────────────────

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

// ─── Preservation Property Tests ─────────────────────────────────────────────

describe('Historical Data Graph Init — Preservation Properties', () => {
  let dom;
  let window;
  let document;
  let fetchHistoryFromRTDBMock;
  let updateHistoricalChartMock;

  /**
   * Helper: set up a fresh JSDOM environment and call init().
   * Returns the settled environment so tests can interact with it.
   */
  async function setupAndInit() {
    const html = readFileSync('public/index.html', 'utf-8');
    const d = new JSDOM(html, {
      runScripts: 'dangerously',
      resources: 'usable',
      url: 'http://localhost',
    });
    const win = d.window;
    const doc = d.window.document;

    // Mock Chart.js
    win.Chart = vi.fn(() => ({
      resize: vi.fn(),
      update: vi.fn(),
      data: { labels: [], datasets: [] },
      destroy: vi.fn(),
    }));

    // Mock fetchHistoryFromRTDB
    const fetchMock = vi.fn().mockResolvedValue([]);
    win.fetchHistoryFromRTDB = fetchMock;

    // Stub requestAnimationFrame
    win.requestAnimationFrame = vi.fn(cb => cb());

    // Swap globals so the ES module reads the right document/window
    const origDocument = globalThis.document;
    const origWindow   = globalThis.window;
    globalThis.document = doc;
    globalThis.window   = win;

    const { init } = await import('../public/js/features/historical-data.js');
    init();
    await new Promise(r => setTimeout(r, 50));

    // Restore globals (tests will set them again as needed)
    globalThis.document = origDocument;
    globalThis.window   = origWindow;

    return { dom: d, win, doc, fetchMock };
  }

  beforeEach(async () => {
    // Import the mocked updateHistoricalChart so we can spy on it
    const charts = await import('../public/js/charts.js');
    updateHistoricalChartMock = charts.updateHistoricalChart;
    updateHistoricalChartMock.mockClear();

    const html = readFileSync('public/index.html', 'utf-8');
    dom = new JSDOM(html, {
      runScripts: 'dangerously',
      resources: 'usable',
      url: 'http://localhost',
    });
    window = dom.window;
    document = dom.window.document;

    window.Chart = vi.fn(() => ({
      resize: vi.fn(),
      update: vi.fn(),
      data: { labels: [], datasets: [] },
      destroy: vi.fn(),
    }));

    fetchHistoryFromRTDBMock = vi.fn().mockResolvedValue([]);
    window.fetchHistoryFromRTDB = fetchHistoryFromRTDBMock;
    window.requestAnimationFrame = vi.fn(cb => cb());
  });

  // ── Observation: manual range change triggers correct fetch ───────────────

  /**
   * Property 3.1: Manual Range Change Preservation
   *
   * **Validates: Requirements 3.1**
   *
   * For any range value in ['week', 'month'], simulating a manual range change
   * after init() produces a fetch with the correct start/end timestamps.
   *
   * On UNFIXED code: init() uses 'week' as default, but manual changes to 'week'
   * or 'month' still call fetchHistoryFromRTDB with the correct range timestamps.
   *
   * EXPECTED OUTCOME: Test PASSES on unfixed code (baseline behavior to preserve)
   */
  it('Property 3.1: Manual range change triggers fetch with correct timestamps', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('week', 'month'),
        async (rangeValue) => {
          // Use a fresh JSDOM per run to avoid accumulated event listeners
          const html = readFileSync('public/index.html', 'utf-8');
          const freshDom = new JSDOM(html, {
            runScripts: 'dangerously',
            resources: 'usable',
            url: 'http://localhost',
          });
          const freshWin = freshDom.window;
          const freshDoc = freshDom.window.document;

          freshWin.Chart = vi.fn(() => ({
            resize: vi.fn(),
            update: vi.fn(),
            data: { labels: [], datasets: [] },
            destroy: vi.fn(),
          }));
          const freshFetchMock = vi.fn().mockResolvedValue([]);
          freshWin.fetchHistoryFromRTDB = freshFetchMock;
          freshWin.requestAnimationFrame = vi.fn(cb => cb());

          const origDocument = globalThis.document;
          const origWindow   = globalThis.window;
          globalThis.document = freshDoc;
          globalThis.window   = freshWin;

          try {
            const { init } = await import('../public/js/features/historical-data.js');
            init();
            await new Promise(r => setTimeout(r, 50));

            // Clear the init fetch call(s)
            freshFetchMock.mockClear();

            // Simulate user manually changing the range select
            const rangeEl = freshDoc.getElementById('hist-range');
            expect(rangeEl).not.toBeNull();

            const beforeChange = Date.now();
            rangeEl.value = rangeValue;
            rangeEl.dispatchEvent(new freshWin.Event('change'));
            await new Promise(r => setTimeout(r, 50));

            // fetchHistoryFromRTDB should have been called once for the new range
            expect(freshFetchMock).toHaveBeenCalled();

            const callArgs = freshFetchMock.mock.calls[0];
            const fromMs = callArgs[0];
            const toMs   = callArgs[1];

            // Verify the timestamps match the expected range
            if (rangeValue === 'week') {
              // Week range: from = Monday 00:00:00 of current week
              const now = new Date(beforeChange);
              const day = now.getDay();
              const mon = new Date(now);
              mon.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
              mon.setHours(0, 0, 0, 0);
              const sun = new Date(mon);
              sun.setDate(mon.getDate() + 6);
              sun.setHours(23, 59, 59, 999);

              // from should be Monday 00:00:00 (within ±5s of expected)
              expect(Math.abs(fromMs - mon.getTime())).toBeLessThanOrEqual(5000);
              // to should be Sunday 23:59:59 (within ±5s of expected)
              expect(Math.abs(toMs - sun.getTime())).toBeLessThanOrEqual(5000);
            } else if (rangeValue === 'month') {
              // Month range: from = 1st of current month, to = last day of current month
              const now = new Date(beforeChange);
              const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
              const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

              expect(Math.abs(fromMs - monthStart.getTime())).toBeLessThanOrEqual(5000);
              expect(Math.abs(toMs - monthEnd.getTime())).toBeLessThanOrEqual(5000);
            }

            // from must be before to
            expect(fromMs).toBeLessThan(toMs);
          } finally {
            globalThis.document = origDocument;
            globalThis.window   = origWindow;
          }
        }
      ),
      { numRuns: 4 } // 2 range values × 2 runs each
    );
  });

  // ── Observation: metric tab click calls updateHistoricalChart with null ────

  /**
   * Property 3.2: Metric Tab Visibility Toggle Preservation
   *
   * **Validates: Requirements 3.2**
   *
   * For any metric tab value in ['all', 'ph', 'do', 'turb', 'temp'], clicking
   * the tab calls updateHistoricalChart with null labels/data (no re-fetch).
   *
   * On UNFIXED code: metric tab clicks already call updateHistoricalChart(chart, null, null, metric)
   * without triggering a new fetchHistoryFromRTDB call.
   *
   * EXPECTED OUTCOME: Test PASSES on unfixed code (baseline behavior to preserve)
   */
  it('Property 3.2: Metric tab click calls updateHistoricalChart with null labels/data', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('all', 'ph', 'do', 'turb', 'temp'),
        async (metricValue) => {
          // Use a fresh JSDOM per run to avoid accumulated event listeners
          const html = readFileSync('public/index.html', 'utf-8');
          const freshDom = new JSDOM(html, {
            runScripts: 'dangerously',
            resources: 'usable',
            url: 'http://localhost',
          });
          const freshWin = freshDom.window;
          const freshDoc = freshDom.window.document;

          freshWin.Chart = vi.fn(() => ({
            resize: vi.fn(),
            update: vi.fn(),
            data: { labels: [], datasets: [] },
            destroy: vi.fn(),
          }));
          const freshFetchMock = vi.fn().mockResolvedValue([]);
          freshWin.fetchHistoryFromRTDB = freshFetchMock;
          freshWin.requestAnimationFrame = vi.fn(cb => cb());

          updateHistoricalChartMock.mockClear();

          const origDocument = globalThis.document;
          const origWindow   = globalThis.window;
          globalThis.document = freshDoc;
          globalThis.window   = freshWin;

          try {
            const { init } = await import('../public/js/features/historical-data.js');
            init();
            await new Promise(r => setTimeout(r, 50));

            // Clear calls from init
            updateHistoricalChartMock.mockClear();
            freshFetchMock.mockClear();

            // Find and click the metric tab button
            const tabBtn = freshDoc.querySelector(`.hist-metric-btn[data-metric="${metricValue}"]`);
            expect(tabBtn).not.toBeNull();

            tabBtn.click();
            await new Promise(r => setTimeout(r, 20));

            // updateHistoricalChart should have been called at least once
            expect(updateHistoricalChartMock).toHaveBeenCalled();

            // The call triggered by the tab click should pass null labels/data
            // (visibility toggle only — no re-fetch)
            const calls = updateHistoricalChartMock.mock.calls;
            // Find the call with null labels (the tab-click call)
            const tabCall = calls.find(args => args[1] === null && args[2] === null);
            expect(tabCall).toBeDefined();
            // activeMetric should match the clicked tab
            expect(tabCall[3]).toBe(metricValue);

            // fetchHistoryFromRTDB should NOT have been called after the tab click
            expect(freshFetchMock).not.toHaveBeenCalled();
          } finally {
            globalThis.document = origDocument;
            globalThis.window   = origWindow;
          }
        }
      ),
      { numRuns: 5 } // one run per metric value
    );
  });

  // ── Observation: sensor-reading-recorded event triggers loadChart ─────────

  /**
   * Property 3.3: Live Sensor Append Preservation
   *
   * **Validates: Requirements 3.3**
   *
   * When a sensor-reading-recorded event fires while the current time is within
   * the active range, loadChart() is called (which calls updateHistoricalChart).
   *
   * On UNFIXED code: the event listener calls loadChart() when now is within range.
   * Since the unfixed default is 'week' (Mon–Sun of current week), and now is always
   * within the current week, the event always triggers a chart reload.
   *
   * EXPECTED OUTCOME: Test PASSES on unfixed code (baseline behavior to preserve)
   */
  it('Property 3.3: sensor-reading-recorded event triggers chart reload when in range', async () => {
    // Use a fresh JSDOM to avoid accumulated event listeners
    const html = readFileSync('public/index.html', 'utf-8');
    const freshDom = new JSDOM(html, {
      runScripts: 'dangerously',
      resources: 'usable',
      url: 'http://localhost',
    });
    const freshWin = freshDom.window;
    const freshDoc = freshDom.window.document;

    freshWin.Chart = vi.fn(() => ({
      resize: vi.fn(),
      update: vi.fn(),
      data: { labels: [], datasets: [] },
      destroy: vi.fn(),
    }));
    const freshFetchMock = vi.fn().mockResolvedValue([]);
    freshWin.fetchHistoryFromRTDB = freshFetchMock;
    freshWin.requestAnimationFrame = vi.fn(cb => cb());

    updateHistoricalChartMock.mockClear();

    const origDocument = globalThis.document;
    const origWindow   = globalThis.window;
    globalThis.document = freshDoc;
    globalThis.window   = freshWin;

    try {
      const { init } = await import('../public/js/features/historical-data.js');
      init();
      await new Promise(r => setTimeout(r, 50));

      // Clear calls from init
      updateHistoricalChartMock.mockClear();
      freshFetchMock.mockClear();

      // Dispatch sensor-reading-recorded event
      // On unfixed code: activeRange is 'week', and now is within the current week,
      // so loadChart() should be called.
      freshWin.dispatchEvent(new freshWin.CustomEvent('sensor-reading-recorded'));
      await new Promise(r => setTimeout(r, 50));

      // updateHistoricalChart should have been called (via loadChart)
      // The event handler calls loadChart() for non-24h ranges when in range
      expect(updateHistoricalChartMock).toHaveBeenCalled();
    } finally {
      globalThis.document = origDocument;
      globalThis.window   = origWindow;
    }
  });
});
