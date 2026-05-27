/**
 * Species Preset Seeding Script
 * Seeds the configurations collection with default species presets
 */
import admin from 'firebase-admin';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { SPECIES_PRESETS } from '../lib/species-presets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function initAdminFromEnv() {
  if (admin.apps.length) return;

  const { config: dotenvConfig } = createRequire(import.meta.url)('dotenv');
  dotenvConfig({ path: path.join(__dirname, '..', '..', '.env') });
  dotenvConfig({ path: path.join(__dirname, '..', '.env') });

  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(saJson)),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    return;
  }

  const candidates = [];
  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const p = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    candidates.push(path.isAbsolute(p) ? p : path.resolve(__dirname, '..', '..', p));
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    candidates.push(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }
  candidates.push(path.join(path.sep, 'etc', 'secrets', 'serviceAccountKey.json'));
  candidates.push(path.resolve(__dirname, '..', '..', 'serviceAccountKey.json'));

  const saPath = candidates.find(p => p && fs.existsSync(p)) || null;
  if (!saPath) {
    throw new Error('Firebase Admin credentials not found. Set FIREBASE_SERVICE_ACCOUNT_JSON or place serviceAccountKey.json.');
  }

  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(fs.readFileSync(saPath, 'utf8'))),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

/**
 * Seed species presets to Firestore configurations collection
 * @returns {Promise<void>}
 */
export async function seedSpeciesPresets() {
  if (!admin.apps.length) {
    console.warn('[Preset Seeding] Admin SDK not initialized. Skipping preset seeding.');
    return;
  }

  const fsDb = admin.firestore();
  let seededCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  console.log('[Preset Seeding] Starting species preset seeding...');

  for (const [species, preset] of Object.entries(SPECIES_PRESETS)) {
    try {
      const docRef = fsDb.collection('configurations').doc(species);
      const docSnap = await docRef.get();

      if (docSnap.exists) {
        await docRef.set(
          {
            name: preset.name,
            species: preset.species,
            thresholds: preset.thresholds,
            isPreset: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        updatedCount++;
        console.log(`[Preset Seeding] Updated preset: ${preset.name}`);
      } else {
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
    const fsDb = admin.firestore();
    const presetsSnap = await fsDb
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

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  initAdminFromEnv();
  seedSpeciesPresets()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Preset Seeding] Failed:', err);
      process.exit(1);
    });
}
