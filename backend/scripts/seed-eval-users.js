/**
 * Ensure evaluation users (User1–User10) exist in Firebase Auth + Firestore.
 */
import admin from 'firebase-admin';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import {
  EVAL_RESPONDENTS,
  evalUserEmail,
  joinedDateToTimestamp,
} from '../lib/eval-users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_EVAL_PASSWORD = 'EvalUser1!';

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
  candidates.push(path.resolve(__dirname, '..', '..', 'serviceAccountKey.json'));

  const saPath = candidates.find((p) => p && fs.existsSync(p)) || null;
  if (!saPath) {
    throw new Error(
      'Firebase Admin credentials not found. Set FIREBASE_SERVICE_ACCOUNT_JSON or place serviceAccountKey.json.',
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(fs.readFileSync(saPath, 'utf8'))),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

async function ensureAuthUser(respondent) {
  const email = evalUserEmail(respondent.userName);
  try {
    await admin.auth().getUser(respondent.userId);
    return 'exists';
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
  }

  await admin.auth().createUser({
    uid: respondent.userId,
    email,
    password: DEFAULT_EVAL_PASSWORD,
    displayName: respondent.userName,
    disabled: false,
  });
  return 'created';
}

async function ensureFirestoreUser(respondent) {
  const ref = admin.firestore().collection('users').doc(respondent.userId);
  const snap = await ref.get();
  const joinedTs = joinedDateToTimestamp(admin, respondent.joinedDate);
  const email = evalUserEmail(respondent.userName);

  if (!snap.exists) {
    await ref.set({
      email,
      displayName: respondent.userName,
      phone: '',
      role: 'farmer',
      status: 'active',
      farmId: '',
      isEvaluationUser: true,
      createdAt: joinedTs,
      joinedDate: joinedTs,
      lastLoginAt: null,
    });
    return 'created';
  }

  const data = snap.data() || {};
  const patch = {};
  if (!data.email) patch.email = email;
  if (!data.displayName) patch.displayName = respondent.userName;
  if (!data.role) patch.role = 'farmer';
  if (!data.status) patch.status = 'active';
  if (!data.createdAt && !data.joinedDate) {
    patch.createdAt = joinedTs;
    patch.joinedDate = joinedTs;
  } else if (!data.joinedDate && data.createdAt) {
    patch.joinedDate = data.createdAt;
  } else if (!data.createdAt && data.joinedDate) {
    patch.createdAt = data.joinedDate;
  }
  if (data.isEvaluationUser !== true) patch.isEvaluationUser = true;

  if (Object.keys(patch).length) {
    await ref.set(patch, { merge: true });
    return 'updated';
  }
  return 'exists';
}

/**
 * Idempotent: creates missing Auth + Firestore records for evaluation users.
 * @returns {Promise<{ created: number, updated: number, skipped: number }>}
 */
export async function ensureEvalUsers() {
  if (!admin.apps.length) {
    console.warn('[Eval Users] Admin SDK not initialized. Skipping.');
    return { created: 0, updated: 0, skipped: 0 };
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const respondent of EVAL_RESPONDENTS) {
    try {
      const authResult = await ensureAuthUser(respondent);
      const fsResult = await ensureFirestoreUser(respondent);
      if (authResult === 'created' || fsResult === 'created') created += 1;
      else if (fsResult === 'updated') updated += 1;
      else skipped += 1;
    } catch (e) {
      console.error(`[Eval Users] Failed for ${respondent.userName}:`, e.message);
    }
  }

  console.log(`[Eval Users] Ready: ${created} created, ${updated} updated, ${skipped} unchanged`);
  return { created, updated, skipped };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  initAdminFromEnv();
  ensureEvalUsers()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Eval Users] Failed:', err);
      process.exit(1);
    });
}
