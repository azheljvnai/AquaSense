/**
 * Styled Excel (SpreadsheetML) and printable HTML for AquaSense reports.
 */

export function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function classifyExcelRow(row, ctx) {
  const first = String(row[0] ?? '').trim();
  if (row.length === 1 && /^---\s+.+\s+---$/.test(first)) {
    ctx.inTable = false;
    return 'Section';
  }
  if (!row.length || row.every((c) => c === '' || c == null)) return 'Data';
  if (!ctx.inTable && row.length >= 2) {
    const looksHeader = row.every((c) => {
      const s = String(c ?? '');
      return /^[a-z][a-z0-9_]*$/i.test(s) || s.includes('(');
    });
    if (looksHeader) {
      ctx.inTable = true;
      return 'Header';
    }
  }
  if (ctx.inTable && row.length >= 2) return 'Data';
  if (row.length === 2) return 'Meta';
  return 'Data';
}

/** Excel-compatible SpreadsheetML with section/header/data styles. */
export function rowsToStyledExcelBlob(rows) {
  const ctx = { inTable: false };
  const styleIds = { Section: 'sSection', Header: 'sHeader', Meta: 'sMeta', Data: 'sData' };
  const rowXml = rows.map((row) => {
    const styleId = styleIds[classifyExcelRow(row, ctx)] || 'sData';
    const cells = row.map((cell) => {
      const v = String(cell ?? '');
      const num = /^-?\d+(\.\d+)?$/.test(v);
      const type = num ? 'Number' : 'String';
      return `<Cell ss:StyleID="${styleId}"><Data ss:Type="${type}">${escapeXml(v)}</Data></Cell>`;
    }).join('');
    return `<Row>${cells}</Row>`;
  }).join('');

  const styles = `
<Styles>
  <Style ss:ID="sSection"><Font ss:Bold="1" ss:Size="12"/><Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/></Style>
  <Style ss:ID="sHeader"><Font ss:Bold="1"/><Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/></Style>
  <Style ss:ID="sMeta"><Font ss:Size="10"/></Style>
  <Style ss:ID="sData"><Font ss:Size="10"/></Style>
</Styles>`;

  const colWidths = [120, 100, 90, 80, 80, 80, 70, 140, 90, 90].map(
    (w, i) => `<Column ss:Index="${i + 1}" ss:Width="${w}"/>`,
  ).join('');

  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${styles}
<Worksheet ss:Name="Report"><Table>${colWidths}${rowXml}</Table></Worksheet>
</Workbook>`;
  return new Blob([xml], { type: 'application/vnd.ms-excel' });
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function statusColor(status) {
  return { Normal: '#166534', Warning: '#b45309', Critical: '#991b1b' }[status] || '#475569';
}

function renderKvTable(rows) {
  if (!rows?.length) return '';
  const body = rows.map(([k, v]) =>
    `<tr><th>${escHtml(k)}</th><td>${escHtml(v)}</td></tr>`,
  ).join('');
  return `<table class="kv-table"><tbody>${body}</tbody></table>`;
}

function renderDataTable(columns, rows, { numericCols = [] } = {}) {
  const head = columns.map((c) => `<th>${escHtml(c)}</th>`).join('');
  const body = rows.length
    ? rows.map((row) => {
      const cells = row.map((cell, i) => {
        const cls = numericCols.includes(i) ? ' class="num"' : '';
        let content = escHtml(cell);
        if (row.length > 2 && i === 2 && typeof cell === 'string' && /Normal|Warning|Critical/.test(cell)) {
          content = `<span style="color:${statusColor(cell)};font-weight:600">${escHtml(cell)}</span>`;
        }
        return `<td${cls}>${content}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('')
    : `<tr><td colspan="${columns.length}" class="empty">No data for this period.</td></tr>`;
  return `<table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/**
 * Build full printable HTML document for browser Print / Save as PDF.
 */
export function buildPrintableHtml({
  title,
  badges = [],
  metaRows = [],
  sections = [],
  footerNotes = [],
  autoPrint = true,
}) {
  const badgeHtml = badges.map((b) =>
    `<span class="badge" style="background:${b.bg};color:${b.color}">${escHtml(b.label)}</span>`,
  ).join('');

  const metaHtml = metaRows.length
    ? `<div class="doc-info">${metaRows.map(([k, v]) =>
      `<div class="doc-info-item"><span class="doc-info-label">${escHtml(k)}</span><span class="doc-info-value">${escHtml(v)}</span></div>`,
    ).join('')}</div>`
    : '';

  const sectionsHtml = sections.map((sec) => {
    let inner = '';
    if (sec.kind === 'kv') inner = renderKvTable(sec.rows);
    else if (sec.kind === 'table') inner = renderDataTable(sec.columns, sec.rows, sec.tableOpts);
    else if (sec.kind === 'note') inner = `<p class="note">${escHtml(sec.text)}</p>`;
    const note = sec.subtitle ? `<p class="section-sub">${escHtml(sec.subtitle)}</p>` : '';
    return `<div class="section-card">
      <div class="section-head">${escHtml(sec.title)}</div>
      ${note}${inner}
    </div>`;
  }).join('');

  const footerHtml = footerNotes.length
    ? `<div class="report-footer">${footerNotes.map((n) => `<p>${escHtml(n)}</p>`).join('')}</div>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:28px 32px;color:#0f172a;font-size:12px;line-height:1.45}
  .brand-bar{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #0ea5e9;padding-bottom:12px;margin-bottom:16px}
  .brand-title{font-size:20px;font-weight:800;letter-spacing:-0.02em;color:#0f172a}
  .brand-sub{font-size:11px;color:#64748b;margin-top:2px}
  .badge{display:inline-block;font-size:10px;font-weight:700;padding:3px 10px;border-radius:99px;text-transform:uppercase;letter-spacing:.05em;vertical-align:middle;margin:0 6px 6px 0}
  h1{font-size:17px;margin:8px 0 4px;font-weight:700}
  .doc-info{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:20px}
  .doc-info-label{display:block;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.04em}
  .doc-info-value{display:block;font-size:12px;font-weight:600;color:#0f172a}
  .section-card{margin-bottom:24px;page-break-inside:avoid}
  .section-head{font-size:13px;font-weight:700;color:#0f172a;border-left:4px solid #0ea5e9;padding:6px 0 6px 12px;background:#f0f9ff;margin-bottom:10px}
  .section-sub{font-size:11px;color:#64748b;margin:-6px 0 10px 12px}
  table{border-collapse:collapse;width:100%;margin-bottom:6px;font-size:11px}
  .kv-table{max-width:480px}
  .kv-table th{width:42%;background:#f8fafc;font-weight:600;text-align:left}
  .data-table thead th{background:#1e293b;color:#f8fafc;font-weight:600}
  td,th{border:1px solid #e2e8f0;padding:8px 10px;text-align:left;vertical-align:top}
  .data-table tbody tr:nth-child(even){background:#f8fafc}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  td.empty{color:#64748b;font-style:italic;text-align:center}
  .note{font-size:10px;color:#64748b;margin:8px 0 0 12px}
  .report-footer{margin-top:28px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:10px;color:#64748b}
  .print-bar{position:sticky;top:0;z-index:10;display:flex;gap:10px;align-items:center;justify-content:center;padding:12px;margin:-28px -32px 20px;background:#0f172a;color:#f8fafc}
  .print-bar button{font:inherit;font-size:14px;font-weight:600;padding:10px 20px;border:none;border-radius:8px;background:#0ea5e9;color:#fff;cursor:pointer}
  @page{margin:14mm 12mm}
  @media print{
    body{padding:0}
    .print-bar,.no-print{display:none!important}
    .section-card{page-break-inside:avoid}
    thead{display:table-header-group}
  }
</style></head><body>
  ${autoPrint ? '' : '<div class="print-bar no-print"><button type="button" onclick="window.print()">Print / Save as PDF</button></div>'}
  <div class="brand-bar">
    <div>
      <div class="brand-title">AquaSense</div>
      <div class="brand-sub">CrayFarm Monitoring Report</div>
    </div>
    <div>${badgeHtml}</div>
  </div>
  <h1>${escHtml(title)}</h1>
  ${metaHtml}
  ${sectionsHtml}
  ${footerHtml}
  ${autoPrint ? '<script>setTimeout(function(){try{window.print();}catch(e){}},400);<\/script>' : ''}
</body></html>`;
}