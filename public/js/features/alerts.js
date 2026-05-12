/**
 * Alerts feature — dynamic, real-time alert system.
 *
 * - Evaluates every incoming sensor reading against the active pond config thresholds
 * - Thresholds update automatically when the active pond/species config changes
 * - Persists alert history to localStorage (max 200 entries, 7-day retention)
 * - Renders live summary counters and a scrollable alert list
 * - Notification preferences (email/SMS/push) persisted to localStorage
 */
import { getBadgeForSpecies, getActiveThresholds, getActiveSpecies, getActivePondId } from '../pond-config.js';
import { getActivePond } from '../pond-context.js';
import { handleAlert } from './notifications.js';
import {
  fbAuth,
  fbFirestore,
  fbCollection,
  fbAddDoc,
  fbServerTimestamp,
  fbQuery,
  fbOrderBy,
  fbLimit,
  fbGetDocs,
  fbUpdateDoc,
  fbDoc,
  fbWhere,
  fbOnSnapshot,
  fbWriteBatch,
} from '../firebase-client.js';
import { alertPondFilterButton, alertEmptyListRow, escapeHtml } from '../ui/templates.js';

/** Set in init() so module-level helpers can refresh the alerts tab UI. */
let rerenderAlertsTab = () => {};

/** Human-readable optimal range for notification emails (mirrors server email template). */
function thresholdSummaryForKey(key) {
  try {
    const t = getActiveThresholds();
    if (!t) return '';
    if (key === 'ph') {
      const pb = t.ph;
      if (pb) return `${pb.optimalMin}–${pb.optimalMax}`;
    }
    if (key === 'do') {
      const db = t.do;
      if (db) return `≥ ${db.optimalMin} mg/L`;
    }
    if (key === 'turb') {
      const tb = t.turb;
      if (tb) return `≤ ${tb.optimalMax} NTU`;
    }
    if (key === 'temp') {
      const tb = t.temp;
      if (tb) return `${tb.optimalMin}–${tb.optimalMax}°C`;
    }
  } catch { /* ignore */ }
  return '';
}

// ─── Alert History Storage ────────────────────────────────────────────────────

const ALERT_STORAGE_KEY = 'aquasense.alerts.v1';
const MAX_ALERTS = 200;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function normalizeAlerts(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    let ts = Number(item.ts);
    if (!Number.isFinite(ts)) continue;
    // Migrate legacy second-based timestamps to ms.
    if (ts > 0 && ts < 1e12) ts *= 1000;

    const badge = typeof item.badge === 'string' ? item.badge : '';
    const severity =
      typeof item.severity === 'string'
        ? item.severity
        : (badge === 'danger' ? 'critical' : badge === 'warn' ? 'warning' : 'info');

    out.push({
      id: typeof item.id === 'string' && item.id ? item.id : `migrated-${ts}-${Math.random().toString(36).slice(2, 7)}`,
      ts,
      key: typeof item.key === 'string' ? item.key : '',
      val: typeof item.val === 'number' && Number.isFinite(item.val) ? item.val : Number(item.val),
      severity,
      badge,
      label: typeof item.label === 'string' ? item.label : '',
      description: typeof item.description === 'string' ? item.description : '',
      pond: typeof item.pond === 'string' ? item.pond : '',
      resolved: typeof item.resolved === 'boolean' ? item.resolved : false,
    });
  }
  return out;
}

function loadAlerts() {
  try {
    const raw = JSON.parse(localStorage.getItem(ALERT_STORAGE_KEY) || '[]');
    return normalizeAlerts(raw);
  } catch {
    return [];
  }
}

function saveAlerts(alerts) {
  try {
    localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(alerts));
  } catch {
    // quota — trim and retry
    const trimmed = alerts.slice(-Math.floor(MAX_ALERTS / 2));
    try { localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(trimmed)); } catch { /* ignore */ }
  }
}

function pruneAlerts(alerts) {
  const cutoff = Date.now() - MAX_AGE_MS;
  let pruned = alerts.filter(a => a.ts >= cutoff);
  if (pruned.length > MAX_ALERTS) pruned = pruned.slice(-MAX_ALERTS);
  return pruned;
}

/**
 * Persist a single alert to Firestore.
 * Non-blocking - errors are logged but do not prevent localStorage caching.
 * @param {Object} alert - The alert object to persist
 * @returns {Promise<void>}
 */
