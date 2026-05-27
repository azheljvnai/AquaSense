/**
 * Append-only RTDB feedLog seed: Tue/Thu/Sat/Sun dispenses at a fixed local time.
 *
 * Safety: never deletes, never overwrites existing keys, never writes null.
 *
 * Usage (from repo root):
 *   node backend/scripts/seed-feedlog-pattern.js --dry-run
 *   node backend/scripts/seed-feedlog-pattern.js
 *   node backend/scripts/seed-feedlog-pattern.js --device device001 --start 2026-04-28 --end 2026-05-26
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env') });

import admin from 'firebase-admin';

/** Tue, Thu, Sat, Sun (0=Sun … 6=Sat) — matches feeding.js schedule convention */
const FEED_WEEKDAYS = new Set([0, 2, 4, 6]);

function parseArgs(argv) {
  const today = formatYmd(new Date());
  const args = {
    device: process.env.DEVICE_ID || 'device001',
    start: '2026-04-28',
    end: today,
    time: '19:00',
    manualCount: 4,
    amountMg: 200,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--device' && argv[i + 1]) { args.device = argv[i + 1]; i++; continue; }
    if (a === '--start' && argv[i + 1]) { args.start = argv[i + 1]; i++; continue; }
    if (a === '--end' && argv[i + 1]) { args.end = argv[i + 1]; i++; continue; }
    if (a === '--time' && argv[i + 1]) { args.time = argv[i + 1]; i++; continue; }
    if (a === '--manual-count' && argv[i + 1]) {
      args.manualCount = Number(argv[i + 1]);
      i++;
      continue;
    }
    if (a === '--amount-mg' && argv[i + 1]) {
      args.amountMg = Number(argv[i + 1]);
      i++;
      continue;
    }
    if (a === '--dry-run') { args.dryRun = true; continue; }
  }
  if (!Number.isFinite(args.manualCount) || args.manualCount < 0) {
    throw new Error('--manual-count must be a non-negative number');
  }
  if (!Number.isFinite(args.amountMg) || args.amountMg <= 0) {
    throw new Error('--amount-mg must be a positive number');
  }
  return args;
}

function initAdmin() {
  if (admin.apps.length) return;
  const dbUrl = process.env.FIREBASE_DATABASE_URL;
  if (!dbUrl) throw new Error('FIREBASE_DATABASE_URL missing in .env');

  const saRel = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '';
  const saPath = saRel
    ? path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), saRel)
    : '';
  if (!saPath || !fs.existsSync(saPath)) {
    throw new Error('Service account JSON not found. Set FIREBASE_SERVICE_ACCOUNT_PATH in .env');
  }
  const serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL: dbUrl });
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatYmd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseYmd(yyyyMmDd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd);
  if (!m) throw new Error(`Invalid date: ${yyyyMmDd} (expected YYYY-MM-DD)`);
  return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) };
}

function addDaysYmd(yyyyMmDd, days) {
  const { y, mo, d } = parseYmd(yyyyMmDd);
  const dt = new Date(y, mo - 1, d, 12, 0, 0, 0);
  dt.setDate(dt.getDate() + days);
  return formatYmd(dt);
}

function parseTimeHm(hm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm).trim());
  if (!m) throw new Error(`Invalid time: ${hm} (expected HH:MM)`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) {
    throw new Error(`Invalid time: ${hm}`);
  }
  return { h, min };
}

