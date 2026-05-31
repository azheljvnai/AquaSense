/**
 * Reports feature.
 * Supports Water Quality, Feeding, and Combined (Water + Feeding) reports
 * for daily / weekly / monthly / custom periods.
 * Every generated report is saved to a localStorage-backed history list.
 */
import { getHistoryRange, mergeRtdbEntries } from '../utils.js';
import {
  getActiveConfigId,
  getActiveSpecies,
  getActiveThresholds,
  SPECIES_PRESETS,
} from '../pond-config.js';
import { showAppToast, showConfirmModal } from '../ui/modal-ui.js';
import {
  FEED_DISPENSE_MG_RANGE_LABEL,
  formatFeedAmountDisplay,
  formatFeedAmountTotalDisplay,
} from '../feed-dispense.js';
import { buildFeedingCsvRows } from './report-feeding-rows.js';
import { getReportDateRange } from '../report-date-range.js';
import { log } from '../utils.js';
import { rowsToStyledExcelBlob, buildPrintableHtml } from './report-format.js';
import {
  closeReportPrintTarget,
  openReportPrintTargetSync,
  writeReportPrintTarget,
  shouldAutoPrint,
} from './report-print.js';

function getReportConfig() {
  const species = getActiveSpecies();
  const thresholds = getActiveThresholds();
  const preset = species && SPECIES_PRESETS[species]
    ? SPECIES_PRESETS[species]
    : SPECIES_PRESETS.crayfish;
  if (species && thresholds) {
    return { species, name: preset.name, thresholds };
  }
  return {
    species: 'crayfish',
    name: 'Crayfish (default)',
    thresholds: SPECIES_PRESETS.crayfish.thresholds,
  };
}

function getReportConfigLabel() {
  if (!getActiveConfigId()) return 'Not Configured';
  const cfg = getReportConfig();
  if (cfg.name) return cfg.name;
  if (cfg.species) {
    return cfg.species.charAt(0).toUpperCase() + cfg.species.slice(1);
  }
  return 'Active configuration';
}

// ─── Report History store ────────────────────────────────────────────────────
const HISTORY_KEY = 'aquasense.reportHistory.v1';
const MAX_HISTORY = 50;

function loadReportHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
}
function saveReportHistory(list) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY))); } catch {}
}
function addToHistory(entry) {
  const list = loadReportHistory();
  list.unshift(entry);
  saveReportHistory(list);
}

