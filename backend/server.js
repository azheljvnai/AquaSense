/**
 * AquaSense backend — serves frontend and exposes config from env.
 * Private API keys/URLs are read from .env and never shipped to the client
 * except via the /api/config endpoint (only non-secret config like Firebase URL).
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from project root (one level up from backend/)
const { config: dotenvConfig } = createRequire(import.meta.url)('dotenv');
dotenvConfig({ path: path.join(__dirname, '..', '.env') });

import express from 'express';
import admin from 'firebase-admin';

// Initialise Firebase Admin SDK once
function initAdmin() {
  if (admin.apps.length) return;
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    ? path.resolve(__dirname, '..', process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
    : null;

  if (saPath && fs.existsSync(saPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    console.log('[Admin SDK] Initialised with service account:', saPath);
  } else {
    // Fallback: Application Default Credentials (gcloud auth / Cloud Run / etc.)
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    console.log('[Admin SDK] Initialised with Application Default Credentials');
  }
}

try {
  initAdmin();
} catch (e) {
  console.warn('[Admin SDK] Init failed — /api/users endpoint will be unavailable:', e.message);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Frontend static files (parent dir / frontend)
const frontendPath = path.join(__dirname, '..', 'frontend');

// Disable caching during development so changes reflect immediately on localhost.
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(express.json());

// ─── Auth middleware ──────────────────────────────────────────────────────────

/**
 * Verifies the Firebase ID token from the Authorization header and attaches
 * the decoded token + Firestore role to req.auth.
 */
async function verifyToken(req, res, next) {
  if (!admin.apps.length) {
    return res.status(503).json({ error: 'Admin SDK not initialised.' });
  }
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization header.' });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    // Fetch role from Firestore
    const snap = await admin.firestore().collection('users').doc(decoded.uid).get();
    const rawRole = snap.exists ? (snap.data()?.role || 'farmer') : 'farmer';
    // Normalise legacy role names
    const role = rawRole === 'manager' ? 'owner' : rawRole === 'viewer' ? 'farmer' : rawRole;
    req.auth = { uid: decoded.uid, role };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

/**
 * Requires the caller to have one of the allowed roles.
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.auth) return res.status(401).json({ error: 'Unauthenticated.' });
    if (!allowedRoles.includes(req.auth.role)) {
      return res.status(403).json({ error: `Access denied. Required role: ${allowedRoles.join(' or ')}.` });
    }
    next();
  };
}

// Avoid confusion: legacy file should always load the SPA entry.
app.get('/dashboard.html', (_req, res) => res.redirect('/'));

/**
 * Public config endpoint — returns only what the client needs to connect.
 * All sensitive values stay in .env and are never logged or exposed elsewhere.
 */
app.get('/api/config', (_req, res) => {
  res.json({
    firebaseDatabaseUrl: process.env.FIREBASE_DATABASE_URL || '',
    deviceId: process.env.DEVICE_ID || 'device001',
    firebase: {
      apiKey: process.env.FIREBASE_API_KEY || '',
      authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
      projectId: process.env.FIREBASE_PROJECT_ID || '',
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
      appId: process.env.FIREBASE_APP_ID || '',
      databaseURL: process.env.FIREBASE_DATABASE_URL || '',
    },
  });
});

/**
 * PATCH /api/users/me — let any authenticated user update their own profile.
 * Allowed fields: displayName, phone. Role and status cannot be self-modified.
 */
app.patch('/api/users/me', verifyToken, async (req, res) => {
  const { displayName, phone } = req.body || {};
  if (!displayName && phone === undefined) {
    return res.status(400).json({ error: 'Provide at least one of: displayName, phone.' });
  }
  try {
    const update = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (displayName) {
      update.displayName = displayName;
      await admin.auth().updateUser(req.auth.uid, { displayName });
    }
    if (phone !== undefined) update.phone = phone;
    await admin.firestore().collection('users').doc(req.auth.uid).set(update, { merge: true });
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('[PATCH /api/users/me]', e.message);
    return res.status(400).json({ error: e.message });
  }
});

/**
 * POST /api/users — create a Firebase Auth account + Firestore user record.
 * Requires: admin or owner role.
 * Owners cannot create admin accounts.
 * Body: { email, password, displayName, phone, role, status, farmId }
 */
app.post('/api/users', verifyToken, requireRole('admin', 'owner'), async (req, res) => {
  if (!admin.apps.length) {
    return res.status(503).json({ error: 'Admin SDK not initialised. Check FIREBASE_SERVICE_ACCOUNT_PATH in .env.' });
  }
  const { email, password, displayName, phone, role, status, farmId } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required.' });
  }

  // Owners cannot create admin accounts
  const assignedRole = role || 'farmer';
  if (req.auth.role === 'owner' && assignedRole === 'admin') {
    return res.status(403).json({ error: 'Owners cannot create Admin accounts.' });
  }
  // Normalise legacy role values submitted by older clients
  const normRole = assignedRole === 'manager' ? 'owner' : assignedRole === 'viewer' ? 'farmer' : assignedRole;
  const validRoles = new Set(['admin', 'owner', 'farmer']);
  if (!validRoles.has(normRole)) {
    return res.status(400).json({ error: `Invalid role "${normRole}". Must be admin, owner, or farmer.` });
  }
  try {
    // 1. Create the Auth account
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: displayName || email.split('@')[0],
    });

    // 2. Write the Firestore user document using the real Auth UID
    await admin.firestore().collection('users').doc(userRecord.uid).set({
      email,
      displayName: displayName || email.split('@')[0],
      phone: phone || '',
      role: normRole,
      status: status || 'active',
      farmId: farmId || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastLoginAt: null,
    });

    return res.status(201).json({ uid: userRecord.uid });
  } catch (e) {
    console.error('[POST /api/users]', e.message);
    return res.status(400).json({ error: e.message });
  }
});

