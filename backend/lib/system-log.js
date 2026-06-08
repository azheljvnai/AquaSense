/**
 * Centralized system logging — Firestore system_logs via Admin SDK.
 */
import admin from 'firebase-admin';
import {
  LOG_SOURCES,
  LOG_SEVERITIES,
  LOG_EVENT_TYPES,
  SYSTEM_LOGS_COLLECTION,
  DESCRIPTION_MAX,
  METADATA_MAX_BYTES,
  AUDIT_EVENT_TYPE,
} from './log-constants.js';
import {
  isRuntimeLogAllowed,
  shouldDedupeLog,
  logDedupeKey,
} from './log-policy.js';
import { enrichLogItemsWithUserNames } from './log-user-display.js';

const _serverDedupe = new Map();

function sanitizeMetadata(metadata) {
  if (metadata == null) return null;
  try {
    const json = JSON.stringify(metadata);
    if (json.length > METADATA_MAX_BYTES) {
      return { _truncated: true, preview: json.slice(0, METADATA_MAX_BYTES - 50) };
    }
    return JSON.parse(json);
  } catch {
    return { _error: 'invalid_metadata' };
  }
}

function validatePayload(payload) {
  const {
    eventType,
    severity,
    source,
    description,
  } = payload || {};

  if (!eventType || !LOG_EVENT_TYPES.has(eventType)) {
    return { ok: false, error: 'Invalid or missing eventType.' };
  }
  if (!severity || !LOG_SEVERITIES.has(severity)) {
    return { ok: false, error: 'Invalid or missing severity.' };
  }
  if (!source || !LOG_SOURCES.has(source)) {
    return { ok: false, error: 'Invalid or missing source.' };
  }
  const desc = String(description || '').trim();
  if (!desc) {
    return { ok: false, error: 'Description is required.' };
  }

  return {
    ok: true,
    data: {
      eventType,
      severity,
      source,
      description: desc.slice(0, DESCRIPTION_MAX),
      userId: payload.userId ? String(payload.userId) : null,
      userName: payload.userName ? String(payload.userName).slice(0, 120) : null,
      metadata: sanitizeMetadata(payload.metadata),
      descriptionLower: desc.slice(0, DESCRIPTION_MAX).toLowerCase(),
    },
  };
}

/**
 * @param {object} payload
 * @returns {Promise<string|null>} document id or null on failure
 */
export async function createSystemLog(payload, options = {}) {
  if (!admin.apps.length) {
    console.error('[system-log] Admin SDK not initialised');
    return null;
  }

  if (!isRuntimeLogAllowed(payload?.eventType, options)) {
    return null;
  }

  const dedupeKey = logDedupeKey(payload);
  if (shouldDedupeLog(payload.eventType, dedupeKey, _serverDedupe)) {
    return null;
  }

  const validated = validatePayload(payload);
  if (!validated.ok) {
    console.error('[system-log]', validated.error);
    return null;
  }

  try {
    const ref = await admin.firestore().collection(SYSTEM_LOGS_COLLECTION).add({
      ...validated.data,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return ref.id;
  } catch (e) {
    console.error('[system-log] Write failed:', e.message);
    return null;
  }
}

/** Fire-and-forget wrapper for server callers. */
export function createSystemLogAsync(payload) {
  void createSystemLog(payload).catch(() => {});
}

/**
 * @param {import('express').Request} req
 * @param {object} partial
 */
export function buildLogFromReq(req, partial) {
  const uid = req.auth?.uid || partial.userId || null;
  return {
    userId: uid,
    userName: partial.userName || null,
    ...partial,
  };
}

function parseMs(val) {
  if (val == null || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  return n;
}

function parseFilterList(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((v) => String(v || '').split(',')).map((v) => v.trim()).filter(Boolean))];
  }
  return [...new Set(String(value).split(',').map((v) => v.trim()).filter(Boolean))];
}

function getSeverityValues(filters) {
  return parseFilterList(filters?.severity);
}

function getEventTypeValues(filters) {
  return parseFilterList(filters?.eventType);
}

function getSourceValues(filters) {
  return parseFilterList(filters?.source);
}

function getUserValues(filters) {
  return parseFilterList(filters?.userId);
}

function hasSystemUserFilter(filters) {
  return getUserValues(filters).includes('__system__');
}

function getQueryableUserValues(filters) {
  return getUserValues(filters).filter((id) => id !== '__system__');
}

/** True when Firestore composite indexes are missing or still building. */
export function isFirestoreIndexError(err) {
  const code = err?.code ?? err?.details;
  const msg = String(err?.message || err || '');
  return (
    code === 9 ||
    code === 'FAILED_PRECONDITION' ||
    (msg.includes('FAILED_PRECONDITION') && msg.includes('index'))
  );
}

