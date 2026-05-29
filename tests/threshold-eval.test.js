import { describe, it, expect } from 'vitest';
import {
  mergeConfigThresholds,
  getBadgeForThresholds,
  buildAlertFromReading,
} from '../backend/lib/threshold-eval.js';
import { SPECIES_PRESETS } from '../backend/lib/species-presets.js';

describe('threshold-eval', () => {
  const crayfishThresholds = SPECIES_PRESETS.crayfish.thresholds;

  it('mergeConfigThresholds uses preset when species set and no stored thresholds', () => {
    const merged = mergeConfigThresholds({ species: 'crayfish' });
    expect(merged.do.optimalMin).toBe(5);
    expect(merged.do.optimalMax).toBe(8);
  });

  it('mergeConfigThresholds overlays stored on preset', () => {
    const merged = mergeConfigThresholds({
      species: 'crayfish',
      thresholds: { do: { optimalMin: 6 } },
    });
    expect(merged.do.optimalMin).toBe(6);
    expect(merged.do.optimalMax).toBe(8);
  });

  it('getBadgeForThresholds returns Normal for optimal pH', () => {
    const t = crayfishThresholds;
    const badge = getBadgeForThresholds('ph', 7.0, t);
    expect(badge).toEqual({ c: 'ok', l: 'Normal' });
  });

  it('getBadgeForThresholds returns Warning for crayfish DO in acceptable band', () => {
    const t = crayfishThresholds;
    const badge = getBadgeForThresholds('do', 4.7, t);
    expect(badge.c).toBe('warn');
  });

  it('getBadgeForThresholds returns Critical for turbidity above acceptable', () => {
    const t = crayfishThresholds;
    const badge = getBadgeForThresholds('turb', 90, t);
    expect(badge.c).toBe('danger');
  });

  it('buildAlertFromReading returns null for normal reading', () => {
    const alert = buildAlertFromReading('ph', 7.0, {
      configId: 'c1',
      species: 'crayfish',
      thresholds: crayfishThresholds,
      pondLabel: 'Pond A',
    });
    expect(alert).toBeNull();
  });

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
});
