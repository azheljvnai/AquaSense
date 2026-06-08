import { fbGetIdToken } from '../firebase-client.js';
import { showConfirmModal, escHtml, showAppToast } from '../ui/modal-ui.js';
import { EVENT_TYPE_GROUPS, SEVERITY_CHIPS, SOURCE_CHIPS } from '../constants/log-constants.js';
import { createLog } from '../services/system-log.js';
import { loadUsers, getUsersList } from './user-management.js';
import { EVAL_RESPONDENTS, SYSTEM_LOG_USER_FILTER_SYSTEM } from '../constants/eval-users.js';
import { setFarmUsersForLogs, formatLogUser } from '../services/log-user-display.js';

const PAGE_SIZE = 25;
const state = {
  items: [],
  nextCursor: null,
  hasMore: false,
  cursorStack: [],
  currentCursor: null,
  loading: false,
  totalCount: null,
  totalPages: null,
  error: null,
  indexNotice: null,
  fetchAbort: null,
  summaryAbort: null,
  fetchGeneration: 0,
  expandedId: null,
  sort: { key: 'createdAt', dir: 'desc' },
  lastAppliedKey: '',
  pending: { search: '', datePreset: '', from: '', to: '', severities: [], sources: [], users: [], eventType: '' },
  summary: { total: null, error: null, warning: null, critical: null },
};

const multiMeta = {
  severity: { optionsId: 'sl-severity-options', triggerId: 'sl-severity-trigger' },
  source: { optionsId: 'sl-source-options', triggerId: 'sl-source-trigger' },
  user: { optionsId: 'sl-user-options', triggerId: 'sl-user-trigger' },
};

function getPerms() { return window._rbacPerms || {}; }
function normalizeList(list) { return [...new Set((Array.isArray(list) ? list : []).filter(Boolean).map(String))]; }
function parseDateYmd(ymd) {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
}
function dayMs(ymd, end = false) {
  const p = parseDateYmd(ymd);
  if (!p) return null;
  return end ? new Date(p.y, p.m, p.d, 23, 59, 59, 999).getTime() : new Date(p.y, p.m, p.d, 0, 0, 0, 0).getTime();
}
function formatDateYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function formatTs(ms) { return ms == null || !Number.isFinite(ms) ? '-' : new Date(ms).toLocaleString(); }
function severityClass(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'critical') return 'sl-badge sl-badge--critical';
  if (v === 'error') return 'sl-badge sl-badge--error';
  if (v === 'warning') return 'sl-badge sl-badge--warning';
  return 'sl-badge sl-badge--info';
}
function filterParams(filters = state.pending) {
  const p = new URLSearchParams();
  if (filters.search.trim()) p.set('q', filters.search.trim());
  if (filters.eventType) p.set('eventType', filters.eventType);
  if (filters.severities.length) p.set('severity', normalizeList(filters.severities).join(','));
  if (filters.sources.length) p.set('source', normalizeList(filters.sources).join(','));
  if (filters.users.length) p.set('userId', normalizeList(filters.users).join(','));
  if (filters.from) p.set('from', String(dayMs(filters.from, false)));
  if (filters.to) p.set('to', String(dayMs(filters.to, true)));
  return p;
}
function currentFilterKey() { return filterParams().toString(); }
function matchesApplied() { return currentFilterKey() === state.lastAppliedKey; }

