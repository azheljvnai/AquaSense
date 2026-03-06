/**
 * Reports feature: Daily/Weekly/Monthly Water Quality and Feeding Report tabs.
 */
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

  function downloadBlob(filename, blob) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }

  function getNowStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  function getLiveSensorSnapshot() {
    const read = (id) => (document.getElementById(id)?.textContent || '').trim();
    return {
      ph: read('v-ph'),
      do: read('v-do'),
      turb: read('v-turb'),
      temp: read('v-temp'),
      device: (document.getElementById('footer')?.textContent || '').includes('DEVICE:') ? (document.getElementById('footer')?.textContent.split('DEVICE:')[1] || '').trim() : '',
      status: (document.getElementById('fb-lbl')?.textContent || '').trim(),
    };
  }

  function buildCsv({ period, type }) {
    const s = getLiveSensorSnapshot();
    const rows = [
      ['report_type', type],
      ['period', period],
      ['generated_at', new Date().toISOString()],
      ['firebase_status', s.status],
      ['device', s.device || ''],
      [],
      ['metric', 'value'],
    ];
    if (type === 'water-quality') {
      rows.push(['ph', s.ph]);
      rows.push(['dissolved_oxygen', s.do]);
      rows.push(['turbidity', s.turb]);
      rows.push(['temperature', s.temp]);
    } else {
      rows.push(['note', 'Feeding report export is UI-only in this demo build']);
    }

    return rows
      .map((r) => r.map((c) => `"${String(c ?? '').replaceAll('"', '""')}"`).join(','))
      .join('\n');
  }

  function openPrintableReport({ period, type }) {
    const s = getLiveSensorSnapshot();
    const w = window.open('', '_blank');
    if (!w) {
      alert('Popup blocked. Allow popups to print/save as PDF.');
      return;
    }

    const title = `${period.toUpperCase()} ${type === 'water-quality' ? 'Water Quality' : 'Feeding'} Report`;
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px;color:#0f172a}
    h1{font-size:20px;margin:0 0 8px}
    .muted{color:#475569;font-size:12px;margin-bottom:16px}
    table{border-collapse:collapse;width:100%;max-width:680px}
    td,th{border:1px solid #e2e8f0;padding:10px 12px;text-align:left}
    th{background:#f8fafc}
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="muted">Generated at ${new Date().toLocaleString()}</div>
  <table>
    <tr><th>Device</th><td>${s.device || ''}</td></tr>
    <tr><th>Firebase status</th><td>${s.status}</td></tr>
    ${
      type === 'water-quality'
        ? `
    <tr><th>pH</th><td>${s.ph}</td></tr>
    <tr><th>Dissolved Oxygen</th><td>${s.do}</td></tr>
    <tr><th>Turbidity</th><td>${s.turb}</td></tr>
    <tr><th>Temperature</th><td>${s.temp}</td></tr>
    `
        : `<tr><th>Note</th><td>Feeding report export is UI-only in this demo build.</td></tr>`
    }
  </table>
  <script>setTimeout(()=>window.print(), 250);<\/script>
</body>
</html>`;

    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function handleDownload(entryEl, format) {
    const period = entryEl.getAttribute('data-report-period') || 'custom';
    const type = entryEl.getAttribute('data-report-type') || 'water-quality';
    const stamp = getNowStamp();
    const base = `${type}_${period}_${stamp}`;

    if (format === 'pdf') {
      openPrintableReport({ period, type });
      return;
    }

    const csv = buildCsv({ period, type });
    const filename = format === 'xlsx' ? `${base}.xlsx` : `${base}.csv`;
    // Excel can open CSV even if extension is .xlsx; keep it simple/no deps.
    downloadBlob(filename, new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
  }

  document.querySelectorAll('.report-entry [data-report-format]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const entry = btn.closest('.report-entry');
      if (!entry) return;
      const format = btn.getAttribute('data-report-format') || 'csv';
      handleDownload(entry, format);
    });
  });

  // Custom: generate a CSV from selected type/range
  const gen = document.getElementById('btn-custom-generate');
  gen?.addEventListener('click', () => {
    const typeSel = document.getElementById('custom-report-type');
    const from = document.getElementById('custom-from');
    const to = document.getElementById('custom-to');
    const type = typeSel?.value === 'feeding' ? 'feeding' : 'water-quality';
    const period = 'custom';
    const stamp = getNowStamp();

    const csv = buildCsv({ period, type }) + `\n\n"from","${from?.value || ''}"\n"to","${to?.value || ''}"\n`;
    downloadBlob(`${type}_custom_${stamp}.csv`, new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
  });
}