/** Filters that should use buildSystemLogsQuery (equality and/or createdAt range). */
export function needsCompositeIndex(filters) {
  const severityVals = getSeverityValues(filters);
  const eventVals = getEventTypeValues(filters);
  const sourceVals = getSourceValues(filters);
  const userVals = getQueryableUserValues(filters);
  return !!(
    severityVals.length ||
    eventVals.length ||
    sourceVals.length ||
    userVals.length ||
    parseMs(filters?.from) != null ||
    parseMs(filters?.to) != null
  );
}

/** Extra client-side filtering (search text or multiple equality fields). */
export function needsPostFilter(filters) {
  if (String(filters.q || '').trim()) return true;

  const severityVals = getSeverityValues(filters);
  const eventVals = getEventTypeValues(filters);
  const sourceVals = getSourceValues(filters);
  const userVals = getUserValues(filters);
  const userQueryableVals = getQueryableUserValues(filters);
  const hasSystem = hasSystemUserFilter(filters);

  if (severityVals.length > 1 || eventVals.length > 1 || sourceVals.length > 1 || userVals.length > 1) return true;

  const eqFields = [
    severityVals.length ? 'severity' : '',
    eventVals.length ? 'eventType' : '',
    sourceVals.length ? 'source' : '',
    userQueryableVals.length ? 'userId' : '',
  ].filter(Boolean);
  if (eqFields.length > 1) return true;
  if (hasSystem && eqFields.length > 0) return true;
  if (hasSystem) return true;
  return false;
}

/** Firestore aggregate count matches the list when no post-filter is required. */
export function filtersSupportExactCount(filters) {
  return !needsPostFilter(filters);
}

function buildSimpleSystemLogsQuery(db) {
  return db.collection(SYSTEM_LOGS_COLLECTION).orderBy('createdAt', 'desc');
}

async function applyCursor(q, db, scanCursor) {
  if (!scanCursor) return q;
  const cursorDoc = await db.collection(SYSTEM_LOGS_COLLECTION).doc(scanCursor).get();
  if (cursorDoc.exists) return q.startAfter(cursorDoc);
  return q;
}

/**
 * Run a limited query; on index errors, fall back to orderBy(createdAt) + post-filter.
 */
async function fetchLogSnapshot(db, filters, { scanCursor, batchSize }) {
  const useComposite = needsCompositeIndex(filters);
  const multiplier = useComposite ? 4 : 1;

  const run = async (composite) => {
    let q = composite ? buildSystemLogsQuery(db, filters) : buildSimpleSystemLogsQuery(db);
    q = q.limit(Math.min(batchSize * multiplier, 500));
    q = await applyCursor(q, db, scanCursor);
    return q.get();
  };

  try {
    const snap = await run(useComposite);
    return { snap, indexFallback: useComposite ? false : false };
  } catch (e) {
    if (!isFirestoreIndexError(e)) throw e;
    console.warn('[system-log] Composite index unavailable, using createdAt fallback:', e.message);
    const snap = await run(false);
    return { snap, indexFallback: true };
  }
}

/**
 * Build Firestore query from filter params.
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {object} filters
 */
export function buildSystemLogsQuery(db, filters) {
  let q = db.collection(SYSTEM_LOGS_COLLECTION);
  const severityVals = getSeverityValues(filters);
  const eventVals = getEventTypeValues(filters);
  const sourceVals = getSourceValues(filters);
  const userVals = getQueryableUserValues(filters);

  // Firestore allows one primary equality + range on createdAt; extra filters applied post-fetch.
  if (severityVals.length === 1) {
    q = q.where('severity', '==', severityVals[0]);
  } else if (eventVals.length === 1) {
    q = q.where('eventType', '==', eventVals[0]);
  } else if (sourceVals.length === 1) {
    q = q.where('source', '==', sourceVals[0]);
  } else if (userVals.length === 1) {
    q = q.where('userId', '==', userVals[0]);
  }

  const fromMs = parseMs(filters.from);
  const toMs = parseMs(filters.to);
  if (fromMs != null) {
    q = q.where('createdAt', '>=', admin.firestore.Timestamp.fromMillis(fromMs));
  }
  if (toMs != null) {
    q = q.where('createdAt', '<=', admin.firestore.Timestamp.fromMillis(toMs));
  }

  q = q.orderBy('createdAt', 'desc');

  return q;
}

