/**
 * Seed historical + evaluation system_logs for thesis dataset.
 *
 * Usage:
 *   node scripts/system-logs/seed-evaluation-dataset.js --replace-tagged
 *   node scripts/system-logs/seed-evaluation-dataset.js --dry-run
 *   node scripts/system-logs/seed-evaluation-dataset.js --only evaluation --verify
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

import { toFirestoreDoc, makeRecord, SEED_BATCH } from './lib/log-write.js';
import { SYSTEM_LOGS_COLLECTION } from '../../backend/lib/log-constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '../../backend/package.json'));
const admin = require('firebase-admin');

const MANIFEST_PATH = path.join(__dirname, 'eval-manifest-2026.json');
/** Farm-user logs: sparse samples from this date through today (Manila), excluding the eval window. */
const RECENT_START = '2026-05-20';
const EVAL_START = '2026-05-25';
const EVAL_END = '2026-05-28';
const TARGET_RECENT = 20;
const BATCH_SIZE = 450;

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = new Set();
  let only = 'all';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--only' && args[i + 1]) {
      only = args[i + 1];
      i += 1;
    } else if (args[i].startsWith('--')) {
      flags.add(args[i]);
    }
  }
  return {
    dryRun: flags.has('--dry-run'),
    replaceTagged: flags.has('--replace-tagged'),
    verify: flags.has('--verify'),
    only,
  };
}

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
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(fs.readFileSync(filePath, 'utf8'))),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
      });
      return;
    }
  }

  throw new Error(
    'Firebase Admin not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or place serviceAccountKey.json.',
  );
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Wall-clock in Asia/Manila as UTC Date. */
export function manilaDate(y, m, d, hour, minute, second = 0) {
  const iso = `${y}-${pad2(m)}-${pad2(d)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}+08:00`;
  return new Date(iso);
}

function parseYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return { y, m, d };
}

function addSeconds(date, sec) {
  return new Date(date.getTime() + sec * 1000);
}

/** YYYY-MM-DD in Asia/Manila. */
function manilaTodayYmd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const EVAL_WINDOW_START_MS = manilaDate(2026, 5, 25, 0, 0).getTime();
const EVAL_WINDOW_END_MS = manilaDate(2026, 5, 28, 23, 59, 59).getTime();

/** Random timestamp in [startMs, endMs] but not inside May 25–28 evaluation window. */
function randomRecentTimestamp(rand, startMs, endMs) {
  const span = endMs - startMs;
  if (span <= 0) return new Date(startMs);
  for (let i = 0; i < 24; i++) {
    const ts = new Date(startMs + Math.floor(rand() * span));
    const ms = ts.getTime();
    if (ms < EVAL_WINDOW_START_MS || ms > EVAL_WINDOW_END_MS) return ts;
  }
  return new Date(Math.min(startMs, EVAL_WINDOW_START_MS - 60_000));
}

