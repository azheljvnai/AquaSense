/**
 * Species Preset Seeding Script
 * Seeds the configurations collection with default species presets
 */
import admin from 'firebase-admin';

const SPECIES_PRESETS = {
  crayfish: {
    name: 'Crayfish',
    species: 'crayfish',
    thresholds: {
      ph: {
        optimalMin: 6.5,
        optimalMax: 8.5,
        acceptable1Min: null,
        acceptable1Max: 6.49,
        acceptable2Min: 8.51,
        acceptable2Max: null,
        stress1Min: null,
        stress1Max: null,
        stress2Min: null,
        stress2Max: null,
      },
      temp: {
        optimalMin: 24,
        optimalMax: 30,
        acceptable1Min: 20,
        acceptable1Max: 23.99,
        acceptable2Min: 30.01,
        acceptable2Max: 33,
        stress1Min: null,
        stress1Max: 19.99,
        stress2Min: 33.01,
        stress2Max: null,
      },
      do: {
        optimalMin: 5,
        acceptableMin: null,
        stressMin: null,
      },
      turb: {
        optimalMax: 40,
        acceptableMax: 80,
        stressMax: null,
        warnMax: null,
      },
    },
  },
  tilapia: {
    name: 'Tilapia',
    species: 'tilapia',
    thresholds: {
      ph: {
        optimalMin: 6.5,
        optimalMax: 8.5,
        acceptable1Min: null,
        acceptable1Max: 6.49,
        acceptable2Min: 8.51,
        acceptable2Max: null,
        stress1Min: null,
        stress1Max: null,
        stress2Min: null,
        stress2Max: null,
      },
      temp: {
        optimalMin: 25,
        optimalMax: 32,
        acceptable1Min: null,
        acceptable1Max: 24.99,
        acceptable2Min: 32.01,
        acceptable2Max: null,
        stress1Min: null,
        stress1Max: null,
        stress2Min: null,
        stress2Max: null,
      },
      do: {
        optimalMin: 5,
        acceptableMin: null,
        stressMin: null,
      },
      turb: {
        optimalMax: 50,
        acceptableMax: 75,
        stressMax: 100,
        warnMax: null,
      },
    },
  },
  catfish: {
    name: 'Catfish',
    species: 'catfish',
    thresholds: {
      ph: {
        optimalMin: 6.5,
        optimalMax: 9.0,
        acceptable1Min: null,
        acceptable1Max: 6.49,
        acceptable2Min: 9.01,
        acceptable2Max: null,
        stress1Min: null,
        stress1Max: null,
        stress2Min: null,
        stress2Max: null,
      },
      temp: {
        optimalMin: 25,
        optimalMax: 32,
        acceptable1Min: null,
        acceptable1Max: 24.99,
        acceptable2Min: 32.01,
        acceptable2Max: null,
        stress1Min: null,
        stress1Max: null,
        stress2Min: null,
        stress2Max: null,
      },
      do: {
        optimalMin: 5,
        acceptableMin: 3,
        stressMin: null,
      },
      turb: {
        optimalMax: 70,
        acceptableMax: 100,
        stressMax: null,
        warnMax: null,
      },
    },
  },
  shrimp: {
    name: 'Shrimp',
    species: 'shrimp',
    thresholds: {
      ph: {
        optimalMin: 7.2,
        optimalMax: 8.5,
        acceptable1Min: null,
        acceptable1Max: 7.19,
        acceptable2Min: 8.51,
        acceptable2Max: null,
        stress1Min: null,
        stress1Max: null,
        stress2Min: null,
        stress2Max: null,
      },
      temp: {
        optimalMin: 28,
        optimalMax: 31,
        acceptable1Min: null,
        acceptable1Max: 27.99,
        acceptable2Min: 31.01,
        acceptable2Max: null,
        stress1Min: null,
        stress1Max: null,
        stress2Min: null,
        stress2Max: null,
      },
      do: {
        optimalMin: 3,
        acceptableMin: null,
        stressMin: null,
      },
      turb: {
        optimalMax: 25,
        acceptableMax: 50,
        stressMax: 100,
        warnMax: null,
      },
    },
  },
};

/**
 * Seed species presets to Firestore configurations collection
 * @returns {Promise<void>}
 */
export async function seedSpeciesPresets() {
  if (!admin.apps.length) {
    console.warn('[Preset Seeding] Admin SDK not initialized. Skipping preset seeding.');
    return;
  }

  const fs = admin.firestore();
  let seededCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  console.log('[Preset Seeding] Starting species preset seeding...');

  for (const [species, preset] of Object.entries(SPECIES_PRESETS)) {
    try {
      const docRef = fs.collection('configurations').doc(species);
      const docSnap = await docRef.get();

      if (docSnap.exists) {
        // Update existing preset with new thresholds
        await docRef.set(
          {
            name: preset.name,
            species: preset.species,
            thresholds: preset.thresholds,
            isPreset: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        updatedCount++;
        console.log(`[Preset Seeding] Updated preset: ${preset.name}`);
      } else {
        // Create new preset
        await docRef.set({
          name: preset.name,
          species: preset.species,
          thresholds: preset.thresholds,
          isPreset: true,
          isActive: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        seededCount++;
        console.log(`[Preset Seeding] Created preset: ${preset.name}`);
      }
    } catch (e) {
      console.error(`[Preset Seeding] Failed to seed ${preset.name}:`, e.message);
      skippedCount++;
    }
  }

  console.log(`[Preset Seeding] Complete: ${seededCount} created, ${updatedCount} updated, ${skippedCount} skipped`);
}

/**
 * Check if presets need seeding (called on server startup)
 * @returns {Promise<boolean>} True if seeding was performed
 */
export async function checkAndSeedPresets() {
  if (!admin.apps.length) {
    return false;
  }

  try {
    const fs = admin.firestore();
    const presetsSnap = await fs
      .collection('configurations')
      .where('isPreset', '==', true)
      .limit(1)
      .get();

    if (presetsSnap.empty) {
      console.log('[Preset Seeding] No presets found. Seeding default presets...');
      await seedSpeciesPresets();
      return true;
    }

    console.log('[Preset Seeding] Presets already exist. Skipping seeding.');
    return false;
  } catch (e) {
    console.error('[Preset Seeding] Error checking presets:', e.message);
    return false;
  }
}
