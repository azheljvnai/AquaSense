/**
 * Shared modal dialogs and top-of-screen toast notifications.
 */

const TOAST_DURATION_MS = 4000;
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

let _openModalCount = 0;
let _lastFocusedElement = null;
let _toastStack = null;

function raf(cb) {
  const w = typeof window !== 'undefined' ? window : null;
  const fn = (typeof requestAnimationFrame === 'function' && requestAnimationFrame)
    || (w && typeof w.requestAnimationFrame === 'function' && w.requestAnimationFrame)
    || (typeof globalThis !== 'undefined' && typeof globalThis.requestAnimationFrame === 'function' && globalThis.requestAnimationFrame);
  if (typeof fn === 'function') return fn(cb);
  return setTimeout(cb, 0);
}

export function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Toast (top-center, small) ───────────────────────────────────────────────

function _ensureToastStack() {
  if (_toastStack && document.body.contains(_toastStack)) return _toastStack;
  _toastStack = document.createElement('div');
  _toastStack.id = 'app-toast-stack';
  _toastStack.className = 'app-toast-stack';
  _toastStack.setAttribute('aria-live', 'polite');
  _toastStack.setAttribute('aria-atomic', 'false');
  document.body.appendChild(_toastStack);
  return _toastStack;
}

/**
 * Small success/info toast at the top of the viewport (matches config-management pattern).
 * @param {'success'|'error'|'warn'|'info'} type
 */
export function showAppToast(message, type = 'info') {
  const stack = _ensureToastStack();
  const toast = document.createElement('div');
  toast.className = `app-toast app-toast--${type}`;
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  stack.appendChild(toast);

  raf(() => toast.classList.add('app-toast--visible'));

  const dismiss = () => {
    toast.classList.remove('app-toast--visible');
    toast.classList.add('app-toast--leaving');
    setTimeout(() => toast.remove(), 280);
  };

  const timer = setTimeout(dismiss, TOAST_DURATION_MS);
  toast.addEventListener('click', () => {
    clearTimeout(timer);
    dismiss();
  });
}

// ─── Modal body scroll lock ──────────────────────────────────────────────────

function _lockBodyScroll() {
  _openModalCount += 1;
  if (_openModalCount === 1) document.body.classList.add('app-modal-open');
}

function _unlockBodyScroll() {
  _openModalCount = Math.max(0, _openModalCount - 1);
  if (_openModalCount === 0) document.body.classList.remove('app-modal-open');
}

// ─── Focus trap & keyboard ─────────────────────────────────────────────────────

function _getFocusableElements(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(
    (el) => !el.disabled && el.offsetParent !== null && !el.getAttribute('aria-hidden'),
  );
}

function _trapFocus(dlg) {
  const onKeyDown = (e) => {
    if (e.key !== 'Tab') return;
    const focusable = _getFocusableElements(dlg);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  dlg.addEventListener('keydown', onKeyDown);
  return () => dlg.removeEventListener('keydown', onKeyDown);
}

/**
 * Wire ESC, focus trap, scroll lock, and focus restore for any <dialog class="um-modal">.
 */
export function wireAppDialog(dlg, {
  allowEscape = true,
  onClose,
  initialFocusSelector,
} = {}) {
  _lastFocusedElement = document.activeElement;
  _lockBodyScroll();

  const releaseTrap = _trapFocus(dlg);

  const close = () => {
    if (!dlg.open) return;
    dlg.close();
  };

  const cleanup = () => {
    releaseTrap();
    _unlockBodyScroll();
    if (_lastFocusedElement && typeof _lastFocusedElement.focus === 'function') {
      try { _lastFocusedElement.focus(); } catch { /* ignore */ }
    }
    onClose?.();
    setTimeout(() => dlg.remove(), 0);
  };

  dlg.addEventListener('close', cleanup, { once: true });

  if (allowEscape) {
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      close();
    });
  } else {
    dlg.addEventListener('cancel', (e) => e.preventDefault());
  }

  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close();
  });

  const focusEl = initialFocusSelector
    ? dlg.querySelector(initialFocusSelector)
    : _getFocusableElements(dlg)[0];
  if (focusEl) raf(() => focusEl.focus());

  return { close, cleanup };
}

function _variantIcon(variant) {
  const map = {
    danger: 'icon-trash',
    warning: 'icon-warning',
    success: 'icon-check',
    info: 'icon-info',
  };
  return map[variant] || 'icon-info';
}

