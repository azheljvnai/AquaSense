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
import { checkAndSeedPresets } from './scripts/seed-presets.js';

// Initialise Firebase Admin SDK once
function initAdmin() {
  if (admin.apps.length) return;
  // Preferred: JSON contents via env var (best for hosts without secret files).
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    const serviceAccount = JSON.parse(saJson);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    console.log('[Admin SDK] Initialised with FIREBASE_SERVICE_ACCOUNT_JSON');
    return;
  }

  // Next: explicit path (local dev) OR secret-file mount path (Render/etc).
  // - If relative, resolve from repo root (one level up from backend/)
  // - If absolute, use as-is
  const candidates = [];

  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const p = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    candidates.push(path.isAbsolute(p) ? p : path.resolve(__dirname, '..', p));
  }

  // Common convention: Google sets this env var when using a credential file.
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    candidates.push(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }

  // Render Secret Files typically mount under /etc/secrets/<filename>
  // (not guaranteed, but this helps when FIREBASE_SERVICE_ACCOUNT_PATH wasn't set).
  candidates.push(path.join(path.sep, 'etc', 'secrets', 'serviceAccountKey.json'));

  const saPath = candidates.find(p => p && fs.existsSync(p)) || null;

  if (saPath) {
    const serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    console.log('[Admin SDK] Initialised with service account:', saPath);
    return;
  }

  // Fallback: Application Default Credentials (gcloud auth / Cloud Run / etc.)
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
  console.log('[Admin SDK] Initialised with Application Default Credentials');
}

try {
  initAdmin();
} catch (e) {
  console.warn('[Admin SDK] Init failed — /api/users endpoint will be unavailable:', e.message);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Frontend static files (parent dir / public)
const frontendPath = path.join(__dirname, '..', 'public');

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

// ─── UniSMS helpers ───────────────────────────────────────────────────────────

function getUniSmsAuthHeader() {
  const secretKey = process.env.UNISMS_SECRET_KEY || '';
  if (!secretKey) return null;
  const token = Buffer.from(`${secretKey}:`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

function normalizePhPhoneToE164(input) {
  // UniSMS expects E.164, commonly +639xxxxxxxxx for PH.
  const raw = String(input || '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/[^\d+]/g, ''); // keep digits and leading +

  // Already E.164 +639XXXXXXXXX
  if (/^\+639\d{9}$/.test(cleaned)) return cleaned;
  // Missing + (e.g. 63917...)
  if (/^639\d{9}$/.test(cleaned)) return `+${cleaned}`;
  // Local PH format 09XXXXXXXXX
  if (/^09\d{9}$/.test(cleaned)) return `+63${cleaned.slice(1)}`;

  // Fall back to cleaned (may be non-PH international E.164)
  return cleaned;
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
    emailjsPublicKey: process.env.EMAILJS_PUBLIC_KEY || '',
    emailjsServiceId: process.env.EMAILJS_SERVICE_ID || '',
    emailjsTemplateId: process.env.EMAILJS_TEMPLATE_ID || '',
  });
});

/**
 * POST /api/notifications/sms — send an SMS via UniSMS
 * Body: { recipient: string, content: string, metadata?: object }
 * Auth: Firebase ID token (Bearer) via verifyToken
 */
app.post('/api/notifications/sms', verifyToken, async (req, res) => {
  const { recipient, content, metadata, sender_id } = req.body || {};

  const authHeader = getUniSmsAuthHeader();
  if (!authHeader) {
    return res.status(503).json({ error: 'UniSMS is not configured (missing UNISMS_SECRET_KEY).' });
  }

  const to = normalizePhPhoneToE164(recipient);
  const msg = String(content || '').trim();
  if (!to) return res.status(400).json({ error: 'recipient is required.' });
  if (!msg) return res.status(400).json({ error: 'content is required.' });
  if (msg.length > 160) return res.status(400).json({ error: 'content must be <= 160 characters.' });

  try {
    const senderId = String(sender_id || process.env.UNISMS_SENDER_ID || '').trim();

    const baseBody = {
      recipient: to,
      content: msg,
    };
    if (metadata && typeof metadata === 'object') {
      baseBody.metadata = metadata;
    }

    async function trySend(includeSenderId) {
      const body = { ...baseBody };
      if (includeSenderId && senderId) body.sender_id = senderId;
      const resp = await fetch('https://unismsapi.com/api/sms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
        },
        body: JSON.stringify(body),
      });
      const data = await resp.json().catch(() => ({}));
      return { resp, data };
    }

    // First attempt: respect configured sender_id.
    let { resp, data } = await trySend(true);

    // If UniSMS rejects sender_id with 422, retry once without it.
    if (!resp.ok && resp.status === 422 && senderId) {
      const msgStr = String(data?.error || data?.message || '').toLowerCase();
      if (msgStr.includes('sender') || msgStr.includes('sender_id')) {
        ({ resp, data } = await trySend(false));
      }
    }

    if (!resp.ok) {
      const detail = data?.error || data?.message || `UniSMS request failed with ${resp.status}`;
      return res.status(resp.status).json({ error: detail });
    }

    const referenceId = data?.message?.reference_id || null;
    return res.status(200).json({ success: true, reference_id: referenceId, provider: 'unisms' });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Failed to send SMS.' });
  }
});

