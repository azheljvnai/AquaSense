/**
 * Append-only RTDB backfill: clone history + feedLog from a source day onto a target day.
 *
 * Safety: never deletes, never overwrites existing keys, never writes null.
 *
 * Gap mode (--gap): fills Apr 13–26, 2026 from Apr 27–May 10, 2026 (14-day offset).
 *
 * Usage (from repo root):
 *   node backend/scripts/seed-rtdb-day.js --device device001 --gap --dry-run
 *   node backend/scripts/seed-rtdb-day.js --device device001 --gap
 *   node backend/scripts/seed-rtdb-day.js --target 2026-04-13 --source-date 2026-04-27 --dry-run
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env') });

import admin from 'firebase-admin';

const GAP_PAIRS = (() => {
  const pairs = [];
  for (let i = 0; i < 14; i++) {
    pairs.push({
      target: addDays('2026-04-13', i),
      source: addDays('2026-04-27', i),
    });
  }
  return pairs;
})();

function parseArgs(argv) {
  const args = {
    device: process.env.DEVICE_ID || 'device001',
    dryRun: false,
    gap: false,
    target: null,
    sourceDate: null,
    historyOnly: false,
    feedlogOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--device' && argv[i + 1]) { args.device = argv[i + 1]; i++; continue; }
    if (a === '--target' && argv[i + 1]) { args.target = argv[i + 1]; i++; continue; }
    if (a === '--source-date' && argv[i + 1]) { args.sourceDate = argv[i + 1]; i++; continue; }
    if (a === '--dry-run') { args.dryRun = true; continue; }
    if (a === '--gap') { args.gap = true; continue; }
    if (a === '--history-only') { args.historyOnly = true; continue; }
    if (a === '--feedlog-only') { args.feedlogOnly = true; continue; }
  }
  if (args.historyOnly && args.feedlogOnly) {
    throw new Error('Use at most one of --history-only or --feedlog-only');
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

function addDays(yyyyMmDd, days) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  dt.setDate(dt.getDate() + days);
  return formatYmd(dt);
}

function dayStartMs(yyyyMmDd) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

function dateKeyLocal(ms) {
  return formatYmd(new Date(ms));
}

function parseTimestamp(value, keyFallback) {
  if (value == null || value === '') {
    return parseTimestampFromKey(keyFallback);
  }
  const n = Number(value);
  if (Number.isFinite(n)) {
    return n > 0 && n < 100000000000 ? n * 1000 : n;
  }
  const normalized = String(value).trim().replace(' ', 'T');
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function parseTimestampFromKey(key) {
  if (!key || typeof key !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(key)) {
    const [date, time] = key.split('_');
    const [hh, mm, ss] = time.split('-');
    return Date.parse(`${date}T${hh}:${mm}:${ss}`);
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(key)) {
    return Date.parse(key.replace(' ', 'T'));
  }
  if (/^[0-9]{8,}$/.test(key)) {
    const n = Number(key);
    return n > 0 && n < 100000000000 ? n * 1000 : n;
  }
  return null;
}

function toKeyStamp(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function toFmtTimestamp(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function firstNumber(...values) {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseHistoryRaw(raw, keyFallback) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const ts = parseTimestamp(obj.timestamp ?? obj.time ?? obj.createdAt ?? obj.ts, keyFallback)
    ?? parseTimestampFromKey(keyFallback);
  if (!Number.isFinite(ts)) return null;
  return {
    ts,
    ph: firstNumber(obj.ph, obj.pH, obj.PH),
    do: firstNumber(obj.do, obj.dO, obj.dissolvedOxygen, obj.dissolved_oxygen, obj.oxygen),
    turb: firstNumber(obj.turb, obj.turbidity, obj.ntu),
    temp: firstNumber(obj.temp, obj.temperature, obj.waterTemp),
  };
}

function parseFeedLogRaw(raw, keyFallback) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const ts = parseTimestamp(obj.timestamp ?? obj.time ?? obj.ts, keyFallback)
    ?? parseTimestampFromKey(keyFallback);
  if (!Number.isFinite(ts)) return null;
  const reason = obj.reason != null ? String(obj.reason) : 'Scheduled';
  return { ts, reason };
}

function collectFromTree(data, parseFn, onEntry) {
  if (!data || typeof data !== 'object') return;

  const visit = (key, value, depth) => {
    if (value == null) return;
    const direct = parseFn(value, key);
    if (direct) {
      onEntry(direct);
      return;
    }
    if (typeof value === 'object' && depth < 4) {
      for (const [k, v] of Object.entries(value)) {
        visit(k, v, depth + 1);
      }
    }
  };

  for (const [k, v] of Object.entries(data)) {
    visit(k, v, 0);
  }
}

function collectForDay(data, parseFn, calendarDate) {
  const out = [];
  const seen = new Set();
  collectFromTree(data, parseFn, (entry) => {
    if (dateKeyLocal(entry.ts) !== calendarDate) return;
    const dedupe = `${entry.ts}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push(entry);
  });
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function buildHistoryValue(entry) {
  const val = { timestamp: toFmtTimestamp(entry.ts) };
  if (entry.ph != null) val.ph = entry.ph;
  if (entry.do != null) val.do = entry.do;
  if (entry.turb != null) val.turb = entry.turb;
  if (entry.temp != null) val.temp = entry.temp;
  return val;
}

function buildFeedLogValue(entry) {
  return { reason: entry.reason, timestamp: toFmtTimestamp(entry.ts) };
}

function shiftEntryTs(entry, sourceDate, targetDate) {
  const offset = dayStartMs(targetDate) - dayStartMs(sourceDate);
  return { ...entry, ts: entry.ts + offset };
}

async function loadNode(ref) {
  const snap = await ref.once('value');
  const val = snap.val();
  return val && typeof val === 'object' ? val : {};
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
    console.log(`[seed] ${label}: wrote ${slice.length} (${i + slice.length}/${keys.length})`);
  }
  return written;
}

async function processPair({
  device,
  sourceDate,
  targetDate,
  histData,
  feedData,
  existingHistKeys,
  existingFeedKeys,
  dryRun,
  writeHistory,
  writeFeedLog,
}) {
  const stats = {
    sourceDate,
    targetDate,
    historySource: 0,
    feedSource: 0,
    historyWouldWrite: 0,
    feedWouldWrite: 0,
    historySkipped: 0,
    feedSkipped: 0,
  };

  const histRef = admin.database().ref(`/devices/${device}/history`);
  const feedRef = admin.database().ref(`/devices/${device}/feedLog`);

  const histPatches = {};
  const feedPatches = {};

  if (writeHistory) {
    const sourceEntries = collectForDay(histData, parseHistoryRaw, sourceDate);
    stats.historySource = sourceEntries.length;

    for (const src of sourceEntries) {
      const shifted = shiftEntryTs(src, sourceDate, targetDate);
      const key = toKeyStamp(shifted.ts);
      if (existingHistKeys.has(key)) {
        stats.historySkipped++;
        continue;
      }
      histPatches[key] = buildHistoryValue(shifted);
      existingHistKeys.add(key);
      stats.historyWouldWrite++;
    }
  }

  if (writeFeedLog) {
    const sourceEntries = collectForDay(feedData, parseFeedLogRaw, sourceDate);
    stats.feedSource = sourceEntries.length;

    for (const src of sourceEntries) {
      const shifted = shiftEntryTs(src, sourceDate, targetDate);
      const key = toKeyStamp(shifted.ts);
      if (existingFeedKeys.has(key)) {
        stats.feedSkipped++;
        continue;
      }
      feedPatches[key] = buildFeedLogValue(shifted);
      existingFeedKeys.add(key);
      stats.feedWouldWrite++;
    }
  }

  if (!dryRun) {
    await applyPatches(histRef, histPatches, `${targetDate} history`);
    await applyPatches(feedRef, feedPatches, `${targetDate} feedLog`);
  }

  return stats;
}

function resolvePairs(args) {
  if (args.gap) return GAP_PAIRS;
  if (!args.target || !args.sourceDate) {
    throw new Error('Provide --gap or both --target and --source-date');
  }
  return [{ target: args.target, source: args.sourceDate }];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  initAdmin();

  const writeHistory = !args.feedlogOnly;
  const writeFeedLog = !args.historyOnly;
  const pairs = resolvePairs(args);

  console.log(`[seed] Device: ${args.device}`);
  console.log(`[seed] Mode: ${args.gap ? 'gap (Apr 13–26 ← Apr 27–May 10)' : 'single day'}`);
  console.log(`[seed] Dry-run: ${args.dryRun}`);
  console.log(`[seed] Branches: ${writeHistory ? 'history' : ''}${writeHistory && writeFeedLog ? ' + ' : ''}${writeFeedLog ? 'feedLog' : ''}`);

  try {
    const histRef = admin.database().ref(`/devices/${args.device}/history`);
    const feedRef = admin.database().ref(`/devices/${args.device}/feedLog`);

    const [histData, feedData] = await Promise.all([
      writeHistory ? loadNode(histRef) : {},
      writeFeedLog ? loadNode(feedRef) : {},
    ]);

    const existingHistKeys = new Set(Object.keys(histData));
    const existingFeedKeys = new Set(Object.keys(feedData));

    const totals = {
      historySource: 0,
      feedSource: 0,
      historyWouldWrite: 0,
      feedWouldWrite: 0,
      historySkipped: 0,
      feedSkipped: 0,
    };

    for (const { target, source } of pairs) {
      const stats = await processPair({
        device: args.device,
        sourceDate: source,
        targetDate: target,
        histData,
        feedData,
        existingHistKeys,
        existingFeedKeys,
        dryRun: args.dryRun,
        writeHistory,
        writeFeedLog,
      });

      console.log(
        `[seed] ${source} → ${target}: ` +
        `history ${stats.historySource} src, ${stats.historyWouldWrite} new, ${stats.historySkipped} skipped | ` +
        `feedLog ${stats.feedSource} src, ${stats.feedWouldWrite} new, ${stats.feedSkipped} skipped`,
      );

      for (const k of Object.keys(totals)) totals[k] += stats[k];
    }

    console.log('[seed] Totals:');
    console.log(`  history: ${totals.historySource} read from source days, ${totals.historyWouldWrite} ${args.dryRun ? 'would write' : 'written'}, ${totals.historySkipped} skipped (existing)`);
    console.log(`  feedLog: ${totals.feedSource} read from source days, ${totals.feedWouldWrite} ${args.dryRun ? 'would write' : 'written'}, ${totals.feedSkipped} skipped (existing)`);

    if (args.dryRun) {
      console.log('[seed] Dry-run complete. No changes written.');
    } else {
      console.log('[seed] Done. Existing Apr 27–May 17 data was not modified.');
    }
  } finally {
    await Promise.allSettled(admin.apps.map((a) => a.delete()));
  }
}

main().catch((e) => {
  console.error('[seed] Failed:', e?.message || e);
  process.exitCode = 1;
});