function syncDatePresetUi() {
  document.getElementById('sl-custom-dates')?.classList.toggle('is-hidden', state.pending.datePreset !== 'custom');
}
function applyDatePreset(preset) {
  if (!preset || preset === 'custom') {
    if (!preset) { state.pending.from = ''; state.pending.to = ''; }
    return;
  }
  const end = new Date();
  const start = new Date();
  if (preset === 'today') {
    state.pending.from = formatDateYmd(end);
    state.pending.to = formatDateYmd(end);
  } else if (preset === '7d') {
    start.setDate(start.getDate() - 6);
    state.pending.from = formatDateYmd(start);
    state.pending.to = formatDateYmd(end);
  } else if (preset === '30d') {
    start.setDate(start.getDate() - 29);
    state.pending.from = formatDateYmd(start);
    state.pending.to = formatDateYmd(end);
  } else if (preset === 'eval') {
    state.pending.from = '2026-05-25';
    state.pending.to = '2026-05-28';
  }
}
function validateDates() {
  if (state.pending.datePreset === 'custom') {
    if (!state.pending.from || !state.pending.to) return 'Choose a start and end date for your custom range.';
  }
  if ((state.pending.from && !state.pending.to) || (!state.pending.from && state.pending.to)) {
    return 'Choose both start and end dates, or clear the date fields.';
  }
  if (state.pending.from && state.pending.to && state.pending.from > state.pending.to) return 'Start date must be on or before the end date.';
  return null;
}

function updateSortIndicators() {
  ['createdAt', 'severity', 'source', 'user', 'description'].forEach((key) => {
    const el = document.getElementById(`sl-sort-${key}`);
    if (!el) return;
    el.textContent = state.sort.key === key ? (state.sort.dir === 'asc' ? '↑' : '↓') : '';
  });
}
function compareRows(a, b) {
  const mul = state.sort.dir === 'asc' ? 1 : -1;
  if (state.sort.key === 'createdAt') return ((a.createdAt || 0) - (b.createdAt || 0)) * mul;
  if (state.sort.key === 'severity') {
    const order = { critical: 4, error: 3, warning: 2, info: 1 };
    return ((order[a.severity] || 0) - (order[b.severity] || 0)) * mul;
  }
  if (state.sort.key === 'source') return String(a.source || '').localeCompare(String(b.source || '')) * mul;
  if (state.sort.key === 'user') return formatLogUser(a).localeCompare(formatLogUser(b)) * mul;
  return String(a.description || '').localeCompare(String(b.description || '')) * mul;
}

function renderTable() {
  const tbody = document.getElementById('sl-tbody');
  if (!tbody) return;
  document.getElementById('sl-table-card')?.classList.toggle('is-loading', state.loading && state.items.length > 0);
  const err = document.getElementById('sl-error');
  if (err) {
    const msg = state.error || state.indexNotice;
    err.style.display = msg ? '' : 'none';
    err.textContent = msg || '';
    err.classList.toggle('sl-error-banner--info', !state.error && !!state.indexNotice);
  }

  if (state.loading && !state.items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="sl-empty">Loading logs...</td></tr>';
    return;
  }
  if (state.error && !state.items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="sl-empty">Could not load logs. Use Refresh to retry.</td></tr>';
    return;
  }
  if (!state.items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="sl-empty">No logs match your filters.</td></tr>';
    return;
  }

  const view = [...state.items].sort(compareRows);
  const html = [];
  view.forEach((item) => {
    const expanded = state.expandedId === item.id;
    html.push(`
      <tr class="sl-row ${expanded ? 'is-expanded' : ''}" data-id="${escHtml(item.id)}" tabindex="0" role="button" aria-expanded="${expanded ? 'true' : 'false'}">
        <td class="sl-ts">${escHtml(formatTs(item.createdAt))}</td>
        <td><span class="${severityClass(item.severity)}">${escHtml(item.severity || '')}</span></td>
        <td>${escHtml(item.source || '')}</td>
        <td>${escHtml(formatLogUser(item))}</td>
        <td class="sl-desc">${escHtml(item.description || '')}</td>
      </tr>
    `);
    if (expanded) {
      const meta = item.metadata && Object.keys(item.metadata).length ? JSON.stringify(item.metadata, null, 2) : '-';
      html.push(`
        <tr class="sl-row-details"><td colspan="5">
          <div class="sl-detail-inline">
            <div class="sl-detail-inline-grid">
              <div><span class="sl-detail-label">Event type</span><span class="sl-mono">${escHtml(item.eventType || '-')}</span></div>
              <div><span class="sl-detail-label">User ID</span><span class="sl-mono">${escHtml(item.userId || '-')}</span></div>
            </div>
            <div class="sl-detail-inline-block"><span class="sl-detail-label">Metadata</span><pre class="sl-meta-pre">${escHtml(meta)}</pre></div>
          </div>
        </td></tr>
      `);
    }
  });
  tbody.innerHTML = html.join('');
  tbody.querySelectorAll('.sl-row').forEach((row) => {
    row.addEventListener('click', () => {
      const id = row.getAttribute('data-id');
      state.expandedId = state.expandedId === id ? null : id;
      renderTable();
    });
  });
  updateSortIndicators();
}

