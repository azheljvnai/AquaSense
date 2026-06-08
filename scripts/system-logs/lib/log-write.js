/**
 * Helpers for seeding system_logs documents (Admin SDK direct writes).
 */
import {
  LOG_SOURCES,
  LOG_SEVERITIES,
  LOG_EVENT_TYPES,
  DESCRIPTION_MAX,
  METADATA_MAX_BYTES,
} from '../../../backend/lib/log-constants.js';

export const SEED_BATCH = 'aquasense-eval-2026-v1';

export function validateLogRecord(record) {
  const { eventType, severity, source, description } = record || {};
  if (!eventType || !LOG_EVENT_TYPES.has(eventType)) {
    return { ok: false, error: `Invalid eventType: ${eventType}` };
  }
  if (!severity || !LOG_SEVERITIES.has(severity)) {
    return { ok: false, error: `Invalid severity: ${severity}` };
  }
  if (!source || !LOG_SOURCES.has(source)) {
    return { ok: false, error: `Invalid source: ${source}` };
  }
  const desc = String(description || '').trim();
  if (!desc) return { ok: false, error: 'Description required' };
  return { ok: true };
}

function sanitizeMetadata(metadata) {
  if (metadata == null) return null;
  const json = JSON.stringify(metadata);
  if (json.length > METADATA_MAX_BYTES) {
    return { _truncated: true, preview: json.slice(0, METADATA_MAX_BYTES - 50) };
  }
  return JSON.parse(json);
}

/**
 * @param {import('firebase-admin')} admin
 * @param {object} record
 * @param {Date} createdAt
 */
export function toFirestoreDoc(admin, record, createdAt) {
  const v = validateLogRecord(record);
  if (!v.ok) throw new Error(v.error);

  const desc = String(record.description).trim().slice(0, DESCRIPTION_MAX);
  return {
    eventType: record.eventType,
    severity: record.severity,
    source: record.source,
    description: desc,
    descriptionLower: desc.toLowerCase(),
    userId: record.userId || null,
    userName: record.userName || null,
    metadata: sanitizeMetadata(record.metadata),
    createdAt: admin.firestore.Timestamp.fromDate(createdAt),
  };
}

export function makeRecord(partial) {
  return {
    eventType: partial.eventType,
    severity: partial.severity,
    source: partial.source,
    description: partial.description,
    userId: partial.userId ?? null,
    userName: partial.userName ?? null,
    metadata: {
      seedBatch: SEED_BATCH,
      dataset: partial.dataset || 'evaluation',
      ...partial.metadata,
    },
    createdAt: partial.createdAt,
  };
}