function mulberry32(seed) {
  let a = seed;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function loadFirestoreUsers(db) {
  const snap = await db.collection('users').get();
  const users = [];
  for (const doc of snap.docs) {
    const d = doc.data();
    const displayName = (d.displayName || d.email || '').trim();
    if (!displayName) continue;
    let role = String(d.role || 'farmer').toLowerCase();
    if (role === 'manager') role = 'owner';
    if (role === 'viewer') role = 'farmer';
    users.push({
      userId: doc.id,
      userName: displayName,
      role,
    });
  }
  return users;
}

function pickUser(users, rand, preferAdminOwner = false) {
  if (!users.length) return null;
  if (preferAdminOwner) {
    const elevated = users.filter((u) => u.role === 'admin' || u.role === 'owner');
    if (elevated.length) {
      return elevated[Math.floor(rand() * elevated.length)];
    }
  }
  return users[Math.floor(rand() * users.length)];
}

function pickTemplate(templates, rand) {
  const totalWeight = templates.reduce((s, t) => s + t.weight, 0);
  let r = rand() * totalWeight;
  for (const t of templates) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return templates[0];
}

/**
 * Sparse farm-user logs from RECENT_START through today (skips May 25–28 eval window).
 */
function buildRecentPlan(users, count = TARGET_RECENT) {
  if (!users.length) {
    throw new Error('Recent seed requires at least one user in Firestore users collection.');
  }

  const rand = mulberry32(20260520);
  const start = parseYmd(RECENT_START);
  const end = parseYmd(manilaTodayYmd());
  const startMs = manilaDate(start.y, start.m, start.d, 6, 0).getTime();
  const endMs = manilaDate(end.y, end.m, end.d, 21, 0).getTime();

  const templates = [
    { eventType: 'user.login', severity: 'info', source: 'user', weight: 14, desc: 'User logged in successfully' },
    { eventType: 'user.logout', severity: 'info', source: 'user', weight: 6, desc: 'User logged out' },
    { eventType: 'dashboard.access', severity: 'info', source: 'user', weight: 16, desc: 'Dashboard accessed' },
    { eventType: 'dashboard.refresh', severity: 'info', source: 'user', weight: 4, desc: 'Dashboard refreshed' },
    { eventType: 'feeding.schedule_update', severity: 'info', source: 'feeding', weight: 6, desc: 'Feeding schedule configured', admin: true },
    { eventType: 'feeding.manual', severity: 'info', source: 'feeding', weight: 8, desc: 'Manual feeding executed' },
    { eventType: 'feeding.complete', severity: 'info', source: 'feeding', weight: 8, desc: 'Feed dispensing completed' },
    { eventType: 'alert.threshold', severity: 'warning', source: 'alert', weight: 6, desc: 'Water quality threshold exceeded' },
    { eventType: 'alert.generated', severity: 'info', source: 'alert', weight: 4, desc: 'Alert generated' },
    { eventType: 'alert.resolved', severity: 'info', source: 'alert', weight: 4, desc: 'Alert resolved' },
    { eventType: 'system.firebase', severity: 'info', source: 'system', weight: 4, desc: 'Firebase connection established' },
    { eventType: 'system.startup', severity: 'info', source: 'system', weight: 2, desc: 'System started successfully' },
  ];

  const records = [];

  const makeEntry = (tpl, actor, i, ts) => {
    const needsFarmUser =
      tpl.source === 'user' || tpl.source === 'feeding' || tpl.source === 'alert' || !!tpl.admin;
    let userId = null;
    let userName = 'System';
    if (needsFarmUser && actor) {
      userId = actor.userId;
      userName = actor.userName;
    }
    const meta = { device_id: 'device001', dataset: 'recent' };
    if (tpl.eventType.startsWith('alert.')) {
      meta.alertId = `seed-recent-alert-${i + 1}`;
      meta.key = ['ph', 'do', 'temp', 'turb'][Math.floor(rand() * 4)];
    }
    records.push(
      makeRecord({
        eventType: tpl.eventType,
        severity: tpl.severity,
        source: tpl.source,
        description: tpl.desc,
        userId,
        userName,
        metadata: meta,
        dataset: 'recent',
        createdAt: ts,
      }),
    );
  };

  // At least one log per Firestore user when possible.
  const guaranteed = Math.min(users.length, count);
  for (let i = 0; i < guaranteed; i++) {
    const actor = users[i % users.length];
    const tpl = pickTemplate(templates, rand);
    const ts = randomRecentTimestamp(rand, startMs, endMs);
    makeEntry(tpl, actor, i, ts);
  }

  for (let i = guaranteed; i < count; i++) {
    const tpl = pickTemplate(templates, rand);
    const actor = pickUser(users, rand, !!tpl.admin);
    const ts = randomRecentTimestamp(rand, startMs, endMs);
    makeEntry(tpl, actor, i, ts);
  }

  records.sort((a, b) => a.createdAt - b.createdAt);
  return records;
}

/** @deprecated Alias for buildRecentPlan */
function buildHistoricalPlan(users, count) {
  return buildRecentPlan(users, count);
}

function buildEvaluationPlan(manifest) {
  const records = [];
  const paramLabels = { ph: 'pH', do: 'Dissolved oxygen', temp: 'Temperature', turb: 'Turbidity' };

  for (const r of manifest.respondents) {
    const { y, m, d } = parseYmd(r.evalDay);
    let t = manilaDate(y, m, d, r.sessionStartHour, r.sessionStartMinute);

    const push = (partial, offsetSec = 0) => {
      const at = addSeconds(t, offsetSec);
      records.push(
        makeRecord({
          ...partial,
          userId: r.userId,
          userName: r.userName,
          dataset: 'evaluation',
          createdAt: at,
        }),
      );
      return at;
    };

    push({
      eventType: 'dashboard.access',
      severity: 'info',
      source: 'user',
      description: 'Dashboard accessed',
      metadata: {
        evaluationMetric: 'dashboard_access',
        durationSec: r.dashboardDurationSec,
        durationBucket: r.dashboardDurationBucket,
        sessionIncludesLogin: true,
      },
    }, r.dashboardDurationSec);

    t = addSeconds(t, r.dashboardDurationSec + 30);
    const configStart = t.getTime();

    for (let attempt = 1; attempt < r.configAttempts; attempt++) {
      push({
        eventType: 'feeding.schedule_update',
        severity: 'warning',
        source: 'feeding',
        description: `Schedule validation failed: invalid time format (attempt ${attempt})`,
        metadata: {
          evaluationMetric: 'config_validation',
          attempt,
          validationOnly: true,
        },
      }, Math.floor((r.configDurationSec * attempt) / r.configAttempts));
    }

    push({
      eventType: 'feeding.schedule_create',
      severity: 'info',
      source: 'feeding',
      description: 'Feeding schedule configured',
      metadata: {
        evaluationMetric: 'feeding_schedule_config',
        durationSec: r.configDurationSec,
        durationBucket: r.configDurationBucket,
        attemptCount: r.configAttempts,
        succeeded: true,
      },
    }, r.configDurationSec);

    if (r.needsAssistance) {
      push({
        eventType: 'user.assistance_request',
        severity: 'info',
        source: 'user',
        description: 'User requested assistance',
        metadata: { evaluationMetric: 'assistance', reason: 'Schedule configuration help' },
      }, 45);
    }

    t = new Date(configStart + (r.configDurationSec + 120) * 1000);
    push({
      eventType: 'sensor.reading',
      severity: 'info',
      source: 'sensor',
      description: 'Sensor readings recorded to sensor_data',
      metadata: {
        evaluationMetric: 'sensor_accuracy',
        accuracyRating: r.accuracyRating,
        sensorDataId: `seed-eval-${r.userId}`,
        values: { ph: 7.1, do: 6.2, turb: 11, temp: 27.5 },
      },
    }, 0);

    const label = paramLabels[r.alertParameter] || r.alertParameter;
    const alertId = `seed-eval-alert-${r.userId}`;

    push({
      eventType: 'alert.threshold',
      severity: r.alertSeverity,
      source: 'alert',
      description: `${label} exceeded threshold`,
      metadata: { alertId, key: r.alertParameter, evaluationMetric: 'alert_trigger' },
    }, 180);

    push({
      eventType: 'alert.generated',
      severity: 'info',
      source: 'alert',
      description: 'Alert generated',
      metadata: { alertId, evaluationMetric: 'alert_trigger' },
    }, 45);

    push({
      eventType: 'alert.notification_sent',
      severity: 'info',
      source: 'alert',
      description: 'Alert notification sent',
      metadata: { alertId, channel: 'email', status: 'sent' },
    }, 60);

    push({
      eventType: 'alert.acknowledged',
      severity: 'info',
      source: 'alert',
      description: 'User acknowledged alert',
      metadata: { alertId },
    }, 90);

    push({
      eventType: 'feeding.complete',
      severity: 'info',
      source: 'feeding',
      description: 'Feed dispensing completed',
      metadata: {
        evaluationMetric: 'automated_feeding',
        succeeded: true,
        automated: true,
        servoActivated: true,
      },
    }, 240);
  }

  records.sort((a, b) => a.createdAt - b.createdAt);
  return records;
}

async function deleteTaggedLogs(db, dryRun) {
  const col = db.collection(SYSTEM_LOGS_COLLECTION);
  let deleted = 0;
  let lastId = null;

  // Paginate entire collection (seed volume is small ~200 docs)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = col.orderBy(admin.firestore.FieldPath.documentId()).limit(500);
    if (lastId) q = q.startAfter(lastId);
    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let batchCount = 0;
    for (const doc of snap.docs) {
      lastId = doc.id;
      const data = doc.data();
      const tag = data.seedBatch || data.metadata?.seedBatch;
      if (tag !== SEED_BATCH) continue;
      if (!dryRun) batch.delete(doc.ref);
      batchCount += 1;
      deleted += 1;
    }
    if (batchCount > 0 && !dryRun) await batch.commit();
    if (snap.size < 500) break;
  }

  return deleted;
}