function renderPagination() {
  const pageNum = state.cursorStack.length + 1;
  const prev = document.getElementById('sl-prev');
  const next = document.getElementById('sl-next');
  const page = document.getElementById('sl-page-label');
  const range = document.getElementById('sl-range-label');
  if (prev) prev.disabled = state.cursorStack.length === 0 || state.loading;
  if (next) next.disabled = !state.hasMore || state.loading;
  if (page) page.textContent = state.totalPages != null ? `Page ${pageNum} of ${state.totalPages}` : `Page ${pageNum}${state.hasMore ? ' · more available' : ''}`;
  if (range) {
    if (!state.items.length && !state.loading) range.textContent = 'No entries on this page';
    else {
      const start = (pageNum - 1) * PAGE_SIZE + 1;
      const end = (pageNum - 1) * PAGE_SIZE + state.items.length;
      range.textContent = state.totalCount != null
        ? `Showing ${start.toLocaleString()}-${end.toLocaleString()} of ${state.totalCount.toLocaleString()} entries`
        : `Showing ${start.toLocaleString()}-${end.toLocaleString()}${state.hasMore ? ' (more pages available)' : ''}`;
    }
  }
}

function setSummary(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = Number.isFinite(val) ? val.toLocaleString() : '-';
}
function renderSummary() {
  setSummary('sl-summary-total', state.summary.total);
  setSummary('sl-summary-error', state.summary.error);
  setSummary('sl-summary-warning', state.summary.warning);
  setSummary('sl-summary-critical', state.summary.critical);
}

function updateActionButtons() {
  const perms = getPerms();
  document.getElementById('sl-export-csv')?.classList.toggle('is-hidden', !perms.canExportLogs);
  document.getElementById('sl-export-xlsx')?.classList.toggle('is-hidden', !perms.canExportLogs);
  document.getElementById('sl-clear')?.classList.toggle('is-hidden', !perms.canClearLogs);
}

function syncFiltersToUi() {
  const { pending } = state;
  const map = [['sl-search', pending.search], ['sl-date-preset', pending.datePreset], ['sl-date-from', pending.from], ['sl-date-to', pending.to], ['sl-filter-event', pending.eventType]];
  map.forEach(([id, v]) => { const el = document.getElementById(id); if (el) el.value = v; });
  ['severity', 'source', 'user'].forEach((group) => {
    const list = group === 'severity' ? pending.severities : group === 'source' ? pending.sources : pending.users;
    const menu = document.getElementById(multiMeta[group].optionsId);
    if (menu) menu.querySelectorAll('input[type="checkbox"]').forEach((i) => { i.checked = list.includes(i.value); });
  });
  syncDatePresetUi();
}

