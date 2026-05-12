/**
 * Pure HTML string builders for modals and small UI fragments.
 * Escape all user-controlled text before interpolating into attributes or body.
 */

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Config-management style modal (fixed overlay, flex center).
 * @param {{ id: string; title: string; bodyHtml: string; footerHtml?: string; closeAction: string }} opts
 */
export function flexModalHtml(opts) {
  const { id, title, bodyHtml, footerHtml = '', closeAction } = opts;
  const safeId = escapeHtml(id);
  const safeTitle = escapeHtml(title);
  const footer = footerHtml
    ? `<div class="modal-footer">${footerHtml}</div>`
    : '';
  return `
    <div id="${safeId}" class="modal" style="display:none;">
      <div class="modal-content">
        <div class="modal-header">
          <h2>${safeTitle}</h2>
          <button type="button" class="modal-close" onclick="${closeAction}">&times;</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        ${footer}
      </div>
    </div>
  `;
}

export function alertPondFilterButton(pond, label, active) {
  const esc = escapeHtml(pond);
  const lab = escapeHtml(label);
  return `<button type="button" class="alert-pond-btn${active ? ' active' : ''}" data-pond="${esc}">${lab}</button>`;
}

export function alertEmptyListRow(message) {
  return `
    <div class="alert-row alert-empty-row">
      <svg class="icon icon-20" style="margin-right:8px;opacity:0.4"><use href="#icon-check"/></svg>
      ${escapeHtml(message)}
    </div>`;
}
