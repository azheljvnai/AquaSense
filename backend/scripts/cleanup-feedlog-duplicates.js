/**
 * feedLog dedupe: at most one entry per calendar day.
 * Keeps the entry with amountMg=200 at 19:00:00 (local); deletes all other keys that day.
 * Days with no 200mg@19:00 entry lose all keys for that day.
 *
 * Usage (from repo root):
 *   node backend/scripts/cleanup-feedlog-duplicates.js --dry-run
 *   node backend/scripts/cleanup-feedlog-duplicates.js
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
    amountMg: 200,
    hour: 19,
    minute: 0,
  };
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
  const saPath = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), saRel);
  if (!saPath || !fs.existsSync(saPath)) {
    throw new Error('Service account JSON not found. Set FIREBASE_SERVICE_ACCOUNT_PATH in .env');
  }
  const serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL: dbUrl });
}

function parseTimestamp(value, key) {
  if (value != null && value !== '') {
    const ms = Date.parse(String(value).trim().replace(' ', 'T'));
    if (Number.isFinite(ms)) return ms;
  }
  if (key && /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(key)) {
    const [date, time] = key.split('_');
    const [hh, mm, ss] = time.split('-');
    return Date.parse(`${date}T${hh}:${mm}:${ss}`);
  }
  return null;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateKeyLocal(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isTargetEntry(entry, { amountMg, hour, minute }) {
  const d = new Date(entry.ms);
  const mg = entry.raw?.amountMg != null ? Number(entry.raw.amountMg) : null;
  return (
    mg === amountMg
    && d.getHours() === hour
    && d.getMinutes() === minute
    && d.getSeconds() === 0
  );
}

function pickKeeper(candidates) {
  if (!candidates.length) return null;
  const exactKey = candidates.find((e) => /_\d{2}-00-00$/.test(e.key) && e.key.includes('_19-00-00'));
  if (exactKey) return exactKey;
  return candidates[0];
}

/**
 * @returns {{ keep: string[], delete: string[] }}
 */
export function planFeedLogDedupe(entries, opts) {
  const byDay = new Map();
  for (const entry of entries) {
    const dk = dateKeyLocal(entry.ms);
    if (!byDay.has(dk)) byDay.set(dk, []);
    byDay.get(dk).push(entry);
  }

  const keep = [];
  const toDelete = [];

  for (const [, dayEntries] of byDay) {
    const targets = dayEntries.filter((e) => isTargetEntry(e, opts));
    const keeper = pickKeeper(targets);
    if (keeper) {
      keep.push(keeper.key);
      for (const e of dayEntries) {
        if (e.key !== keeper.key) toDelete.push(e.key);
      }
    } else {
      for (const e of dayEntries) toDelete.push(e.key);
    }
  }

  return { keep, delete: toDelete };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const opts = { amountMg: args.amountMg, hour: args.hour, minute: args.minute };

  initAdmin();
  const feedRef = admin.database().ref(`/devices/${args.device}/feedLog`);

  try {
    const snap = await feedRef.once('value');
    const data = snap.val() && typeof snap.val() === 'object' ? snap.val() : {};

    const entries = [];
    for (const [key, raw] of Object.entries(data)) {
      const ms = parseTimestamp(raw?.timestamp, key);
      if (!Number.isFinite(ms)) continue;
      entries.push({ key, ms, raw });
    }

    const { keep, delete: del } = planFeedLogDedupe(entries, opts);

    console.log('[cleanup-feedlog] Config:');
    console.log(`  device:   ${args.device}`);
    console.log(`  keep:     amountMg=${opts.amountMg} at ${opts.hour}:${pad(opts.minute)}:00`);
    console.log(`  dry-run:  ${args.dryRun}`);
    console.log(`  total:    ${entries.length} parsed entries`);
    console.log(`  keep:     ${keep.length} key(s)`);
    console.log(`  delete:   ${del.length} key(s)`);

    if (del.length) {
      console.log('[cleanup-feedlog] Keys to delete:');
      for (const k of del.sort()) console.log(`  - ${k}`);
    }

    if (!args.dryRun && del.length) {
      const CHUNK = 500;
      for (let i = 0; i < del.length; i += CHUNK) {
        const slice = del.slice(i, i + CHUNK);
        const batch = {};
        for (const k of slice) batch[k] = null;
        await feedRef.update(batch);
        console.log(`[cleanup-feedlog] deleted ${slice.length} (${Math.min(i + CHUNK, del.length)}/${del.length})`);
      }
      console.log('[cleanup-feedlog] Done.');
    } else if (args.dryRun) {
      console.log('[cleanup-feedlog] Dry-run complete. No changes written.');
    } else {
      console.log('[cleanup-feedlog] Nothing to delete.');
    }
  } finally {
    await Promise.allSettled(admin.apps.map((a) => a.delete()));
  }
}

main().catch((e) => {
  console.error('[cleanup-feedlog] Failed:', e?.message || e);
  process.exitCode = 1;
});