function updateChips() {
  const wrap = document.getElementById('sl-active-filters');
  if (!wrap) return;
  const chips = [];
  if (state.pending.search) chips.push({ key: 'q', value: '', label: `Search: "${state.pending.search}"` });
  state.pending.severities.forEach((v) => chips.push({ key: 'severity', value: v, label: `Severity: ${v}` }));
  state.pending.sources.forEach((v) => chips.push({ key: 'source', value: v, label: `Source: ${v}` }));
  if (state.pending.eventType) chips.push({ key: 'eventType', value: '', label: `Event: ${state.pending.eventType}` });
  state.pending.users.forEach((v) => chips.push({ key: 'user', value: v, label: `User: ${labelUser(v)}` }));
  if (state.pending.datePreset || state.pending.from || state.pending.to) chips.push({ key: 'dates', value: '', label: `Dates: ${labelDates()}` });
  if (!chips.length) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    return;
  }
  wrap.hidden = false;
  wrap.innerHTML = chips.map((c) => `<span class="sl-active-chip">${escHtml(c.label)}<button type="button" data-clear="${escHtml(c.key)}" data-value="${escHtml(c.value)}">x</button></span>`).join('');
  wrap.querySelectorAll('[data-clear]').forEach((btn) => {
    btn.addEventListener('click', () => {
      clearChip(btn.getAttribute('data-clear'), btn.getAttribute('data-value') || '');
    });
  });
}

function labelUser(id) {
  if (id === SYSTEM_LOG_USER_FILTER_SYSTEM) return 'System (automated)';
  const evalUser = EVAL_RESPONDENTS.find((x) => x.userId === id);
  if (evalUser) return evalUser.userName;
  return getUsersList().find((x) => x.id === id)?.displayName || id;
}
function labelDates() {
  if (state.pending.datePreset && state.pending.datePreset !== 'custom') return state.pending.datePreset;
  if (state.pending.from || state.pending.to) return `${state.pending.from || '...'} - ${state.pending.to || '...'}`;
  return 'All time';
}
function clearChip(key, value) {
  if (key === 'q') state.pending.search = '';
  if (key === 'severity') state.pending.severities = state.pending.severities.filter((x) => x !== value);
  if (key === 'source') state.pending.sources = state.pending.sources.filter((x) => x !== value);
  if (key === 'eventType') state.pending.eventType = '';
  if (key === 'user') state.pending.users = state.pending.users.filter((x) => x !== value);
  if (key === 'dates') { state.pending.datePreset = ''; state.pending.from = ''; state.pending.to = ''; }
  syncFiltersToUi();
  updateChips();
}
function clearAllFilters() {
  state.pending = { search: '', datePreset: '', from: '', to: '', severities: [], sources: [], users: [], eventType: '' };
  syncFiltersToUi();
  updateChips();
}