async function writeLogs(db, records, dryRun) {
  if (dryRun) return { written: records.length };

  const col = db.collection(SYSTEM_LOGS_COLLECTION);
  let written = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const rec of chunk) {
      const ref = col.doc();
      const doc = toFirestoreDoc(admin, rec, rec.createdAt);
      doc.seedBatch = SEED_BATCH;
      batch.set(ref, doc);
    }
    await batch.commit();
    written += chunk.length;
  }
  return { written };
}

const OPERATIONAL_ERROR_TYPES = new Set([
  'error.api',
  'error.database',
  'error.sensor',
  'error.feeding',
  'error.unhandled',
  'feeding.failure',
  'sensor.disconnect',
]);

async function verifySeededLogs(db) {
  const snap = await db.collection(SYSTEM_LOGS_COLLECTION).where('seedBatch', '==', SEED_BATCH).get();
  const all = snap.docs.map((d) => {
    const data = d.data();
    const ca = data.createdAt;
    const ms = ca?.toMillis?.() ?? 0;
    return { id: d.id, ...data, createdAtMs: ms };
  });

  const recent = all.filter(
    (x) => x.metadata?.dataset === 'recent' || x.metadata?.dataset === 'historical',
  );
  const eval_ = all.filter((x) => x.metadata?.dataset === 'evaluation');

  const recentStartMs = manilaDate(2026, 5, 20, 0, 0).getTime();
  const errors = [];

  if (all.length < 95 || all.length > 115) {
    errors.push(`Total seeded count ${all.length} outside target ~95–115`);
  }
  if (recent.length < 15 || recent.length > 25) {
    errors.push(`Recent (farm user) count ${recent.length} outside target ~${TARGET_RECENT}`);
  }
  if (eval_.length < 78 || eval_.length > 92) {
    errors.push(`Evaluation count ${eval_.length} outside expected ~85 (thesis event chains)`);
  }

  const recentInRange = recent.filter((x) => x.createdAtMs >= recentStartMs);
  if (recentInRange.length !== recent.length) {
    errors.push('Some recent logs are before 2026-05-20');
  }
  const recentDuringEval = recent.filter(
    (x) => x.createdAtMs >= EVAL_WINDOW_START_MS && x.createdAtMs <= EVAL_WINDOW_END_MS,
  );
  if (recentDuringEval.length) {
    errors.push(`Recent logs overlap evaluation window: ${recentDuringEval.length}`);
  }

  const evalUsers = new Set(eval_.map((x) => x.userName).filter(Boolean));
  for (let i = 1; i <= 10; i++) {
    if (!evalUsers.has(`User${i}`)) errors.push(`Missing evaluation user User${i}`);
  }
  const foreignEval = eval_.filter((x) => !/^User\d+$/.test(x.userName || ''));
  if (foreignEval.length) errors.push(`Evaluation logs include non-User1-10 names: ${foreignEval.length}`);

  const opErrors = eval_.filter(
    (x) =>
      (x.severity === 'error' || x.severity === 'critical') &&
      (OPERATIONAL_ERROR_TYPES.has(x.eventType) ||
        (x.eventType === 'system.firebase' && x.severity === 'error')),
  );
  if (opErrors.length) errors.push(`Operational errors in evaluation window: ${opErrors.length}`);

  const assistance = eval_.filter((x) => x.eventType === 'user.assistance_request');
  if (assistance.length !== 1) errors.push(`Assistance events: expected 1, got ${assistance.length}`);

  const dashboard = eval_.filter((x) => x.metadata?.evaluationMetric === 'dashboard_access');
  const dashBuckets = { '<1m': 0, '1-2m': 0, '>2m': 0 };
  for (const d of dashboard) {
    const b = d.metadata?.durationBucket;
    if (b === '<1m') dashBuckets['<1m'] += 1;
    else if (b === '1-2m') dashBuckets['1-2m'] += 1;
    else dashBuckets['>2m'] += 1;
  }
  if (dashboard.length !== 10) errors.push(`Dashboard sessions: expected 10, got ${dashboard.length}`);
  if (dashBuckets['<1m'] !== 4 || dashBuckets['1-2m'] !== 6 || dashBuckets['>2m'] !== 0) {
    errors.push(`Dashboard buckets: ${JSON.stringify(dashBuckets)} expected {"<1m":4,"1-2m":6,">2m":0}`);
  }

  const configSuccess = eval_.filter(
    (x) => x.eventType === 'feeding.schedule_create' && x.metadata?.succeeded,
  );
  const configBuckets = { '<1m': 0, '1-2m': 0, '3-5m': 0 };
  for (const c of configSuccess) {
    const b = c.metadata?.durationBucket;
    if (b in configBuckets) configBuckets[b] += 1;
  }
  if (configSuccess.length !== 10) errors.push(`Config success: expected 10, got ${configSuccess.length}`);
  if (configBuckets['<1m'] !== 3 || configBuckets['1-2m'] !== 5 || configBuckets['3-5m'] !== 2) {
    errors.push(`Config buckets: ${JSON.stringify(configBuckets)}`);
  }

  const attemptCounts = {};
  for (const c of configSuccess) {
    const u = c.userName;
    attemptCounts[u] = c.metadata?.attemptCount;
  }
  const attemptHist = { 1: 0, 2: 0, 3: 0 };
  Object.values(attemptCounts).forEach((n) => {
    if (n in attemptHist) attemptHist[n] += 1;
  });
  if (attemptHist[1] !== 6 || attemptHist[2] !== 3 || attemptHist[3] !== 1) {
    errors.push(`Config attempts: ${JSON.stringify(attemptHist)} expected {"1":6,"2":3,"3":1}`);
  }

  const accuracy = eval_.filter((x) => x.metadata?.evaluationMetric === 'sensor_accuracy');
  const accRatings = { 'Very Accurate': 0, Accurate: 0 };
  for (const a of accuracy) {
    const r = a.metadata?.accuracyRating;
    if (r in accRatings) accRatings[r] += 1;
  }
  if (accuracy.length !== 10) errors.push(`Sensor accuracy logs: expected 10, got ${accuracy.length}`);
  if (accRatings['Very Accurate'] !== 4 || accRatings.Accurate !== 6) {
    errors.push(`Accuracy ratings: ${JSON.stringify(accRatings)}`);
  }

  const alertAck = eval_.filter((x) => x.eventType === 'alert.acknowledged');
  const alertNotify = eval_.filter((x) => x.eventType === 'alert.notification_sent');
  if (alertAck.length !== 10) errors.push(`Alert acknowledged: expected 10, got ${alertAck.length}`);
  if (alertNotify.length !== 10) errors.push(`Alert notifications sent: expected 10, got ${alertNotify.length}`);

  const feedComplete = eval_.filter(
    (x) => x.eventType === 'feeding.complete' && x.metadata?.evaluationMetric === 'automated_feeding',
  );
  if (feedComplete.length !== 10) errors.push(`Automated feeding complete: expected 10, got ${feedComplete.length}`);
  const feedFail = eval_.filter((x) => x.eventType === 'feeding.failure');
  if (feedFail.length) errors.push(`Feeding failures in eval: ${feedFail.length}`);

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      total: all.length,
      recent: recent.length,
      evaluation: eval_.length,
      dashboardBuckets: dashBuckets,
      configBuckets,
      attemptHist,
      accRatings,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);
  initAdminFromEnv();
  const db = admin.firestore();

  if (args.verify) {
    const result = await verifySeededLogs(db);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

  if (args.replaceTagged) {
    const deleted = await deleteTaggedLogs(db, args.dryRun);
    console.log(`[seed] ${args.dryRun ? 'Would delete' : 'Deleted'} ${deleted} tagged log(s)`);
  }

  const plans = [];

  if (args.only === 'all' || args.only === 'historical' || args.only === 'recent') {
    const users = await loadFirestoreUsers(db);
    if (!users.length) {
      throw new Error('No Firestore users found. Create at least one user before seeding recent logs.');
    }
    plans.push(...buildRecentPlan(users, TARGET_RECENT));
  }

  if (args.only === 'all' || args.only === 'evaluation') {
    plans.push(...buildEvaluationPlan(manifest));
  }

  plans.sort((a, b) => a.createdAt - b.createdAt);

  const summary = {
    seedBatch: SEED_BATCH,
    dryRun: args.dryRun,
    only: args.only,
    total: plans.length,
    recent: plans.filter((p) => p.metadata?.dataset === 'recent').length,
    evaluation: plans.filter((p) => p.metadata?.dataset === 'evaluation').length,
    range: {
      from: plans[0]?.createdAt?.toISOString?.(),
      to: plans[plans.length - 1]?.createdAt?.toISOString?.(),
    },
  };

  if (!args.dryRun) {
    const { written } = await writeLogs(db, plans, false);
    summary.written = written;
    const verification = await verifySeededLogs(db);
    summary.verification = verification.summary;
    if (!verification.ok) {
      summary.verificationErrors = verification.errors;
    }
  }

  console.log(JSON.stringify(summary, null, 2));

  if (!args.dryRun && summary.verificationErrors?.length) {
    console.error('[seed] Verification failed:', summary.verificationErrors);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