/** Apply filters not handled by Firestore query (multi-filter + search). */
export function matchesLogFilters(item, filters) {
  const severityVals = getSeverityValues(filters);
  const eventVals = getEventTypeValues(filters);
  const sourceVals = getSourceValues(filters);
  const userVals = getUserValues(filters);

  if (severityVals.length && !severityVals.includes(item.severity)) return false;
  if (eventVals.length && !eventVals.includes(item.eventType)) return false;
  if (sourceVals.length && !sourceVals.includes(item.source)) return false;

  if (userVals.length) {
    const allowSystem = userVals.includes('__system__');
    if (allowSystem && !item.userId) {
      // allowed
    } else if (!userVals.includes(item.userId || '')) {
      return false;
    }
  }

  const fromMs = parseMs(filters.from);
  const toMs = parseMs(filters.to);
  if (fromMs != null && (item.createdAt == null || item.createdAt < fromMs)) return false;
  if (toMs != null && (item.createdAt == null || item.createdAt > toMs)) return false;
  const q = String(filters.q || '').trim().toLowerCase();
  if (q && !String(item.description || '').toLowerCase().includes(q)) return false;
  return true;
}

/**
 * @param {FirebaseFirestore.QueryDocumentSnapshot} doc
 */
export function serializeLogDoc(doc) {
  const d = doc.data();
  const createdAt = d.createdAt;
  let createdAtMs = null;
  if (createdAt && typeof createdAt.toMillis === 'function') {
    createdAtMs = createdAt.toMillis();
  } else if (createdAt?._seconds != null) {
    createdAtMs = createdAt._seconds * 1000;
  }
  return {
    id: doc.id,
    createdAt: createdAtMs,
    eventType: d.eventType,
    severity: d.severity,
    source: d.source,
    description: d.description,
    userId: d.userId || null,
    userName: d.userName || null,
    metadata: d.metadata || null,
  };
}

/**
 * Count documents matching filters (exact when filtersSupportExactCount).
 * @returns {Promise<number|null>}
 */
export async function countSystemLogs(filters) {
  if (!filtersSupportExactCount(filters)) return null;
  const db = admin.firestore();
  const useComposite = needsCompositeIndex(filters);

  const runCount = async (composite) => {
    const q = composite ? buildSystemLogsQuery(db, filters) : buildSimpleSystemLogsQuery(db);
    const snap = await q.count().get();
    return snap.data().count;
  };

  try {
    return await runCount(useComposite);
  } catch (e) {
    if (!isFirestoreIndexError(e)) throw e;
    if (!useComposite) return null;
    try {
      return await runCount(false);
    } catch {
      return null;
    }
  }
}

/**
 * Query paginated logs.
 */
export async function querySystemLogs(filters, { pageSize = 25, cursor = null, includeCount = false } = {}) {
  const db = admin.firestore();
  const limit = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
  const items = [];
  let hasMore = false;
  let scanCursor = cursor || null;
  let usePostFilter = needsPostFilter(filters);
  const maxScans = usePostFilter ? 8 : 1;
  let scans = 0;
  let indexFallback = false;

  while (items.length < limit + 1 && scans < maxScans) {
    scans += 1;
    const remaining = limit + 1 - items.length;
    const batchSize = usePostFilter ? Math.min(remaining * 4, 100) : limit + 1;
    const { snap, indexFallback: usedFallback } = await fetchLogSnapshot(db, filters, {
      scanCursor,
      batchSize,
    });
    if (usedFallback) {
      indexFallback = true;
      usePostFilter = true;
    }
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const item = serializeLogDoc(doc);
      if (usePostFilter && !matchesLogFilters(item, filters)) continue;
      items.push(item);
      if (items.length > limit) {
        hasMore = true;
        break;
      }
    }

    scanCursor = snap.docs[snap.docs.length - 1].id;
    if (snap.size < batchSize) break;
    if (hasMore) break;
  }

  const pageItems = hasMore ? items.slice(0, limit) : items;
  const enrichedItems = await enrichLogItemsWithUserNames(db, pageItems);
  const nextCursor = pageItems.length ? pageItems[pageItems.length - 1].id : null;

  let totalCount = null;
  let totalPages = null;
  if (includeCount && !cursor) {
    try {
      totalCount = await countSystemLogs(filters);
      if (totalCount != null) totalPages = Math.max(1, Math.ceil(totalCount / limit));
    } catch (e) {
      if (!isFirestoreIndexError(e)) throw e;
    }
  }

  return {
    items: enrichedItems,
    nextCursor,
    hasMore,
    indexFallback,
    pageSize: limit,
    totalCount,
    totalPages,
  };
}

