/**
 * Reports feature.
 * Supports Water Quality, Feeding, and Combined (Water + Feeding) reports
 * for daily / weekly / monthly / custom periods.
 * Every generated report is saved to a localStorage-backed history list.
 */
import { getHistoryRange } from '../utils.js';

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
    const now = new Date();
    if (period === 'daily') {
      const s = new Date(now); s.setHours(0,0,0,0);
      const e = new Date(now); e.setHours(23,59,59,999);
      return { from: s, to: e, label: `Today (${fmtDate(now)})` };
    }
    if (period === 'weekly') {
      const day = now.getDay();
      const mon = new Date(now); mon.setDate(now.getDate() + (day===0?-6:1-day)); mon.setHours(0,0,0,0);
      const sun = new Date(mon); sun.setDate(mon.getDate()+6); sun.setHours(23,59,59,999);
      return { from: mon, to: sun, label: `This week (${fmtDate(mon)} Mon – ${fmtDate(sun)} Sun)` };
    }
    if (period === 'monthly') {
      const s = new Date(now.getFullYear(), now.getMonth(), 1, 0,0,0,0);
      const e = new Date(now.getFullYear(), now.getMonth()+1, 0, 23,59,59,999);
      return { from: s, to: e, label: `This month (${fmtDate(s)} – ${fmtDate(e)})` };
    }
    if (period === 'custom' && customFrom && customTo) {
      return { from: new Date(customFrom+'T00:00:00'), to: new Date(customTo+'T23:59:59'), label: `${customFrom} – ${customTo}` };
    }
    const s = new Date(now); s.setHours(0,0,0,0);
    const e = new Date(now); e.setHours(23,59,59,999);
    return { from: s, to: e, label: fmtDate(now) };
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

  // ── CSV builders ───────────────────────────────────────────────────────────

  function wqCsvRows(readings, snap, period, range) {
    const rows = [
      ['--- WATER QUALITY ---'],
      ['metric','current','avg','min','max','samples'],
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
      rows.push([m.label, cur[m.key], s?.avg??'—', s?.min??'—', s?.max??'—', s?.count??0]);
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

  function feedingCsvRows(period, range) {
    const daysInMonth = new Date(range.to.getFullYear(), range.to.getMonth()+1, 0).getDate();
    const rows = [['--- FEEDING ---'], ['metric','value'], ['period_label', range.label]];
    if (period === 'daily') {
      rows.push(['scheduled_feedings','4'],['completed_feedings','2'],['total_feed_kg','55'],['feed_efficiency_pct','93']);
    } else if (period === 'weekly') {
      rows.push(['avg_daily_feed_kg','86.4'],['total_feed_kg','604.8'],['feed_efficiency_pct','93'],['days_in_week','7']);
    } else {
      rows.push(['avg_daily_feed_kg','86.4'],['total_feed_kg',String((86.4*daysInMonth).toFixed(1))],['feed_efficiency_pct','93'],['days_in_month',String(daysInMonth)]);
    }
    return rows;
  }

  function buildCsv({ period, type, customFrom, customTo }) {
    const range = getDateRange(period, customFrom, customTo);
    const readings = getHistoryRange(range.from.getTime(), range.to.getTime());
    const snap = getLiveSnapshot();

    const header = [
      ['report_type', type === 'combined' ? 'Combined (Water Quality + Feeding)' : type === 'water-quality' ? 'Water Quality' : 'Feeding'],
      ['period', period], ['date_range', range.label],
      ['generated_at', new Date().toISOString()], ['firebase_status', snap.status], [],
    ];

    let body = [];
    if (type === 'water-quality') body = wqCsvRows(readings, snap, period, range);
    else if (type === 'feeding')  body = feedingCsvRows(period, range);
    else { // combined
      body = [...wqCsvRows(readings, snap, period, range), [], ...feedingCsvRows(period, range)];
    }

    return [...header, ...body]
      .map(r => r.map(c => `"${String(c??'').replaceAll('"','""')}"`).join(','))
      .join('\n');
  }

  // ── Printable report builder ───────────────────────────────────────────────

  function wqSummaryHtml(readings, snap, { includeRaw = true } = {}) {
    const metrics = [
      { key:'ph',   label:'pH',                  current: snap.ph },
      { key:'do',   label:'Dissolved O₂ (mg/L)', current: snap.do },
      { key:'turb', label:'Turbidity (NTU)',      current: snap.turb },
      { key:'temp', label:'Temperature (°C)',     current: snap.temp },
    ];
    const rows = metrics.map(m => {
      const s = stats(readings, m.key);
      return `<tr><td>${m.label}</td><td>${m.current||'—'}</td><td>${s?.avg??'—'}</td><td>${s?.min??'—'}</td><td>${s?.max??'—'}</td><td>${s?.count??0}</td></tr>`;
    }).join('');
    const rawSection = includeRaw ? `
      <h2 style="margin-top:24px">Raw Readings <span style="font-weight:400;color:#64748b">(${readings.length} records)</span></h2>
      <table>
        <thead><tr><th>Timestamp</th><th>pH</th><th>DO (mg/L)</th><th>Turbidity (NTU)</th><th>Temp (°C)</th></tr></thead>
        <tbody>${readings.length
          ? readings.map(r=>`<tr><td>${fmtDateTime(new Date(r.ts))}</td><td>${r.ph?.toFixed(2)??'—'}</td><td>${r.do?.toFixed(2)??'—'}</td><td>${r.turb?.toFixed(2)??'—'}</td><td>${r.temp?.toFixed(2)??'—'}</td></tr>`).join('')
          : '<tr><td colspan="5" style="color:#64748b;font-style:italic">No readings for this period.</td></tr>'
        }</tbody>
      </table>` : '';
    return `
      <h2>Water Quality Summary</h2>
      <table>
        <thead><tr><th>Metric</th><th>Current</th><th>Avg</th><th>Min</th><th>Max</th><th>Samples</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>${rawSection}`;
  }

  function feedingHtml(period, range) {
    const daysInMonth = new Date(range.to.getFullYear(), range.to.getMonth()+1, 0).getDate();
    let rows = '';
    if (period === 'daily') rows = `<tr><th>Scheduled Feedings</th><td>4</td></tr><tr><th>Completed Feedings</th><td>2</td></tr><tr><th>Total Feed Dispensed</th><td>55 kg</td></tr><tr><th>Feed Efficiency</th><td>93%</td></tr><tr><th>Stock Remaining</th><td>1,250 kg (~14 days)</td></tr>`;
    else if (period === 'weekly') rows = `<tr><th>Days in Week</th><td>7</td></tr><tr><th>Avg Daily Feed</th><td>86.4 kg/day</td></tr><tr><th>Total Feed Dispensed</th><td>604.8 kg</td></tr><tr><th>Feed Efficiency</th><td>93%</td></tr><tr><th>Stock Remaining</th><td>1,250 kg (~14 days)</td></tr>`;
    else rows = `<tr><th>Days in Month</th><td>${daysInMonth}</td></tr><tr><th>Avg Daily Feed</th><td>86.4 kg/day</td></tr><tr><th>Total Feed Dispensed</th><td>${(86.4*daysInMonth).toFixed(1)} kg</td></tr><tr><th>Feed Efficiency</th><td>93%</td></tr><tr><th>Stock Remaining</th><td>1,250 kg (~14 days)</td></tr>`;
    return `<h2>Feeding Summary</h2><table style="max-width:420px"><tbody>${rows}</tbody></table>`;
  }

  function openPrintableReport({ period, type, customFrom, customTo }) {
    const range = getDateRange(period, customFrom, customTo);
    const readings = getHistoryRange(range.from.getTime(), range.to.getTime());
    const snap = getLiveSnapshot();

    const w = window.open('', '_blank');
    if (!w) { alert('Popup blocked. Allow popups to print/save as PDF.'); return; }

    const periodLabel = { daily:'Daily', weekly:'Weekly', monthly:'Monthly', custom:'Custom' }[period] ?? period;
    const typeLabel   = { 'water-quality':'Water Quality', feeding:'Feeding', combined:'Combined' }[type] ?? type;
    const title = `${periodLabel} ${typeLabel} Report`;

    let body = '';
    if (type === 'water-quality') body = wqSummaryHtml(readings, snap, { includeRaw: false });
    else if (type === 'feeding')  body = feedingHtml(period, range);
    else body = wqSummaryHtml(readings, snap, { includeRaw: false }) + '<div style="margin-top:32px;border-top:1px solid #e2e8f0;padding-top:24px">' + feedingHtml(period, range) + '</div>';

    const combinedBadge = type === 'combined' ? '<span class="badge" style="background:#ede9fe;color:#6d28d9">Water + Feeding</span>' : '';

    w.document.open();
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px 28px;color:#0f172a;font-size:13px}
  .badge{display:inline-block;background:#e0f2fe;color:#0369a1;font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;text-transform:uppercase;letter-spacing:.06em;vertical-align:middle;margin-right:6px}
  h1{font-size:18px;margin:4px 0 2px}
  h2{font-size:13px;font-weight:600;margin:20px 0 6px;color:#334155;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
  .meta{color:#64748b;font-size:11px;margin-bottom:4px}
  .range{font-size:12px;font-weight:500;margin-bottom:18px;color:#0f172a}
  table{border-collapse:collapse;width:100%;margin-bottom:4px}
  td,th{border:1px solid #e2e8f0;padding:7px 10px;text-align:left;white-space:nowrap}
  thead th{background:#f1f5f9;font-weight:600}
  tbody tr:nth-child(even){background:#f8fafc}
  @media print{body{padding:12px 14px}thead{display:table-header-group}}
</style></head><body>
  <div><span class="badge">${periodLabel}</span><span class="badge" style="background:#f0fdf4;color:#166534">${typeLabel}</span>${combinedBadge}</div>
  <h1>${title}</h1>
  <div class="meta">Generated: ${new Date().toLocaleString()}</div>
  <div class="range">Period: ${range.label}</div>
  <div class="meta">Firebase: ${snap.status||'—'}</div>
  ${body}
  <script>setTimeout(()=>window.print(),300);<\/script>
</body></html>`);
    w.document.close();
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
          <div class="rpt-history-meta">${h.period} · ${h.dateRange} · ${h.generatedAt}</div>
        </div>
        <span class="badge-pill" style="font-size:0.65rem;${fmtBadge}">${h.format.toUpperCase()}</span>
        <div class="rpt-history-actions">
          <button class="btn btn-outline" style="padding:5px 10px;font-size:0.75rem" data-regen-index="${i}">Re-generate</button>
        </div>
      </div>`;
    }).join('');

    // Re-generate buttons
    list.querySelectorAll('[data-regen-index]').forEach(btn => {
      btn.addEventListener('click', () => {
        const h = loadReportHistory()[Number(btn.getAttribute('data-regen-index'))];
        if (!h) return;
        const perms = window._rbacPerms;
        if (perms && !perms.canDownloadReports) { alert('Access denied: Owner or Admin required.'); return; }
        if (h.format === 'pdf') {
          openPrintableReport({ period: h.period, type: h.type, customFrom: h.customFrom, customTo: h.customTo });
        } else {
          const csv = buildCsv({ period: h.period, type: h.type, customFrom: h.customFrom, customTo: h.customTo });
          const ext = h.format === 'xlsx' ? 'xlsx' : 'csv';
          downloadBlob(`${h.type}_${h.period}_${getNowStamp()}.${ext}`, new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8' }));
        }
      });
    });
  }

  function recordHistory({ period, type, format, range, customFrom, customTo }) {
    const periodLabel = { daily:'Daily', weekly:'Weekly', monthly:'Monthly', custom:'Custom' }[period] ?? period;
    const typeLabel   = { 'water-quality':'Water Quality', feeding:'Feeding', combined:'Combined' }[type] ?? type;
    addToHistory({
      title: `${periodLabel} ${typeLabel} Report`,
      period, type, format,
      dateRange: range.label,
      generatedAt: new Date().toLocaleString(),
      customFrom: customFrom || '',
      customTo:   customTo   || '',
    });
    renderHistory();
  }

  // ── Download handler ───────────────────────────────────────────────────────

  function handleDownload(entryEl, format) {
    const period = entryEl.getAttribute('data-report-period') || 'daily';
    const type   = entryEl.getAttribute('data-report-type')   || 'water-quality';
    const range  = getDateRange(period);
    const stamp  = getNowStamp();

    if (format === 'pdf') {
      openPrintableReport({ period, type });
      recordHistory({ period, type, format: 'pdf', range });
      return;
    }
    const csv = buildCsv({ period, type });
    const ext = format === 'xlsx' ? 'xlsx' : 'csv';
    downloadBlob(`${type}_${period}_${stamp}.${ext}`, new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8' }));
    recordHistory({ period, type, format, range });
  }

  // ── Event wiring ───────────────────────────────────────────────────────────

  document.querySelectorAll('.report-entry [data-report-format]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const perms = window._rbacPerms;
      if (perms && !perms.canDownloadReports) { alert('Access denied: Owner or Admin required to download reports.'); return; }
      const entry = btn.closest('.report-entry');
      if (!entry) return;
      handleDownload(entry, btn.getAttribute('data-report-format') || 'csv');
    });
  });

  // Custom CSV
  document.getElementById('btn-custom-generate')?.addEventListener('click', () => {
    const perms = window._rbacPerms;
    if (perms && !perms.canDownloadReports) { alert('Access denied: Owner or Admin required.'); return; }
    const from = document.getElementById('custom-from')?.value;
    const to   = document.getElementById('custom-to')?.value;
    if (!from || !to) { alert('Please select both a From and To date.'); return; }
    if (new Date(from) > new Date(to)) { alert('From date must be before To date.'); return; }
    const typeVal = document.getElementById('custom-report-type')?.value || 'water-quality';
    const type = ['feeding','combined'].includes(typeVal) ? typeVal : 'water-quality';
    const range = getDateRange('custom', from, to);
    const csv = buildCsv({ period:'custom', type, customFrom: from, customTo: to });
    downloadBlob(`${type}_custom_${getNowStamp()}.csv`, new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8' }));
    recordHistory({ period:'custom', type, format:'csv', range, customFrom: from, customTo: to });
  });

  // Custom PDF
  document.getElementById('btn-custom-generate-pdf')?.addEventListener('click', () => {
    const perms = window._rbacPerms;
    if (perms && !perms.canDownloadReports) { alert('Access denied: Owner or Admin required.'); return; }
    const from = document.getElementById('custom-from')?.value;
    const to   = document.getElementById('custom-to')?.value;
    if (!from || !to) { alert('Please select both a From and To date.'); return; }
    if (new Date(from) > new Date(to)) { alert('From date must be before To date.'); return; }
    const typeVal = document.getElementById('custom-report-type')?.value || 'water-quality';
    const type = ['feeding','combined'].includes(typeVal) ? typeVal : 'water-quality';
    const range = getDateRange('custom', from, to);
    openPrintableReport({ period:'custom', type, customFrom: from, customTo: to });
    recordHistory({ period:'custom', type, format:'pdf', range, customFrom: from, customTo: to });
  });

  // Clear history
  document.getElementById('btn-clear-report-history')?.addEventListener('click', () => {
    if (!confirm('Clear all report history?')) return;
    saveReportHistory([]);
    renderHistory();
  });

  // Initial render
  renderHistory();
}
