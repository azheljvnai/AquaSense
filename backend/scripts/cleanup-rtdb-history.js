/**
 * One-time cleanup script:
 * Deletes frontend-generated RTDB history entries so only ESP32 format remains.
 *
 * Keeps:
 *  - Keys like "YYYY-MM-DD_HH-MM-SS" (ESP32 format)
 *  - Objects with `timestamp: "YYYY-MM-DD HH:MM:SS"`
 *
 * Deletes (frontend-generated):
 *  - Numeric keys (e.g. "1777221106582")
 *  - Entries that contain a numeric `ts` field
 *
 * Usage (from repo root):
 *   node backend/scripts/cleanup-rtdb-history.js --device device001 --dry-run
 *   node backend/scripts/cleanup-rtdb-history.js --device device001
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env') });

import admin from 'firebase-admin';

function parseArgs(argv) {
  const args = { device: process.env.DEVICE_ID || 'device001', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--device' && argv[i + 1]) { args.device = argv[i + 1]; i++; continue; }
    if (a === '--dry-run') { args.dryRun = true; continue; }
  }
  return args;
}

function initAdmin() {
  if (admin.apps.length) return;
  const dbUrl = process.env.FIREBASE_DATABASE_URL;
  if (!dbUrl) throw new Error('FIREBASE_DATABASE_URL missing in .env');

  const saRel = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '';
  const saPath = saRel ? path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), saRel) : '';
  if (!saPath || !fs.existsSync(saPath)) {
    throw new Error('Service account JSON not found. Set FIREBASE_SERVICE_ACCOUNT_PATH in .env');
  }
  const serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL: dbUrl });
}

function isNumericKey(k) {
  return typeof k === 'string' && /^[0-9]{8,}$/.test(k);
}

function looksEsp32Key(k) {
  // "YYYY-MM-DD_HH-MM-SS"
  return typeof k === 'string' && /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(k);
}

function shouldDeleteEntry(key, value) {
  // Delete numeric keys unless they are clearly ESP32 keys (they won't be)
  if (isNumericKey(key)) return true;
  // Delete any entry that carries numeric ts (frontend schema)
  if (value && typeof value === 'object') {
    const ts = value.ts;
    if (typeof ts === 'number' && Number.isFinite(ts)) return true;
    // Some frontend writes store ts as string digits
    if (typeof ts === 'string' && /^[0-9]{8,}$/.test(ts)) return true;
  }
  return false;
}

async function main() {
  const { device, dryRun } = parseArgs(process.argv.slice(2));
  initAdmin();

  try {
    const histRef = admin.database().ref(`/devices/${device}/history`);
    const snap = await histRef.once('value');
    const hist = snap.val();

    if (!hist || typeof hist !== 'object') {
      console.log(`[cleanup] No history object found at /devices/${device}/history`);
      return;
    }

    let total = 0;
    let deleteCount = 0;
    let keepCount = 0;
    const updates = {};

    for (const [k, v] of Object.entries(hist)) {
      // Defensive: skip accidental "flat latest object" fields (like do/ph/temp/timestamp)
      // These are not keyed entries and shouldn't exist under history as top-level metrics.
      // If they appear, we keep them untouched to avoid unintended loss.
      if (!looksEsp32Key(k) && !isNumericKey(k) && typeof v !== 'object') {
        continue;
      }

      total++;
      if (shouldDeleteEntry(k, v)) {
        updates[k] = null;
        deleteCount++;
      } else {
        keepCount++;
      }
    }

    console.log(`[cleanup] Device: ${device}`);
    console.log(`[cleanup] Total children scanned: ${total}`);
    console.log(`[cleanup] Keep (ESP32/other): ${keepCount}`);
    console.log(`[cleanup] Delete (frontend numeric/ts): ${deleteCount}`);

    if (!deleteCount) return;
    if (dryRun) {
      console.log('[cleanup] Dry-run enabled. No changes written.');
      return;
    }

    // Chunk updates to avoid exceeding RTDB limits
    const keys = Object.keys(updates);
    const CHUNK = 500;
    for (let i = 0; i < keys.length; i += CHUNK) {
      const slice = keys.slice(i, i + CHUNK);
      const patch = {};
      for (const k of slice) patch[k] = null;
      await histRef.update(patch);
      console.log(`[cleanup] Deleted ${slice.length} entries (${i + slice.length}/${keys.length})`);
    }

    console.log('[cleanup] Done.');
  } finally {
    // Ensure Node exits (firebase-admin keeps sockets open)
    await Promise.allSettled(admin.apps.map((a) => a.delete()));
  }
}

main().catch((e) => {
  console.error('[cleanup] Failed:', e?.message || e);
  process.exitCode = 1;
});

