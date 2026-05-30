/**
 * Species threshold presets (mirrors public/js/pond-config.js SPECIES_PRESETS).
 */

/** Shared ph / temp / do bands (turbidity remains species-specific). */
export const STANDARD_SENSOR_THRESHOLDS = {
  ph: {
    optimalMin: 6.5,
    optimalMax: 8.5,
    acceptable1Min: 6.0,
    acceptable1Max: 6.49,
    acceptable2Min: 8.51,
    acceptable2Max: 9.0,
    stress1Min: null,
    stress1Max: 5.99,
    stress2Min: 9.01,
    stress2Max: null,
  },
  temp: {
    optimalMin: 25,
    optimalMax: 31,
    acceptable1Min: 24.5,
    acceptable1Max: 24.99,
    acceptable2Min: 31.01,
    acceptable2Max: 31.5,
    stress1Min: null,
    stress1Max: 24.49,
    stress2Min: 31.51,
    stress2Max: null,
  },
  do: {
    optimalMin: 6,
    optimalMax: 9,
    acceptable1Min: 5.5,
    acceptable1Max: 5.99,
    acceptable2Min: 9.01,
    acceptable2Max: 9.5,
    stress1Min: null,
    stress1Max: 5.49,
    stress2Min: 9.51,
    stress2Max: null,
  },
};

/** Pre-migration bands (±0.5 warning gap). Used to upgrade stored Firestore configs. */
export const LEGACY_STANDARD_SENSOR_THRESHOLDS = {
  ph: {
    optimalMin: 6.5,
    optimalMax: 8.5,
    acceptable1Min: 6.2,
    acceptable1Max: 6.4,
    acceptable2Min: 8.6,
    acceptable2Max: 8.8,
    stress1Min: null,
    stress1Max: 6.19,
    stress2Min: 8.81,
    stress2Max: null,
  },
  temp: {
    optimalMin: 25,
    optimalMax: 31,
    acceptable1Min: 24,
    acceptable1Max: 24.5,
    acceptable2Min: 31.5,
    acceptable2Max: 32.5,
    stress1Min: null,
    stress1Max: 23.99,
    stress2Min: 32.51,
    stress2Max: null,
  },
  do: {
    optimalMin: 6,
    optimalMax: 9,
    acceptable1Min: 5,
    acceptable1Max: 6,
    acceptable2Min: 10,
    acceptable2Max: 12,
    stress1Min: null,
    stress1Max: 4.99,
    stress2Min: 12.01,
    stress2Max: null,
  },
};

function bandEquals(a, b) {
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Replace ph/temp/do bands that exactly match legacy standard presets.
 * Skips customized bands and crayfish DO (non-legacy).
 * @param {object|null} thresholds - stored configuration thresholds
 * @returns {{ thresholds: object|null, changed: boolean }}
 */
export function migrateLegacyStandardBands(thresholds) {
  if (!thresholds || typeof thresholds !== 'object') {
    return { thresholds, changed: false };
  }

  const legacy = LEGACY_STANDARD_SENSOR_THRESHOLDS;
  const next = { ...thresholds };
  let changed = false;

  for (const key of ['ph', 'temp']) {
    if (bandEquals(thresholds[key], legacy[key])) {
      next[key] = { ...STANDARD_SENSOR_THRESHOLDS[key] };
      changed = true;
    }
  }

  if (bandEquals(thresholds.do, legacy.do)) {
    next.do = { ...STANDARD_SENSOR_THRESHOLDS.do };
    changed = true;
  }

  return { thresholds: changed ? next : thresholds, changed };
}

/** Crayfish DO — optimal 5–8 mg/L; warning ±0.5 outside that band. */
export const CRAYFISH_DO_THRESHOLDS = {
  optimalMin: 5,
  optimalMax: 8,
  acceptable1Min: 4.5,
  acceptable1Max: 4.99,
  acceptable2Min: 8.01,
  acceptable2Max: 8.5,
  stress1Min: null,
  stress1Max: 4.49,
  stress2Min: 8.51,
  stress2Max: null,
};

export const SPECIES_PRESETS = {
  crayfish: {
    name: 'Crayfish',
    species: 'crayfish',
    thresholds: {
      ph: { ...STANDARD_SENSOR_THRESHOLDS.ph },
      temp: { ...STANDARD_SENSOR_THRESHOLDS.temp },
      do: { ...CRAYFISH_DO_THRESHOLDS },
      turb: { optimalMax: 40, acceptableMax: 80, stressMax: null, warnMax: null },
    },
  },
  tilapia: {
    name: 'Tilapia',
    species: 'tilapia',
    thresholds: {
      ph: { ...STANDARD_SENSOR_THRESHOLDS.ph },
      temp: { ...STANDARD_SENSOR_THRESHOLDS.temp },
      do: { ...STANDARD_SENSOR_THRESHOLDS.do },
      turb: { optimalMax: 50, acceptableMax: 75, stressMax: 100, warnMax: null },
    },
  },
  catfish: {
    name: 'Catfish',
    species: 'catfish',
    thresholds: {
      ph: { ...STANDARD_SENSOR_THRESHOLDS.ph },
      temp: { ...STANDARD_SENSOR_THRESHOLDS.temp },
      do: { ...STANDARD_SENSOR_THRESHOLDS.do },
      turb: { optimalMax: 70, acceptableMax: 100, stressMax: null, warnMax: null },
    },
  },
  shrimp: {
    name: 'Shrimp',
    species: 'shrimp',
    thresholds: {
      ph: { ...STANDARD_SENSOR_THRESHOLDS.ph },
      temp: { ...STANDARD_SENSOR_THRESHOLDS.temp },
      do: { ...STANDARD_SENSOR_THRESHOLDS.do },
      turb: { optimalMax: 25, acceptableMax: 50, stressMax: 100, warnMax: null },
    },
  },
};

/**
 * Migrate all configuration documents with legacy standard warning bands.
 * @param {import('firebase-admin').firestore.Firestore} fsDb
 * @returns {Promise<{ scanned: number, updated: number }>}
 */
export async function migrateAllConfigurationWarningBands(fsDb) {
  const snap = await fsDb.collection('configurations').get();
  let updated = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const { thresholds, changed } = migrateLegacyStandardBands(data.thresholds || null);
    if (!changed) continue;

    await doc.ref.set(
      {
        thresholds,
        warningBandsMigratedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    updated++;
  }

  return { scanned: snap.size, updated };
}
