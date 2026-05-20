/**
 * RTDB history cleanup:
 *  - Default: delete frontend-generated numeric-key / ts-field entries
 *  - --delete-keys: remove specific history (and feedLog) keys
 *  - --purge-before: remove ESP32-style keys dated before YYYY-MM-DD (e.g. epoch junk)
 *  - --inspect: print /sensors freshness and latest history keys (no writes)
 *
 * Usage (from repo root):
 *   node backend/scripts/cleanup-rtdb-history.js --device device001 --dry-run
 *   node backend/scripts/cleanup-rtdb-history.js --device device001
 *   node backend/scripts/cleanup-rtdb-history.js --device device001 --delete-keys 1970-01-01_08-00-31,1970-01-01_08-01-01
 *   node backend/scripts/cleanup-rtdb-history.js --device device001 --purge-before 2000-01-01 --dry-run
 *   node backend/scripts/cleanup-rtdb-history.js --device device001 --inspect
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
  const args = {
    device: process.env.DEVICE_ID || 'device001',
    dryRun: false,
    deleteKeys: [],
    purgeBefore: null,
    inspect: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--device' && argv[i + 1]) { args.device = argv[i + 1]; i++; continue; }
    if (a === '--delete-keys' && argv[i + 1]) {
      args.deleteKeys = argv[i + 1].split(',').map((k) => k.trim()).filter(Boolean);
      i++;
      continue;
    }
    if (a === '--purge-before' && argv[i + 1]) { args.purgeBefore = argv[i + 1]; i++; continue; }
    if (a === '--inspect') { args.inspect = true; continue; }
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
  return typeof k === 'string' && /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(k);
}

function parseEsp32KeyDate(key) {
  if (!looksEsp32Key(key)) return null;
  const [date] = key.split('_');
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function shouldDeleteEntry(key, value) {
  if (isNumericKey(key)) return true;
  if (value && typeof value === 'object') {
    const ts = value.ts;
    if (typeof ts === 'number' && Number.isFinite(ts)) return true;
    if (typeof ts === 'string' && /^[0-9]{8,}$/.test(ts)) return true;
  }
  return false;
}

function shouldPurgeEsp32Key(key, purgeBeforeDate) {
  if (!purgeBeforeDate || !looksEsp32Key(key)) return false;
  const entryDate = parseEsp32KeyDate(key);
  if (!entryDate) return false;
  return entryDate.getTime() < purgeBeforeDate.getTime();
}

async function applyDeletes(ref, keys, label, dryRun) {
  if (!keys.length) return 0;
  if (dryRun) {
    console.log(`[cleanup] ${label}: would delete ${keys.length} key(s): ${keys.join(', ')}`);
    return keys.length;
  }
  const patch = {};
  for (const k of keys) patch[k] = null;
  await ref.update(patch);
  console.log(`[cleanup] ${label}: deleted ${keys.length} key(s): ${keys.join(', ')}`);
  return keys.length;
}

async function deleteSpecificKeys(device, keys, dryRun) {
  const histRef = admin.database().ref(`/devices/${device}/history`);
  const feedRef = admin.database().ref(`/devices/${device}/feedLog`);
  let total = 0;
  total += await applyDeletes(histRef, keys, 'history', dryRun);
  total += await applyDeletes(feedRef, keys, 'feedLog', dryRun);
  return total;
}

async function purgeBeforeDate(device, purgeBefore, dryRun) {
  const cutoff = new Date(purgeBefore + 'T00:00:00');
  if (Number.isNaN(cutoff.getTime())) {
    throw new Error(`Invalid --purge-before date: ${purgeBefore}`);
  }

  const histRef = admin.database().ref(`/devices/${device}/history`);
  const snap = await histRef.once('value');
  const hist = snap.val();
  if (!hist || typeof hist !== 'object') {
    console.log(`[cleanup] No history at /devices/${device}/history`);
    return 0;
  }

  const toDelete = [];
  for (const k of Object.keys(hist)) {
    if (shouldPurgeEsp32Key(k, cutoff)) toDelete.push(k);
  }

  console.log(`[cleanup] --purge-before ${purgeBefore}: ${toDelete.length} ESP32 key(s) to remove`);
  if (toDelete.length && toDelete.length <= 20) {
    console.log(`[cleanup] Keys: ${toDelete.join(', ')}`);
  } else if (toDelete.length > 20) {
    console.log(`[cleanup] First 10: ${toDelete.slice(0, 10).join(', ')} ...`);
  }

  return applyDeletes(histRef, toDelete, 'history (purge-before)', dryRun);
}

function formatTs(ms) {
  if (!Number.isFinite(ms)) return '(invalid)';
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

async function inspectDevice(device) {
  const db = admin.database();
  const sensorsSnap = await db.ref(`/devices/${device}/sensors`).once('value');
  const sensors = sensorsSnap.val();

  console.log(`[inspect] Device: ${device}`);
  console.log('[inspect] /sensors:');
  if (!sensors || typeof sensors !== 'object') {
    console.log('  (empty or missing)');
  } else {
    const ts = Number(sensors.ts);
    const ageMin = Number.isFinite(ts) ? Math.round((Date.now() - ts) / 60000) : null;
    console.log(`  ts: ${sensors.ts} (${Number.isFinite(ts) ? formatTs(ts) : 'n/a'})`);
    if (ageMin != null) console.log(`  age: ${ageMin} minute(s) ago`);
    console.log(`  ph=${sensors.ph} do=${sensors.do} turb=${sensors.turb} temp=${sensors.temp}`);
  }

  const histRef = db.ref(`/devices/${device}/history`);
  const histSnap = await histRef.once('value');
  const hist = histSnap.val();
  const keys = hist && typeof hist === 'object' ? Object.keys(hist) : [];
  const esp32Keys = keys.filter(looksEsp32Key).sort();
  const epochKeys = esp32Keys.filter((k) => k.startsWith('1970-'));
  const recentKeys = esp32Keys.filter((k) => k >= '2026-05-17').slice(-15);

  console.log(`[inspect] /history: ${keys.length} total children, ${esp32Keys.length} ESP32-style keys`);
  if (epochKeys.length) {
    console.log(`[inspect] Epoch-era keys (${epochKeys.length}): ${epochKeys.join(', ')}`);
  }
  console.log('[inspect] Latest keys from 2026-05-17 onward (up to 15):');
  if (recentKeys.length) {
    for (const k of recentKeys) {
      const v = hist[k];
      const ts = v?.timestamp ?? v?.ts ?? '';
      console.log(`  ${k}  timestamp=${ts}  ph=${v?.ph} do=${v?.do} turb=${v?.turb} temp=${v?.temp}`);
    }
  } else {
    console.log('  (none found)');
  }

  const lastKey = esp32Keys.length ? esp32Keys[esp32Keys.length - 1] : null;
  if (lastKey) {
    console.log(`[inspect] Newest ESP32 key overall: ${lastKey}`);
  }
}

async function runDefaultCleanup(device, dryRun) {
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
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  initAdmin();

  try {
    if (args.inspect) {
      await inspectDevice(args.device);
      return;
    }

    if (args.deleteKeys.length) {
      const n = await deleteSpecificKeys(args.device, args.deleteKeys, args.dryRun);
      if (!n) console.log('[cleanup] No matching keys deleted (may already be gone).');
      else if (args.dryRun) console.log('[cleanup] Dry-run complete.');
      else console.log('[cleanup] Done.');
      return;
    }

    if (args.purgeBefore) {
      const n = await purgeBeforeDate(args.device, args.purgeBefore, args.dryRun);
      if (!n) console.log('[cleanup] Nothing to purge.');
      else if (args.dryRun) console.log('[cleanup] Dry-run complete.');
      else console.log('[cleanup] Done.');
      return;
    }

    await runDefaultCleanup(args.device, args.dryRun);
  } finally {
    await Promise.allSettled(admin.apps.map((a) => a.delete()));
  }
}

main().catch((e) => {
  console.error('[cleanup] Failed:', e?.message || e);
  process.exitCode = 1;
});
