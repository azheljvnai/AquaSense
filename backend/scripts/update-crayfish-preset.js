/**
 * Update Crayfish Preset Script
 * Updates the crayfish preset with the correct temperature thresholds
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(
    readFileSync('../serviceAccountKey.json', 'utf8')
  );
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const CRAYFISH_PRESET = {
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
      // Normal: 24–30°C
      optimalMin: 24,
      optimalMax: 30,
      // Warning: 20–23°C or 31–33°C
      acceptable1Min: 20,
      acceptable1Max: 23.99,
      acceptable2Min: 30.01,
      acceptable2Max: 33,
      // Critical: Below 20°C or Above 33°C
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
};

/**
 * Update the crayfish preset in Firestore
 */
async function updateCrayfishPreset() {
  const fs = admin.firestore();
  
  console.log('[Update] Updating crayfish preset...');
  
  try {
    const docRef = fs.collection('configurations').doc('crayfish');
    const docSnap = await docRef.get();
    
    if (!docSnap.exists) {
      console.log('[Update] Crayfish preset not found. Creating it...');
      await docRef.set({
        ...CRAYFISH_PRESET,
        isPreset: true,
        isActive: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log('[Update] Crayfish preset created successfully');
    } else {
      console.log('[Update] Crayfish preset found. Updating thresholds...');
      await docRef.set(
        {
          name: CRAYFISH_PRESET.name,
          species: CRAYFISH_PRESET.species,
          thresholds: CRAYFISH_PRESET.thresholds,
          isPreset: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      console.log('[Update] Crayfish preset updated successfully');
    }
    
    // Display the updated thresholds
    const updated = await docRef.get();
    const data = updated.data();
    console.log('\n[Update] Current crayfish temperature thresholds:');
    console.log('  Normal (Optimal): ', data.thresholds.temp.optimalMin, '°C -', data.thresholds.temp.optimalMax, '°C');
    console.log('  Warning (Acceptable): ', data.thresholds.temp.acceptable1Min, '°C -', data.thresholds.temp.acceptable1Max, '°C or', data.thresholds.temp.acceptable2Min, '°C -', data.thresholds.temp.acceptable2Max, '°C');
    console.log('  Critical (Stress): Below', data.thresholds.temp.stress1Max, '°C or Above', data.thresholds.temp.stress2Min, '°C');
    
  } catch (e) {
    console.error('[Update] Error:', e.message);
    throw e;
  }
}

// Run the update
updateCrayfishPreset()
  .then(() => {
    console.log('\n[Update] Script completed successfully');
    process.exit(0);
  })
  .catch((e) => {
    console.error('[Update] Script failed:', e);
    process.exit(1);
  });
