/**
 * AquaSense backend — serves frontend and exposes config from env.
 * Private API keys/URLs are read from .env and never shipped to the client
 * except via the /api/config endpoint (only non-secret config like Firebase URL).
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from project root (one level up from backend/)
const { config: dotenvConfig } = createRequire(import.meta.url)('dotenv');
dotenvConfig({ path: path.join(__dirname, '..', '.env') });

import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

// Frontend static files (parent dir / frontend)
const frontendPath = path.join(__dirname, '..', 'frontend');

// Disable caching during development so changes reflect immediately on localhost.
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Avoid confusion: legacy file should always load the SPA entry.
app.get('/dashboard.html', (_req, res) => res.redirect('/'));

app.use(express.static(frontendPath, { etag: false, lastModified: false, maxAge: 0 }));

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
