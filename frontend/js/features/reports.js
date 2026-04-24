/**
 * Reports feature: Daily/Weekly/Monthly Water Quality and Feeding Report tabs.
 * Download/generate is restricted to admin and owner roles.
 *
 * Historical sensor data is read from the persistent store in utils.js
 * (localStorage-backed, populated on every Firebase sensor update).
 */
import { getHistoryRange } from '../utils.js';

export function init() {
  document.querySelectorAll('.tab-btn[data-report-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-report-tab');
      const container = btn.closest('.report-tabs');
      if (!container) return;
      container.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      container.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      const content = document.getElementById('tab-' + tab);
      if (content) content.classList.add('active');
    });
  });

  // -------------------------------------------------------------------------
  // Date range helpers
  // -------------------------------------------------------------------------

  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function fmtTime(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
  function fmtDateTime(d) { return `${fmtDate(d)} ${fmtTime(d)}`; }

  /**
   * Returns { from: Date, to: Date, label: string } for a given period.
   * Weekly is always Mon 00:00:00 → Sun 23:59:59 of the current week.
   */
  function getDateRange(period, customFrom, customTo) {
    const now = new Date();

    if (period === 'daily') {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      return { from: start, to: end, label: `Today (${fmtDate(now)})` };
    }

    if (period === 'weekly') {
      // Monday of current week
      const day = now.getDay(); // 0=Sun … 6=Sat
      const diffToMon = (day === 0 ? -6 : 1 - day);
      const mon = new Date(now);
      mon.setDate(now.getDate() + diffToMon);
      mon.setHours(0, 0, 0, 0);
      // Sunday of current week
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      sun.setHours(23, 59, 59, 999);
      return { from: mon, to: sun, label: `This week (${fmtDate(mon)} Mon – ${fmtDate(sun)} Sun)` };
    }

    if (period === 'monthly') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return { from: start, to: end, label: `This month (${fmtDate(start)} – ${fmtDate(end)})` };
    }

    if (period === 'custom' && customFrom && customTo) {
      const start = new Date(customFrom + 'T00:00:00');
      const end = new Date(customTo + 'T23:59:59');
      return { from: start, to: end, label: `${customFrom} – ${customTo}` };
    }

    // fallback: today
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    return { from: start, to: end, label: fmtDate(now) };
  }

  // -------------------------------------------------------------------------
  // Sensor data helpers
  // -------------------------------------------------------------------------

  function getLiveSnapshot() {
    const read = (id) => (document.getElementById(id)?.textContent || '').trim();
    return {
      ph: read('v-ph'),
      do: read('v-do'),
      turb: read('v-turb'),
      temp: read('v-temp'),
      device: '',
      status: (document.getElementById('fb-lbl')?.textContent || '').trim(),
    };
  }

  function stats(readings, key) {
    const nums = readings.map((r) => r[key]).filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (!nums.length) return null;
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    return {
      avg: avg.toFixed(2),
      min: Math.min(...nums).toFixed(2),
      max: Math.max(...nums).toFixed(2),
      count: nums.length,
    };
  }

  // -------------------------------------------------------------------------
  // CSV builder
  // -------------------------------------------------------------------------

  function buildCsv({ period, type, customFrom, customTo }) {
    const range = getDateRange(period, customFrom, customTo);
    const readings = getHistoryRange(range.from.getTime(), range.to.getTime());
    const snap = getLiveSnapshot();

    const rows = [
      ['report_type', type === 'water-quality' ? 'Water Quality' : 'Feeding'],
      ['period', period],
      ['date_range', range.label],
      ['generated_at', new Date().toISOString()],
      ['firebase_status', snap.status],
      [],
    ];

    if (type === 'water-quality') {
      // Summary section
      rows.push(['--- SUMMARY ---']);
      rows.push(['metric', 'current', 'avg', 'min', 'max', 'samples']);
      const metrics = [
        { key: 'ph',   label: 'pH' },
        { key: 'do',   label: 'Dissolved Oxygen (mg/L)' },
        { key: 'turb', label: 'Turbidity (NTU)' },
        { key: 'temp', label: 'Temperature (°C)' },
      ];
      const currentMap = { ph: snap.ph, do: snap.do, turb: snap.turb, temp: snap.temp };
      for (const m of metrics) {
        const s = stats(readings, m.key);
        rows.push([m.label, currentMap[m.key], s?.avg ?? '—', s?.min ?? '—', s?.max ?? '—', s?.count ?? 0]);
      }

      // Raw data section
      rows.push([]);
      rows.push(['--- RAW READINGS ---']);
      rows.push(['timestamp', 'pH', 'dissolved_oxygen_mg_L', 'turbidity_NTU', 'temperature_C']);
      for (const r of readings) {
        rows.push([
          fmtDateTime(new Date(r.ts)),
          r.ph?.toFixed(2) ?? '',
          r.do?.toFixed(2) ?? '',
          r.turb?.toFixed(2) ?? '',
          r.temp?.toFixed(2) ?? '',
        ]);
      }
      if (!readings.length) rows.push(['(no readings recorded for this period)']);
    } else {
      // Feeding — static aggregates (feeding data not yet tracked per-reading)
      rows.push(['metric', 'value']);
      rows.push(['period_label', range.label]);
      if (period === 'daily') {
        rows.push(['scheduled_feedings', '4']);
        rows.push(['completed_feedings', '2']);
        rows.push(['total_feed_kg', '55']);
        rows.push(['feed_efficiency_pct', '93']);
      } else if (period === 'weekly') {
        rows.push(['avg_daily_feed_kg', '86.4']);
        rows.push(['total_feed_kg', '604.8']);
        rows.push(['feed_efficiency_pct', '93']);
        rows.push(['days_in_week', '7']);
      } else if (period === 'monthly') {
        rows.push(['avg_daily_feed_kg', '86.4']);
        rows.push(['total_feed_kg', String((86.4 * new Date(range.to.getFullYear(), range.to.getMonth() + 1, 0).getDate()).toFixed(1))]);
        rows.push(['feed_efficiency_pct', '93']);
        rows.push(['days_in_month', String(new Date(range.to.getFullYear(), range.to.getMonth() + 1, 0).getDate())]);
      }
    }

    return rows
      .map((r) => r.map((c) => `"${String(c ?? '').replaceAll('"', '""')}"`).join(','))
      .join('\n');
  }

  // -------------------------------------------------------------------------
  // Printable HTML report builder
  // -------------------------------------------------------------------------

  function buildWqSummaryRows(readings, snap) {
    const metrics = [
      { key: 'ph',   label: 'pH',                    current: snap.ph },
      { key: 'do',   label: 'Dissolved O₂ (mg/L)',   current: snap.do },
      { key: 'turb', label: 'Turbidity (NTU)',        current: snap.turb },
      { key: 'temp', label: 'Temperature (°C)',       current: snap.temp },
    ];
    return metrics.map((m) => {
      const s = stats(readings, m.key);
      return `<tr>
        <td>${m.label}</td>
        <td>${m.current || '—'}</td>
        <td>${s?.avg ?? '—'}</td>
        <td>${s?.min ?? '—'}</td>
        <td>${s?.max ?? '—'}</td>
        <td>${s?.count ?? 0}</td>
      </tr>`;
    }).join('');
  }

  function buildRawRows(readings) {
    if (!readings.length) return '<tr><td colspan="5" style="color:#64748b;font-style:italic">No readings recorded for this period.</td></tr>';
    return readings.map((r) => `<tr>
      <td>${fmtDateTime(new Date(r.ts))}</td>
      <td>${r.ph?.toFixed(2) ?? '—'}</td>
      <td>${r.do?.toFixed(2) ?? '—'}</td>
      <td>${r.turb?.toFixed(2) ?? '—'}</td>
      <td>${r.temp?.toFixed(2) ?? '—'}</td>
    </tr>`).join('');
  }

  function buildFeedingRows(period, range) {
    const daysInMonth = new Date(range.to.getFullYear(), range.to.getMonth() + 1, 0).getDate();
    if (period === 'daily') return `
      <tr><th>Scheduled Feedings</th><td>4</td></tr>
      <tr><th>Completed Feedings</th><td>2</td></tr>
      <tr><th>Total Feed Dispensed</th><td>55 kg</td></tr>
      <tr><th>Feed Efficiency</th><td>93%</td></tr>
      <tr><th>Stock Remaining</th><td>1,250 kg (~14 days)</td></tr>`;
    if (period === 'weekly') return `
      <tr><th>Days in Week</th><td>7</td></tr>
      <tr><th>Avg Daily Feed</th><td>86.4 kg/day</td></tr>
      <tr><th>Total Feed Dispensed</th><td>604.8 kg</td></tr>
      <tr><th>Feed Efficiency</th><td>93%</td></tr>
      <tr><th>Stock Remaining</th><td>1,250 kg (~14 days)</td></tr>`;
    if (period === 'monthly') return `
      <tr><th>Days in Month</th><td>${daysInMonth}</td></tr>
      <tr><th>Avg Daily Feed</th><td>86.4 kg/day</td></tr>
      <tr><th>Total Feed Dispensed</th><td>${(86.4 * daysInMonth).toFixed(1)} kg</td></tr>
      <tr><th>Feed Efficiency</th><td>93%</td></tr>
      <tr><th>Stock Remaining</th><td>1,250 kg (~14 days)</td></tr>`;
    return `<tr><th>Period</th><td>${range.label}</td></tr>`;
  }

  function openPrintableReport({ period, type, customFrom, customTo }) {
    const range = getDateRange(period, customFrom, customTo);
    const readings = getHistoryRange(range.from.getTime(), range.to.getTime());
    const snap = getLiveSnapshot();

    const w = window.open('', '_blank');
    if (!w) { alert('Popup blocked. Allow popups to print/save as PDF.'); return; }

    const periodLabel = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', custom: 'Custom' }[period]
      ?? (period.charAt(0).toUpperCase() + period.slice(1));
    const typeLabel = type === 'water-quality' ? 'Water Quality' : 'Feeding';
    const title = `${periodLabel} ${typeLabel} Report`;

    const bodyContent = type === 'water-quality' ? `
      <h2>Summary</h2>
      <table>
        <thead><tr><th>Metric</th><th>Current</th><th>Avg</th><th>Min</th><th>Max</th><th>Samples</th></tr></thead>
        <tbody>${buildWqSummaryRows(readings, snap)}</tbody>
      </table>

      <h2 style="margin-top:28px">Raw Readings <span class="count">(${readings.length} records)</span></h2>
      <table>
        <thead><tr><th>Timestamp</th><th>pH</th><th>DO (mg/L)</th><th>Turbidity (NTU)</th><th>Temp (°C)</th></tr></thead>
        <tbody>${buildRawRows(readings)}</tbody>
      </table>
    ` : `
      <h2>Feeding Summary</h2>
      <table class="narrow">
        <tbody>${buildFeedingRows(period, range)}</tbody>
      </table>
    `;

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px 28px;color:#0f172a;font-size:13px}
    .badge{display:inline-block;background:#e0f2fe;color:#0369a1;font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;text-transform:uppercase;letter-spacing:.06em;vertical-align:middle;margin-right:6px}
    h1{font-size:18px;margin:4px 0 2px}
    h2{font-size:13px;font-weight:600;margin:20px 0 6px;color:#334155}
    .meta{color:#64748b;font-size:11px;margin-bottom:4px}
    .range{font-size:12px;font-weight:500;margin-bottom:18px;color:#0f172a}
    .count{font-weight:400;color:#64748b}
    table{border-collapse:collapse;width:100%;margin-bottom:4px}
    table.narrow{max-width:420px}
    td,th{border:1px solid #e2e8f0;padding:7px 10px;text-align:left;white-space:nowrap}
    thead th{background:#f1f5f9;font-weight:600}
    tbody tr:nth-child(even){background:#f8fafc}
    @media print{body{padding:12px 14px}thead{display:table-header-group}}
  </style>
</head>
<body>
  <div><span class="badge">${periodLabel}</span><span class="badge" style="background:#f0fdf4;color:#166534">${typeLabel}</span></div>
  <h1>${title}</h1>
  <div class="meta">Generated: ${new Date().toLocaleString()}</div>
  <div class="range">Period: ${range.label}</div>
  <div class="meta">Firebase: ${snap.status || '—'}</div>
  ${bodyContent}
  <script>setTimeout(()=>window.print(),300);<\/script>
</body>
</html>`;

    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  // -------------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------------

  function getNowStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  function downloadBlob(filename, blob) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }

  function handleDownload(entryEl, format) {
    const period = entryEl.getAttribute('data-report-period') || 'daily';
    const type   = entryEl.getAttribute('data-report-type')   || 'water-quality';
    const stamp  = getNowStamp();
    const base   = `${type}_${period}_${stamp}`;

    if (format === 'pdf') {
      openPrintableReport({ period, type });
      return;
    }
    const csv = buildCsv({ period, type });
    const filename = format === 'xlsx' ? `${base}.xlsx` : `${base}.csv`;
    downloadBlob(filename, new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
  }

  // -------------------------------------------------------------------------
  // Event wiring
  // -------------------------------------------------------------------------

  document.querySelectorAll('.report-entry [data-report-format]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const perms = window._rbacPerms;
      if (perms && !perms.canDownloadReports) {
        alert('Access denied: Owner or Admin required to download reports.');
        return;
      }
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
    const type = document.getElementById('custom-report-type')?.value === 'feeding' ? 'feeding' : 'water-quality';
    const csv  = buildCsv({ period: 'custom', type, customFrom: from, customTo: to });
    downloadBlob(`${type}_custom_${getNowStamp()}.csv`, new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
  });

  // Custom PDF
  document.getElementById('btn-custom-generate-pdf')?.addEventListener('click', () => {
    const perms = window._rbacPerms;
    if (perms && !perms.canDownloadReports) { alert('Access denied: Owner or Admin required.'); return; }
    const from = document.getElementById('custom-from')?.value;
    const to   = document.getElementById('custom-to')?.value;
    if (!from || !to) { alert('Please select both a From and To date.'); return; }
    if (new Date(from) > new Date(to)) { alert('From date must be before To date.'); return; }
    const type = document.getElementById('custom-report-type')?.value === 'feeding' ? 'feeding' : 'water-quality';
    openPrintableReport({ period: 'custom', type, customFrom: from, customTo: to });
  });
}
