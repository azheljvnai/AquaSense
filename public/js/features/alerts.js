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

// ─── Alert History Storage ────────────────────────────────────────────────────

const ALERT_STORAGE_KEY = 'aquasense.alerts.v1';
const MAX_ALERTS = 200;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function loadAlerts() {
  try {
    return JSON.parse(localStorage.getItem(ALERT_STORAGE_KEY) || '[]');
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
  };
}

// ─── Deduplication — suppress repeat alerts within a cooldown window ──────────
// Keyed by `${pondId}:${sensorKey}` so switching ponds never inherits stale cooldowns.

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes per sensor key per pond
const _lastAlertTs = {};

function cooldownKey(key) {
  const pondId = getActivePondId() || 'default';
  return `${pondId}:${key}`;
}

function shouldSuppress(key) {
  const last = _lastAlertTs[cooldownKey(key)] || 0;
  return Date.now() - last < COOLDOWN_MS;
}

function markAlerted(key) {
  _lastAlertTs[cooldownKey(key)] = Date.now();
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
        clearAllAlerts();
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
      if (phEl)   phEl.textContent   = 'Optimal: 6.5 – 8.5';
      if (tempEl) tempEl.textContent = 'Optimal: 20 – 26 °C';
      if (doEl)   doEl.textContent   = 'Optimal: ≥ 6 mg/L';
      if (turbEl) turbEl.textContent = 'Optimal: ≤ 20 NTU';
    }

    if (specEl) {
      const names = { crayfish: 'Crayfish', tilapia: 'Tilapia', catfish: 'Catfish', shrimp: 'Shrimp' };
      specEl.textContent = species ? `Active config: ${names[species] || species}` : 'Default thresholds';
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

  function severityColor(severity) {
    if (severity === 'critical') return '#ef4444';
    if (severity === 'warning')  return '#eab308';
    return '#3b82f6';
  }

  function renderPondFilters(alerts) {
    const toolbar = document.getElementById('alert-pond-filters');
    if (!toolbar) return;

    // Collect unique pond names from unresolved alerts only
    const ponds = [...new Set(alerts.filter(a => !a.resolved).map(a => a.pond))].sort();

    // Rebuild buttons — keep current selection if still valid
    toolbar.innerHTML = `<button class="alert-pond-btn${_activePondFilter === 'all' ? ' active' : ''}" data-pond="all">All Ponds</button>`;
    for (const pond of ponds) {
      const active = _activePondFilter === pond ? ' active' : '';
      toolbar.innerHTML += `<button class="alert-pond-btn${active}" data-pond="${pond}">${pond}</button>`;
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
      container.innerHTML = `
        <div class="alert-row" style="justify-content:center;padding:32px 0;color:var(--text-muted);font-size:0.9rem;">
          <svg class="icon icon-20" style="margin-right:8px;opacity:0.4"><use href="#icon-check"/></svg>
          ${msg}
        </div>`;
      return;
    }

    container.innerHTML = visible.map(alert => `
      <div class="alert-row" data-alert-id="${alert.id}">
        <div class="alert-icon" style="background:${severityColor(alert.severity)};color:white">
          <svg class="icon icon-20"><use href="${severityIcon(alert.severity)}"/></svg>
        </div>
        <div class="alert-body">
          <div class="alert-title">${alert.label}</div>
          <div class="alert-desc">${alert.description}</div>
          <div class="alert-meta">
            <span>${timeAgo(alert.ts)}</span>
            <span class="badge-pill" style="background:#f1f5f9;">${alert.pond}</span>
            <button class="btn btn-outline btn-resolve" style="padding:6px 12px;font-size:0.8rem;" data-id="${alert.id}">Mark Resolved</button>
          </div>
        </div>
      </div>`).join('');

    // Resolve button handlers — mark resolved and immediately remove from view
    container.querySelectorAll('.btn-resolve').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const all = loadAlerts();
        const idx = all.findIndex(a => a.id === id);
        if (idx !== -1) { all[idx].resolved = true; saveAlerts(all); }
        renderAlertList();
        window.dispatchEvent(new Event('alerts-updated'));
      });
    });
  }

  renderAlertList();

  // Purge any stale alerts stored before a real pond was selected (pond name was 'Pond')
  (function purgeFallbackAlerts() {
    const all = loadAlerts();
    const cleaned = all.filter(a => a.pond && a.pond !== 'Pond');
    if (cleaned.length !== all.length) { saveAlerts(cleaned); renderAlertList(); }
  })();

  // ── React to new sensor readings ───────────────────────────────────────────
  window.addEventListener('sensor-data-updated', (e) => {
    const activePond = getActivePond();
    if (!activePond?.name) return; // no real pond selected yet — skip

    const { ph, doV, turb, temp } = e.detail || {};
    const pondName = activePond.name;
    const readings = { ph, do: doV, turb, temp };
    const newAlerts = [];

    for (const [key, val] of Object.entries(readings)) {
      if (val == null || !Number.isFinite(val)) continue;
      if (shouldSuppress(key)) continue;
      const alert = evaluateSensor(key, val, pondName);
      if (alert) {
        markAlerted(key);
        newAlerts.push(alert);
        handleAlert(alert).catch(() => {/* notification errors are non-fatal */});
      }
    }

    if (newAlerts.length) {
      const all = pruneAlerts(loadAlerts());
      all.push(...newAlerts);
      saveAlerts(all);
      renderAlertList();
      window.dispatchEvent(new Event('alerts-updated'));
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
 * Clear all alerts from localStorage
 */
function clearAllAlerts() {
  try {
    const allAlerts = loadAlerts();
    const totalCount = allAlerts.length;
    
    if (totalCount === 0) {
      showToast('No alerts to clear', 'info');
      return;
    }
    
    localStorage.removeItem(ALERT_STORAGE_KEY);
    renderAlertList();
    window.dispatchEvent(new Event('alerts-updated'));
    showToast(`Successfully cleared ${totalCount} alerts`, 'success');
  } catch (err) {
    console.error('[clearAllAlerts] Error:', err);
    showToast('Failed to clear alerts', 'error');
  }
}

/**
 * Mark all unresolved alerts as resolved
 */
function markAllAlertsAsResolved() {
  try {
    const allAlerts = loadAlerts();
    const unresolvedAlerts = allAlerts.filter(alert => !alert.resolved);
    
    if (unresolvedAlerts.length === 0) {
      showToast('No unresolved alerts to mark', 'info');
      return;
    }
    
    const updatedAlerts = allAlerts.map(alert => ({
      ...alert,
      resolved: true
    }));
    
    saveAlerts(updatedAlerts);
    renderAlertList();
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