/**
 * PATCH /api/users/:uid — enable or disable a Firebase Auth account.
 * Requires: admin or owner role. Owners cannot disable admin accounts.
 * Body: { disabled: true | false }
 */
app.patch('/api/users/:uid', verifyToken, requireRole('admin', 'owner'), async (req, res) => {
  if (!admin.apps.length) {
    return res.status(503).json({ error: 'Admin SDK not initialised.' });
  }
  const { disabled } = req.body || {};
  if (typeof disabled !== 'boolean') {
    return res.status(400).json({ error: '"disabled" (boolean) is required.' });
  }

  // Owners cannot disable admin accounts
  if (req.auth.role === 'owner') {
    const targetSnap = await admin.firestore().collection('users').doc(req.params.uid).get();
    const targetRole = targetSnap.exists ? (targetSnap.data()?.role || 'farmer') : 'farmer';
    if (targetRole === 'admin') {
      return res.status(403).json({ error: 'Owners cannot disable Admin accounts.' });
    }
  }
  try {
    await admin.auth().updateUser(req.params.uid, { disabled });
    await admin.firestore().collection('users').doc(req.params.uid).set(
      { status: disabled ? 'inactive' : 'active', updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('[PATCH /api/users]', e.message);
    return res.status(400).json({ error: e.message });
  }
});

/**
 * DELETE /api/users/:uid — permanently delete a Firebase Auth account + Firestore record.
 * Requires: admin role only.
 */
app.delete('/api/users/:uid', verifyToken, requireRole('admin'), async (req, res) => {
  if (!admin.apps.length) {
    return res.status(503).json({ error: 'Admin SDK not initialised.' });
  }
  try {
    await admin.auth().deleteUser(req.params.uid);
    await admin.firestore().collection('users').doc(req.params.uid).delete();
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('[DELETE /api/users]', e.message);
    return res.status(400).json({ error: e.message });
  }
});

// Static files — registered after API routes so /api/* is never intercepted
app.use(express.static(frontendPath, { etag: false, lastModified: false, maxAge: 0 }));

// SPA fallback: serve index.html for non-file routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`AquaSense backend running at http://localhost:${PORT}`);
  console.log(`Frontend served from: ${frontendPath}`);
  if (!process.env.FIREBASE_DATABASE_URL) {
    console.warn('FIREBASE_DATABASE_URL not set in .env — client will need to enter it manually.');
  }
});