/**
 * PATCH /api/users/me — let any authenticated user update their own profile.
 * Allowed fields: displayName, email, phone, farm (name/location/size/capacity/established/manager).
 * Role and status cannot be self-modified.
 */
app.patch('/api/users/me', verifyToken, async (req, res) => {
  const { displayName, email, phone, farm } = req.body || {};
  const hasFarmPatch = !!(farm && typeof farm === 'object');
  if (!displayName && !email && phone === undefined && !hasFarmPatch) {
    return res.status(400).json({ error: 'Provide at least one of: displayName, email, phone, farm.' });
  }
  try {
    const fs = admin.firestore();
    const userRef = fs.collection('users').doc(req.auth.uid);
    const userSnap = await userRef.get();
    const current = userSnap.exists ? userSnap.data() : {};
    const update = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (displayName) {
      update.displayName = displayName;
      await admin.auth().updateUser(req.auth.uid, { displayName });
    }
    if (email) {
      update.email = email;
      await admin.auth().updateUser(req.auth.uid, { email });
    }
    if (phone !== undefined) update.phone = phone;
    await userRef.set(update, { merge: true });

    if (hasFarmPatch) {
      const farmId = current?.farmId || '';
      if (farmId) {
        const farmUpdate = {
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if ('name' in farm) farmUpdate.name = String(farm.name || '');
        if ('location' in farm) farmUpdate.location = String(farm.location || '');
        if ('size' in farm) farmUpdate.size = String(farm.size || '');
        if ('capacity' in farm) farmUpdate.capacity = String(farm.capacity || '');
        if ('manager' in farm) farmUpdate.manager = String(farm.manager || '');
        if ('established' in farm) farmUpdate.established = String(farm.established || '');
        await fs.collection('farms').doc(farmId).set(farmUpdate, { merge: true });
      }
    }
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

// ─── Pond API ─────────────────────────────────────────────────────────────────

/** GET /api/ponds — list all ponds */
app.get('/api/ponds', verifyToken, async (req, res) => {
  try {
    const snap = await admin.firestore().collection('ponds').get();
    const ponds = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return res.json(ponds);
  } catch (e) {
    console.error('[GET /api/ponds]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

/** POST /api/ponds — create a pond. Requires admin or owner. */
app.post('/api/ponds', verifyToken, requireRole('admin', 'owner'), async (req, res) => {
  const { name, location, capacity } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required.' });
  try {
    const ref = await admin.firestore().collection('ponds').add({
      name, location: location || '', capacity: capacity || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.status(201).json({ id: ref.id });
  } catch (e) {
    console.error('[POST /api/ponds]', e.message);
    return res.status(400).json({ error: e.message });
  }
});

/** PATCH /api/ponds/:id — update a pond. Requires admin or owner. */
app.patch('/api/ponds/:id', verifyToken, requireRole('admin', 'owner'), async (req, res) => {
  const { name, location, capacity } = req.body || {};
  try {
    await admin.firestore().collection('ponds').doc(req.params.id).set(
      { name, location, capacity, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
    return res.json({ success: true });
  } catch (e) {
    console.error('[PATCH /api/ponds]', e.message);
    return res.status(400).json({ error: e.message });
  }
});

/** DELETE /api/ponds/:id — delete a pond. Requires admin. */
app.delete('/api/ponds/:id', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    await admin.firestore().collection('ponds').doc(req.params.id).delete();
    return res.json({ success: true });
  } catch (e) {
    console.error('[DELETE /api/ponds]', e.message);
    return res.status(400).json({ error: e.message });
  }
});

// ─── Pond Configurations API ──────────────────────────────────────────────────

/** GET /api/pond-configurations?pondId=xxx — list configs for a pond */
app.get('/api/pond-configurations', verifyToken, async (req, res) => {
  const { pondId } = req.query;
  if (!pondId) return res.status(400).json({ error: 'pondId query param required.' });
  try {
    const snap = await admin.firestore().collection('pond_configurations')
      .where('pondId', '==', pondId).get();
    return res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (e) {
    console.error('[GET /api/pond-configurations]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

/** POST /api/pond-configurations — assign a config to a pond. Requires admin or owner. */
app.post('/api/pond-configurations', verifyToken, requireRole('admin', 'owner'), async (req, res) => {
  const { pondId, name, species, thresholds } = req.body || {};
  if (!pondId || !species) return res.status(400).json({ error: 'pondId and species are required.' });
  try {
    const ref = await admin.firestore().collection('pond_configurations').add({
      pondId, name: name || species, species, thresholds: thresholds || {},
      isActive: false, createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.status(201).json({ id: ref.id });
  } catch (e) {
    console.error('[POST /api/pond-configurations]', e.message);
    return res.status(400).json({ error: e.message });
  }
});

/** PATCH /api/pond-configurations/:id — update a config. Requires admin or owner. */
app.patch('/api/pond-configurations/:id', verifyToken, requireRole('admin', 'owner'), async (req, res) => {
  try {
    await admin.firestore().collection('pond_configurations').doc(req.params.id).set(
      { ...req.body, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
    return res.json({ success: true });
  } catch (e) {
    console.error('[PATCH /api/pond-configurations]', e.message);
    return res.status(400).json({ error: e.message });
  }
});

/**
 * POST /api/pond-configurations/:id/activate — set as active for its pond.
 * Deactivates all other configs for the same pond. Requires admin or owner.
 */
app.post('/api/pond-configurations/:id/activate', verifyToken, requireRole('admin', 'owner'), async (req, res) => {
  try {
    const fs = admin.firestore();
    const cfgSnap = await fs.collection('pond_configurations').doc(req.params.id).get();
    if (!cfgSnap.exists) return res.status(404).json({ error: 'Configuration not found.' });
    const pondId = cfgSnap.data().pondId;

    // Deactivate all configs for this pond, then activate the target
    const allSnap = await fs.collection('pond_configurations').where('pondId', '==', pondId).get();
    const batch = fs.batch();
    allSnap.docs.forEach(d => batch.update(d.ref, { isActive: d.id === req.params.id }));
    await batch.commit();
    return res.json({ success: true });
  } catch (e) {
    console.error('[POST /api/pond-configurations/:id/activate]', e.message);
    return res.status(400).json({ error: e.message });
  }
});

/**
 * POST /api/pond-configurations/:id/deactivate — clear the active flag for this config.
 * Requires admin or owner.
 */
app.post('/api/pond-configurations/:id/deactivate', verifyToken, requireRole('admin', 'owner'), async (req, res) => {
  try {
    const fs = admin.firestore();
    const ref = fs.collection('pond_configurations').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Configuration not found.' });
    await ref.update({ isActive: false });
    return res.json({ success: true });
  } catch (e) {
    console.error('[POST /api/pond-configurations/:id/deactivate]', e.message);
    return res.status(400).json({ error: e.message });
  }
});

/** DELETE /api/pond-configurations/:id — remove a config. Requires admin or owner. */
app.delete('/api/pond-configurations/:id', verifyToken, requireRole('admin', 'owner'), async (req, res) => {
  try {
    await admin.firestore().collection('pond_configurations').doc(req.params.id).delete();
    return res.json({ success: true });
  } catch (e) {
    console.error('[DELETE /api/pond-configurations]', e.message);
    return res.status(400).json({ error: e.message });
  }
});

// ─── Migration API ────────────────────────────────────────────────────────────

/**
 * POST /api/migrate/backup — create a backup of ponds and pond_configurations.
 * Requires admin role. Stores backup in migrations_backup collection.
 */
app.post('/api/migrate/backup', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const fs = admin.firestore();
    
    // Fetch all ponds
    const pondsSnap = await fs.collection('ponds').get();
    const ponds = pondsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Fetch all pond_configurations
    const configsSnap = await fs.collection('pond_configurations').get();
    const pondConfigurations = configsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Create backup document
    const backup = {
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      collections: {
        ponds,
        pond_configurations: pondConfigurations,
      },
      status: 'completed',
      metadata: {
        totalPonds: ponds.length,
        totalConfigurations: pondConfigurations.length,
        backupSize: JSON.stringify({ ponds, pond_configurations: pondConfigurations }).length,
      },
    };
    
    // Verify backup integrity
    if (ponds.length !== pondsSnap.size || pondConfigurations.length !== configsSnap.size) {
      return res.status(500).json({ error: 'Backup integrity verification failed.' });
    }
    
    // Store backup
    const backupRef = await fs.collection('migrations_backup').add(backup);
    
    console.log(`[Migration Backup] Created backup ${backupRef.id} with ${ponds.length} ponds and ${pondConfigurations.length} configurations`);
    
    return res.status(201).json({
      success: true,
      backupId: backupRef.id,
      metadata: backup.metadata,
    });
  } catch (e) {
    console.error('[POST /api/migrate/backup]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/migrate/rollback — restore ponds and pond_configurations from latest backup.
 * Requires admin role. Deletes configurations collection and restores old collections.
 */
app.post('/api/migrate/rollback', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const fs = admin.firestore();
    
    // Get latest backup
    const backupsSnap = await fs.collection('migrations_backup')
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get();
    
    if (backupsSnap.empty) {
      return res.status(404).json({ error: 'No backup found to rollback from.' });
    }
    
    const backupDoc = backupsSnap.docs[0];
    const backup = backupDoc.data();
    const { ponds, pond_configurations } = backup.collections;
    
    console.log(`[Migration Rollback] Starting rollback from backup ${backupDoc.id}`);
    
    // Delete configurations collection
    const configurationsSnap = await fs.collection('configurations').get();
    const deleteBatch = fs.batch();
    configurationsSnap.docs.forEach(d => deleteBatch.delete(d.ref));
    await deleteBatch.commit();
    console.log(`[Migration Rollback] Deleted ${configurationsSnap.size} configurations`);
    
    // Restore ponds collection
    const pondsBatch = fs.batch();
    ponds.forEach(pond => {
      const { id, ...data } = pond;
      pondsBatch.set(fs.collection('ponds').doc(id), data);
    });
    await pondsBatch.commit();
    console.log(`[Migration Rollback] Restored ${ponds.length} ponds`);
    
    // Restore pond_configurations collection
    const configsBatch = fs.batch();
    pond_configurations.forEach(config => {
      const { id, ...data } = config;
      configsBatch.set(fs.collection('pond_configurations').doc(id), data);
    });
    await configsBatch.commit();
    console.log(`[Migration Rollback] Restored ${pond_configurations.length} pond_configurations`);
    
    // Verify restoration
    const restoredPondsSnap = await fs.collection('ponds').get();
    const restoredConfigsSnap = await fs.collection('pond_configurations').get();
    
    if (restoredPondsSnap.size !== ponds.length || restoredConfigsSnap.size !== pond_configurations.length) {
      return res.status(500).json({ error: 'Rollback verification failed.' });
    }
    
    // Update backup status
    await backupDoc.ref.update({ status: 'rolled_back' });
    
    return res.status(200).json({
      success: true,
      restored: {
        ponds: ponds.length,
        pond_configurations: pond_configurations.length,
      },
    });
  } catch (e) {
    console.error('[POST /api/migrate/rollback]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/migrate/status — get migration backup status and list of available backups.
 * Requires admin role.
 */
app.get('/api/migrate/status', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const fs = admin.firestore();
    
    // Get all backups ordered by timestamp
    const backupsSnap = await fs.collection('migrations_backup')
      .orderBy('timestamp', 'desc')
      .get();
    
    const backups = backupsSnap.docs.map(d => ({
      id: d.id,
      timestamp: d.data().timestamp,
      status: d.data().status,
      metadata: d.data().metadata,
    }));
    
    return res.status(200).json({
      backups,
      totalBackups: backups.length,
      latestBackup: backups[0] || null,
    });
  } catch (e) {
    console.error('[GET /api/migrate/status]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/migrate/execute — execute migration from pond_configurations to configurations.
 * Requires admin role. Verifies backup exists before proceeding.
 */
app.post('/api/migrate/execute', verifyToken, requireRole('admin'), async (req, res) => {
  try {
    const fs = admin.firestore();
    
    // Verify backup exists
    const backupsSnap = await fs.collection('migrations_backup')
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get();
    
    if (backupsSnap.empty) {
      return res.status(400).json({ error: 'No backup found. Create a backup before executing migration.' });
    }
    
    console.log('[Migration Execute] Starting migration...');
    
    // Fetch all pond_configurations
    const configsSnap = await fs.collection('pond_configurations').get();
    const pondConfigurations = configsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Migrate to configurations collection
    const migrateBatch = fs.batch();
    let activeCount = 0;
    let firstActiveId = null;
    
    pondConfigurations.forEach(config => {
      const { id, pondId, ...data } = config;
      // Track active configurations
      if (data.isActive) {
        activeCount++;
        if (!firstActiveId) firstActiveId = id;
      }
      migrateBatch.set(fs.collection('configurations').doc(id), {
        ...data,
        // Ensure only one configuration is active
        isActive: activeCount === 0 && data.isActive ? true : (id === firstActiveId),
        migratedFrom: 'pond_configurations',
        migratedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    
    await migrateBatch.commit();
    console.log(`[Migration Execute] Migrated ${pondConfigurations.length} configurations`);
    
    // Delete ponds collection
    const pondsSnap = await fs.collection('ponds').get();
    const deletePondsBatch = fs.batch();
    pondsSnap.docs.forEach(d => deletePondsBatch.delete(d.ref));
    await deletePondsBatch.commit();
    console.log(`[Migration Execute] Deleted ${pondsSnap.size} ponds`);
    
    // Delete pond_configurations collection
    const deleteConfigsBatch = fs.batch();
    configsSnap.docs.forEach(d => deleteConfigsBatch.delete(d.ref));
    await deleteConfigsBatch.commit();
    console.log(`[Migration Execute] Deleted ${configsSnap.size} pond_configurations`);
    
    // Verify migration
    const migratedSnap = await fs.collection('configurations').get();
    const activeConfigs = migratedSnap.docs.filter(d => d.data().isActive);
    
    if (migratedSnap.size < pondConfigurations.length) {
      return res.status(500).json({ error: 'Migration verification failed: not all configurations migrated.' });
    }
    
    if (activeConfigs.length > 1) {
      console.warn(`[Migration Execute] Warning: ${activeConfigs.length} active configurations found, expected 1`);
    }
    
    return res.status(200).json({
      success: true,
      migrated: {
        configurations: pondConfigurations.length,
        pondsDeleted: pondsSnap.size,
        pondConfigurationsDeleted: configsSnap.size,
      },
      activeConfigurations: activeConfigs.length,
    });
  } catch (e) {
    console.error('[POST /api/migrate/execute]', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ─── Configuration Management API ─────────────────────────────────────────────

/** GET /api/configurations — list all configurations */
app.get('/api/configurations', verifyToken, async (req, res) => {
  try {
    const snap = await admin.firestore().collection('configurations').get();
    return res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** POST /api/configurations — create a new configuration. Requires admin or owner. */
app.post('/api/configurations', verifyToken, requireRole('admin', 'owner'), async (req, res) => {
  const { name, species, thresholds, isPreset } = req.body || {};
  if (!species) return res.status(400).json({ error: 'species is required.' });
  try {
    const ref = await admin.firestore().collection('configurations').add({
      name: name || species,
      species,
      thresholds: thresholds || {},
      isPreset: isPreset || false,
      isActive: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.status(201).json({ id: ref.id });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

/** PATCH /api/configurations/:id — update a configuration. Requires admin or owner. */
app.patch('/api/configurations/:id', verifyToken, requireRole('admin', 'owner'), async (req, res) => {
  const { name, species, thresholds } = req.body || {};
  try {
    await admin.firestore().collection('configurations').doc(req.params.id).set(
      { name, species, thresholds, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
    return res.json({ success: true });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

/** DELETE /api/configurations/:id — delete a configuration. Requires admin or owner. */
app.delete('/api/configurations/:id', verifyToken, requireRole('admin', 'owner'), async (req, res) => {
  try {
    const fs = admin.firestore();
    const configSnap = await fs.collection('configurations').doc(req.params.id).get();
    if (!configSnap.exists) {
      return res.status(404).json({ error: 'Configuration not found.' });
    }
    if (configSnap.data().isActive) {
      return res.status(400).json({ error: 'Cannot delete active configuration. Deactivate it first.' });
    }
    await fs.collection('configurations').doc(req.params.id).delete();
    return res.json({ success: true });
  } catch (e) {
    console.error('[DELETE /api/configurations]', e.message);
    return res.status(400).json({ error: e.message });
  }
});

/**
 * POST /api/configurations/:id/activate — set configuration as active.
 * Deactivates all other configurations. Requires admin or owner.
 */
app.post('/api/configurations/:id/activate', verifyToken, requireRole('admin', 'owner'), async (req, res) => {
  try {
    const fs = admin.firestore();
    const cfgSnap = await fs.collection('configurations').doc(req.params.id).get();
    if (!cfgSnap.exists) return res.status(404).json({ error: 'Configuration not found.' });

    // Deactivate all configurations, then activate the target
    const allSnap = await fs.collection('configurations').get();
    const batch = fs.batch();
    allSnap.docs.forEach(d => batch.update(d.ref, { isActive: d.id === req.params.id }));
    await batch.commit();
    
    console.log(`[Configuration Activate] Activated configuration ${req.params.id}`);
    return res.json({ success: true });
  } catch (e) {
    console.error('[POST /api/configurations/:id/activate]', e.message);
    return res.status(400).json({ error: e.message });
  }
});

/**
 * POST /api/configurations/:id/deactivate — clear the active flag for this configuration.
 * Requires admin or owner.
 */
app.post('/api/configurations/:id/deactivate', verifyToken, requireRole('admin', 'owner'), async (req, res) => {
  try {
    const fs = admin.firestore();
    const ref = fs.collection('configurations').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Configuration not found.' });
    await ref.update({ isActive: false });
    
    console.log(`[Configuration Deactivate] Deactivated configuration ${req.params.id}`);
    return res.json({ success: true });
  } catch (e) {
    console.error('[POST /api/configurations/:id/deactivate]', e.message);
    return res.status(400).json({ error: e.message });
  }
});

// Static files — registered after API routes so /api/* is never intercepted
app.use(express.static(frontendPath, { etag: false, lastModified: false, maxAge: 0 }));
// Also serve frontend assets (css, js, etc.)
app.use(express.static(path.join(__dirname, '..', 'frontend'), { etag: false, lastModified: false, maxAge: 0 }));

// SPA fallback: serve index.html for non-file routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`AquaSense backend running at http://localhost:${PORT}`);
  console.log(`Frontend served from: ${frontendPath}`);
  if (!process.env.FIREBASE_DATABASE_URL) {
    console.warn('FIREBASE_DATABASE_URL not set in .env — client will need to enter it manually.');
  }
  
  // Seed species presets on startup
  try {
    await checkAndSeedPresets();
  } catch (e) {
    console.error('[Server] Failed to seed presets:', e.message);
  }
});
