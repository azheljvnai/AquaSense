/**
 * Historical Data feature: weekly chart and range selector.
 * Threshold editing is restricted to admin and owner roles.
 */
import { initHistoricalChart } from '../charts.js';
import { getThresholds, saveThresholds, resetThresholds } from '../utils.js';

function canEditThresholds() {
  const perms = window._rbacPerms;
  return !perms || perms.canEditThresholds;
}

export function init() {
  const histEl = document.getElementById('hist-chart');
  if (histEl) initHistoricalChart(histEl);

  const btn = document.getElementById('btn-edit-thresholds');
  const dlg = document.getElementById('thresh-dlg');
  const form = document.getElementById('thresh-form');
  if (!btn || !dlg || !form) return;

  const inputs = Array.from(form.querySelectorAll('input[data-th]'));

  function setByPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      cur = cur[parts[i]];
      if (!cur) return;
    }
    const last = parts[parts.length - 1];
    cur[last] = value;
  }

  function getByPath(obj, path) {
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
      cur = cur?.[p];
    }
    return cur;
  }

  function populate() {
    const t = getThresholds();
    for (const input of inputs) {
      const path = input.getAttribute('data-th') || '';
      const v = getByPath(t, path);
      input.value = typeof v === 'number' ? String(v) : '';
    }
  }

  function readForm() {
    const next = JSON.parse(JSON.stringify(getThresholds()));
    for (const input of inputs) {
      const path = input.getAttribute('data-th') || '';
      const n = Number(input.value);
      if (!Number.isFinite(n)) continue;
      setByPath(next, path, n);
    }
    return next;
  }

  btn.addEventListener('click', () => {
    if (!canEditThresholds()) {
      alert('Access denied: Owner or Admin required to edit thresholds.');
      return;
    }
    populate();
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else alert('Your browser does not support this dialog UI.');
  });

  document.getElementById('btn-thresh-cancel')?.addEventListener('click', () => dlg.close());

  document.getElementById('btn-thresh-reset')?.addEventListener('click', () => {
    resetThresholds();
    populate();
    window.dispatchEvent(new CustomEvent('thresholds-changed'));
  });

  document.getElementById('btn-thresh-save')?.addEventListener('click', () => {
    saveThresholds(readForm());
    window.dispatchEvent(new CustomEvent('thresholds-changed'));
    dlg.close();
  });
}
