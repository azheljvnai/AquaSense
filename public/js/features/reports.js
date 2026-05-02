/**
 * Reports feature.
 * Supports Water Quality, Feeding, and Combined (Water + Feeding) reports
 * for daily / weekly / monthly / custom periods.
 * Every generated report is saved to a localStorage-backed history list.
 */
import { getHistoryRange, mergeHistoryEntries } from '../utils.js';
import { getActivePond, getPondList, onActivePondChange } from '../pond-context.js';
import { getPondConfigurations, SPECIES_PRESETS } from '../pond-config.js';

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

  // ── Pond filter ────────────────────────────────────────────────────────────

  /** Returns the currently selected pond for reports (null = All Ponds). */
  function getReportPond() {
    const sel = document.getElementById('report-pond-select');
    if (!sel || sel.value === 'all') return null;
    const ponds = getPondList();
    return ponds.find(p => p.id === sel.value) || null;
  }

  function updateReportPondBar() {
    const pond   = getReportPond();
    const bar    = document.getElementById('report-active-pond-bar');
    const nameEl = document.getElementById('report-active-pond-name');
    const specEl = document.getElementById('report-active-pond-species');
    if (!bar) return;
    if (!pond) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    if (nameEl) nameEl.textContent = pond.name || pond.id;
    if (specEl) {
      const s = pond.species || '';
      specEl.textContent = s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
      specEl.style.display = s ? '' : 'none';
    }
  }

  function populateReportPondSelect(ponds) {
    const sel = document.getElementById('report-pond-select');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="all">All Ponds</option>';
    for (const p of ponds) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name || p.id;
      sel.appendChild(opt);
    }
    // Restore selection or default to active pond
    const activePond = getActivePond();
    if (current && sel.querySelector(`option[value="${current}"]`)) {
      sel.value = current;
    } else if (activePond && sel.querySelector(`option[value="${activePond.id}"]`)) {
      sel.value = activePond.id;
    }
    updateReportPondBar();
  }

  // Populate on load
  populateReportPondSelect(getPondList());

  // Update when pond list changes
  window.addEventListener('pond-list-updated', (e) => {
    populateReportPondSelect(e.detail.ponds || []);
  });

  // Sync to active pond when it changes globally
  onActivePondChange((pond) => {
    const sel = document.getElementById('report-pond-select');
    if (sel && pond && sel.querySelector(`option[value="${pond.id}"]`)) {
      sel.value = pond.id;
    }
    updateReportPondBar();
  });

  document.getElementById('report-pond-select')?.addEventListener('change', updateReportPondBar);

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

  // ── Per-pond config loader ─────────────────────────────────────────────────

  /**
   * Fetch the active config for a pond and return its species + thresholds.
   * Falls back to crayfish defaults if nothing is configured.
   */
  async function fetchPondConfig(pondId) {
    try {
      const configs = await getPondConfigurations(pondId);
      const active  = configs.find(c => c.isActive) || configs[0] || null;
      if (active) {
        const species = active.species || 'crayfish';
        const preset  = SPECIES_PRESETS[species] || SPECIES_PRESETS.crayfish;
        return {
          species,
          name:       active.name || preset.name,
          thresholds: active.thresholds ? { ...preset.thresholds, ...active.thresholds } : preset.thresholds,
        };
      }
    } catch { /* offline / no config */ }
    return { species: 'crayfish', name: 'Crayfish (default)', thresholds: SPECIES_PRESETS.crayfish.thresholds };
  }

  /**
   * Evaluate a sensor value against a pond's thresholds and return a status label.
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

  async function buildCsv({ period, type, customFrom, customTo }) {
    const range    = getDateRange(period, customFrom, customTo);
    // Ensure we pull persisted telemetry from RTDB (data recorded while browser was closed).
    if (typeof window.fetchHistoryFromRTDB === 'function') {
      try {
        const rtdbEntries = await window.fetchHistoryFromRTDB(range.from.getTime(), range.to.getTime());
        if (rtdbEntries?.length) mergeHistoryEntries(rtdbEntries);
      } catch {
        // RTDB unavailable — fall back to local cache silently
      }
    }
    const readings = getHistoryRange(range.from.getTime(), range.to.getTime());
    const snap     = getLiveSnapshot();
    const pond     = getReportPond();
    const allPonds = getPondList();

    // Determine which ponds to report on
    const targetPonds = pond ? [pond] : allPonds;

    const pondLabel    = pond ? (pond.name || pond.id) : 'All Ponds';
    const typeLabel    = type === 'combined' ? 'Combined (Water Quality + Feeding)' : type === 'water-quality' ? 'Water Quality' : 'Feeding';

    const header = [
      ['report_type', typeLabel],
      ['period', period], ['date_range', range.label],
      ['pond_filter', pondLabel],
      ['generated_at', new Date().toISOString()], ['firebase_status', snap.status], [],
    ];

    let body = [];

    if (targetPonds.length === 0) {
      // No ponds configured — fall back to untagged report
      const pondCfg = { species: 'crayfish', thresholds: SPECIES_PRESETS.crayfish.thresholds };
      if (type === 'water-quality') body = wqCsvRows(readings, snap, pondCfg);
      else if (type === 'feeding')  body = feedingCsvRows(period, range);
      else body = [...wqCsvRows(readings, snap, pondCfg), [], ...feedingCsvRows(period, range)];
    } else {
      // One section per pond, each with its own config
      for (let i = 0; i < targetPonds.length; i++) {
        const p       = targetPonds[i];
        const pondCfg = await fetchPondConfig(p.id);
        const speciesLabel = pondCfg.species.charAt(0).toUpperCase() + pondCfg.species.slice(1);

        if (i > 0) body.push([], ['═══════════════════════════════════════']);
        body.push(
          [`=== POND: ${p.name || p.id} ===`],
          ['pond_id', p.id],
          ['pond_name', p.name || p.id],
          ['species', speciesLabel],
          ['config_name', pondCfg.name],
          [],
        );

        if (type === 'water-quality') body.push(...wqCsvRows(readings, snap, pondCfg));
        else if (type === 'feeding')  body.push(...feedingCsvRows(period, range));
        else body.push(...wqCsvRows(readings, snap, pondCfg), [], ...feedingCsvRows(period, range));
      }
    }

    return [...header, ...body]
      .map(r => r.map(c => `"${String(c??'').replaceAll('"','""')}"`).join(','))
      .join('\n');
  }

  // ── Printable report builder ───────────────────────────────────────────────

  function wqSummaryHtml(readings, snap, pondCfg, { includeRaw = true } = {}) {
    const metrics = [
      { key:'ph',   label:'pH',                  current: snap.ph },
      { key:'do',   label:'Dissolved O₂ (mg/L)', current: snap.do },
      { key:'turb', label:'Turbidity (NTU)',      current: snap.turb },
      { key:'temp', label:'Temperature (°C)',     current: snap.temp },
    ];
    const rows = metrics.map(m => {
      const s      = stats(readings, m.key);
      const status = evalStatus(m.key, m.current, pondCfg?.thresholds);
      const statusColor = { Normal:'#166534', Warning:'#b45309', Critical:'#991b1b' }[status] || '#475569';
      return `<tr>
        <td>${m.label}</td>
        <td>${m.current||'—'}</td>
        <td style="color:${statusColor};font-weight:600">${status}</td>
        <td>${s?.avg??'—'}</td><td>${s?.min??'—'}</td><td>${s?.max??'—'}</td><td>${s?.count??0}</td>
      </tr>`;
    }).join('');
    const rawSection = includeRaw ? `
      <h3 style="margin-top:20px;font-size:12px;color:#334155">Raw Readings <span style="font-weight:400;color:#64748b">(${readings.length} records)</span></h3>
      <table>
        <thead><tr><th>Timestamp</th><th>pH</th><th>DO (mg/L)</th><th>Turbidity (NTU)</th><th>Temp (°C)</th></tr></thead>
        <tbody>${readings.length
          ? readings.map(r=>`<tr><td>${fmtDateTime(new Date(r.ts))}</td><td>${r.ph?.toFixed(2)??'—'}</td><td>${r.do?.toFixed(2)??'—'}</td><td>${r.turb?.toFixed(2)??'—'}</td><td>${r.temp?.toFixed(2)??'—'}</td></tr>`).join('')
          : '<tr><td colspan="5" style="color:#64748b;font-style:italic">No readings for this period.</td></tr>'
        }</tbody>
      </table>` : '';
    return `
      <h3 style="font-size:12px;font-weight:600;margin:14px 0 6px;color:#334155;border-bottom:1px solid #e2e8f0;padding-bottom:4px">Water Quality Summary</h3>
      <table>
        <thead><tr><th>Metric</th><th>Current</th><th>Status</th><th>Avg</th><th>Min</th><th>Max</th><th>Samples</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>${rawSection}`;
  }

  function feedingHtml(period, range) {
    const daysInMonth = new Date(range.to.getFullYear(), range.to.getMonth()+1, 0).getDate();
    let rows = '';
    if (period === 'daily') rows = `<tr><th>Scheduled Feedings</th><td>4</td></tr><tr><th>Completed Feedings</th><td>2</td></tr><tr><th>Total Feed Dispensed</th><td>55 kg</td></tr><tr><th>Feed Efficiency</th><td>93%</td></tr><tr><th>Stock Remaining</th><td>1,250 kg (~14 days)</td></tr>`;
    else if (period === 'weekly') rows = `<tr><th>Days in Week</th><td>7</td></tr><tr><th>Avg Daily Feed</th><td>86.4 kg/day</td></tr><tr><th>Total Feed Dispensed</th><td>604.8 kg</td></tr><tr><th>Feed Efficiency</th><td>93%</td></tr><tr><th>Stock Remaining</th><td>1,250 kg (~14 days)</td></tr>`;
    else rows = `<tr><th>Days in Month</th><td>${daysInMonth}</td></tr><tr><th>Avg Daily Feed</th><td>86.4 kg/day</td></tr><tr><th>Total Feed Dispensed</th><td>${(86.4*daysInMonth).toFixed(1)} kg</td></tr><tr><th>Feed Efficiency</th><td>93%</td></tr><tr><th>Stock Remaining</th><td>1,250 kg (~14 days)</td></tr>`;
    return `<h3 style="font-size:12px;font-weight:600;margin:14px 0 6px;color:#334155;border-bottom:1px solid #e2e8f0;padding-bottom:4px">Feeding Summary</h3><table style="max-width:420px"><tbody>${rows}</tbody></table>`;
  }

  async function openPrintableReport({ period, type, customFrom, customTo }) {
    const range    = getDateRange(period, customFrom, customTo);
    if (typeof window.fetchHistoryFromRTDB === 'function') {
      try {
        const rtdbEntries = await window.fetchHistoryFromRTDB(range.from.getTime(), range.to.getTime());
        if (rtdbEntries?.length) mergeHistoryEntries(rtdbEntries);
      } catch {
        // ignore
      }
    }
    const readings = getHistoryRange(range.from.getTime(), range.to.getTime());
    const snap     = getLiveSnapshot();
    const pond     = getReportPond();
    const allPonds = getPondList();

    const targetPonds  = pond ? [pond] : allPonds;
    const pondLabel    = pond ? (pond.name || pond.id) : 'All Ponds';
    const periodLabel  = { daily:'Daily', weekly:'Weekly', monthly:'Monthly', custom:'Custom' }[period] ?? period;
    const typeLabel    = { 'water-quality':'Water Quality', feeding:'Feeding', combined:'Combined' }[type] ?? type;
    const title        = `${periodLabel} ${typeLabel} Report`;

    const w = window.open('', '_blank');
    if (!w) { alert('Popup blocked. Allow popups to print/save as PDF.'); return; }

    // Build per-pond sections
    let body = '';
    if (targetPonds.length === 0) {
      const pondCfg = { species: 'crayfish', thresholds: SPECIES_PRESETS.crayfish.thresholds };
      if (type === 'water-quality') body = wqSummaryHtml(readings, snap, pondCfg, { includeRaw: false });
      else if (type === 'feeding')  body = feedingHtml(period, range);
      else body = wqSummaryHtml(readings, snap, pondCfg, { includeRaw: false }) + feedingHtml(period, range);
    } else {
      const sections = await Promise.all(targetPonds.map(async (p) => {
        const pondCfg     = await fetchPondConfig(p.id);
        const speciesLabel = pondCfg.species.charAt(0).toUpperCase() + pondCfg.species.slice(1);
        const pondHeader  = targetPonds.length > 1
          ? `<div class="pond-section-header">
               <span class="pond-section-name">${p.name || p.id}</span>
               <span class="badge" style="background:#f0fdf4;color:#166534">${speciesLabel}</span>
               <span class="badge" style="background:#f8fafc;color:#475569;font-weight:500">${pondCfg.name}</span>
             </div>`
          : `<div style="margin-bottom:8px;font-size:11px;color:#64748b">
               Species: <strong>${speciesLabel}</strong> &nbsp;·&nbsp; Config: <strong>${pondCfg.name}</strong>
             </div>`;

        let content = '';
        if (type === 'water-quality') content = wqSummaryHtml(readings, snap, pondCfg, { includeRaw: false });
        else if (type === 'feeding')  content = feedingHtml(period, range);
        else content = wqSummaryHtml(readings, snap, pondCfg, { includeRaw: false }) + feedingHtml(period, range);

        return `<div class="pond-section">${pondHeader}${content}</div>`;
      }));
      body = sections.join('');
    }

    const combinedBadge = type === 'combined' ? '<span class="badge" style="background:#ede9fe;color:#6d28d9">Water + Feeding</span>' : '';
    const pondBadge     = `<span class="badge" style="background:#e0f2fe;color:#0369a1">${pondLabel}</span>`;

    w.document.open();
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px 28px;color:#0f172a;font-size:13px}
  .badge{display:inline-block;background:#e0f2fe;color:#0369a1;font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;text-transform:uppercase;letter-spacing:.06em;vertical-align:middle;margin-right:6px}
  h1{font-size:18px;margin:4px 0 2px}
  h3{font-size:13px;font-weight:600;margin:20px 0 6px;color:#334155;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
  .meta{color:#64748b;font-size:11px;margin-bottom:4px}
  .range{font-size:12px;font-weight:500;margin-bottom:18px;color:#0f172a}
  table{border-collapse:collapse;width:100%;margin-bottom:4px}
  td,th{border:1px solid #e2e8f0;padding:7px 10px;text-align:left;white-space:nowrap}
  thead th{background:#f1f5f9;font-weight:600}
  tbody tr:nth-child(even){background:#f8fafc}
  .pond-section{margin-bottom:32px}
  .pond-section-header{display:flex;align-items:center;gap:8px;background:#f1f5f9;border-left:3px solid #3b82f6;padding:8px 12px;border-radius:0 6px 6px 0;margin-bottom:10px;font-weight:700;font-size:13px}
  .pond-section-name{font-size:14px;font-weight:700;color:#0f172a}
  @media print{body{padding:12px 14px}thead{display:table-header-group}.pond-section{page-break-inside:avoid}}
</style></head><body>
  <div><span class="badge">${periodLabel}</span><span class="badge" style="background:#f0fdf4;color:#166534">${typeLabel}</span>${combinedBadge}${pondBadge}</div>
  <h1>${title}</h1>
  <div class="meta">Generated: ${new Date().toLocaleString()}</div>
  <div class="range">Period: ${range.label}</div>
  <div class="meta" style="margin-bottom:18px">Firebase: ${snap.status||'—'}</div>
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
          <div class="rpt-history-meta">${h.period} · ${h.dateRange} · ${h.pondLabel || 'All Ponds'} · ${h.generatedAt}</div>
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
            await openPrintableReport({ period: h.period, type: h.type, customFrom: h.customFrom, customTo: h.customTo });
          } else {
            const csv = await buildCsv({ period: h.period, type: h.type, customFrom: h.customFrom, customTo: h.customTo });
            const ext = h.format === 'xlsx' ? 'xlsx' : 'csv';
            downloadBlob(`${h.type}_${h.period}_${getNowStamp()}.${ext}`, new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8' }));
          }
        } finally { btn.disabled = false; }
      });
    });
  }

  function recordHistory({ period, type, format, range, customFrom, customTo }) {
    const periodLabel = { daily:'Daily', weekly:'Weekly', monthly:'Monthly', custom:'Custom' }[period] ?? period;
    const typeLabel   = { 'water-quality':'Water Quality', feeding:'Feeding', combined:'Combined' }[type] ?? type;
    const pond = getReportPond();
    const pondLabel = pond ? (pond.name || pond.id) : 'All Ponds';
    addToHistory({
      title: `${periodLabel} ${typeLabel} Report`,
      period, type, format,
      dateRange: range.label,
      pondLabel,
      pondId: pond?.id || 'all',
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
      await openPrintableReport({ period, type });
      recordHistory({ period, type, format: 'pdf', range });
      return;
    }
    const csv = await buildCsv({ period, type });
    const ext = format === 'xlsx' ? 'xlsx' : 'csv';
    downloadBlob(`${type}_${period}_${stamp}.${ext}`, new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8' }));
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
      const csv = await buildCsv({ period:'custom', type, customFrom: from, customTo: to });
      downloadBlob(`${type}_custom_${getNowStamp()}.csv`, new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8' }));
      recordHistory({ period:'custom', type, format:'csv', range, customFrom: from, customTo: to });
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
    try {
      await openPrintableReport({ period:'custom', type, customFrom: from, customTo: to });
      recordHistory({ period:'custom', type, format:'pdf', range, customFrom: from, customTo: to });
    } finally { btn.disabled = false; }
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