/**
 * Fetch up to maxRows for export (capped).
 */
export async function fetchLogsForExport(filters, maxRows = 5000) {
  const db = admin.firestore();
  const out = [];
  let scanCursor = null;

  while (out.length < maxRows) {
    const batchSize = Math.min(500, maxRows - out.length + 50);
    const { snap } = await fetchLogSnapshot(db, filters, { scanCursor, batchSize });
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const item = serializeLogDoc(doc);
      if (!matchesLogFilters(item, filters)) continue;
      out.push(item);
      if (out.length >= maxRows) break;
    }
    scanCursor = snap.docs[snap.docs.length - 1].id;
    if (snap.size < batchSize) break;
  }
  const enriched = await enrichLogItemsWithUserNames(db, out);
  return enriched;
}

export async function summarizeSystemLogs(filters, { maxScan = 20000 } = {}) {
  const db = admin.firestore();
  let scanCursor = null;
  let scanned = 0;
  const summary = {
    total: 0,
    error: 0,
    warning: 0,
    critical: 0,
    truncated: false,
  };

  while (scanned < maxScan) {
    const batchSize = Math.min(500, maxScan - scanned);
    const { snap } = await fetchLogSnapshot(db, filters, { scanCursor, batchSize });
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned += 1;
      const item = serializeLogDoc(doc);
      if (!matchesLogFilters(item, filters)) continue;
      summary.total += 1;
      if (item.severity === 'error') summary.error += 1;
      if (item.severity === 'warning') summary.warning += 1;
      if (item.severity === 'critical') summary.critical += 1;
      if (scanned >= maxScan) break;
    }

    scanCursor = snap.docs[snap.docs.length - 1].id;
    if (snap.size < batchSize) break;
  }

  if (scanned >= maxScan) summary.truncated = true;
  return summary;
}

const BATCH_SIZE = 500;

/**
 * Delete logs matching filters (excludes audit entries). Returns deleted count.
 */
export async function clearSystemLogs(filters, { userId, userName } = {}) {
  const db = admin.firestore();
  let deletedCount = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { snap } = await fetchLogSnapshot(db, { ...filters }, { scanCursor: null, batchSize: BATCH_SIZE });
    if (snap.empty) break;

    const batch = db.batch();
    let batchCount = 0;
    for (const doc of snap.docs) {
      if (doc.data().eventType === AUDIT_EVENT_TYPE) continue;
      const item = serializeLogDoc(doc);
      if (!matchesLogFilters(item, filters)) continue;
      batch.delete(doc.ref);
      batchCount += 1;
      deletedCount += 1;
    }
    if (batchCount > 0) await batch.commit();
    if (snap.size < BATCH_SIZE) break;
  }

  await createSystemLog({
    eventType: AUDIT_EVENT_TYPE,
    severity: 'warning',
    source: 'system',
    description: `System logs cleared by administrator (${deletedCount} entries deleted)`,
    userId: userId || null,
    userName: userName || null,
    metadata: {
      deletedCount,
      filterSnapshot: {
        severity: filters.severity || null,
        eventType: filters.eventType || null,
        source: filters.source || null,
        from: filters.from || null,
        to: filters.to || null,
        q: filters.q || null,
      },
    },
  });

  return deletedCount;
}

/**
 * CSV rows for export.
 */
export function logsToCsvRows(items) {
  const header = ['Timestamp', 'Severity', 'Event Type', 'Source', 'Description', 'User ID', 'User Name'];
  const rows = [header];
  for (const item of items) {
    const ts = item.createdAt
      ? new Date(item.createdAt).toISOString()
      : '';
    rows.push([
      ts,
      item.severity || '',
      item.eventType || '',
      item.source || '',
      item.description || '',
      item.userId || '',
      item.userName || '',
    ]);
  }
  return rows;
}

export function csvFromRows(rows) {
  const escape = (v) => {
    const s = String(v ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return '\uFEFF' + rows.map((r) => r.map(escape).join(',')).join('\r\n');
}

export function xlsxFromRows(rows) {
  const escapeXml = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const rowXml = rows
    .map((row) => {
      const cells = row
        .map((cell) => {
          const v = String(cell ?? '');
          const num = /^-?\d+(\.\d+)?$/.test(v);
          const type = num ? 'Number' : 'String';
          return `<Cell><Data ss:Type="${type}">${escapeXml(v)}</Data></Cell>`;
        })
        .join('');
      return `<Row>${cells}</Row>`;
    })
    .join('');

  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="SystemLogs"><Table>${rowXml}</Table></Worksheet>
</Workbook>`;
  return xml;
}
