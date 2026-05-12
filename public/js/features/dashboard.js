/**
 * Dashboard feature: main chart + dynamic recent alerts + active configuration display.
 */
import { initDashboardChart } from '../charts.js';
import { getActiveConfigId, getActiveSpecies, loadActiveConfiguration, onConfigChange } from '../pond-config.js';

const ALERT_STORAGE_KEY = 'aquasense.alerts.v1';
const RECENT_ALERTS_LIMIT = 5;

function normalizeAlerts(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    let ts = Number(item.ts);
    if (!Number.isFinite(ts)) continue;
    if (ts > 0 && ts < 1e12) ts *= 1000;

    const badge = typeof item.badge === 'string' ? item.badge : '';
    const severity =
      typeof item.severity === 'string'
        ? item.severity
        : (badge === 'danger' ? 'critical' : badge === 'warn' ? 'warning' : 'info');

    out.push({
      id: typeof item.id === 'string' ? item.id : '',
      ts,
      severity,
      badge,
      label: typeof item.label === 'string' ? item.label : '',
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

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000)     return 'just now';
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`;
  return `${Math.floor(diff / 86_400_000)} day${Math.floor(diff / 86_400_000) > 1 ? 's' : ''} ago`;
}

function severityCssClass(severity) {
  if (severity === 'critical') return 'critical';
  if (severity === 'warning')  return 'warning';
  return 'info';
}

export function renderRecentAlerts() {
  const container = document.getElementById('recent-alerts');
  if (!container) return;

  const alerts = loadAlerts()
    .filter(a => !a.resolved)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, RECENT_ALERTS_LIMIT);

  if (!alerts.length) {
    container.innerHTML = '<div class="alert-item neutral muted">No active alerts — all parameters within optimal range.</div>';
    return;
  }

  container.innerHTML = alerts.map(alert => `
    <div class="alert-item ${severityCssClass(alert.severity)}">
      ${alert.label}
      <div class="alert-time">${timeAgo(alert.ts)} · ${alert.pond}</div>
    </div>`).join('');
}

// ─── Active Configuration Display ─────────────────────────────────────────────
// Removed - configuration badge no longer displayed on dashboard

// function renderConfigurationBadge() {
//   const badgeEl = document.getElementById('dash-config-badge');
//   const notConfiguredEl = document.getElementById('dash-not-configured');
//   
//   if (!badgeEl || !notConfiguredEl) return;
//   
//   const configId = getActiveConfigId();
//   const species = getActiveSpecies();
//   
//   if (configId && species) {
//     // Show configuration badge
//     badgeEl.style.display = 'flex';
//     notConfiguredEl.style.display = 'none';
//     
//     const speciesNames = {
//       crayfish: 'Crayfish',
//       tilapia: 'Tilapia',
//       catfish: 'Catfish',
//       shrimp: 'Shrimp',
//     };
//     
//     badgeEl.innerHTML = `
//       <span class="config-label">Active Configuration:</span>
//       <span class="species-badge species-${species}">${speciesNames[species] || species}</span>
//     `;
//   } else {
//     // Show "Not Configured" notice
//     badgeEl.style.display = 'none';
//     notConfiguredEl.style.display = 'flex';
//   }
// }

function navigateToConfiguration() {
  const configLink = document.querySelector('[data-page="configuration"]');
  if (configLink) configLink.click();
}

export async function init() {
  const chartEl = document.getElementById('chart');
  if (chartEl) initDashboardChart(chartEl);

  // Load active configuration
  await loadActiveConfiguration();
  
  // Render recent alerts
  renderRecentAlerts();

  // Keep in sync whenever new alerts are generated
  window.addEventListener('alerts-updated', renderRecentAlerts);

  // Expose navigation function for "Configure Now" button
  window.navigateToConfiguration = navigateToConfiguration;
}
