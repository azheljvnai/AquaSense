/**
 * Cleanup Duplicate Presets Script
 * Removes duplicate preset configurations, keeping only the ones with fixed IDs
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

const VALID_PRESET_IDS = ['crayfish', 'tilapia', 'catfish', 'shrimp'];

/**
 * Remove duplicate preset configurations
 * Keeps only presets with IDs matching the species name
 */
async function cleanupDuplicatePresets() {
  const fs = admin.firestore();
  
  console.log('[Cleanup] Starting duplicate preset cleanup...');
  
  try {
    // Get all preset configurations
    const presetsSnap = await fs
      .collection('configurations')
      .where('isPreset', '==', true)
      .get();
    
    console.log(`[Cleanup] Found ${presetsSnap.size} preset configurations`);
    
    let deletedCount = 0;
    let keptCount = 0;
    
    for (const doc of presetsSnap.docs) {
      const id = doc.id;
      const data = doc.data();
      
      // Keep presets with valid IDs (species names)
      if (VALID_PRESET_IDS.includes(id)) {
        console.log(`[Cleanup] Keeping valid preset: ${id} (${data.name})`);
        keptCount++;
      } else {
        // Delete duplicate presets with random IDs
        console.log(`[Cleanup] Deleting duplicate preset: ${id} (${data.name}, species: ${data.species})`);
        await doc.ref.delete();
        deletedCount++;
      }
    }
    
    console.log(`[Cleanup] Complete: ${keptCount} kept, ${deletedCount} deleted`);
    
    // Verify the cleanup
    const remainingPresetsSnap = await fs
      .collection('configurations')
      .where('isPreset', '==', true)
      .get();
    
    console.log(`[Cleanup] Remaining presets: ${remainingPresetsSnap.size}`);
    remainingPresetsSnap.forEach(doc => {
      console.log(`  - ${doc.id}: ${doc.data().name}`);
    });
    
  } catch (e) {
    console.error('[Cleanup] Error:', e.message);
    throw e;
  }
}

// Run the cleanup
cleanupDuplicatePresets()
  .then(() => {
    console.log('[Cleanup] Script completed successfully');
    process.exit(0);
  })
  .catch((e) => {
    console.error('[Cleanup] Script failed:', e);
    process.exit(1);
  });