// ─── Init ────────────────────────────────────────────────────────────────────
export function init() {

  // Tab switching
  document.querySelectorAll('.tab-btn[data-report-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-report-tab');
      const container = btn.closest('.report-tabs');
      if (!container) return;
      container.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      container.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + tab)?.classList.add('active');
    });
  });

  // ── helpers ────────────────────────────────────────────────────────────────
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
  function fmtTime(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
  function fmtDateTime(d) { return `${fmtDate(d)} ${fmtTime(d)}`; }
  function getNowStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  function getDateRange(period, customFrom, customTo) {
    return getReportDateRange(period, customFrom, customTo);
  }

  function getLiveSnapshot() {
    const read = (id) => (document.getElementById(id)?.textContent || '').trim();
    return {
      ph: read('v-ph'), do: read('v-do'), turb: read('v-turb'), temp: read('v-temp'),
      status: (document.getElementById('fb-lbl')?.textContent || '').trim(),
    };
  }

  function stats(readings, key) {
    const nums = readings.map(r => r[key]).filter(v => typeof v === 'number' && Number.isFinite(v));
    if (!nums.length) return null;
    const avg = nums.reduce((a,b) => a+b, 0) / nums.length;
    return { avg: avg.toFixed(2), min: Math.min(...nums).toFixed(2), max: Math.max(...nums).toFixed(2), count: nums.length };
  }

  function downloadBlob(filename, blob) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }

  function rowsToCsvString(rows) {
    return rows
      .map(r => r.map(c => `"${String(c ?? '').replaceAll('"', '""')}"`).join(','))
      .join('\n');
  }

  function downloadReportFile(filename, rows, format) {
    if (format === 'xlsx') {
      downloadBlob(filename.replace(/\.xlsx$/i, '.xls'), rowsToStyledExcelBlob(rows));
      return;
    }
    downloadBlob(filename, new Blob(['\uFEFF' + rowsToCsvString(rows)], { type: 'text/csv;charset=utf-8' }));
  }

  /**
   * Evaluate a sensor value against the active configuration thresholds.
   */
  function evalStatus(key, val, thresholds) {
    const t = thresholds;
    if (!t || val === '' || val == null || isNaN(Number(val))) return '—';
    const v = Number(val);

    if (key === 'turb') {
      const tb = t.turb;
      if (v <= tb.optimalMax)    return 'Normal';
      if (v <= tb.acceptableMax) return 'Warning';
      return 'Critical';
    }
    if (key === 'do') {
      const db = t.do;
      if (v >= db.optimalMin)                                return 'Normal';
      if (db.acceptableMin && v >= db.acceptableMin)         return 'Warning';
      return 'Critical';
    }
    if (key === 'temp') {
      const tb = t.temp;
      if (v >= tb.optimalMin && v <= tb.optimalMax) return 'Normal';
      return 'Critical';
    }
    if (key === 'ph') {
      const pb = t.ph;
      if (v >= pb.optimalMin && v <= pb.optimalMax) return 'Normal';
      return 'Critical';
    }
    return '—';
  }

  // ── CSV builders ───────────────────────────────────────────────────────────

  function wqCsvRows(readings, snap, pondCfg) {
    const rows = [
      ['--- WATER QUALITY ---'],
      ['metric','current','status','avg','min','max','samples'],
    ];
    const metrics = [
      { key:'ph',   label:'pH' },
      { key:'do',   label:'Dissolved Oxygen (mg/L)' },
      { key:'turb', label:'Turbidity (NTU)' },
      { key:'temp', label:'Temperature (°C)' },
    ];
    const cur = { ph: snap.ph, do: snap.do, turb: snap.turb, temp: snap.temp };
    for (const m of metrics) {
      const s = stats(readings, m.key);
      const status = evalStatus(m.key, cur[m.key], pondCfg?.thresholds);
      rows.push([m.label, cur[m.key], status, s?.avg??'—', s?.min??'—', s?.max??'—', s?.count??0]);
    }
    rows.push([]);
    rows.push(['--- RAW READINGS ---']);
    rows.push(['timestamp','pH','dissolved_oxygen_mg_L','turbidity_NTU','temperature_C']);
    for (const r of readings) {
      rows.push([fmtDateTime(new Date(r.ts)), r.ph?.toFixed(2)??'', r.do?.toFixed(2)??'', r.turb?.toFixed(2)??'', r.temp?.toFixed(2)??'']);
    }
    if (!readings.length) rows.push(['(no readings recorded for this period)']);
    return rows;
  }

  async function loadFeedDispenses(range) {
    if (typeof window.fetchFeedLogFromRTDB !== 'function') {
      log('Feed log fetch unavailable (Firebase not connected).', 'warn');
      return [];
    }
    try {
      return await window.fetchFeedLogFromRTDB(range.from.getTime(), range.to.getTime());
    } catch (e) {
      log('Feed log fetch failed: ' + (e?.message || String(e)), 'err');
      return [];
    }
  }

  function getReportDeviceLabel() {
    if (typeof window.getReportDeviceId === 'function') return window.getReportDeviceId();
    return 'device001';
  }

  async function buildReportRows({ period, type, customFrom, customTo }) {
    const range    = getDateRange(period, customFrom, customTo);
    // Ensure we pull persisted telemetry from RTDB (data recorded while browser was closed).
    if (typeof window.fetchHistoryFromRTDB === 'function') {
      try {
        const rtdbEntries = await window.fetchHistoryFromRTDB(range.from.getTime(), range.to.getTime());
        if (rtdbEntries?.length) mergeRtdbEntries(rtdbEntries);
      } catch {
        // RTDB unavailable — fall back to local cache silently
      }
    }
    const readings = getHistoryRange(range.from.getTime(), range.to.getTime());
    const snap     = getLiveSnapshot();
    const reportCfg = getReportConfig();
    const configLabel = getReportConfigLabel();
    const speciesLabel = reportCfg.species.charAt(0).toUpperCase() + reportCfg.species.slice(1);
    const typeLabel    = type === 'combined' ? 'Combined (Water Quality + Feeding)' : type === 'water-quality' ? 'Water Quality' : 'Feeding';

    const header = [
      ['report_type', typeLabel],
      ['period', period], ['date_range', range.label],
      ['configuration', configLabel],
      ['species', speciesLabel],
      ['device_id', getReportDeviceLabel()],
      ['generated_at', new Date().toISOString()], ['firebase_status', snap.status], [],
    ];

    let body = [];
    if (type === 'water-quality') {
      body = wqCsvRows(readings, snap, reportCfg);
    } else if (type === 'feeding') {
      const dispenses = await loadFeedDispenses(range);
      body = buildFeedingCsvRows(dispenses, range);
    } else {
      const dispenses = await loadFeedDispenses(range);
      body = [...wqCsvRows(readings, snap, reportCfg), [], ...buildFeedingCsvRows(dispenses, range)];
    }

    return [...header, ...body];
  }

  async function buildCsv(opts) {
    return rowsToCsvString(await buildReportRows(opts));
  }

  // ── Printable report builder ───────────────────────────────────────────────

  function buildWqPrintSections(readings, snap, pondCfg) {
    const metrics = [
      { key: 'ph', label: 'pH', current: snap.ph },
      { key: 'do', label: 'Dissolved O₂ (mg/L)', current: snap.do },
      { key: 'turb', label: 'Turbidity (NTU)', current: snap.turb },
      { key: 'temp', label: 'Temperature (°C)', current: snap.temp },
    ];
    const summaryRows = metrics.map((m) => {
      const s = stats(readings, m.key);
      const status = evalStatus(m.key, m.current, pondCfg?.thresholds);
      return [m.label, m.current || '—', status, s?.avg ?? '—', s?.min ?? '—', s?.max ?? '—', String(s?.count ?? 0)];
    });
    return [{
      title: 'Water Quality Summary',
      kind: 'table',
      columns: ['Metric', 'Current', 'Status', 'Avg', 'Min', 'Max', 'Samples'],
      rows: summaryRows,
      tableOpts: { numericCols: [3, 4, 5, 6] },
    }];
  }

  function buildFeedingPrintSections(dispenses, range) {
    const totalAmount = formatFeedAmountTotalDisplay(dispenses.length);
    return [
      {
        title: 'Feeding Summary',
        kind: 'kv',
        rows: [
          ['Period', range.label],
          ['Total Dispenses', String(dispenses.length)],
          ['Total Amount', totalAmount],
          ['Expected per Dispense', FEED_DISPENSE_MG_RANGE_LABEL],
        ],
      },
      {
        title: 'Dispense Log',
        subtitle: dispenses.length ? `${dispenses.length} events` : 'No events',
        kind: 'table',
        columns: ['Dispense Time', 'Type', 'Amount', 'Reason'],
        rows: dispenses.length
          ? dispenses.map((d) => [
            d.timestampDisplay,
            d.type,
            d.amountDisplay ?? formatFeedAmountDisplay(d.amountMg),
            d.reason,
          ])
          : [],
      },
    ];
  }

  async function buildReportPrintHtml({ period, type, customFrom, customTo }) {
    const range = getDateRange(period, customFrom, customTo);
    if (typeof window.fetchHistoryFromRTDB === 'function') {
      try {
        const rtdbEntries = await window.fetchHistoryFromRTDB(range.from.getTime(), range.to.getTime());
        if (rtdbEntries?.length) mergeRtdbEntries(rtdbEntries);
      } catch {
        // ignore
      }
    }
    const readings = getHistoryRange(range.from.getTime(), range.to.getTime());
    const snap = getLiveSnapshot();
    const reportCfg = getReportConfig();
    const configLabel = getReportConfigLabel();
    const speciesLabel = reportCfg.species.charAt(0).toUpperCase() + reportCfg.species.slice(1);
    const periodLabel = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', custom: 'Custom' }[period] ?? period;
    const typeLabel = { 'water-quality': 'Water Quality', feeding: 'Feeding', combined: 'Combined' }[type] ?? type;
    const title = `${periodLabel} ${typeLabel} Report`;

    const badges = [
      { label: periodLabel, bg: '#e0f2fe', color: '#0369a1' },
      { label: typeLabel, bg: '#f0fdf4', color: '#166534' },
      { label: configLabel, bg: '#e0f2fe', color: '#0369a1' },
    ];
    if (type === 'combined') badges.push({ label: 'Water + Feeding', bg: '#ede9fe', color: '#6d28d9' });

    const metaRows = [
      ['Report Period', range.label],
      ['Configuration', configLabel],
      ['Species', speciesLabel],
      ['Device', getReportDeviceLabel()],
      ['Generated', new Date().toLocaleString()],
      ['System Status', snap.status || '—'],
    ];

    let sections = [];
    if (type === 'water-quality') {
      sections = buildWqPrintSections(readings, snap, reportCfg);
    } else if (type === 'feeding') {
      const dispenses = await loadFeedDispenses(range);
      sections = buildFeedingPrintSections(dispenses, range);
    } else {
      const dispenses = await loadFeedDispenses(range);
      sections = [
        ...buildWqPrintSections(readings, snap, reportCfg),
        ...buildFeedingPrintSections(dispenses, range),
      ];
    }

    return buildPrintableHtml({
      title,
      badges,
      metaRows,
      sections,
      autoPrint: shouldAutoPrint(),
    });
  }

  async function populatePrintableReport(target, opts) {
    try {
      const html = await buildReportPrintHtml(opts);
      writeReportPrintTarget(target, html);
      if (target?.kind === 'overlay') {
        showAppToast('Report ready — tap Print / Save as PDF.', 'info');
      }
    } catch (e) {
      closeReportPrintTarget(target);
      showAppToast('Could not open report for printing. Try again or use CSV.', 'error');
      throw e;
    }
  }

  /** @deprecated Use openReportPrintTargetSync + populatePrintableReport from a click handler. */
  async function openPrintableReport(opts) {
    const target = openReportPrintTargetSync();
    await populatePrintableReport(target, opts);
  }

  // ── History rendering ──────────────────────────────────────────────────────

  function typeIcon(type) {
    if (type === 'water-quality') return { bg:'rgba(59,130,246,0.1)', color:'#3b82f6', icon:'#icon-droplet' };
    if (type === 'feeding')       return { bg:'rgba(34,197,94,0.1)',  color:'#22c55e', icon:'#icon-fish' };
    return                               { bg:'rgba(124,58,237,0.1)', color:'#7c3aed', icon:'#icon-document' };
  }

  function renderHistory() {
    const list = document.getElementById('report-history-list');
    if (!list) return;
    const history = loadReportHistory();
    if (!history.length) {
      list.innerHTML = '<div class="rpt-history-empty">No reports generated yet.</div>';
      return;
    }
    list.innerHTML = history.map((h, i) => {
      const ic = typeIcon(h.type);
      const typeLabel = { 'water-quality':'Water Quality', feeding:'Feeding', combined:'Combined' }[h.type] ?? h.type;
      const fmtBadge = h.format === 'pdf'
        ? 'background:#fee2e2;color:#b91c1c'
        : h.format === 'xlsx'
        ? 'background:#dcfce7;color:#15803d'
        : 'background:#f1f5f9;color:#475569';
      return `<div class="rpt-history-row">
        <div class="rpt-history-icon" style="background:${ic.bg};color:${ic.color}">
          <svg class="icon icon-14"><use href="${ic.icon}"/></svg>
        </div>
        <div class="rpt-history-body">
          <div class="rpt-history-name">${h.title}</div>
          <div class="rpt-history-meta">${h.period} · ${h.dateRange} · ${h.pondLabel || '—'} · ${h.generatedAt}</div>
        </div>
        <span class="badge-pill" style="font-size:0.65rem;${fmtBadge}">${h.format.toUpperCase()}</span>
        <div class="rpt-history-actions">
          <button class="btn btn-outline" style="padding:5px 10px;font-size:0.75rem" data-regen-index="${i}">Re-generate</button>
        </div>
      </div>`;
    }).join('');

    // Re-generate buttons
    list.querySelectorAll('[data-regen-index]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const h = loadReportHistory()[Number(btn.getAttribute('data-regen-index'))];
        if (!h) return;
        const perms = window._rbacPerms;
        if (perms && !perms.canDownloadReports) { alert('Access denied: Owner or Admin required.'); return; }
        btn.disabled = true;
        try {
          if (h.format === 'pdf') {
            const target = openReportPrintTargetSync();
            await populatePrintableReport(target, {
              period: h.period,
              type: h.type,
              customFrom: h.customFrom,
              customTo: h.customTo,
            });
          } else {
            const rows = await buildReportRows({ period: h.period, type: h.type, customFrom: h.customFrom, customTo: h.customTo });
            const ext = h.format === 'xlsx' ? 'xls' : 'csv';
            downloadReportFile(`${h.type}_${h.period}_${getNowStamp()}.${ext}`, rows, h.format);
          }
        } finally { btn.disabled = false; }
      });
    });
  }

  function recordHistory({ period, type, format, range, customFrom, customTo }) {
    const periodLabel = { daily:'Daily', weekly:'Weekly', monthly:'Monthly', custom:'Custom' }[period] ?? period;
    const typeLabel   = { 'water-quality':'Water Quality', feeding:'Feeding', combined:'Combined' }[type] ?? type;
    const configLabel = getReportConfigLabel();
    addToHistory({
      title: `${periodLabel} ${typeLabel} Report`,
      period, type, format,
      dateRange: range.label,
      pondLabel: configLabel,
      configLabel,
      configId: getActiveConfigId() || '',
      generatedAt: new Date().toLocaleString(),
      customFrom: customFrom || '',
      customTo:   customTo   || '',
    });
    renderHistory();
  }

  // ── Download handler ───────────────────────────────────────────────────────

  async function handleDownload(entryEl, format) {
    const period = entryEl.getAttribute('data-report-period') || 'daily';
    const type   = entryEl.getAttribute('data-report-type')   || 'water-quality';
    const range  = getDateRange(period);
    const stamp  = getNowStamp();

    if (format === 'pdf') {
      const target = openReportPrintTargetSync();
      try {
        await populatePrintableReport(target, { period, type });
        recordHistory({ period, type, format: 'pdf', range });
      } catch {
        // toast shown in populatePrintableReport
      }
      return;
    }
    const rows = await buildReportRows({ period, type });
    const ext = format === 'xlsx' ? 'xls' : 'csv';
    downloadReportFile(`${type}_${period}_${stamp}.${ext}`, rows, format);
    recordHistory({ period, type, format, range });
  }

  // ── Event wiring ───────────────────────────────────────────────────────────

  document.querySelectorAll('.report-entry [data-report-format]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const perms = window._rbacPerms;
      if (perms && !perms.canDownloadReports) { alert('Access denied: Owner or Admin required to download reports.'); return; }
      const entry = btn.closest('.report-entry');
      if (!entry) return;
      btn.disabled = true;
      try { await handleDownload(entry, btn.getAttribute('data-report-format') || 'csv'); }
      finally { btn.disabled = false; }
    });
  });

  // Custom CSV
  document.getElementById('btn-custom-generate')?.addEventListener('click', async () => {
    const perms = window._rbacPerms;
    if (perms && !perms.canDownloadReports) { alert('Access denied: Owner or Admin required.'); return; }
    const from = document.getElementById('custom-from')?.value;
    const to   = document.getElementById('custom-to')?.value;
    if (!from || !to) { alert('Please select both a From and To date.'); return; }
    if (new Date(from) > new Date(to)) { alert('From date must be before To date.'); return; }
    const typeVal = document.getElementById('custom-report-type')?.value || 'water-quality';
    const type = ['feeding','combined'].includes(typeVal) ? typeVal : 'water-quality';
    const range = getDateRange('custom', from, to);
    const btn = document.getElementById('btn-custom-generate');
    btn.disabled = true;
    try {
      const rows = await buildReportRows({ period:'custom', type, customFrom: from, customTo: to });
      downloadReportFile(`${type}_custom_${getNowStamp()}.csv`, rows, 'csv');
      recordHistory({ period:'custom', type, format:'csv', range, customFrom: from, customTo: to });
    } finally { btn.disabled = false; }
  });

  // Custom Excel
  document.getElementById('btn-custom-generate-xlsx')?.addEventListener('click', async () => {
    const perms = window._rbacPerms;
    if (perms && !perms.canDownloadReports) { alert('Access denied: Owner or Admin required.'); return; }
    const from = document.getElementById('custom-from')?.value;
    const to   = document.getElementById('custom-to')?.value;
    if (!from || !to) { alert('Please select both a From and To date.'); return; }
    if (new Date(from) > new Date(to)) { alert('From date must be before To date.'); return; }
    const typeVal = document.getElementById('custom-report-type')?.value || 'water-quality';
    const type = ['feeding', 'combined'].includes(typeVal) ? typeVal : 'water-quality';
    const range = getDateRange('custom', from, to);
    const btn = document.getElementById('btn-custom-generate-xlsx');
    btn.disabled = true;
    try {
      const rows = await buildReportRows({ period: 'custom', type, customFrom: from, customTo: to });
      downloadReportFile(`${type}_custom_${getNowStamp()}.xlsx`, rows, 'xlsx');
      recordHistory({ period: 'custom', type, format: 'xlsx', range, customFrom: from, customTo: to });
    } finally { btn.disabled = false; }
  });

  // Custom PDF
  document.getElementById('btn-custom-generate-pdf')?.addEventListener('click', async () => {
    const perms = window._rbacPerms;
    if (perms && !perms.canDownloadReports) { alert('Access denied: Owner or Admin required.'); return; }
    const from = document.getElementById('custom-from')?.value;
    const to   = document.getElementById('custom-to')?.value;
    if (!from || !to) { alert('Please select both a From and To date.'); return; }
    if (new Date(from) > new Date(to)) { alert('From date must be before To date.'); return; }
    const typeVal = document.getElementById('custom-report-type')?.value || 'water-quality';
    const type = ['feeding','combined'].includes(typeVal) ? typeVal : 'water-quality';
    const range = getDateRange('custom', from, to);
    const btn = document.getElementById('btn-custom-generate-pdf');
    btn.disabled = true;
    const target = openReportPrintTargetSync();
    try {
      await populatePrintableReport(target, { period: 'custom', type, customFrom: from, customTo: to });
      recordHistory({ period: 'custom', type, format: 'pdf', range, customFrom: from, customTo: to });
    } catch {
      // toast shown in populatePrintableReport
    } finally { btn.disabled = false; }
  });

  // Clear history
  document.getElementById('btn-clear-report-history')?.addEventListener('click', () => {
    showConfirmModal({
      title: 'Clear report history',
      subtitle: 'Downloaded report records will be removed from this device.',
      message: 'Clear all report history? This cannot be undone.',
      confirmLabel: 'Clear history',
      destructive: true,
      onConfirm: async () => {
        saveReportHistory([]);
        renderHistory();
        showAppToast('Report history cleared.', 'success');
      },
    });
  });

  // Initial render
  renderHistory();
}