async function persistAlertToFirestore(alert) {
  try {
    if (!fbAuth().currentUser) {
      console.warn('[persistAlertToFirestore] Skipped Firestore write: no signed-in user (rules require auth).');
      return;
    }
    const alertData = {
      id: alert.id,
      ts: alert.ts,
      key: alert.key,
      val: alert.val,
      severity: alert.severity,
      badge: alert.badge,
      label: alert.label,
      description: alert.description,
      pond: alert.pond,
      resolved: alert.resolved,
      createdAt: fbServerTimestamp(),
    };
    
    await fbAddDoc(fbCollection(fbFirestore(), 'alerts'), alertData);
  } catch (err) {
    // Non-blocking - localStorage still works
    console.error('[persistAlertToFirestore] Failed to persist alert to Firestore:', err);
  }
}

/**
 * Load alerts from Firestore on page load.
 * Merges with localStorage alerts (Firestore is source of truth).
 * Applies same pruning logic (7 days, 200 max).
 * @returns {Promise<Array>} - Array of alerts from Firestore
 */
async function loadAlertsFromFirestore() {
  try {
    const alertsRef = fbCollection(fbFirestore(), 'alerts');
    const q = fbQuery(alertsRef, fbOrderBy('ts', 'desc'));
    const querySnapshot = await fbGetDocs(q);
    
    const firestoreAlerts = [];
    querySnapshot.docs.forEach((doc) => {
      firestoreAlerts.push(firestoreDataToAlert(doc.data(), doc.id));
    });
    
    // Merge with localStorage alerts (Firestore is source of truth)
    const localAlerts = loadAlerts();
    
    // Create a map of Firestore alert IDs for deduplication
    const firestoreIds = new Set(firestoreAlerts.map(a => a.id));
    
    // Add localStorage alerts that are not in Firestore
    const uniqueLocalAlerts = localAlerts.filter(a => !firestoreIds.has(a.id));
    
    // Combine and prune
    const mergedAlerts = [...firestoreAlerts, ...uniqueLocalAlerts];
    const prunedAlerts = pruneAlerts(mergedAlerts);
    
    // Save merged alerts back to localStorage
    saveAlerts(prunedAlerts);
    
    return prunedAlerts;
  } catch (err) {
    console.error('[loadAlertsFromFirestore] Failed to load alerts from Firestore:', err);
    // Fall back to localStorage on error
    return loadAlerts();
  }
}

function firestoreDataToAlert(data, docId) {
  let ts = Number(data.ts) || 0;
  if (ts > 0 && ts < 1e12) ts *= 1000;
  const badge = typeof data.badge === 'string' ? data.badge : '';
  const severity =
    typeof data.severity === 'string'
      ? data.severity
      : (badge === 'danger' ? 'critical' : badge === 'warn' ? 'warning' : 'info');
  return {
    id: data.id || docId,
    ts,
    key: typeof data.key === 'string' ? data.key : '',
    val: typeof data.val === 'number' && Number.isFinite(data.val) ? data.val : Number(data.val),
    severity,
    badge,
    label: typeof data.label === 'string' ? data.label : '',
    description: typeof data.description === 'string' ? data.description : '',
    pond: typeof data.pond === 'string' ? data.pond : '',
    resolved: typeof data.resolved === 'boolean' ? data.resolved : false,
  };
}

let _alertsRealtimeUnsub = null;

function unsubscribeAlertsRealtime() {
  if (_alertsRealtimeUnsub) {
    try {
      _alertsRealtimeUnsub();
    } catch { /* ignore */ }
    _alertsRealtimeUnsub = null;
  }
}

/**
 * Merge remote alert writes into localStorage so other logged-in sessions see updates.
 */