async function fetchSummary() {
  state.summaryAbort?.abort();
  const controller = new AbortController();
  state.summaryAbort = controller;
  try {
    const token = await fbGetIdToken();
    const resp = await fetch(`/api/system-logs/summary?${filterParams()}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
    if (!resp.ok) throw new Error('summary failed');
    const data = await resp.json();
    state.summary = { total: data.total ?? null, error: data.error ?? null, warning: data.warning ?? null, critical: data.critical ?? null };
  } catch (e) {
    if (e?.name !== 'AbortError') state.summary = { total: null, error: null, warning: null, critical: null };
  } finally {
    renderSummary();
  }
}

async function fetchLogs({ cursor = null, resetStack = false, includeCount = false, suppressValidationToast = false } = {}) {
  const dateErr = validateDates();
  if (dateErr) {
    if (!suppressValidationToast) showAppToast(dateErr, 'error');
    return;
  }
  state.fetchAbort?.abort();
  const controller = new AbortController();
  state.fetchAbort = controller;
  const generation = ++state.fetchGeneration;
  state.loading = true;
  state.error = null;
  if (resetStack) { state.totalCount = null; state.totalPages = null; }
  renderTable();
  renderPagination();
  try {
    const token = await fbGetIdToken();
    const params = filterParams();
    params.set('pageSize', String(PAGE_SIZE));
    if (cursor) params.set('cursor', cursor);
    if (includeCount || (resetStack && !cursor)) params.set('includeCount', '1');
    const resp = await fetch(`/api/system-logs?${params}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
    if (generation !== state.fetchGeneration) return;
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Failed to load logs.');
    state.indexNotice = resp.headers.get('X-System-Logs-Index-Fallback') === '1' ? 'Indexes are still building - results may be slower.' : null;
    state.items = data.items || [];
    state.nextCursor = data.nextCursor || null;
    state.hasMore = !!data.hasMore;
    if (data.totalCount != null) state.totalCount = data.totalCount;
    if (data.totalPages != null) state.totalPages = data.totalPages;
    if (resetStack) {
      state.cursorStack = [];
      state.currentCursor = null;
      state.lastAppliedKey = currentFilterKey();
      state.expandedId = null;
    }
    renderPagination();
    renderTable();
  } catch (e) {
    if (e?.name === 'AbortError' || generation !== state.fetchGeneration) return;
    state.error = e?.message || String(e);
    if (!cursor) state.items = [];
    renderTable();
  } finally {
    if (generation === state.fetchGeneration) {
      state.loading = false;
      renderPagination();
    }
  }
}

async function applyFilters({ includeCount = true, suppressValidationToast = true } = {}) {
  updateChips();
  await Promise.all([fetchLogs({ resetStack: true, includeCount, suppressValidationToast }), fetchSummary()]);
}

async function downloadExport(format) {
  if (!getPerms().canExportLogs) return;
  try {
    const token = await fbGetIdToken();
    const p = filterParams();
    p.set('format', format);
    const resp = await fetch(`/api/system-logs/export?${p}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) throw new Error('Export failed.');
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = format === 'csv' ? 'system-logs.csv' : 'system-logs.xls';
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(e?.message || String(e));
  }
}
async function clearLogs() {
  if (!getPerms().canClearLogs) return;
  const ok = await showConfirmModal({
    title: 'Clear system logs',
    message: 'Delete all logs matching the current filters? This cannot be undone. An audit entry will be recorded.',
    confirmLabel: 'Clear logs',
    variant: 'danger',
  });
  if (!ok) return;
  try {
    const token = await fbGetIdToken();
    const resp = await fetch(`/api/system-logs?${filterParams()}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Clear failed.');
    await applyFilters({ includeCount: true, suppressValidationToast: true });
  } catch (e) {
    alert(e?.message || String(e));
  }
}

function wireMultiselect(group, options) {
  const menu = document.getElementById(multiMeta[group].optionsId);
  const trigger = document.getElementById(multiMeta[group].triggerId);
  if (!menu || !trigger) return;
  menu.innerHTML = options.map((o) => `<label class="sl-multi-option"><input type="checkbox" value="${escHtml(o.value)}" /> <span>${escHtml(o.label)}</span></label>`).join('');
  menu.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', () => {
      const vals = [...menu.querySelectorAll('input[type="checkbox"]:checked')].map((x) => x.value);
      if (group === 'severity') state.pending.severities = normalizeList(vals);
      if (group === 'source') state.pending.sources = normalizeList(vals);
      if (group === 'user') state.pending.users = normalizeList(vals);
      trigger.textContent = vals.length ? `${group[0].toUpperCase() + group.slice(1)}: ${vals.length} selected` : `${group[0].toUpperCase() + group.slice(1)}: All`;
      updateChips();
    });
  });
  trigger.textContent = `${group[0].toUpperCase() + group.slice(1)}: All`;
}

function populateEventSelect() {
  const sel = document.getElementById('sl-filter-event');
  if (!sel) return;
  sel.innerHTML = '<option value="">All event types</option>';
  EVENT_TYPE_GROUPS.forEach((group) => {
    const og = document.createElement('optgroup');
    og.label = group.label;
    group.options.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      og.appendChild(opt);
    });
    sel.appendChild(og);
  });
}
async function populateUserMulti() {
  try {
    await loadUsers();
    setFarmUsersForLogs(getUsersList());
  } catch {
    setFarmUsersForLogs([]);
  }
  const farmUsers = getUsersList().filter((u) => !EVAL_RESPONDENTS.some((e) => e.userId === u.id));
  wireMultiselect('user', [
    { value: SYSTEM_LOG_USER_FILTER_SYSTEM, label: 'System (automated)' },
    ...EVAL_RESPONDENTS.map((r) => ({ value: r.userId, label: r.userName })),
    ...farmUsers.map((u) => ({ value: u.id, label: u.displayName })),
  ]);
}

