/**
 * Water quality — threshold evaluation (server).
 * Module: backend/lib/threshold-eval.js
 * Demo: proves Normal / Warning / Critical from species bands (e.g. 31.3°C → Warning).
 */
import { describe, it, expect } from 'vitest';
import {
  mergeConfigThresholds,
  getBadgeForThresholds,
  buildAlertFromReading,
} from '../backend/lib/threshold-eval.js';
import { SPECIES_PRESETS } from '../backend/lib/species-presets.js';

describe('threshold-eval', () => {
  const crayfishThresholds = SPECIES_PRESETS.crayfish.thresholds;

  // Active config with no stored overrides → full crayfish preset (DO 5–8, etc.)
  it('mergeConfigThresholds uses preset when species set and no stored thresholds', () => {
    const merged = mergeConfigThresholds({ species: 'crayfish' });
    expect(merged.do.optimalMin).toBe(5);
    expect(merged.do.optimalMax).toBe(8);
  });

  // Saved per-field overrides merge on top of preset (custom optimalMin, keep preset max)
  it('mergeConfigThresholds overlays stored on preset', () => {
    const merged = mergeConfigThresholds({
      species: 'crayfish',
      thresholds: { do: { optimalMin: 6 } },
    });
    expect(merged.do.optimalMin).toBe(6);
    expect(merged.do.optimalMax).toBe(8);
  });

  // In-range pH → badge ok / label Normal; no alert payload
  it('getBadgeForThresholds returns Normal for optimal pH', () => {
    const t = crayfishThresholds;
    const badge = getBadgeForThresholds('ph', 7.0, t);
    expect(badge).toEqual({ c: 'ok', l: 'Normal' });
  });

  // Crayfish DO low warning band (4.5–4.99) → warn, not critical
  it('getBadgeForThresholds returns Warning for crayfish DO in acceptable band', () => {
    const t = crayfishThresholds;
    const badge = getBadgeForThresholds('do', 4.7, t);
    expect(badge.c).toBe('warn');
  });

  // Turbidity above acceptableMax → danger / Critical
  it('getBadgeForThresholds returns Critical for turbidity above acceptable', () => {
    const t = crayfishThresholds;
    const badge = getBadgeForThresholds('turb', 90, t);
    expect(badge.c).toBe('danger');
  });

  // Normal reading → buildAlertFromReading returns null (no notification)
  it('buildAlertFromReading returns null for normal reading', () => {
    const alert = buildAlertFromReading('ph', 7.0, {
      configId: 'c1',
      species: 'crayfish',
      thresholds: crayfishThresholds,
      pondLabel: 'Pond A',
    });
    expect(alert).toBeNull();
  });

  // Very low DO → critical severity in alert object for dispatch
  it('buildAlertFromReading returns alert for critical DO', () => {
    const alert = buildAlertFromReading('do', 4.0, {
      configId: 'c1',
      species: 'crayfish',
      thresholds: crayfishThresholds,
      pondLabel: 'Pond A',
    });
    expect(alert).not.toBeNull();
    expect(alert.severity).toBe('critical');
    expect(alert.key).toBe('do');
    expect(alert.resolved).toBe(false);
  });

  describe('±0.5 warning bands (standard temp/ph/do)', () => {
    const t = crayfishThresholds;
    const tilapiaThresholds = SPECIES_PRESETS.tilapia.thresholds;

    // Upper edge of normal band (31.0°C inclusive)
    it('temp 31.0 is Normal', () => {
      expect(getBadgeForThresholds('temp', 31.0, t).c).toBe('ok');
    });

    // Demo: 31.1–31.5°C → Warning (high band 31.01–31.5); fixes legacy gap to Critical
    it('temp 31.3 is Warning (was critical with legacy gap)', () => {
      expect(getBadgeForThresholds('temp', 31.3, t).c).toBe('warn');
    });

    // Above warning high band (31.5) → Critical
    it('temp 31.6 is Critical', () => {
      expect(getBadgeForThresholds('temp', 31.6, t).c).toBe('danger');
    });

    // Low warning band 24.5–24.99
    it('temp 24.7 is Warning', () => {
      expect(getBadgeForThresholds('temp', 24.7, t).c).toBe('warn');
    });

    // Below low warning → Critical
    it('temp 24.4 is Critical', () => {
      expect(getBadgeForThresholds('temp', 24.4, t).c).toBe('danger');
    });

    // pH high warning band 8.51–9.0
    it('ph 8.7 is Warning', () => {
      expect(getBadgeForThresholds('ph', 8.7, t).c).toBe('warn');
    });

    // Standard DO (tilapia) high warning 9.01–9.5
    it('tilapia DO 9.2 is Warning', () => {
      expect(getBadgeForThresholds('do', 9.2, tilapiaThresholds).c).toBe('warn');
    });

    // Alert payload uses severity "warning" (not critical) for dispatch/UI
    it('buildAlertFromReading severity is warning for temp 31.3', () => {
      const alert = buildAlertFromReading('temp', 31.3, {
        configId: 'c1',
        species: 'crayfish',
        thresholds: t,
        pondLabel: 'Pond A',
      });
      expect(alert).not.toBeNull();
      expect(alert.severity).toBe('warning');
    });
  });
});