function toKeyStamp(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function toFmtTimestamp(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * @returns {Array<{ ms: number, date: string, weekday: number, reason: string }>}
 */
export function buildFeedDispenses({ start, end, time, manualCount, amountMg }) {
  const { h, min } = parseTimeHm(time);
  const out = [];
  let cursor = start;
  let manualLeft = manualCount;

  while (cursor <= end) {
    const { y, mo, d } = parseYmd(cursor);
    const dt = new Date(y, mo - 1, d, h, min, 0, 0);
    const wd = dt.getDay();
    if (FEED_WEEKDAYS.has(wd)) {
      const reason = manualLeft > 0 ? 'Manual' : 'SCHED 1';
      if (manualLeft > 0) manualLeft--;
      out.push({
        ms: dt.getTime(),
        date: cursor,
        weekday: wd,
        reason,
        amountMg,
      });
    }
    cursor = addDaysYmd(cursor, 1);
  }
  return out;
}

function buildFeedLogValue(entry) {
  return {
    reason: entry.reason,
    timestamp: toFmtTimestamp(entry.ms),
    amountMg: entry.amountMg,
  };
}

async function applyPatches(ref, patches, label) {
  const keys = Object.keys(patches);
  if (!keys.length) return 0;

  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const slice = keys.slice(i, i + CHUNK);
    const batch = {};
    for (const k of slice) batch[k] = patches[k];
    await ref.update(batch);
    written += slice.length;
    console.log(`[seed-feedlog] ${label}: wrote ${slice.length} (${i + slice.length}/${keys.length})`);
  }
  return written;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.start > args.end) {
    throw new Error(`--start (${args.start}) must be on or before --end (${args.end})`);
  }

  const dispenses = buildFeedDispenses({
    start: args.start,
    end: args.end,
    time: args.time,
    manualCount: args.manualCount,
    amountMg: args.amountMg,
  });

  const manualN = dispenses.filter((d) => d.reason === 'Manual').length;
  const schedN = dispenses.filter((d) => d.reason === 'SCHED 1').length;

  console.log('[seed-feedlog] Config:');
  console.log(`  device:       ${args.device}`);
  console.log(`  range:        ${args.start} → ${args.end}`);
  console.log(`  time:         ${args.time}:00 (local)`);
  console.log(`  weekdays:     Tue, Thu, Sat, Sun`);
  console.log(`  manual first: ${args.manualCount}`);
  console.log(`  amountMg:     ${args.amountMg}`);
  console.log(`  dry-run:      ${args.dryRun}`);
  console.log(`  planned:      ${dispenses.length} entries (${manualN} Manual, ${schedN} SCHED 1)`);

  for (const d of dispenses) {
    const key = toKeyStamp(d.ms);
    const val = buildFeedLogValue(d);
    console.log(
      `  ${key}  ${WEEKDAY_NAMES[d.weekday]}  ${val.reason}  ${val.timestamp}  ${val.amountMg}mg`,
    );
  }

  if (!dispenses.length) {
    console.log('[seed-feedlog] No matching feed days in range. Nothing to do.');
    return;
  }

  initAdmin();
  const feedRef = admin.database().ref(`/devices/${args.device}/feedLog`);

  try {
    const snap = await feedRef.once('value');
    const existing = snap.val() && typeof snap.val() === 'object' ? snap.val() : {};
    const existingKeys = new Set(Object.keys(existing));

    const patches = {};
    let skipped = 0;
    for (const entry of dispenses) {
      const key = toKeyStamp(entry.ms);
      if (existingKeys.has(key)) {
        skipped++;
        continue;
      }
      patches[key] = buildFeedLogValue(entry);
      existingKeys.add(key);
    }

    const wouldWrite = Object.keys(patches).length;
    console.log(`[seed-feedlog] ${wouldWrite} new, ${skipped} skipped (existing keys)`);

    if (!args.dryRun && wouldWrite > 0) {
      await applyPatches(feedRef, patches, 'feedLog');
      console.log(`[seed-feedlog] Done. Wrote ${wouldWrite} entries to /devices/${args.device}/feedLog`);
    } else if (args.dryRun) {
      console.log('[seed-feedlog] Dry-run complete. No changes written.');
    } else {
      console.log('[seed-feedlog] All entries already exist. No changes written.');
    }
  } finally {
    await Promise.allSettled(admin.apps.map((a) => a.delete()));
  }
}

main().catch((e) => {
  console.error('[seed-feedlog] Failed:', e?.message || e);
  process.exitCode = 1;
});