function wireSortHeaders() {
  document.querySelectorAll('#page-system-logs .sl-sort').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort-key');
      if (!key) return;
      if (state.sort.key === key) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      else state.sort = { key, dir: key === 'createdAt' ? 'desc' : 'asc' };
      renderTable();
    });
  });
}

function toggleAdvancedPanel() {
  const panel = document.getElementById('sl-advanced-panel');
  const btn = document.getElementById('sl-advanced-toggle');
  if (!panel || !btn) return;
  const show = panel.classList.contains('is-hidden');
  panel.classList.toggle('is-hidden', !show);
  btn.setAttribute('aria-expanded', show ? 'true' : 'false');
}

export function loadSystemLogs() {
  if (!getPerms().canViewLogs) return;
  applyFilters({ includeCount: true, suppressValidationToast: true });
}
export function onPageActivated(page) {
  if (page === 'system-logs') {
    updateActionButtons();
    loadSystemLogs();
  }
}
export function init() {
  updateActionButtons();
  wireMultiselect('severity', SEVERITY_CHIPS.map((c) => ({ value: c.value, label: c.label })));
  wireMultiselect('source', SOURCE_CHIPS.map((c) => ({ value: c.value, label: c.label })));
  populateUserMulti();
  populateEventSelect();
  wireSortHeaders();
  renderSummary();

  document.getElementById('sl-search')?.addEventListener('input', (e) => { state.pending.search = e.target.value.trim(); updateChips(); });
  document.getElementById('sl-date-preset')?.addEventListener('change', (e) => { state.pending.datePreset = e.target.value || ''; applyDatePreset(state.pending.datePreset); syncFiltersToUi(); updateChips(); });
  document.getElementById('sl-date-from')?.addEventListener('change', (e) => { state.pending.from = e.target.value || ''; if (state.pending.from || state.pending.to) state.pending.datePreset = 'custom'; syncDatePresetUi(); updateChips(); });
  document.getElementById('sl-date-to')?.addEventListener('change', (e) => { state.pending.to = e.target.value || ''; if (state.pending.from || state.pending.to) state.pending.datePreset = 'custom'; syncDatePresetUi(); updateChips(); });
  document.getElementById('sl-filter-event')?.addEventListener('change', (e) => { state.pending.eventType = e.target.value || ''; updateChips(); });
  document.getElementById('sl-advanced-toggle')?.addEventListener('click', toggleAdvancedPanel);
  document.getElementById('sl-apply')?.addEventListener('click', () => applyFilters({ suppressValidationToast: false }));
  document.getElementById('sl-clear-filters')?.addEventListener('click', clearAllFilters);
  document.getElementById('sl-refresh')?.addEventListener('click', () => {
    createLog({ eventType: 'dashboard.refresh', severity: 'info', source: 'user', description: 'System logs table refreshed' });
    applyFilters({ suppressValidationToast: false });
  });
  document.getElementById('sl-prev')?.addEventListener('click', () => {
    if (state.cursorStack.length === 0) return;
    if (!matchesApplied()) return applyFilters();
    state.currentCursor = state.cursorStack.pop() ?? null;
    fetchLogs({ cursor: state.currentCursor });
  });
  document.getElementById('sl-next')?.addEventListener('click', () => {
    if (!state.hasMore || !state.nextCursor) return;
    if (!matchesApplied()) return applyFilters();
    state.cursorStack.push(state.currentCursor);
    state.currentCursor = state.nextCursor;
    fetchLogs({ cursor: state.nextCursor });
  });
  document.getElementById('sl-export-csv')?.addEventListener('click', () => downloadExport('csv'));
  document.getElementById('sl-export-xlsx')?.addEventListener('click', () => downloadExport('xlsx'));
  document.getElementById('sl-clear')?.addEventListener('click', clearLogs);

  state.lastAppliedKey = currentFilterKey();
  window.addEventListener('page-activated', (e) => onPageActivated(e.detail?.page));
}
