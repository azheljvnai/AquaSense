import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../public/js/firebase-client.js', () => ({
  fbGetIdToken: vi.fn(),
  fbFirestore: vi.fn(),
  fbAddDoc: vi.fn(),
  fbCollection: vi.fn(),
  fbServerTimestamp: vi.fn(),
}));

import {
  validateThresholds,
  mergeConfigThresholdsForForm,
  readThresholdsFromForm,
  fillThresholdForm,
} from '../public/js/threshold-form.js';
import { SPECIES_PRESETS } from '../public/js/pond-config.js';

const validThresholds = SPECIES_PRESETS.crayfish.thresholds;

describe('threshold-form', () => {
  describe('validateThresholds', () => {
    it('returns null for valid crayfish preset thresholds', () => {
      expect(validateThresholds(validThresholds)).toBeNull();
    });

    it('returns error when pH min exceeds max', () => {
      const t = JSON.parse(JSON.stringify(validThresholds));
      t.ph.optimalMin = 9;
      t.ph.optimalMax = 7;
      expect(validateThresholds(t)).toMatch(/pH normal min/);
    });

    it('returns error when turbidity max missing', () => {
      const t = JSON.parse(JSON.stringify(validThresholds));
      t.turb.optimalMax = null;
      expect(validateThresholds(t)).toMatch(/Turbidity normal max/);
    });
  });

  describe('mergeConfigThresholdsForForm', () => {
    it('merges species preset with stored overrides', () => {
      const merged = mergeConfigThresholdsForForm({
        species: 'crayfish',
        thresholds: { do: { optimalMin: 5.5 } },
      });
      expect(merged.do.optimalMin).toBe(5.5);
      expect(merged.do.optimalMax).toBe(8);
    });
  });

  describe('readThresholdsFromForm / fillThresholdForm', () => {
    let dom;

    beforeEach(() => {
      dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
      global.document = dom.window.document;
      document.body.innerHTML = `
        <input id="t-ph-opt-min" value="6.5" />
        <input id="t-ph-opt-max" value="8.5" />
        <input id="t-ph-warn-low-min" value="6.2" />
        <input id="t-ph-warn-low-max" value="6.4" />
        <input id="t-ph-warn-high-min" value="8.6" />
        <input id="t-ph-warn-high-max" value="8.8" />
        <input id="t-ph-crit-low" value="" />
        <input id="t-ph-crit-high" value="" />
        <input id="t-temp-opt-min" value="25" />
        <input id="t-temp-opt-max" value="31" />
        <input id="t-temp-warn-low-min" value="24" />
        <input id="t-temp-warn-low-max" value="24.5" />
        <input id="t-temp-warn-high-min" value="31.5" />
        <input id="t-temp-warn-high-max" value="32.5" />
        <input id="t-temp-crit-low" value="" />
        <input id="t-temp-crit-high" value="" />
        <input id="t-do-opt-min" value="5" />
        <input id="t-do-opt-max" value="8" />
        <input id="t-do-warn-low-min" value="4.5" />
        <input id="t-do-warn-low-max" value="4.99" />
        <input id="t-do-warn-high-min" value="8.01" />
        <input id="t-do-warn-high-max" value="8.5" />
        <input id="t-do-crit-low" value="" />
        <input id="t-do-crit-high" value="" />
        <input id="t-turb-opt-max" value="40" />
        <input id="t-turb-warn-max" value="80" />
        <input id="t-turb-crit-max" value="" />
      `;
    });

    afterEach(() => {
      delete global.document;
    });

    it('readThresholdsFromForm parses numeric fields', () => {
      const t = readThresholdsFromForm('t');
      expect(t.ph.optimalMin).toBe(6.5);
      expect(t.do.optimalMax).toBe(8);
      expect(t.turb.optimalMax).toBe(40);
    });

    it('fillThresholdForm round-trips with readThresholdsFromForm', () => {
      document.body.innerHTML = document.body.innerHTML.replace(/id="t-/g, 'id="t2-');
      fillThresholdForm('t2', validThresholds);
      const t = readThresholdsFromForm('t2');
      expect(t.ph.optimalMin).toBe(validThresholds.ph.optimalMin);
      expect(t.do.optimalMin).toBe(validThresholds.do.optimalMin);
    });
  });
});
