/**
 * One-time RTDB patch for device001 feedLog amounts and bad keys.
 * Requires FIREBASE_DATABASE_URL and FIREBASE_SERVICE_ACCOUNT_JSON (or service account file).
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
const BAD_KEY = '1970-01-01_08-01-10';
const MAY28_KEY = '2026-05-28_19-00-00';
const MAY28_ENTRY = {
  reason: 'Scheduled',
  timestamp: '2026-05-28 19:00:00',
  amountMg: AMOUNT_LABEL,
};

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

function hasMay28ScheduledEntry(feedLog) {
  if (!feedLog || typeof feedLog !== 'object') return false;
  for (const val of Object.values(feedLog)) {
    if (!val || typeof val !== 'object') continue;
    const ts = String(val.timestamp || '').trim();
    const reason = String(val.reason || '').toUpperCase();
    if (ts === MAY28_ENTRY.timestamp && (reason.startsWith('SCHED') || reason === 'SCHEDULED')) {
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
  let patchedAmounts = 0;

  for (const [key, val] of Object.entries(feedLog)) {
    if (!val || typeof val !== 'object') continue;
    if (val.amountMg !== AMOUNT_LABEL) {
      updates[`${base}/feedLog/${key}/amountMg`] = AMOUNT_LABEL;
      patchedAmounts += 1;
    }
  }

  updates[`${base}/feedLog/${BAD_KEY}`] = null;

  const histSnap = await db.ref(`${base}/history/${BAD_KEY}`).once('value');
  if (histSnap.exists()) {
    updates[`${base}/history/${BAD_KEY}`] = null;
  }

  if (!hasMay28ScheduledEntry(feedLog) && !updates[MAY28_KEY]) {
    updates[`${base}/feedLog/${MAY28_KEY}`] = MAY28_ENTRY;
  }

  await db.ref().update(updates);

  console.log(JSON.stringify({
    ok: true,
    deviceId: DEVICE_ID,
    patchedAmounts,
    removedFeedLogKey: BAD_KEY,
    removedHistoryKey: histSnap.exists() ? BAD_KEY : null,
    addedMay28Scheduled: !hasMay28ScheduledEntry(feedLog),
    updateCount: Object.keys(updates).length,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
