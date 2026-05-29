/**
 * Unit tests for updateNavigatorUI (exported from historical-data.js).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../public/js/charts.js', () => ({
  initHistoricalChart: vi.fn(() => null),
  updateHistoricalChart: vi.fn(),
}));
vi.mock('../public/js/utils.js', () => ({
  getHistoryRange: vi.fn(() => []),
  spkData: { ph: [], do: [], turb: [], temp: [] },
  mergeRtdbEntries: vi.fn(),
  getBadge: vi.fn(() => ({ c: 'ok', l: 'Normal' })),
}));

import { updateNavigatorUI } from '../public/js/features/historical-data.js';

describe('updateNavigatorUI', () => {
  let dom;
  let document;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-28T14:30:00'));

    dom = new JSDOM(`
      <!DOCTYPE html>
      <html><body>
        <div id="hist-week-nav" style="display:none">
          <button id="hist-week-prev"></button>
          <span id="hist-week-label"></span>
          <button id="hist-week-next"></button>
        </div>
        <div id="hist-month-nav" style="display:none">
          <button id="hist-month-prev"></button>
          <span id="hist-month-label"></span>
          <button id="hist-month-next"></button>
        </div>
      </body></html>
    `);
    document = dom.window.document;
    global.document = document;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete global.document;
  });

  it('shows week navigator and hides month navigator when range is week', () => {
    updateNavigatorUI('week', 0, 0);
    expect(document.getElementById('hist-week-nav').style.display).toBe('flex');
    expect(document.getElementById('hist-month-nav').style.display).toBe('none');
  });

  it('shows month navigator and hides week navigator when range is month', () => {
    updateNavigatorUI('month', 0, 0);
    expect(document.getElementById('hist-week-nav').style.display).toBe('none');
    expect(document.getElementById('hist-month-nav').style.display).toBe('flex');
  });

  it('hides both navigators for 24h and custom', () => {
    updateNavigatorUI('24h', 0, 0);
    expect(document.getElementById('hist-week-nav').style.display).toBe('none');
    expect(document.getElementById('hist-month-nav').style.display).toBe('none');

    updateNavigatorUI('custom', 0, 0);
    expect(document.getElementById('hist-week-nav').style.display).toBe('none');
    expect(document.getElementById('hist-month-nav').style.display).toBe('none');
  });

  it('sets week label with Mon–Sun range', () => {
    updateNavigatorUI('week', 0, 0);
    const label = document.getElementById('hist-week-label').textContent;
    expect(label).toMatch(/^Mon \d+ \w+ – Sun \d+ \w+ \d{4}$/);
  });

  it('disables week next at current week (offset >= 0)', () => {
    updateNavigatorUI('week', 0, 0);
    expect(document.getElementById('hist-week-next').disabled).toBe(true);
    updateNavigatorUI('week', -1, 0);
    expect(document.getElementById('hist-week-next').disabled).toBe(false);
  });

  it('sets month label and disables month next at current month', () => {
    updateNavigatorUI('month', 0, 0);
    expect(document.getElementById('hist-month-label').textContent).toContain('2026');
    expect(document.getElementById('hist-month-next').disabled).toBe(true);
    updateNavigatorUI('month', 0, -1);
    expect(document.getElementById('hist-month-next').disabled).toBe(false);
  });
});
