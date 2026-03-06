/**
 * AquaSense backend — serves frontend and exposes config from env.
 * Private API keys/URLs are read from .env and never shipped to the client
 * except via the /api/config endpoint (only non-secret config like Firebase URL).
 */
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
