/**
 * Water quality — Firestore threshold migration.
 * Module: backend/lib/species-presets.js migrateLegacyStandardBands
 * Demo: configs with old warning gaps upgrade to ±0.5 bands; custom edits are preserved.
 */
import { describe, it, expect } from 'vitest';
import {
  migrateLegacyStandardBands,
  LEGACY_STANDARD_SENSOR_THRESHOLDS,
  STANDARD_SENSOR_THRESHOLDS,
  CRAYFISH_DO_THRESHOLDS,
} from '../backend/lib/species-presets.js';

describe('migrateLegacyStandardBands', () => {
  // Stored temp exactly matches legacy preset → replace with new bands (31.01–31.5 warning high)
  it('replaces legacy temp band with new standard band', () => {
    const stored = {
      temp: { ...LEGACY_STANDARD_SENSOR_THRESHOLDS.temp },
      do: { ...CRAYFISH_DO_THRESHOLDS },
    };
    const { thresholds, changed } = migrateLegacyStandardBands(stored);
    expect(changed).toBe(true);
    expect(thresholds.temp).toEqual(STANDARD_SENSOR_THRESHOLDS.temp);
    expect(thresholds.do).toEqual(CRAYFISH_DO_THRESHOLDS);
  });

  // User changed optimalMin → do not overwrite entire temp object
  it('leaves customized temp band unchanged', () => {
    const customTemp = {
      ...LEGACY_STANDARD_SENSOR_THRESHOLDS.temp,
      optimalMin: 26,
    };
    const stored = { temp: customTemp };
    const { thresholds, changed } = migrateLegacyStandardBands(stored);
    expect(changed).toBe(false);
    expect(thresholds.temp.optimalMin).toBe(26);
  });

  // Tilapia-style legacy DO migrates; crayfish DO band is different and untouched
  it('migrates legacy standard DO but not crayfish DO', () => {
    const legacyDo = { ...LEGACY_STANDARD_SENSOR_THRESHOLDS.do };
    const { thresholds: migrated, changed } = migrateLegacyStandardBands({ do: legacyDo });
    expect(changed).toBe(true);
    expect(migrated.do).toEqual(STANDARD_SENSOR_THRESHOLDS.do);

    const crayfish = migrateLegacyStandardBands({
      do: { ...CRAYFISH_DO_THRESHOLDS },
    });
    expect(crayfish.changed).toBe(false);
  });

  it('returns unchanged when thresholds null', () => {
    const result = migrateLegacyStandardBands(null);
    expect(result.changed).toBe(false);
    expect(result.thresholds).toBeNull();
  });
});
