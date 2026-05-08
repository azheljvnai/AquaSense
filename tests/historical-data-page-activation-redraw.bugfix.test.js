// tests/historical-data-page-activation-redraw.bugfix.test.js
// Bugfix: historical-data-blank-canvas — Regression test
//
// When the Historical Data page is activated (made visible), the feature should
// force a resize + redraw so the canvas can't remain blank until a manual range switch.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';

let lastChart = null;

vi.mock('../public/js/charts.js', () => ({
  initHistoricalChart: vi.fn(() => {
    lastChart = { resize: vi.fn(), update: vi.fn(), data: { labels: [], datasets: [] } };
    return lastChart;
  }),
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
  spkData: { ph: [], do: [], turb: [], temp: [] },
  mergeRtdbEntries: vi.fn(),
}));

describe('Historical Data — redraw on page activation', () => {
  beforeEach(() => {
    vi.resetModules();
    lastChart = null;
  });

  it('dispatching page-activated(historical-data) triggers a chart update', async () => {
    const html = readFileSync('public/index.html', 'utf-8');
    const dom = new JSDOM(html, { url: 'http://localhost' });

    const origDocument = globalThis.document;
    const origWindow = globalThis.window;
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;

    // Stub requestAnimationFrame used by resizeAndScrollChart
    globalThis.window.requestAnimationFrame = vi.fn(cb => cb());

    try {
      const { init } = await import('../public/js/features/historical-data.js');
      init();

      expect(lastChart).toBeTruthy();
      lastChart.update.mockClear();

      globalThis.window.dispatchEvent(new globalThis.window.CustomEvent('page-activated', { detail: { page: 'historical-data' } }));

      expect(lastChart.update).toHaveBeenCalled();
    } finally {
      globalThis.document = origDocument;
      globalThis.window = origWindow;
    }
  });
});