function _buildModalShell({
  title,
  subtitle,
  bodyHtml,
  variant = 'info',
  footerHtml,
  wide = false,
  dialogId = 'app-modal',
}) {
  const dlg = document.createElement('dialog');
  dlg.className = `um-modal app-modal app-modal--${variant}${wide ? ' um-modal-wide' : ''}`;
  dlg.setAttribute('aria-labelledby', `${dialogId}-title`);
  if (subtitle) dlg.setAttribute('aria-describedby', `${dialogId}-sub`);

  dlg.innerHTML = `
    <div class="um-modal-inner">
      <div class="um-modal-head">
        <div class="app-modal-head-text">
          <div class="app-modal-icon app-modal-icon--${variant}" aria-hidden="true">
            <svg class="icon icon-20"><use href="#${_variantIcon(variant)}"/></svg>
          </div>
          <div>
            <div class="um-modal-title" id="${dialogId}-title">${title}</div>
            ${subtitle ? `<div class="um-modal-sub" id="${dialogId}-sub">${subtitle}</div>` : ''}
          </div>
        </div>
        <button type="button" class="um-modal-close app-modal-close" aria-label="Close">
          <svg class="icon icon-16"><use href="#icon-x"/></svg>
        </button>
      </div>
      <div class="app-modal-body">
        ${bodyHtml}
      </div>
      ${footerHtml ? `<div class="um-modal-footer app-modal-footer">${footerHtml}</div>` : ''}
    </div>`;

  return dlg;
}

/**
 * Alert / info modal with a single OK action.
 */
export function showAlertModal({
  title,
  subtitle = '',
  message,
  variant = 'info',
  okLabel = 'OK',
} = {}) {
  const dlg = _buildModalShell({
    title: escHtml(title),
    subtitle: escHtml(subtitle),
    variant,
    bodyHtml: `<p class="um-confirm-text">${escHtml(message)}</p>`,
    footerHtml: `
      <button type="button" class="btn btn-primary" data-action="ok">${escHtml(okLabel)}</button>`,
  });

  document.body.appendChild(dlg);
  dlg.showModal();
  const { close } = wireAppDialog(dlg, { initialFocusSelector: '[data-action="ok"]' });

  dlg.querySelector('.app-modal-close')?.addEventListener('click', close);
  dlg.querySelector('[data-action="ok"]')?.addEventListener('click', close);

  return { dialog: dlg, close };
}

/**
 * Confirmation modal with async handler, loading + inline error states.
 */
export function showConfirmModal({
  title,
  subtitle = '',
  message,
  messageHtml,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  variant = destructive ? 'danger' : 'warning',
  onConfirm,
} = {}) {
  const body = messageHtml
    ? `<div class="um-confirm-text">${messageHtml}</div>`
    : `<p class="um-confirm-text">${escHtml(message)}</p>`;

  const confirmClass = destructive
    ? 'btn btn-primary um-btn-danger'
    : variant === 'warning'
      ? 'btn btn-primary um-btn-warn'
      : 'btn btn-primary';

  const dlg = _buildModalShell({
    title: escHtml(title),
    subtitle: escHtml(subtitle),
    variant,
    bodyHtml: `${body}<div class="app-modal-error um-error" role="alert" hidden></div>`,
    footerHtml: `
      <button type="button" class="btn btn-outline" data-action="cancel">${escHtml(cancelLabel)}</button>
      <button type="button" class="${confirmClass}" data-action="confirm">${escHtml(confirmLabel)}</button>`,
  });

  document.body.appendChild(dlg);
  dlg.showModal();

  const errEl = dlg.querySelector('.app-modal-error');
  const confirmBtn = dlg.querySelector('[data-action="confirm"]');
  const cancelBtn = dlg.querySelector('[data-action="cancel"]');

  const { close } = wireAppDialog(dlg, { initialFocusSelector: '[data-action="cancel"]' });

  const setError = (msg) => {
    if (!errEl) return;
    if (msg) {
      errEl.textContent = msg;
      errEl.hidden = false;
    } else {
      errEl.textContent = '';
      errEl.hidden = true;
    }
  };

  const setLoading = (loading, label) => {
    if (!confirmBtn) return;
    confirmBtn.disabled = loading;
    cancelBtn.disabled = loading;
    dlg.querySelector('.app-modal-close').disabled = loading;
    if (label) confirmBtn.textContent = label;
  };

  dlg.querySelector('.app-modal-close')?.addEventListener('click', close);
  cancelBtn?.addEventListener('click', close);

  const runConfirm = async () => {
    if (!onConfirm) {
      close();
      return;
    }
    setError('');
    setLoading(true, 'Processing…');
    try {
      await onConfirm({ dialog: dlg, setError, setLoading, close });
      if (dlg.open) close();
    } catch (err) {
      setError(err?.message || String(err));
      setLoading(false, confirmLabel);
    }
  };

  confirmBtn?.addEventListener('click', runConfirm);
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !confirmBtn?.disabled) {
      e.preventDefault();
      runConfirm();
    }
  });

  return { dialog: dlg, close, setError, setLoading };
}
