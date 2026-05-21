/**
 * Species threshold presets (mirrors public/js/pond-config.js SPECIES_PRESETS).
 */
export const SPECIES_PRESETS = {
  crayfish: {
    name: 'Crayfish',
    species: 'crayfish',
    thresholds: {
      ph: { optimalMin: 6.5, optimalMax: 8.5, acceptable1Min: null, acceptable1Max: 6.49, acceptable2Min: 8.51, acceptable2Max: null, stress1Min: null, stress1Max: null, stress2Min: null, stress2Max: null },
      temp: { optimalMin: 24, optimalMax: 30, acceptable1Min: 20, acceptable1Max: 23.99, acceptable2Min: 30.01, acceptable2Max: 33, stress1Min: null, stress1Max: 19.99, stress2Min: 33.01, stress2Max: null },
      do: { optimalMin: 5, acceptableMin: null, stressMin: null },
      turb: { optimalMax: 40, acceptableMax: 80, stressMax: null, warnMax: null },
    },
  },
  tilapia: {
    name: 'Tilapia',
    species: 'tilapia',
    thresholds: {
      ph: { optimalMin: 6.5, optimalMax: 8.5, acceptable1Min: null, acceptable1Max: 6.49, acceptable2Min: 8.51, acceptable2Max: null, stress1Min: null, stress1Max: null, stress2Min: null, stress2Max: null },
      temp: { optimalMin: 25, optimalMax: 32, acceptable1Min: null, acceptable1Max: 24.99, acceptable2Min: 32.01, acceptable2Max: null, stress1Min: null, stress1Max: null, stress2Min: null, stress2Max: null },
      do: { optimalMin: 5, acceptableMin: null, stressMin: null },
      turb: { optimalMax: 50, acceptableMax: 75, stressMax: 100, warnMax: null },
    },
  },
  catfish: {
    name: 'Catfish',
    species: 'catfish',
    thresholds: {
      ph: { optimalMin: 6.5, optimalMax: 9.0, acceptable1Min: null, acceptable1Max: 6.49, acceptable2Min: 9.01, acceptable2Max: null, stress1Min: null, stress1Max: null, stress2Min: null, stress2Max: null },
      temp: { optimalMin: 25, optimalMax: 32, acceptable1Min: null, acceptable1Max: 24.99, acceptable2Min: 32.01, acceptable2Max: null, stress1Min: null, stress1Max: null, stress2Min: null, stress2Max: null },
      do: { optimalMin: 5, acceptableMin: 3, stressMin: null },
      turb: { optimalMax: 70, acceptableMax: 100, stressMax: null, warnMax: null },
    },
  },
  shrimp: {
    name: 'Shrimp',
    species: 'shrimp',
    thresholds: {
      ph: { optimalMin: 7.2, optimalMax: 8.5, acceptable1Min: null, acceptable1Max: 7.19, acceptable2Min: 8.51, acceptable2Max: null, stress1Min: null, stress1Max: null, stress2Min: null, stress2Max: null },
      temp: { optimalMin: 28, optimalMax: 31, acceptable1Min: null, acceptable1Max: 27.99, acceptable2Min: 31.01, acceptable2Max: null, stress1Min: null, stress1Max: null, stress2Min: null, stress2Max: null },
      do: { optimalMin: 3, acceptableMin: null, stressMin: null },
      turb: { optimalMax: 25, acceptableMax: 50, stressMax: 100, warnMax: null },
    },
  },
};
