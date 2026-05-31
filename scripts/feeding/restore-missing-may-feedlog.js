/**
 * Re-insert purged scheduled feedLog entries for May 2026 (device001 default).
 * Skips any timestamp that already exists in feedLog.
 *
 * Requires FIREBASE_DATABASE_URL and service account (same as patch-feedlog-device001.js).
 *
 * Usage:
 *   node scripts/feeding/restore-missing-may-feedlog.js
 *   DEVICE_ID=device001 node scripts/feeding/restore-missing-may-feedlog.js
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '../../backend/package.json'));
const admin = require('firebase-admin');

const DEVICE_ID = process.env.DEVICE_ID || 'device001';
const AMOUNT_LABEL = '~200-300mg';
const FEED_TIME = '19:00:00';

/** Purged / missing scheduled feeds (7pm slot). */
const MISSING_TIMESTAMPS = [
  '2026-05-09 19:00:00',
  '2026-05-16 19:00:00',
  '2026-05-23 19:00:00',
  '2026-05-24 19:00:00',
  '2026-05-26 19:00:00',
  '2026-05-28 19:00:00',
  '2026-05-30 19:00:00',
];

function initAdminFromEnv() {
  if (admin.apps.length) return;

  const { config: dotenvConfig } = require('dotenv');
  dotenvConfig({ path: path.join(__dirname, '../../.env') });
  dotenvConfig({ path: path.join(__dirname, '../../backend/.env') });

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
    candidates.push(path.isAbsolute(p) ? p : path.resolve(__dirname, '../..', p));
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    candidates.push(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }
  candidates.push(path.resolve(__dirname, '../../serviceAccountKey.json'));

  for (const filePath of candidates) {
    if (filePath && fs.existsSync(filePath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
      });
      return;
    }
  }

  throw new Error(
    'Firebase Admin not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or place serviceAccountKey.json.',
  );
}

function timestampToKey(ts) {
  return ts.replace(' ', '_').replace(/:/g, '-');
}

function hasScheduledAt(feedLog, timestamp) {
  if (!feedLog || typeof feedLog !== 'object') return false;
  const want = timestamp.trim();
  for (const val of Object.values(feedLog)) {
    if (!val || typeof val !== 'object') continue;
    const ts = String(val.timestamp || '').trim();
    const reason = String(val.reason || '').toUpperCase();
    if (ts === want && (reason.startsWith('SCHED') || reason === 'SCHEDULED')) {
      return true;
    }
  }
  return false;
}

async function main() {
  initAdminFromEnv();
  const db = admin.database();
  const base = `/devices/${DEVICE_ID}`;
  const updates = {};

  const feedSnap = await db.ref(`${base}/feedLog`).once('value');
  const feedLog = feedSnap.val() || {};

  const added = [];
  const skipped = [];

  for (const timestamp of MISSING_TIMESTAMPS) {
    if (hasScheduledAt(feedLog, timestamp)) {
      skipped.push(timestamp);
      continue;
    }
    const key = timestampToKey(timestamp);
    updates[`${base}/feedLog/${key}`] = {
      reason: 'Scheduled',
      timestamp,
      amountMg: AMOUNT_LABEL,
    };
    added.push({ key, timestamp });
  }

  if (added.length === 0) {
    console.log(JSON.stringify({
      ok: true,
      deviceId: DEVICE_ID,
      message: 'All missing timestamps already present in feedLog',
      skipped,
    }, null, 2));
    return;
  }

  await db.ref().update(updates);

  console.log(JSON.stringify({
    ok: true,
    deviceId: DEVICE_ID,
    feedTime: FEED_TIME,
    inserted: added.length,
    added,
    skipped,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