function subscribeAlertsRealtime() {
  unsubscribeAlertsRealtime();
  try {
    const alertsRef = fbCollection(fbFirestore(), 'alerts');
    const q = fbQuery(alertsRef, fbOrderBy('ts', 'desc'), fbLimit(250));
    _alertsRealtimeUnsub = fbOnSnapshot(
      q,
      (snapshot) => {
        const byId = new Map();
        for (const a of loadAlerts()) {
          byId.set(a.id, a);
        }
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'removed') return;
          const normalized = firestoreDataToAlert(change.doc.data(), change.doc.id);
          if (!normalized.id || !Number.isFinite(normalized.ts)) return;
          byId.set(normalized.id, normalized);
        });
        const merged = pruneAlerts([...byId.values()].sort((a, b) => b.ts - a.ts));
        saveAlerts(merged);
        rerenderAlertsTab();
        window.dispatchEvent(new Event('alerts-updated'));
      },
      (err) => {
        console.error('[subscribeAlertsRealtime]', err);
      }
    );
  } catch (err) {
    console.error('[subscribeAlertsRealtime] setup failed:', err);
  }
}

/**
 * Delete up to maxDocs most recent alert documents (matches listener window).
 * @param {number} maxDocs
 */
async function deleteRecentAlertDocumentsFromFirestore(maxDocs) {
  const db = fbFirestore();
  const alertsRef = fbCollection(db, 'alerts');
  const q = fbQuery(alertsRef, fbOrderBy('ts', 'desc'), fbLimit(maxDocs));
  const snap = await fbGetDocs(q);
  const refs = snap.docs.map((d) => d.ref);
  const CHUNK = 450;
  for (let i = 0; i < refs.length; i += CHUNK) {
    const batch = fbWriteBatch(db);
    for (const ref of refs.slice(i, i + CHUNK)) {
      batch.delete(ref);
    }
    await batch.commit();
  }
}

/**
 * Update an alert's resolved status in Firestore.
 * Non-blocking - errors are logged but do not prevent localStorage updates.
 * @param {string} alertId - The alert ID to update
 * @returns {Promise<void>}
 */
async function updateAlertResolvedInFirestore(alertId) {
  try {
    // Query Firestore to find the document with matching alert ID
    const alertsRef = fbCollection(fbFirestore(), 'alerts');
    const q = fbQuery(alertsRef, fbWhere('id', '==', alertId));
    const querySnapshot = await fbGetDocs(q);
    
    if (querySnapshot.empty) {
      console.warn(`[updateAlertResolvedInFirestore] Alert ${alertId} not found in Firestore`);
      return;
    }
    
    // Update the first matching document (should only be one)
    const docRef = fbDoc(fbFirestore(), 'alerts', querySnapshot.docs[0].id);
    await fbUpdateDoc(docRef, { resolved: true });
  } catch (err) {
    // Non-blocking - localStorage still works
    console.error('[updateAlertResolvedInFirestore] Failed to update alert in Firestore:', err);
  }
}

// ─── Alert Evaluation ─────────────────────────────────────────────────────────

const SENSOR_LABELS = { ph: 'pH', do: 'Dissolved O₂', turb: 'Turbidity', temp: 'Temperature' };
const SENSOR_UNITS  = { ph: '',   do: ' mg/L',         turb: ' NTU',      temp: '°C' };

/**
 * Severity map: badge class → alert severity level
 * Only store readings that are genuinely at risk:
 *   danger  → critical
 *   warn    → warning
 *   ok      → null (no alert stored)
 */
function severityFromBadge(badgeClass) {
  if (badgeClass === 'danger') return 'critical';
  if (badgeClass === 'warn')   return 'warning';
  return null; // ok — not at risk, no alert
}

/**
 * Evaluate a single sensor reading and return an alert object if it breaches
 * a threshold, or null if the value is optimal.
 */
