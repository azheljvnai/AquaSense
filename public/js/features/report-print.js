/**
 * Mobile-safe print/PDF: open target synchronously on tap, then fill async.
 */

const LOADING_DOC = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Loading report…</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#64748b}</style>
</head><body><p>Loading report…</p></body></html>`;

export function prefersInPagePrint() {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
  const narrow = window.matchMedia?.('(max-width: 768px)')?.matches;
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(navigator.userAgent || '');
  return !!(coarse || narrow || mobileUa);
}

export function shouldAutoPrint() {
  return !prefersInPagePrint();
}

/** Call synchronously inside a click handler — before any await. */
export function openReportPrintTargetSync() {
  if (prefersInPagePrint()) {
    return openReportPrintOverlaySync();
  }
  try {
    const win = window.open('about:blank', '_blank');
    if (win && !win.closed) {
      win.document.open();
      win.document.write(LOADING_DOC);
      win.document.close();
      return { kind: 'window', win };
    }
  } catch {
    // fall through to overlay
  }
  return openReportPrintOverlaySync();
}

function ensurePrintOverlay() {
  let overlay = document.getElementById('report-print-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'report-print-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Report preview');
  overlay.innerHTML = `
    <div class="report-print-shell">
      <div class="report-print-toolbar no-print">
        <p class="report-print-toolbar-title">Report ready</p>
        <div class="report-print-toolbar-actions">
          <button type="button" class="btn btn-primary" id="report-print-btn">Print / Save as PDF</button>
          <button type="button" class="btn btn-outline" id="report-print-close">Close</button>
        </div>
      </div>
      <div class="report-print-scroll" id="report-print-body"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#report-print-close')?.addEventListener('click', () => {
    closeReportPrintTarget({ kind: 'overlay', overlay });
  });
  overlay.querySelector('#report-print-btn')?.addEventListener('click', () => {
    window.print();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeReportPrintTarget({ kind: 'overlay', overlay });
  });

  return overlay;
}

function openReportPrintOverlaySync() {
  const overlay = ensurePrintOverlay();
  const body = document.getElementById('report-print-body');
  if (body) body.innerHTML = '<p class="report-print-loading">Loading report…</p>';
  overlay.classList.add('is-open');
  document.body.classList.add('report-print-open');
  return { kind: 'overlay', overlay };
}

export function closeReportPrintTarget(target) {
  if (!target) return;
  if (target.kind === 'window' && target.win && !target.win.closed) {
    try { target.win.close(); } catch { /* ignore */ }
    return;
  }
  if (target.kind === 'overlay' && target.overlay) {
    target.overlay.classList.remove('is-open');
    document.body.classList.remove('report-print-open');
    const body = document.getElementById('report-print-body');
    if (body) body.innerHTML = '';
  }
}

function mountHtmlInOverlay(html) {
  const body = document.getElementById('report-print-body');
  if (!body) return;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const wrap = document.createElement('div');
  wrap.className = 'report-print-document';
  doc.querySelectorAll('style').forEach((style) => {
    wrap.appendChild(style.cloneNode(true));
  });
  doc.querySelectorAll('body > *').forEach((node) => {
    wrap.appendChild(node.cloneNode(true));
  });
  body.innerHTML = '';
  body.appendChild(wrap);
}

export function writeReportPrintTarget(target, html) {
  if (!target) throw new Error('No print target');
  if (target.kind === 'window') {
    const { win } = target;
    if (!win || win.closed) throw new Error('Print window was closed');
    win.document.open();
    win.document.write(html);
    win.document.close();
    if (win.document?.body) {
      win.document.body.style.margin = '0';
    }
    return;
  }
  mountHtmlInOverlay(html);
}