function evaluateSensor(key, val, pondName) {
  const badge = getBadgeForSpecies(key, val);
  const severity = severityFromBadge(badge.c);
  if (!severity) return null;

  const unit  = SENSOR_UNITS[key] || '';
  const label = SENSOR_LABELS[key] || key.toUpperCase();
  const species = getActiveSpecies();
  const t = getActiveThresholds();

  let description = '';
  if (key === 'ph') {
    const pb = t?.ph;
    if (pb) description = `pH ${val.toFixed(2)} is outside the optimal range (${pb.optimalMin}–${pb.optimalMax}).`;
    else    description = `pH ${val.toFixed(2)} is outside the optimal range.`;
  } else if (key === 'do') {
    const db = t?.do;
    if (db) description = `Dissolved O₂ ${val.toFixed(1)} mg/L is below optimal (≥${db.optimalMin} mg/L).`;
    else    description = `Dissolved O₂ ${val.toFixed(1)} mg/L is below optimal.`;
  } else if (key === 'turb') {
    const tb = t?.turb;
    if (tb) description = `Turbidity ${val.toFixed(1)} NTU exceeds optimal (≤${tb.optimalMax} NTU).`;
    else    description = `Turbidity ${val.toFixed(1)} NTU exceeds optimal.`;
  } else if (key === 'temp') {
    const tb = t?.temp;
    if (tb) description = `Temperature ${val.toFixed(1)}°C is outside optimal range (${tb.optimalMin}–${tb.optimalMax}°C).`;
    else    description = `Temperature ${val.toFixed(1)}°C is outside optimal range.`;
  }

  if (species) description += ` (${species.charAt(0).toUpperCase() + species.slice(1)} config)`;

  return {
    id:       `${key}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts:       Date.now(),
    key,
    val,
    severity,   // 'critical' | 'warning' | 'info'
    badge:      badge.c,
    label:      `${badge.c === 'danger' ? 'Critical' : badge.c === 'warn' ? 'Warning' : 'Notice'}: ${label} in ${pondName}`,
    description,
    pond:       pondName,
    resolved:   false,
    thresholdSummary: thresholdSummaryForKey(key),
  };
}

// ─── Deduplication — suppress repeat alerts within a cooldown window ──────────
// Keyed by `${pondId}:${sensorKey}:${severity}` so switching ponds never inherits stale cooldowns,
// and warning vs critical are independent (escalation still notifies).

const COOLDOWN_MS = 15 * 60 * 1000; // match server dispatch-alert.js
const _lastAlertTs = {};

function cooldownKey(key, severity) {
  const pondId = getActivePondId() || 'default';
  return `${pondId}:${key}:${severity}`;
}

function shouldSuppress(key, severity) {
  const last = _lastAlertTs[cooldownKey(key, severity)] || 0;
  return Date.now() - last < COOLDOWN_MS;
}

function markAlerted(key, severity) {
  _lastAlertTs[cooldownKey(key, severity)] = Date.now();
}

/** Clear cooldowns for all keys on the current pond so the first reading after a switch is always evaluated. */
function resetCooldownsForPond(pondId) {
  const prefix = `${pondId || 'default'}:`;
  for (const k of Object.keys(_lastAlertTs)) {
    if (k.startsWith(prefix)) delete _lastAlertTs[k];
  }
}

// ─── Main init ────────────────────────────────────────────────────────────────

export function init() {
  // Load alerts from Firestore on page load
  loadAlertsFromFirestore().then(() => {
    renderAlertList();
    window.dispatchEvent(new Event('alerts-updated'));
    subscribeAlertsRealtime();
  }).catch(err => {
    console.error('[init] Failed to load alerts from Firestore:', err);
    // Fall back to localStorage rendering
    renderAlertList();
  });

  // ── Notification preference toggles ────────────────────────────────────────
  const email = document.getElementById('alert-email');
  const sms   = document.getElementById('alert-sms');
  const push  = document.getElementById('alert-push');
  const SETTINGS_KEY = 'aquasense.settings.v1';

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; }
  }
  function saveSettings(next) {
    const merged = { ...loadSettings(), ...next };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged)); } catch { /* ignore */ }
  }

  if (email || sms || push) {
    const s = loadSettings();
    if (email && typeof s.email === 'boolean') email.checked = s.email;
    if (sms   && typeof s.sms   === 'boolean') sms.checked   = s.sms;
    if (push  && typeof s.push  === 'boolean') push.checked  = s.push;
    email?.addEventListener('change', () => saveSettings({ email: !!email.checked }));
    sms?.addEventListener('change',   () => saveSettings({ sms:   !!sms.checked }));
    push?.addEventListener('change',  () => saveSettings({ push:  !!push.checked }));
  }

  // ── Alert action buttons ───────────────────────────────────────────────────
  const clearAllBtn = document.getElementById('btn-clear-all-alerts');
  const markAllResolvedBtn = document.getElementById('btn-mark-all-resolved');

  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', () => {
      const allAlerts = loadAlerts();
      const totalCount = allAlerts.length;
      if (totalCount === 0) {
        showToast('No alerts to clear', 'info');
        return;
      }
      if (confirm(`Are you sure you want to clear all ${totalCount} alerts? This action cannot be undone.`)) {
        void clearAllAlerts();
      }
    });
  }

  if (markAllResolvedBtn) {
    markAllResolvedBtn.addEventListener('click', () => {
      const allAlerts = loadAlerts();
      const unresolvedCount = allAlerts.filter(a => !a.resolved).length;
      if (unresolvedCount === 0) {
        showToast('No unresolved alerts to mark', 'info');
        return;
      }
      if (confirm(`Mark all ${unresolvedCount} active alerts as resolved?`)) {
        markAllAlertsAsResolved();
      }
    });
  }

  // ── Threshold display — driven by active pond config ───────────────────────
  function renderThresholds() {
    const t = getActiveThresholds();
    const species = getActiveSpecies();

    const phEl   = document.getElementById('alert-th-ph');
    const tempEl = document.getElementById('alert-th-temp');
    const doEl   = document.getElementById('alert-th-do');
    const turbEl = document.getElementById('alert-th-turb');
    const specEl = document.getElementById('alert-th-species');

    if (t) {
      if (phEl)   phEl.textContent   = `Optimal: ${t.ph?.optimalMin ?? '—'} – ${t.ph?.optimalMax ?? '—'}`;
      if (tempEl) tempEl.textContent = `Optimal: ${t.temp?.optimalMin ?? '—'} – ${t.temp?.optimalMax ?? '—'} °C`;
      if (doEl)   doEl.textContent   = `Optimal: ≥ ${t.do?.optimalMin ?? '—'} mg/L`;
      if (turbEl) turbEl.textContent = `Optimal: ≤ ${t.turb?.optimalMax ?? '—'} NTU`;
    } else {
      if (phEl)   phEl.textContent   = 'Not configured';
      if (tempEl) tempEl.textContent = 'Not configured';
      if (doEl)   doEl.textContent   = 'Not configured';
      if (turbEl) turbEl.textContent = 'Not configured';
    }

    if (specEl) {
      const names = { crayfish: 'Crayfish', tilapia: 'Tilapia', catfish: 'Catfish', shrimp: 'Shrimp' };
      specEl.textContent = species ? `Active config: ${names[species] || species}` : 'No active config';
    }
  }

  renderThresholds();
  window.addEventListener('thresholds-changed',   renderThresholds);
  window.addEventListener('pond-config-changed',  renderThresholds);

  // ── Pond filter state ──────────────────────────────────────────────────────
  let _activePondFilter = 'all'; // 'all' or a pond name string

  // ── Alert list rendering ───────────────────────────────────────────────────
  function timeAgo(ts) {
    const diff = Date.now() - ts;
    if (diff < 60_000)        return 'just now';
    if (diff < 3_600_000)     return `${Math.floor(diff / 60_000)} min ago`;
    if (diff < 86_400_000)    return `${Math.floor(diff / 3_600_000)} hr ago`;
    return `${Math.floor(diff / 86_400_000)} day${Math.floor(diff / 86_400_000) > 1 ? 's' : ''} ago`;
  }

  function severityIcon(severity) {
    if (severity === 'critical') return '#icon-x';
    if (severity === 'warning')  return '#icon-warning';
    return '#icon-info';
  }

  function severityIconClass(severity) {
    if (severity === 'critical') return 'alert-icon--critical';
    if (severity === 'warning')  return 'alert-icon--warning';
    return 'alert-icon--info';
  }

  function renderPondFilters(alerts) {
    const toolbar = document.getElementById('alert-pond-filters');
    if (!toolbar) return;

    // Collect unique pond names from unresolved alerts only
    const ponds = [...new Set(alerts.filter(a => !a.resolved).map(a => a.pond))].sort();

    // Rebuild buttons — keep current selection if still valid
    toolbar.innerHTML = alertPondFilterButton('all', 'All Ponds', _activePondFilter === 'all');
    for (const pond of ponds) {
      toolbar.innerHTML += alertPondFilterButton(pond, pond, _activePondFilter === pond);
    }

    // If the previously selected pond no longer has alerts, reset to 'all'
    if (_activePondFilter !== 'all' && !ponds.includes(_activePondFilter)) {
      _activePondFilter = 'all';
      toolbar.querySelector('[data-pond="all"]')?.classList.add('active');
    }

    toolbar.querySelectorAll('.alert-pond-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _activePondFilter = btn.dataset.pond;
        toolbar.querySelectorAll('.alert-pond-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderAlertList();
      });
    });
  }

  function renderAlertList() {
    const container = document.getElementById('alert-list-dynamic');
    if (!container) return;

    const allAlerts = pruneAlerts(loadAlerts());
    saveAlerts(allAlerts);

    // Summary counters — always across all ponds
    const critCount     = allAlerts.filter(a => !a.resolved && a.severity === 'critical').length;
    const warnCount     = allAlerts.filter(a => !a.resolved && a.severity === 'warning').length;
    const resolvedCount = allAlerts.filter(a => a.resolved).length;

    const elCrit     = document.getElementById('alert-critical');
    const elWarn     = document.getElementById('alert-warnings');
    const elInfo     = document.getElementById('alert-info');
    const elResolved = document.getElementById('alert-resolved');
    if (elCrit)     elCrit.textContent     = critCount;
    if (elWarn)     elWarn.textContent     = warnCount;
    if (elInfo)     elInfo.textContent     = 0;
    if (elResolved) elResolved.textContent = resolvedCount;

    // Rebuild pond filter buttons from current unresolved alerts
    renderPondFilters(allAlerts);

    // Only show unresolved alerts, filtered by selected pond
    const visible = allAlerts
      .filter(a => !a.resolved)
      .filter(a => _activePondFilter === 'all' || a.pond === _activePondFilter)
      .sort((a, b) => b.ts - a.ts); // most recent first

    if (!visible.length) {
      const msg = _activePondFilter === 'all'
        ? 'No active alerts — all parameters within optimal range.'
        : `No active alerts for ${_activePondFilter}.`;
      container.innerHTML = alertEmptyListRow(msg);
      return;
    }

    container.innerHTML = visible.map(alert => `
      <div class="alert-row" data-alert-id="${alert.id}">
        <div class="alert-icon ${severityIconClass(alert.severity)}">
          <svg class="icon icon-20"><use href="${severityIcon(alert.severity)}"/></svg>
        </div>
        <div class="alert-body">
          <div class="alert-title">${escapeHtml(alert.label)}</div>
          <div class="alert-desc">${escapeHtml(alert.description)}</div>
          <div class="alert-meta">
            <span>${timeAgo(alert.ts)}</span>
            <span class="badge-pill badge-pill--muted">${escapeHtml(alert.pond)}</span>
            <button type="button" class="btn btn-outline btn-sm btn-resolve" data-id="${alert.id}">Mark Resolved</button>
          </div>
        </div>
      </div>`).join('');

    // Resolve button handlers — mark resolved and immediately remove from view
    container.querySelectorAll('.btn-resolve').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const all = loadAlerts();
        const idx = all.findIndex(a => a.id === id);
        if (idx !== -1) {
          // Update localStorage
          all[idx].resolved = true;
          saveAlerts(all);
          
          // Update Firestore (non-blocking)
          updateAlertResolvedInFirestore(id).catch(err => {
            console.error('[btn-resolve] Failed to update Firestore:', err);
          });
        }
        renderAlertList();
        window.dispatchEvent(new Event('alerts-updated'));
      });
    });
  }

  rerenderAlertsTab = renderAlertList;

  renderAlertList();

  // Purge any stale alerts stored before a real pond was selected (pond name was 'Pond')
  (function purgeFallbackAlerts() {
    const all = loadAlerts();
    const cleaned = all.filter(a => a.pond && a.pond !== 'Pond');
    if (cleaned.length !== all.length) { saveAlerts(cleaned); renderAlertList(); }
  })();

  // ── React to new sensor readings ───────────────────────────────────────────
  window.addEventListener('sensor-data-updated', (e) => {
    // Determine pond name for dual setup support:
    // Try new setup first (configuration-based): getActiveSpecies() || 'Unknown'
    // Fall back to legacy setup (pond management): getActivePond()?.name
    // Legacy setup takes precedence when both are present
    let pondName = getActiveSpecies() || 'Unknown';
    
    const activePond = getActivePond();
    if (activePond?.name) {
      pondName = activePond.name;
    }
    
    // Skip if no valid pond identifier
    if (!pondName || pondName === 'Unknown') {
      return;
    }

    const { ph, doV, turb, temp } = e.detail || {};
    const readings = { ph, do: doV, turb, temp };
    const newAlerts = [];

    for (const [key, val] of Object.entries(readings)) {
      if (val == null || !Number.isFinite(val)) continue;
      const alert = evaluateSensor(key, val, pondName);
      if (!alert) continue;
      if (shouldSuppress(key, alert.severity)) continue;
      markAlerted(key, alert.severity);
      newAlerts.push(alert);
    }

    if (newAlerts.length) {
      const all = pruneAlerts(loadAlerts());
      all.push(...newAlerts);
      saveAlerts(all);
      renderAlertList();
      window.dispatchEvent(new Event('alerts-updated'));

      (async () => {
        for (const alert of newAlerts) {
          await persistAlertToFirestore(alert);
          try {
            await handleAlert(alert);
          } catch {
            /* notification errors are non-fatal */
          }
        }
      })().catch(() => {/* ignore */});
    }
  });

  // Re-render when pond/config changes (thresholds may reclassify existing state)
  window.addEventListener('pond-config-changed', (e) => {
    const pondId = e.detail?.pondId || getActivePondId() || 'default';
    resetCooldownsForPond(pondId);
    renderAlertList();
  });
  window.addEventListener('active-pond-changed', renderAlertList);
}

// ─── Alert Management Functions ───────────────────────────────────────────────

/**
 * Clear all alerts from localStorage and remove recent copies from Firestore so they do not reappear.
 */
async function clearAllAlerts() {
  const totalCount = loadAlerts().length;
  try {
    unsubscribeAlertsRealtime();
    if (fbAuth().currentUser) {
      try {
        await deleteRecentAlertDocumentsFromFirestore(500);
      } catch (err) {
        console.error('[clearAllAlerts] Firestore delete failed:', err);
      }
    }
    localStorage.removeItem(ALERT_STORAGE_KEY);
    rerenderAlertsTab();
    window.dispatchEvent(new Event('alerts-updated'));
    subscribeAlertsRealtime();
    showToast(totalCount ? `Successfully cleared ${totalCount} alerts` : 'Alerts cleared', 'success');
  } catch (err) {
    console.error('[clearAllAlerts] Error:', err);
    showToast('Failed to clear alerts', 'error');
    try {
      subscribeAlertsRealtime();
    } catch { /* ignore */ }
  }
}

/**
 * Mark all unresolved alerts as resolved
 */
async function markAllAlertsAsResolved() {
  try {
    const allAlerts = loadAlerts();
    const unresolvedAlerts = allAlerts.filter(alert => !alert.resolved);
    
    if (unresolvedAlerts.length === 0) {
      showToast('No unresolved alerts to mark', 'info');
      return;
    }

    // Update localStorage
    for (const a of allAlerts) a.resolved = true;
    saveAlerts(allAlerts);
    
    // Update Firestore for all unresolved alerts (non-blocking)
    const firestoreUpdates = unresolvedAlerts.map(alert => 
      updateAlertResolvedInFirestore(alert.id).catch(err => {
        console.error(`[markAllAlertsAsResolved] Failed to update alert ${alert.id}:`, err);
      })
    );
    
    // Wait for all Firestore updates to complete (but don't block UI)
    Promise.all(firestoreUpdates).catch(err => {
      console.error('[markAllAlertsAsResolved] Some Firestore updates failed:', err);
    });
    
    rerenderAlertsTab();
    window.dispatchEvent(new Event('alerts-updated'));
    showToast(`Successfully marked ${unresolvedAlerts.length} alerts as resolved`, 'success');
  } catch (err) {
    console.error('[markAllAlertsAsResolved] Error:', err);
    showToast('Failed to mark alerts as resolved', 'error');
  }
}

/**
 * Show a toast notification
 */
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `alert-toast alert-toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = [
    'position:fixed',
    'bottom:24px',
    'right:24px',
    'z-index:9999',
    'padding:12px 20px',
    'border-radius:8px',
    'font-size:0.875rem',
    'max-width:360px',
    'box-shadow:0 4px 12px rgba(0,0,0,0.15)',
    'color:#fff',
    `background:${type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : '#3b82f6'}`,
    'transition:opacity 0.3s ease',
  ].join(';');

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
