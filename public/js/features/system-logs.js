export function init() {}
export function loadSystemLogs() {}
export function onPageActivated() {}
/**
 * System Logs dashboard controller.
 */
import { fbGetIdToken, fbFirestore, fbCollection, fbQuery, fbOrderBy, fbLimit, fbOnSnapshot } from '../firebase-client.js';
import { showConfirmModal, escHtml, showAppToast } from '../ui/modal-ui.js';
import { EVENT_TYPE_GROUPS, SEVERITY_CHIPS, SOURCE_CHIPS, SYSTEM_LOGS_COLLECTION } from '../constants/log-constants.js';
import { createLog } from '../services/system-log.js';
import { loadUsers, getUsersList } from './user-management.js';
import { EVAL_RESPONDENTS, SYSTEM_LOG_USER_FILTER_SYSTEM } from '../constants/eval-users.js';
import { setFarmUsersForLogs, formatLogUser } from '../services/log-user-display.js';

const PAGE_SIZE = 25;
const SKELETON_ROWS = 8;

let _items = [];
let _nextCursor = null;
let _hasMore = false;
let _cursorStack = [];
let _currentPageCursor = null;
let _loading = false;
let _error = null;
let _pageActive = false;
let _realtimeUnsub = null;
let _knownIds = new Set();
let _newestLoadedAt = 0;
let _indexNotice = null;
let _totalCount = null;
let _totalPages = null;
let _fetchAbort = null;
let _summaryAbort = null;
let _fetchGeneration = 0;
let _lastAppliedFilterKey = '';
let _expandedRowId = null;
let _sort = { key: 'createdAt', dir: 'desc' };
let _summary = { total: null, error: null, warning: null, critical: null };

const _pendingFilters = { search: '', datePreset: '', from: '', to: '', severities: [], sources: [], users: [], eventType: '' };
const _multiMeta = {
  severity: { detailsId: 'sl-severity-multi', optionsId: 'sl-severity-options', triggerId: 'sl-severity-trigger' },
  source: { detailsId: 'sl-source-multi', optionsId: 'sl-source-options', triggerId: 'sl-source-trigger' },
  user: { detailsId: 'sl-user-multi', optionsId: 'sl-user-options', triggerId: 'sl-user-trigger' },
};

function getPerms() { return window._rbacPerms || {}; }
function normalizeList(list) { return [...new Set((Array.isArray(list) ? list : []).filter(Boolean).map(String))]; }
function getCurrentFilterKey() { return buildFilterParams().toString(); }
function filtersMatchLastApplied() { return getCurrentFilterKey() === _lastAppliedFilterKey; }
function filtersAreActive() { return [...buildFilterParams().keys()].length > 0; }
function formatTimestamp(ms) { return ms == null || !Number.isFinite(ms) ? '-' : new Date(ms).toLocaleString(); }

function parseDateYmd(ymd) {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
}
function startOfLocalDayMs(ymd) {
  const p = parseDateYmd(ymd);
  if (!p) return null;
  return new Date(p.y, p.m, p.d, 0, 0, 0, 0).getTime();
}
function endOfLocalDayMs(ymd) {
  const p = parseDateYmd(ymd);
  if (!p) return null;
  return new Date(p.y, p.m, p.d, 23, 59, 59, 999).getTime();
}
function formatDateYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildFilterParams(filters = _pendingFilters) {
  const p = new URLSearchParams();
  const q = String(filters.search || '').trim();
  if (q) p.set('q', q);
  if (filters.eventType) p.set('eventType', filters.eventType);
  if (filters.severities.length) p.set('severity', normalizeList(filters.severities).join(','));
  if (filters.sources.length) p.set('source', normalizeList(filters.sources).join(','));
  if (filters.users.length) p.set('userId', normalizeList(filters.users).join(','));
  if (filters.from) {
    const fromMs = startOfLocalDayMs(filters.from);
    if (Number.isFinite(fromMs)) p.set('from', String(fromMs));
  }
  if (filters.to) {
    const toMs = endOfLocalDayMs(filters.to);
    if (Number.isFinite(toMs)) p.set('to', String(toMs));
  }
  return p;
}

function severityBadgeClass(severity) {
  const s = String(severity || '').toLowerCase();
  if (s === 'critical') return 'sl-badge sl-badge--critical';
  if (s === 'error') return 'sl-badge sl-badge--error';
  if (s === 'warning') return 'sl-badge sl-badge--warning';
  return 'sl-badge sl-badge--info';
}

function renderSkeletonRows() {
  return Array.from({ length: SKELETON_ROWS }, () => `
    <tr class="sl-skeleton-row">
      <td><span class="sl-skeleton"></span></td>
      <td><span class="sl-skeleton sl-skeleton--short"></span></td>
      <td><span class="sl-skeleton sl-skeleton--short"></span></td>
      <td><span class="sl-skeleton sl-skeleton--short"></span></td>
      <td><span class="sl-skeleton"></span></td>
    </tr>
  `).join('');
}

function compareBySort(a, b) {
  const mul = _sort.dir === 'asc' ? 1 : -1;
  if (_sort.key === 'createdAt') return ((a.createdAt || 0) - (b.createdAt || 0)) * mul;
  if (_sort.key === 'severity') {
    const order = { critical: 4, error: 3, warning: 2, info: 1 };
    return ((order[a.severity] || 0) - (order[b.severity] || 0)) * mul;
  }
  if (_sort.key === 'source') return String(a.source || '').localeCompare(String(b.source || '')) * mul;
  if (_sort.key === 'user') return formatLogUser(a).localeCompare(formatLogUser(b)) * mul;
  return String(a.description || '').localeCompare(String(b.description || '')) * mul;
}

function renderSortIndicators() {
  ['createdAt', 'severity', 'source', 'user', 'description'].forEach((key) => {
    const el = document.getElementById(`sl-sort-${key}`);
    if (!el) return;
    el.textContent = _sort.key === key ? (_sort.dir === 'asc' ? '↑' : '↓') : '';
  });
}

function toggleRowExpansion(id) {
  if (!id) return;
  _expandedRowId = _expandedRowId === id ? null : id;
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('sl-tbody');
  const card = document.getElementById('sl-table-card');
  if (!tbody) return;
  if (card) card.classList.toggle('is-loading', _loading && _items.length > 0);

  const errEl = document.getElementById('sl-error');
  if (errEl) {
    const show = _error || _indexNotice;
    errEl.style.display = show ? '' : 'none';
    errEl.textContent = show || '';
    errEl.classList.toggle('sl-error-banner--info', !_error && !!_indexNotice);
  }

  if (_loading && !_items.length) {
    tbody.innerHTML = renderSkeletonRows();
    renderSortIndicators();
    return;
  }
  if (_error && !_items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="sl-empty">Could not load logs. Use Refresh to retry.</td></tr>';
    renderSortIndicators();
    return;
  }
  if (!_items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="sl-empty">No logs match your filters.</td></tr>';
    renderSortIndicators();
    return;
  }

  const view = [..._items].sort(compareBySort);
  const rows = [];
  view.forEach((item) => {
    const expanded = _expandedRowId === item.id;
    rows.push(`
      <tr class="sl-row ${expanded ? 'is-expanded' : ''}" data-id="${escHtml(item.id)}" tabindex="0" role="button" aria-expanded="${expanded ? 'true' : 'false'}">
        <td class="sl-ts">${escHtml(formatTimestamp(item.createdAt))}</td>
        <td><span class="${severityBadgeClass(item.severity)}">${escHtml(item.severity || '')}</span></td>
        <td>${escHtml(item.source || '')}</td>
        <td>${escHtml(formatLogUser(item))}</td>
        <td class="sl-desc">${escHtml(item.description || '')}</td>
      </tr>
    `);
    if (expanded) {
      const meta = item.metadata && Object.keys(item.metadata).length ? JSON.stringify(item.metadata, null, 2) : '-';
      rows.push(`
        <tr class="sl-row-details">
          <td colspan="5">
            <div class="sl-detail-inline">
              <div class="sl-detail-inline-grid">
                <div><span class="sl-detail-label">Event type</span><span class="sl-mono">${escHtml(item.eventType || '-')}</span></div>
                <div><span class="sl-detail-label">User ID</span><span class="sl-mono">${escHtml(item.userId || '-')}</span></div>
              </div>
              <div class="sl-detail-inline-block">
                <span class="sl-detail-label">Metadata</span>
                <pre class="sl-meta-pre">${escHtml(meta)}</pre>
              </div>
            </div>
          </td>
        </tr>
      `);
    }
  });
  tbody.innerHTML = rows.join('');

  tbody.querySelectorAll('.sl-row').forEach((row) => {
    row.addEventListener('click', () => toggleRowExpansion(row.getAttribute('data-id')));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleRowExpansion(row.getAttribute('data-id'));
      }
    });
  });

  _knownIds = new Set(_items.map((i) => i.id));
  if (_items[0]?.createdAt) _newestLoadedAt = _items[0].createdAt;
  renderSortIndicators();
}

function updatePaginationUi() {
  const prev = document.getElementById('sl-prev');
  const next = document.getElementById('sl-next');
  const pageLabel = document.getElementById('sl-page-label');
  const rangeLabel = document.getElementById('sl-range-label');
  const pageNum = _cursorStack.length + 1;

  if (prev) prev.disabled = _cursorStack.length === 0 || _loading;
  if (next) next.disabled = !_hasMore || _loading;
  if (pageLabel) {
    if (_totalPages != null) pageLabel.textContent = `Page ${pageNum} of ${_totalPages}`;
    else if (_hasMore) pageLabel.textContent = `Page ${pageNum} · more available`;
    else if (pageNum > 1 || _items.length) pageLabel.textContent = `Page ${pageNum}`;
    else pageLabel.textContent = 'No results';
  }
  if (rangeLabel) {
    if (_loading && !_items.length) rangeLabel.textContent = 'Loading logs...';
    else if (!_items.length && !_loading) rangeLabel.textContent = 'No entries on this page';
    else {
      const start = (pageNum - 1) * PAGE_SIZE + 1;
      const end = (pageNum - 1) * PAGE_SIZE + _items.length;
      rangeLabel.textContent = _totalCount != null
        ? `Showing ${start.toLocaleString()}-${end.toLocaleString()} of ${_totalCount.toLocaleString()} entries`
        : `Showing ${start.toLocaleString()}-${end.toLocaleString()}${_hasMore ? ' (more pages available)' : ''}`;
    }
  }
}

function updateActionButtons() {
  const perms = getPerms();
  document.getElementById('sl-export-csv')?.classList.toggle('is-hidden', !perms.canExportLogs);
  document.getElementById('sl-export-xlsx')?.classList.toggle('is-hidden', !perms.canExportLogs);
  document.getElementById('sl-clear')?.classList.toggle('is-hidden', !perms.canClearLogs);
}
function setSummaryValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = Number.isFinite(value) ? value.toLocaleString() : '-';
}
function renderSummary() {
  setSummaryValue('sl-summary-total', _summary.total);
  setSummaryValue('sl-summary-error', _summary.error);
  setSummaryValue('sl-summary-warning', _summary.warning);
  setSummaryValue('sl-summary-critical', _summary.critical);
}

function labelForEvent(value) {
  for (const g of EVENT_TYPE_GROUPS) {
    const found = g.options.find((o) => o.value === value);
    if (found) return found.label;
  }
  return value;
}
function labelForUserFilter(value) {
  if (!value) return 'All users';
  if (value === SYSTEM_LOG_USER_FILTER_SYSTEM) return 'System (automated)';
  const evalMatch = EVAL_RESPONDENTS.find((r) => r.userId === value);
  if (evalMatch) return evalMatch.userName;
  const farm = getUsersList().find((u) => u.id === value);
  return farm?.displayName || value;
}
function labelForDateFilter() {
  const labels = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', eval: 'Evaluation (May 25-28)', custom: 'Custom' };
  if (_pendingFilters.datePreset && _pendingFilters.datePreset !== 'custom') return labels[_pendingFilters.datePreset] || _pendingFilters.datePreset;
  if (_pendingFilters.from && _pendingFilters.to) return `${_pendingFilters.from} - ${_pendingFilters.to}`;
  if (_pendingFilters.from || _pendingFilters.to) return `${_pendingFilters.from || '...'} - ${_pendingFilters.to || '...'}`;
  return 'All time';
}

function updateMultiTrigger(group) {
  const trigger = document.getElementById(_multiMeta[group].triggerId);
  if (!trigger) return;
  const selected = group === 'severity' ? _pendingFilters.severities : group === 'source' ? _pendingFilters.sources : _pendingFilters.users;
  const label = group[0].toUpperCase() + group.slice(1);
  trigger.textContent = selected.length ? `${label}: ${selected.length} selected` : `${label}: All`;
}

function renderMultiOptions(group, options) {
  const menu = document.getElementById(_multiMeta[group].optionsId);
  if (!menu) return;
  const selected = group === 'severity' ? _pendingFilters.severities : group === 'source' ? _pendingFilters.sources : _pendingFilters.users;
  menu.innerHTML = options.map((opt) => `
    <label class="sl-multi-option">
      <input type="checkbox" data-group="${group}" value="${escHtml(opt.value)}" ${selected.includes(opt.value) ? 'checked' : ''} />
      <span>${escHtml(opt.label)}</span>
    </label>
  `).join('');
  menu.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', () => {
      const values = [...menu.querySelectorAll('input[type="checkbox"]:checked')].map((x) => x.value);
      if (group === 'severity') _pendingFilters.severities = normalizeList(values);
      if (group === 'source') _pendingFilters.sources = normalizeList(values);
      if (group === 'user') _pendingFilters.users = normalizeList(values);
      updateMultiTrigger(group);
      updateActiveFilterChips();
    });
  });
  updateMultiTrigger(group);
}

function populateEventSelect() {
  const evt = document.getElementById('sl-filter-event');
  if (!evt) return;
  evt.innerHTML = '<option value="">All event types</option>';
  EVENT_TYPE_GROUPS.forEach((group) => {
    const og = document.createElement('optgroup');
    og.label = group.label;
    group.options.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      og.appendChild(opt);
    });
    evt.appendChild(og);
  });
}
function populateUserMulti() {
  const farmUsers = getUsersList().filter((u) => !EVAL_RESPONDENTS.some((e) => e.userId === u.id));
  const options = [
    { value: SYSTEM_LOG_USER_FILTER_SYSTEM, label: 'System (automated)' },
    ...EVAL_RESPONDENTS.map((r) => ({ value: r.userId, label: r.userName })),
    ...farmUsers.map((u) => ({ value: u.id, label: u.displayName })),
  ];
  renderMultiOptions('user', options);
}
async function loadUserDirectory() {
  try {
    await loadUsers();
    setFarmUsersForLogs(getUsersList());
  } catch (e) {
    console.warn('[SystemLogs] Could not load users for filters:', e);
    setFarmUsersForLogs([]);
  }
  populateUserMulti();
}

function syncDatePresetUi() {
  const custom = document.getElementById('sl-custom-dates');
  if (custom) custom.classList.toggle('is-hidden', _pendingFilters.datePreset !== 'custom');
}
function applyDatePresetValues(preset) {
  if (!preset || preset === 'custom') {
    if (!preset) {
      _pendingFilters.from = '';
      _pendingFilters.to = '';
    }
    return;
  }
  const end = new Date();
  const start = new Date();
  if (preset === 'today') {
    _pendingFilters.from = formatDateYmd(end);
    _pendingFilters.to = formatDateYmd(end);
  } else if (preset === '7d') {
    start.setDate(start.getDate() - 6);
    _pendingFilters.from = formatDateYmd(start);
    _pendingFilters.to = formatDateYmd(end);
  } else if (preset === '30d') {
    start.setDate(start.getDate() - 29);
    _pendingFilters.from = formatDateYmd(start);
    _pendingFilters.to = formatDateYmd(end);
  } else if (preset === 'eval') {
    _pendingFilters.from = '2026-05-25';
    _pendingFilters.to = '2026-05-28';
  }
}
function validateDateRange() {
  if (_pendingFilters.datePreset === 'custom') {
    if (!_pendingFilters.from || !_pendingFilters.to) return 'Choose a start and end date for your custom range.';
    if (_pendingFilters.from > _pendingFilters.to) return 'Start date must be on or before the end date.';
    return null;
  }
  if ((_pendingFilters.from && !_pendingFilters.to) || (!_pendingFilters.from && _pendingFilters.to)) {
    return 'Choose both start and end dates, or clear the date fields.';
  }
  if (_pendingFilters.from && _pendingFilters.to && _pendingFilters.from > _pendingFilters.to) {
    return 'Start date must be on or before the end date.';
  }
  return null;
}
function syncFiltersToUi() {
  const search = document.getElementById('sl-search');
  const preset = document.getElementById('sl-date-preset');
  const from = document.getElementById('sl-date-from');
  const to = document.getElementById('sl-date-to');
  const event = document.getElementById('sl-filter-event');
  if (search) search.value = _pendingFilters.search;
  if (preset) preset.value = _pendingFilters.datePreset;
  if (from) from.value = _pendingFilters.from;
  if (to) to.value = _pendingFilters.to;
  if (event) event.value = _pendingFilters.eventType;
  const syncChecks = (group, vals) => {
    const menu = document.getElementById(_multiMeta[group].optionsId);
    if (!menu) return;
    menu.querySelectorAll('input[type="checkbox"]').forEach((i) => { i.checked = vals.includes(i.value); });
    updateMultiTrigger(group);
  };
  syncChecks('severity', _pendingFilters.severities);
  syncChecks('source', _pendingFilters.sources);
  syncChecks('user', _pendingFilters.users);
  syncDatePresetUi();
}

function clearFilterKey(key, value = '') {
  if (key === 'q') _pendingFilters.search = '';
  if (key === 'severity') _pendingFilters.severities = _pendingFilters.severities.filter((x) => x !== value);
  if (key === 'source') _pendingFilters.sources = _pendingFilters.sources.filter((x) => x !== value);
  if (key === 'eventType') _pendingFilters.eventType = '';
  if (key === 'user') _pendingFilters.users = _pendingFilters.users.filter((x) => x !== value);
  if (key === 'dates') {
    _pendingFilters.datePreset = '';
    _pendingFilters.from = '';
    _pendingFilters.to = '';
  }
  syncFiltersToUi();
  updateActiveFilterChips();
}

function updateActiveFilterChips() {
  const wrap = document.getElementById('sl-active-filters');
  if (!wrap) return;
  const chips = [];
  if (_pendingFilters.search) chips.push({ key: 'q', value: '', label: `Search: "${_pendingFilters.search}"` });
  _pendingFilters.severities.forEach((v) => chips.push({ key: 'severity', value: v, label: `Severity: ${v}` }));
  _pendingFilters.sources.forEach((v) => chips.push({ key: 'source', value: v, label: `Source: ${v}` }));
  if (_pendingFilters.eventType) chips.push({ key: 'eventType', value: '', label: `Event: ${labelForEvent(_pendingFilters.eventType)}` });
  _pendingFilters.users.forEach((v) => chips.push({ key: 'user', value: v, label: `User: ${labelForUserFilter(v)}` }));
  if (_pendingFilters.datePreset || _pendingFilters.from || _pendingFilters.to) chips.push({ key: 'dates', value: '', label: `Dates: ${labelForDateFilter()}` });
  if (!chips.length) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    return;
  }
  wrap.hidden = false;
  wrap.innerHTML = chips.map((c) =>
    `<span class="sl-active-chip">${escHtml(c.label)}<button type="button" data-clear="${escHtml(c.key)}" data-value="${escHtml(c.value)}" aria-label="Remove filter">x</button></span>`
  ).join('');
  wrap.querySelectorAll('[data-clear]').forEach((btn) => {
    btn.addEventListener('click', () => clearFilterKey(btn.getAttribute('data-clear'), btn.getAttribute('data-value') || ''));
  });
}
function clearAllFilters() {
  _pendingFilters.search = '';
  _pendingFilters.datePreset = '';
  _pendingFilters.from = '';
  _pendingFilters.to = '';
  _pendingFilters.severities = [];
  _pendingFilters.sources = [];
  _pendingFilters.users = [];
  _pendingFilters.eventType = '';
  syncFiltersToUi();
  updateActiveFilterChips();
}

async function fetchSummary() {
  _summaryAbort?.abort();
  const controller = new AbortController();
  _summaryAbort = controller;
  try {
    const token = await fbGetIdToken();
    if (!token) throw new Error('Not signed in.');
    const resp = await fetch(`/api/system-logs/summary?${buildFilterParams()}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error('Summary fetch failed.');
    const data = await resp.json();
    _summary = { total: data.total ?? null, error: data.error ?? null, warning: data.warning ?? null, critical: data.critical ?? null };
  } catch (e) {
    if (e?.name !== 'AbortError') _summary = { total: null, error: null, warning: null, critical: null };
  } finally {
    renderSummary();
  }
}

async function fetchLogs({ cursor = null, resetStack = false, includeCount = false, suppressValidationToast = false } = {}) {
  const dateErr = validateDateRange();
  if (dateErr) {
    if (!suppressValidationToast) showAppToast(dateErr, 'error');
    return;
  }
  _fetchAbort?.abort();
  const controller = new AbortController();
  _fetchAbort = controller;
  const generation = ++_fetchGeneration;
  _loading = true;
  _error = null;
  if (resetStack) {
    _totalCount = null;
    _totalPages = null;
  }
  renderTable();
  updatePaginationUi();

  try {
    const token = await fbGetIdToken();
    if (!token) throw new Error('Not signed in.');
    const params = buildFilterParams();
    params.set('pageSize', String(PAGE_SIZE));
    if (cursor) params.set('cursor', cursor);
    if (includeCount || (resetStack && !cursor)) params.set('includeCount', '1');
    const resp = await fetch(`/api/system-logs?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (generation !== _fetchGeneration) return;
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Failed to load logs.');
    _indexNotice = resp.headers.get('X-System-Logs-Index-Fallback') === '1'
      ? 'Indexes are still building - results may load slower until indexes are Enabled.'
      : null;
    _items = data.items || [];
    _nextCursor = data.nextCursor || null;
    _hasMore = !!data.hasMore;
    if (data.totalCount != null) _totalCount = data.totalCount;
    if (data.totalPages != null) _totalPages = data.totalPages;
    if (resetStack) {
      _cursorStack = [];
      _currentPageCursor = null;
      _lastAppliedFilterKey = getCurrentFilterKey();
      _expandedRowId = null;
    }
    updatePaginationUi();
    renderTable();
    setupRealtimeIfEligible();
  } catch (e) {
    if (e?.name === 'AbortError') return;
    if (generation !== _fetchGeneration) return;
    _error = e?.message || String(e);
    if (!cursor) _items = [];
    renderTable();
  } finally {
    if (generation === _fetchGeneration) {
      _loading = false;
      updatePaginationUi();
    }
  }
}

async function applyFilters({ includeCount = true, suppressValidationToast = true } = {}) {
  updateActiveFilterChips();
  await Promise.all([fetchLogs({ resetStack: true, includeCount, suppressValidationToast }), fetchSummary()]);
}

function canUseRealtime() {
  if (!_pageActive) return false;
  if (_cursorStack.length > 0) return false;
  if (filtersAreActive()) return false;
  if (_sort.key !== 'createdAt' || _sort.dir !== 'desc') return false;
  return true;
}
function teardownRealtime() {
  if (_realtimeUnsub) {
    _realtimeUnsub();
    _realtimeUnsub = null;
  }
}
function setupRealtimeIfEligible() {
  teardownRealtime();
  if (!canUseRealtime()) return;
  const fs = fbFirestore();
  if (!fs) return;
  const q = fbQuery(fbCollection(fs, SYSTEM_LOGS_COLLECTION), fbOrderBy('createdAt', 'desc'), fbLimit(15));
  _realtimeUnsub = fbOnSnapshot(q, (snap) => {
    const additions = [];
    snap.docChanges().forEach((change) => {
      if (change.type !== 'added') return;
      const id = change.doc.id;
      if (_knownIds.has(id)) return;
      const d = change.doc.data();
      const ca = d.createdAt;
      const createdAtMs = ca && typeof ca.toMillis === 'function' ? ca.toMillis() : (ca?.seconds != null ? ca.seconds * 1000 : null);
      if (createdAtMs != null && createdAtMs <= _newestLoadedAt) return;
      additions.push({ id, createdAt: createdAtMs, eventType: d.eventType, severity: d.severity, source: d.source, description: d.description, userId: d.userId || null, userName: d.userName || null, metadata: d.metadata || null });
    });
    if (!additions.length) return;
    additions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    _items = [...additions, ..._items].slice(0, PAGE_SIZE + additions.length);
    _knownIds = new Set(_items.map((i) => i.id));
    if (_items[0]?.createdAt) _newestLoadedAt = _items[0].createdAt;
    renderTable();
    fetchSummary();
  });
}

async function downloadExport(format) {
  if (!getPerms().canExportLogs) return;
  try {
    const token = await fbGetIdToken();
    const params = buildFilterParams();
    params.set('format', format);
    const resp = await fetch(`/api/system-logs/export?${params}`, { headers: { Authorization: `Bearer ${token}` } });
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
    const resp = await fetch(`/api/system-logs?${buildFilterParams()}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Clear failed.');
    await applyFilters({ includeCount: true, suppressValidationToast: true });
  } catch (e) {
    alert(e?.message || String(e));
  }
}

function toggleAdvancedPanel() {
  const panel = document.getElementById('sl-advanced-panel');
  const btn = document.getElementById('sl-advanced-toggle');
  if (!panel || !btn) return;
  const show = panel.classList.contains('is-hidden');
  panel.classList.toggle('is-hidden', !show);
  btn.setAttribute('aria-expanded', show ? 'true' : 'false');
}
function wireSortHeaders() {
  document.querySelectorAll('#page-system-logs .sl-sort').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort-key');
      if (!key) return;
      if (_sort.key === key) _sort.dir = _sort.dir === 'asc' ? 'desc' : 'asc';
      else _sort = { key, dir: key === 'createdAt' ? 'desc' : 'asc' };
      renderTable();
    });
  });
}
function wireMultiCloseOnOutside() {
  document.addEventListener('click', (e) => {
    Object.values(_multiMeta).forEach((meta) => {
      const details = document.getElementById(meta.detailsId);
      if (!details || !details.open) return;
      if (!details.contains(e.target)) details.open = false;
    });
  });
}
function initFilterWidgets() {
  renderMultiOptions('severity', SEVERITY_CHIPS.map((x) => ({ value: x.value, label: x.label })));
  renderMultiOptions('source', SOURCE_CHIPS.map((x) => ({ value: x.value, label: x.label })));
  populateEventSelect();
  populateUserMulti();
  syncFiltersToUi();
  updateActiveFilterChips();
}

export function loadSystemLogs() {
  if (!getPerms().canViewLogs) return;
  applyFilters({ includeCount: true, suppressValidationToast: true });
}
export function onPageActivated(page) {
  _pageActive = page === 'system-logs';
  if (_pageActive) {
    updateActionButtons();
    loadUserDirectory().then(() => {
      syncFiltersToUi();
      loadSystemLogs();
    });
  } else {
    teardownRealtime();
  }
}
export function init() {
  updateActionButtons();
  initFilterWidgets();
  wireSortHeaders();
  wireMultiCloseOnOutside();
  renderSummary();
  syncDatePresetUi();

  document.getElementById('sl-search')?.addEventListener('input', (e) => { _pendingFilters.search = e.target.value.trim(); updateActiveFilterChips(); });
  document.getElementById('sl-date-preset')?.addEventListener('change', (e) => { _pendingFilters.datePreset = e.target.value || ''; applyDatePresetValues(_pendingFilters.datePreset); syncFiltersToUi(); updateActiveFilterChips(); });
  document.getElementById('sl-date-from')?.addEventListener('change', (e) => { _pendingFilters.from = e.target.value || ''; if (_pendingFilters.from || _pendingFilters.to) _pendingFilters.datePreset = 'custom'; syncFiltersToUi(); updateActiveFilterChips(); });
  document.getElementById('sl-date-to')?.addEventListener('change', (e) => { _pendingFilters.to = e.target.value || ''; if (_pendingFilters.from || _pendingFilters.to) _pendingFilters.datePreset = 'custom'; syncFiltersToUi(); updateActiveFilterChips(); });
  document.getElementById('sl-filter-event')?.addEventListener('change', (e) => { _pendingFilters.eventType = e.target.value || ''; updateActiveFilterChips(); });

  document.getElementById('sl-advanced-toggle')?.addEventListener('click', toggleAdvancedPanel);
  document.getElementById('sl-apply')?.addEventListener('click', () => applyFilters({ suppressValidationToast: false }));
  document.getElementById('sl-clear-filters')?.addEventListener('click', clearAllFilters);
  document.getElementById('sl-refresh')?.addEventListener('click', () => {
    createLog({ eventType: 'dashboard.refresh', severity: 'info', source: 'user', description: 'System logs table refreshed' });
    applyFilters({ suppressValidationToast: false });
  });
  document.getElementById('sl-prev')?.addEventListener('click', () => {
    if (_cursorStack.length === 0) return;
    if (!filtersMatchLastApplied()) return applyFilters();
    _currentPageCursor = _cursorStack.pop() ?? null;
    fetchLogs({ cursor: _currentPageCursor });
  });
  document.getElementById('sl-next')?.addEventListener('click', () => {
    if (!_hasMore || !_nextCursor) return;
    if (!filtersMatchLastApplied()) return applyFilters();
    _cursorStack.push(_currentPageCursor);
    _currentPageCursor = _nextCursor;
    fetchLogs({ cursor: _nextCursor });
  });
  document.getElementById('sl-export-csv')?.addEventListener('click', () => downloadExport('csv'));
  document.getElementById('sl-export-xlsx')?.addEventListener('click', () => downloadExport('xlsx'));
  document.getElementById('sl-clear')?.addEventListener('click', clearLogs);

  window.addEventListener('page-activated', (e) => onPageActivated(e.detail?.page));
  _lastAppliedFilterKey = getCurrentFilterKey();
}
/**
 * System Logs dashboard controller.
 */
import { fbGetIdToken, fbFirestore, fbCollection, fbQuery, fbOrderBy, fbLimit, fbOnSnapshot } from '../firebase-client.js';
import { showConfirmModal, escHtml, showAppToast } from '../ui/modal-ui.js';
import { EVENT_TYPE_GROUPS, SEVERITY_CHIPS, SOURCE_CHIPS, SYSTEM_LOGS_COLLECTION } from '../constants/log-constants.js';
import { createLog } from '../services/system-log.js';
import { loadUsers, getUsersList } from './user-management.js';
import { EVAL_RESPONDENTS, SYSTEM_LOG_USER_FILTER_SYSTEM } from '../constants/eval-users.js';
import { setFarmUsersForLogs, formatLogUser } from '../services/log-user-display.js';

const PAGE_SIZE = 25;
const SKELETON_ROWS = 8;

let _items = [];
let _nextCursor = null;
let _hasMore = false;
let _cursorStack = [];
let _currentPageCursor = null;
let _loading = false;
let _error = null;
let _pageActive = false;
let _realtimeUnsub = null;
let _knownIds = new Set();
let _newestLoadedAt = 0;
let _indexNotice = null;
let _totalCount = null;
let _totalPages = null;
let _fetchAbort = null;
let _summaryAbort = null;
let _fetchGeneration = 0;
let _lastAppliedFilterKey = '';
let _expandedRowId = null;
let _sort = { key: 'createdAt', dir: 'desc' };
let _summary = { total: null, error: null, warning: null, critical: null };

const _pendingFilters = {
  search: '',
  datePreset: '',
  from: '',
  to: '',
  severities: [],
  sources: [],
  users: [],
  eventType: '',
};

const _multiMeta = {
  severity: { detailsId: 'sl-severity-multi', optionsId: 'sl-severity-options', triggerId: 'sl-severity-trigger' },
  source: { detailsId: 'sl-source-multi', optionsId: 'sl-source-options', triggerId: 'sl-source-trigger' },
  user: { detailsId: 'sl-user-multi', optionsId: 'sl-user-options', triggerId: 'sl-user-trigger' },
};

function getPerms() { return window._rbacPerms || {}; }
function normalizeList(list) { return [...new Set((Array.isArray(list) ? list : []).filter(Boolean).map(String))]; }

function parseDateYmd(ymd) {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
}
function startOfLocalDayMs(ymd) {
  const p = parseDateYmd(ymd);
  if (!p) return null;
  return new Date(p.y, p.m, p.d, 0, 0, 0, 0).getTime();
}
function endOfLocalDayMs(ymd) {
  const p = parseDateYmd(ymd);
  if (!p) return null;
  return new Date(p.y, p.m, p.d, 23, 59, 59, 999).getTime();
}

function buildFilterParams(filters = _pendingFilters) {
  const p = new URLSearchParams();
  const q = String(filters.search || '').trim();
  if (q) p.set('q', q);
  if (filters.eventType) p.set('eventType', filters.eventType);
  if (filters.severities.length) p.set('severity', normalizeList(filters.severities).join(','));
  if (filters.sources.length) p.set('source', normalizeList(filters.sources).join(','));
  if (filters.users.length) p.set('userId', normalizeList(filters.users).join(','));
  if (filters.from) {
    const fromMs = startOfLocalDayMs(filters.from);
    if (Number.isFinite(fromMs)) p.set('from', String(fromMs));
  }
  if (filters.to) {
    const toMs = endOfLocalDayMs(filters.to);
    if (Number.isFinite(toMs)) p.set('to', String(toMs));
  }
  return p;
}

function getCurrentFilterKey() { return buildFilterParams().toString(); }
function filtersMatchLastApplied() { return getCurrentFilterKey() === _lastAppliedFilterKey; }
function filtersAreActive() { return [...buildFilterParams().keys()].length > 0; }
function formatTimestamp(ms) { return ms == null || !Number.isFinite(ms) ? '-' : new Date(ms).toLocaleString(); }

function severityBadgeClass(severity) {
  const s = String(severity || '').toLowerCase();
  if (s === 'critical') return 'sl-badge sl-badge--critical';
  if (s === 'error') return 'sl-badge sl-badge--error';
  if (s === 'warning') return 'sl-badge sl-badge--warning';
  return 'sl-badge sl-badge--info';
}

function renderSkeletonRows() {
  return Array.from({ length: SKELETON_ROWS }, () => `
    <tr class="sl-skeleton-row">
      <td><span class="sl-skeleton"></span></td>
      <td><span class="sl-skeleton sl-skeleton--short"></span></td>
      <td><span class="sl-skeleton sl-skeleton--short"></span></td>
      <td><span class="sl-skeleton sl-skeleton--short"></span></td>
      <td><span class="sl-skeleton"></span></td>
    </tr>
  `).join('');
}

function compareBySort(a, b) {
  const mul = _sort.dir === 'asc' ? 1 : -1;
  if (_sort.key === 'createdAt') return ((a.createdAt || 0) - (b.createdAt || 0)) * mul;
  if (_sort.key === 'severity') {
    const order = { critical: 4, error: 3, warning: 2, info: 1 };
    return ((order[a.severity] || 0) - (order[b.severity] || 0)) * mul;
  }
  if (_sort.key === 'source') return String(a.source || '').localeCompare(String(b.source || '')) * mul;
  if (_sort.key === 'user') return formatLogUser(a).localeCompare(formatLogUser(b)) * mul;
  return String(a.description || '').localeCompare(String(b.description || '')) * mul;
}

function renderSortIndicators() {
  ['createdAt', 'severity', 'source', 'user', 'description'].forEach((key) => {
    const el = document.getElementById(`sl-sort-${key}`);
    if (!el) return;
    el.textContent = _sort.key === key ? (_sort.dir === 'asc' ? '↑' : '↓') : '';
  });
}

function toggleRowExpansion(id) {
  if (!id) return;
  _expandedRowId = _expandedRowId === id ? null : id;
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('sl-tbody');
  const card = document.getElementById('sl-table-card');
  if (!tbody) return;
  if (card) card.classList.toggle('is-loading', _loading && _items.length > 0);

  const errEl = document.getElementById('sl-error');
  if (errEl) {
    const show = _error || _indexNotice;
    errEl.style.display = show ? '' : 'none';
    errEl.textContent = show || '';
    errEl.classList.toggle('sl-error-banner--info', !_error && !!_indexNotice);
  }

  if (_loading && !_items.length) {
    tbody.innerHTML = renderSkeletonRows();
    renderSortIndicators();
    return;
  }
  if (_error && !_items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="sl-empty">Could not load logs. Use Refresh to retry.</td></tr>';
    renderSortIndicators();
    return;
  }
  if (!_items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="sl-empty">No logs match your filters.</td></tr>';
    renderSortIndicators();
    return;
  }

  const view = [..._items].sort(compareBySort);
  const html = [];
  view.forEach((item) => {
    const expanded = _expandedRowId === item.id;
    html.push(`
      <tr class="sl-row ${expanded ? 'is-expanded' : ''}" data-id="${escHtml(item.id)}" tabindex="0" role="button" aria-expanded="${expanded ? 'true' : 'false'}">
        <td class="sl-ts">${escHtml(formatTimestamp(item.createdAt))}</td>
        <td><span class="${severityBadgeClass(item.severity)}">${escHtml(item.severity || '')}</span></td>
        <td>${escHtml(item.source || '')}</td>
        <td>${escHtml(formatLogUser(item))}</td>
        <td class="sl-desc">${escHtml(item.description || '')}</td>
      </tr>
    `);
    if (expanded) {
      const meta = item.metadata && Object.keys(item.metadata).length ? JSON.stringify(item.metadata, null, 2) : '-';
      html.push(`
        <tr class="sl-row-details">
          <td colspan="5">
            <div class="sl-detail-inline">
              <div class="sl-detail-inline-grid">
                <div><span class="sl-detail-label">Event type</span><span class="sl-mono">${escHtml(item.eventType || '-')}</span></div>
                <div><span class="sl-detail-label">User ID</span><span class="sl-mono">${escHtml(item.userId || '-')}</span></div>
              </div>
              <div class="sl-detail-inline-block">
                <span class="sl-detail-label">Metadata</span>
                <pre class="sl-meta-pre">${escHtml(meta)}</pre>
              </div>
            </div>
          </td>
        </tr>
      `);
    }
  });
  tbody.innerHTML = html.join('');

  tbody.querySelectorAll('.sl-row').forEach((row) => {
    row.addEventListener('click', () => toggleRowExpansion(row.getAttribute('data-id')));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleRowExpansion(row.getAttribute('data-id'));
      }
    });
  });

  _knownIds = new Set(_items.map((i) => i.id));
  if (_items[0]?.createdAt) _newestLoadedAt = _items[0].createdAt;
  renderSortIndicators();
}

function updatePaginationUi() {
  const prev = document.getElementById('sl-prev');
  const next = document.getElementById('sl-next');
  const pageLabel = document.getElementById('sl-page-label');
  const rangeLabel = document.getElementById('sl-range-label');
  const pageNum = _cursorStack.length + 1;

  if (prev) prev.disabled = _cursorStack.length === 0 || _loading;
  if (next) next.disabled = !_hasMore || _loading;

  if (pageLabel) {
    if (_totalPages != null) pageLabel.textContent = `Page ${pageNum} of ${_totalPages}`;
    else if (_hasMore) pageLabel.textContent = `Page ${pageNum} · more available`;
    else if (pageNum > 1 || _items.length) pageLabel.textContent = `Page ${pageNum}`;
    else pageLabel.textContent = 'No results';
  }

  if (rangeLabel) {
    if (_loading && !_items.length) rangeLabel.textContent = 'Loading logs...';
    else if (!_items.length && !_loading) rangeLabel.textContent = 'No entries on this page';
    else {
      const start = (pageNum - 1) * PAGE_SIZE + 1;
      const end = (pageNum - 1) * PAGE_SIZE + _items.length;
      rangeLabel.textContent = _totalCount != null
        ? `Showing ${start.toLocaleString()}-${end.toLocaleString()} of ${_totalCount.toLocaleString()} entries`
        : `Showing ${start.toLocaleString()}-${end.toLocaleString()}${_hasMore ? ' (more pages available)' : ''}`;
    }
  }
}

function updateActionButtons() {
  const perms = getPerms();
  document.getElementById('sl-export-csv')?.classList.toggle('is-hidden', !perms.canExportLogs);
  document.getElementById('sl-export-xlsx')?.classList.toggle('is-hidden', !perms.canExportLogs);
  document.getElementById('sl-clear')?.classList.toggle('is-hidden', !perms.canClearLogs);
}

function setSummaryValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = Number.isFinite(value) ? value.toLocaleString() : '-';
}
function renderSummary() {
  setSummaryValue('sl-summary-total', _summary.total);
  setSummaryValue('sl-summary-error', _summary.error);
  setSummaryValue('sl-summary-warning', _summary.warning);
  setSummaryValue('sl-summary-critical', _summary.critical);
}

function labelForEvent(value) {
  for (const g of EVENT_TYPE_GROUPS) {
    const found = g.options.find((o) => o.value === value);
    if (found) return found.label;
  }
  return value;
}
function labelForUserFilter(value) {
  if (!value) return 'All users';
  if (value === SYSTEM_LOG_USER_FILTER_SYSTEM) return 'System (automated)';
  const evalMatch = EVAL_RESPONDENTS.find((r) => r.userId === value);
  if (evalMatch) return evalMatch.userName;
  const farm = getUsersList().find((u) => u.id === value);
  return farm?.displayName || value;
}

function labelForDateFilter() {
  const presetLabels = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', eval: 'Evaluation (May 25-28)', custom: 'Custom' };
  if (_pendingFilters.datePreset && _pendingFilters.datePreset !== 'custom') return presetLabels[_pendingFilters.datePreset] || _pendingFilters.datePreset;
  if (_pendingFilters.from && _pendingFilters.to) return `${_pendingFilters.from} - ${_pendingFilters.to}`;
  if (_pendingFilters.from || _pendingFilters.to) return `${_pendingFilters.from || '...'} - ${_pendingFilters.to || '...'}`;
  return 'All time';
}

function updateMultiTrigger(group) {
  const trigger = document.getElementById(_multiMeta[group].triggerId);
  if (!trigger) return;
  const selected = group === 'severity'
    ? _pendingFilters.severities
    : group === 'source'
      ? _pendingFilters.sources
      : _pendingFilters.users;
  const label = group[0].toUpperCase() + group.slice(1);
  trigger.textContent = selected.length ? `${label}: ${selected.length} selected` : `${label}: All`;
}

function renderMultiOptions(group, options) {
  const menu = document.getElementById(_multiMeta[group].optionsId);
  if (!menu) return;
  const selected = group === 'severity' ? _pendingFilters.severities : group === 'source' ? _pendingFilters.sources : _pendingFilters.users;

  menu.innerHTML = options.map((opt) => `
    <label class="sl-multi-option">
      <input type="checkbox" data-group="${group}" value="${escHtml(opt.value)}" ${selected.includes(opt.value) ? 'checked' : ''} />
      <span>${escHtml(opt.label)}</span>
    </label>
  `).join('');

  menu.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', () => {
      const values = [...menu.querySelectorAll('input[type="checkbox"]:checked')].map((x) => x.value);
      if (group === 'severity') _pendingFilters.severities = normalizeList(values);
      if (group === 'source') _pendingFilters.sources = normalizeList(values);
      if (group === 'user') _pendingFilters.users = normalizeList(values);
      updateMultiTrigger(group);
      updateActiveFilterChips();
    });
  });
  updateMultiTrigger(group);
}

function populateEventSelect() {
  const evt = document.getElementById('sl-filter-event');
  if (!evt) return;
  evt.innerHTML = '<option value="">All event types</option>';
  EVENT_TYPE_GROUPS.forEach((group) => {
    const og = document.createElement('optgroup');
    og.label = group.label;
    group.options.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      og.appendChild(opt);
    });
    evt.appendChild(og);
  });
}

function populateUserMulti() {
  const farmUsers = getUsersList().filter((u) => !EVAL_RESPONDENTS.some((e) => e.userId === u.id));
  const options = [
    { value: SYSTEM_LOG_USER_FILTER_SYSTEM, label: 'System (automated)' },
    ...EVAL_RESPONDENTS.map((r) => ({ value: r.userId, label: r.userName })),
    ...farmUsers.map((u) => ({ value: u.id, label: u.displayName })),
  ];
  renderMultiOptions('user', options);
}

async function loadUserDirectory() {
  try {
    await loadUsers();
    setFarmUsersForLogs(getUsersList());
  } catch (e) {
    console.warn('[SystemLogs] Could not load users for filters:', e);
    setFarmUsersForLogs([]);
  }
  populateUserMulti();
}

function syncDatePresetUi() {
  const custom = document.getElementById('sl-custom-dates');
  if (custom) custom.classList.toggle('is-hidden', _pendingFilters.datePreset !== 'custom');
}

function formatDateYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function applyDatePresetValues(preset) {
  if (!preset || preset === 'custom') {
    if (!preset) {
      _pendingFilters.from = '';
      _pendingFilters.to = '';
    }
    return;
  }

  const end = new Date();
  const start = new Date();
  if (preset === 'today') {
    _pendingFilters.from = formatDateYmd(end);
    _pendingFilters.to = formatDateYmd(end);
  } else if (preset === '7d') {
    start.setDate(start.getDate() - 6);
    _pendingFilters.from = formatDateYmd(start);
    _pendingFilters.to = formatDateYmd(end);
  } else if (preset === '30d') {
    start.setDate(start.getDate() - 29);
    _pendingFilters.from = formatDateYmd(start);
    _pendingFilters.to = formatDateYmd(end);
  } else if (preset === 'eval') {
    _pendingFilters.from = '2026-05-25';
    _pendingFilters.to = '2026-05-28';
  }
}

function validateDateRange() {
  if (_pendingFilters.datePreset === 'custom') {
    if (!_pendingFilters.from || !_pendingFilters.to) return 'Choose a start and end date for your custom range.';
    if (_pendingFilters.from > _pendingFilters.to) return 'Start date must be on or before the end date.';
    return null;
  }
  if ((_pendingFilters.from && !_pendingFilters.to) || (!_pendingFilters.from && _pendingFilters.to)) {
    return 'Choose both start and end dates, or clear the date fields.';
  }
  if (_pendingFilters.from && _pendingFilters.to && _pendingFilters.from > _pendingFilters.to) {
    return 'Start date must be on or before the end date.';
  }
  return null;
}

function syncFiltersToUi() {
  const search = document.getElementById('sl-search');
  const preset = document.getElementById('sl-date-preset');
  const from = document.getElementById('sl-date-from');
  const to = document.getElementById('sl-date-to');
  const event = document.getElementById('sl-filter-event');
  if (search) search.value = _pendingFilters.search;
  if (preset) preset.value = _pendingFilters.datePreset;
  if (from) from.value = _pendingFilters.from;
  if (to) to.value = _pendingFilters.to;
  if (event) event.value = _pendingFilters.eventType;

  const syncChecks = (group, vals) => {
    const menu = document.getElementById(_multiMeta[group].optionsId);
    if (!menu) return;
    menu.querySelectorAll('input[type="checkbox"]').forEach((i) => { i.checked = vals.includes(i.value); });
    updateMultiTrigger(group);
  };
  syncChecks('severity', _pendingFilters.severities);
  syncChecks('source', _pendingFilters.sources);
  syncChecks('user', _pendingFilters.users);
  syncDatePresetUi();
}

function clearFilterKey(key, value = '') {
  if (key === 'q') _pendingFilters.search = '';
  if (key === 'severity') _pendingFilters.severities = _pendingFilters.severities.filter((x) => x !== value);
  if (key === 'source') _pendingFilters.sources = _pendingFilters.sources.filter((x) => x !== value);
  if (key === 'eventType') _pendingFilters.eventType = '';
  if (key === 'user') _pendingFilters.users = _pendingFilters.users.filter((x) => x !== value);
  if (key === 'dates') {
    _pendingFilters.datePreset = '';
    _pendingFilters.from = '';
    _pendingFilters.to = '';
  }
  syncFiltersToUi();
  updateActiveFilterChips();
}

function updateActiveFilterChips() {
  const wrap = document.getElementById('sl-active-filters');
  if (!wrap) return;
  const chips = [];
  if (_pendingFilters.search) chips.push({ key: 'q', value: '', label: `Search: "${_pendingFilters.search}"` });
  _pendingFilters.severities.forEach((v) => chips.push({ key: 'severity', value: v, label: `Severity: ${v}` }));
  _pendingFilters.sources.forEach((v) => chips.push({ key: 'source', value: v, label: `Source: ${v}` }));
  if (_pendingFilters.eventType) chips.push({ key: 'eventType', value: '', label: `Event: ${labelForEvent(_pendingFilters.eventType)}` });
  _pendingFilters.users.forEach((v) => chips.push({ key: 'user', value: v, label: `User: ${labelForUserFilter(v)}` }));
  if (_pendingFilters.datePreset || _pendingFilters.from || _pendingFilters.to) {
    chips.push({ key: 'dates', value: '', label: `Dates: ${labelForDateFilter()}` });
  }

  if (!chips.length) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    return;
  }
  wrap.hidden = false;
  wrap.innerHTML = chips.map((c) =>
    `<span class="sl-active-chip">${escHtml(c.label)}<button type="button" data-clear="${escHtml(c.key)}" data-value="${escHtml(c.value)}" aria-label="Remove filter">x</button></span>`
  ).join('');

  wrap.querySelectorAll('[data-clear]').forEach((btn) => {
    btn.addEventListener('click', () => clearFilterKey(btn.getAttribute('data-clear'), btn.getAttribute('data-value') || ''));
  });
}

function clearAllFilters() {
  _pendingFilters.search = '';
  _pendingFilters.datePreset = '';
  _pendingFilters.from = '';
  _pendingFilters.to = '';
  _pendingFilters.severities = [];
  _pendingFilters.sources = [];
  _pendingFilters.users = [];
  _pendingFilters.eventType = '';
  syncFiltersToUi();
  updateActiveFilterChips();
}

async function fetchSummary() {
  _summaryAbort?.abort();
  const controller = new AbortController();
  _summaryAbort = controller;
  try {
    const token = await fbGetIdToken();
    if (!token) throw new Error('Not signed in.');
    const resp = await fetch(`/api/system-logs/summary?${buildFilterParams()}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error('Summary fetch failed.');
    const data = await resp.json();
    _summary = { total: data.total ?? null, error: data.error ?? null, warning: data.warning ?? null, critical: data.critical ?? null };
  } catch (e) {
    if (e?.name !== 'AbortError') _summary = { total: null, error: null, warning: null, critical: null };
  } finally {
    renderSummary();
  }
}

async function fetchLogs({ cursor = null, resetStack = false, includeCount = false, suppressValidationToast = false } = {}) {
  const dateErr = validateDateRange();
  if (dateErr) {
    if (!suppressValidationToast) showAppToast(dateErr, 'error');
    return;
  }

  _fetchAbort?.abort();
  const controller = new AbortController();
  _fetchAbort = controller;
  const generation = ++_fetchGeneration;
  _loading = true;
  _error = null;
  if (resetStack) {
    _totalCount = null;
    _totalPages = null;
  }
  renderTable();
  updatePaginationUi();

  try {
    const token = await fbGetIdToken();
    if (!token) throw new Error('Not signed in.');
    const params = buildFilterParams();
    params.set('pageSize', String(PAGE_SIZE));
    if (cursor) params.set('cursor', cursor);
    if (includeCount || (resetStack && !cursor)) params.set('includeCount', '1');

    const resp = await fetch(`/api/system-logs?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (generation !== _fetchGeneration) return;
    const data = await resp.json();
    if (!resp.ok) {
      if (data.code === 'INDEX_BUILDING') {
        throw new Error('Firestore indexes are still building (usually 2-10 minutes). Wait until Enabled and retry Refresh.');
      }
      throw new Error(data.error || 'Failed to load logs.');
    }

    _indexNotice = resp.headers.get('X-System-Logs-Index-Fallback') === '1'
      ? 'Indexes are still building - results may load slower until indexes are Enabled.'
      : null;

    _items = data.items || [];
    _nextCursor = data.nextCursor || null;
    _hasMore = !!data.hasMore;
    if (data.totalCount != null) _totalCount = data.totalCount;
    if (data.totalPages != null) _totalPages = data.totalPages;

    if (resetStack) {
      _cursorStack = [];
      _currentPageCursor = null;
      _lastAppliedFilterKey = getCurrentFilterKey();
      _expandedRowId = null;
    }

    updatePaginationUi();
    renderTable();
    setupRealtimeIfEligible();
  } catch (e) {
    if (e?.name === 'AbortError') return;
    if (generation !== _fetchGeneration) return;
    _error = e?.message || String(e);
    if (!cursor) _items = [];
    renderTable();
  } finally {
    if (generation === _fetchGeneration) {
      _loading = false;
      document.getElementById('sl-table-card')?.classList.remove('is-loading');
      updatePaginationUi();
    }
  }
}

async function applyFilters({ includeCount = true, suppressValidationToast = true } = {}) {
  updateActiveFilterChips();
  await Promise.all([
    fetchLogs({ resetStack: true, includeCount, suppressValidationToast }),
    fetchSummary(),
  ]);
}

function canUseRealtime() {
  if (!_pageActive) return false;
  if (_cursorStack.length > 0) return false;
  if (filtersAreActive()) return false;
  if (_sort.key !== 'createdAt' || _sort.dir !== 'desc') return false;
  return true;
}
function teardownRealtime() {
  if (_realtimeUnsub) {
    _realtimeUnsub();
    _realtimeUnsub = null;
  }
}
function setupRealtimeIfEligible() {
  teardownRealtime();
  if (!canUseRealtime()) return;
  const fs = fbFirestore();
  if (!fs) return;

  const q = fbQuery(fbCollection(fs, SYSTEM_LOGS_COLLECTION), fbOrderBy('createdAt', 'desc'), fbLimit(15));
  _realtimeUnsub = fbOnSnapshot(
    q,
    (snap) => {
      const additions = [];
      snap.docChanges().forEach((change) => {
        if (change.type !== 'added') return;
        const id = change.doc.id;
        if (_knownIds.has(id)) return;
        const d = change.doc.data();
        const ca = d.createdAt;
        const createdAtMs = ca && typeof ca.toMillis === 'function' ? ca.toMillis() : (ca?.seconds != null ? ca.seconds * 1000 : null);
        if (createdAtMs != null && createdAtMs <= _newestLoadedAt) return;
        additions.push({
          id,
          createdAt: createdAtMs,
          eventType: d.eventType,
          severity: d.severity,
          source: d.source,
          description: d.description,
          userId: d.userId || null,
          userName: d.userName || null,
          metadata: d.metadata || null,
        });
      });
      if (!additions.length) return;
      additions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      _items = [...additions, ..._items].slice(0, PAGE_SIZE + additions.length);
      _knownIds = new Set(_items.map((i) => i.id));
      if (_items[0]?.createdAt) _newestLoadedAt = _items[0].createdAt;
      renderTable();
      fetchSummary();
    },
    (err) => {
      if (String(err?.message || '').includes('index')) {
        _indexNotice = 'Live updates paused while Firestore indexes finish building. Use Refresh to reload the table.';
        renderTable();
      }
    },
  );
}

async function downloadExport(format) {
  if (!getPerms().canExportLogs) return;
  try {
    const token = await fbGetIdToken();
    const params = buildFilterParams();
    params.set('format', format);
    const resp = await fetch(`/api/system-logs/export?${params}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || 'Export failed.');
    }
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
    const resp = await fetch(`/api/system-logs?${buildFilterParams()}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Clear failed.');
    await applyFilters({ includeCount: true, suppressValidationToast: true });
  } catch (e) {
    alert(e?.message || String(e));
  }
}

function toggleAdvancedPanel() {
  const panel = document.getElementById('sl-advanced-panel');
  const btn = document.getElementById('sl-advanced-toggle');
  if (!panel || !btn) return;
  const show = panel.classList.contains('is-hidden');
  panel.classList.toggle('is-hidden', !show);
  btn.setAttribute('aria-expanded', show ? 'true' : 'false');
}

function wireSortHeaders() {
  document.querySelectorAll('#page-system-logs .sl-sort').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort-key');
      if (!key) return;
      if (_sort.key === key) _sort.dir = _sort.dir === 'asc' ? 'desc' : 'asc';
      else _sort = { key, dir: key === 'createdAt' ? 'desc' : 'asc' };
      renderTable();
    });
  });
}

function wireMultiCloseOnOutside() {
  document.addEventListener('click', (e) => {
    Object.values(_multiMeta).forEach((meta) => {
      const details = document.getElementById(meta.detailsId);
      if (!details || !details.open) return;
      if (!details.contains(e.target)) details.open = false;
    });
  });
}

function initFilterWidgets() {
  renderMultiOptions('severity', SEVERITY_CHIPS.map((x) => ({ value: x.value, label: x.label })));
  renderMultiOptions('source', SOURCE_CHIPS.map((x) => ({ value: x.value, label: x.label })));
  populateEventSelect();
  populateUserMulti();
  syncFiltersToUi();
  updateActiveFilterChips();
}

export function loadSystemLogs() {
  if (!getPerms().canViewLogs) return;
  applyFilters({ includeCount: true, suppressValidationToast: true });
}

export function onPageActivated(page) {
  _pageActive = page === 'system-logs';
  if (_pageActive) {
    updateActionButtons();
    loadUserDirectory().then(() => {
      syncFiltersToUi();
      loadSystemLogs();
    });
  } else {
    teardownRealtime();
  }
}

export function init() {
  updateActionButtons();
  initFilterWidgets();
  wireSortHeaders();
  wireMultiCloseOnOutside();
  renderSummary();
  syncDatePresetUi();

  document.getElementById('sl-search')?.addEventListener('input', (e) => {
    _pendingFilters.search = e.target.value.trim();
    updateActiveFilterChips();
  });

  document.getElementById('sl-date-preset')?.addEventListener('change', (e) => {
    _pendingFilters.datePreset = e.target.value || '';
    applyDatePresetValues(_pendingFilters.datePreset);
    syncFiltersToUi();
    updateActiveFilterChips();
  });
  document.getElementById('sl-date-from')?.addEventListener('change', (e) => {
    _pendingFilters.from = e.target.value || '';
    if (_pendingFilters.from || _pendingFilters.to) _pendingFilters.datePreset = 'custom';
    syncFiltersToUi();
    updateActiveFilterChips();
  });
  document.getElementById('sl-date-to')?.addEventListener('change', (e) => {
    _pendingFilters.to = e.target.value || '';
    if (_pendingFilters.from || _pendingFilters.to) _pendingFilters.datePreset = 'custom';
    syncFiltersToUi();
    updateActiveFilterChips();
  });
  document.getElementById('sl-filter-event')?.addEventListener('change', (e) => {
    _pendingFilters.eventType = e.target.value || '';
    updateActiveFilterChips();
  });

  document.getElementById('sl-advanced-toggle')?.addEventListener('click', toggleAdvancedPanel);
  document.getElementById('sl-apply')?.addEventListener('click', () => applyFilters({ suppressValidationToast: false }));
  document.getElementById('sl-clear-filters')?.addEventListener('click', clearAllFilters);

  document.getElementById('sl-refresh')?.addEventListener('click', () => {
    createLog({
      eventType: 'dashboard.refresh',
      severity: 'info',
      source: 'user',
      description: 'System logs table refreshed',
    });
    applyFilters({ suppressValidationToast: false });
  });

  document.getElementById('sl-prev')?.addEventListener('click', () => {
    if (_cursorStack.length === 0) return;
    if (!filtersMatchLastApplied()) return applyFilters();
    _currentPageCursor = _cursorStack.pop() ?? null;
    fetchLogs({ cursor: _currentPageCursor });
  });
  document.getElementById('sl-next')?.addEventListener('click', () => {
    if (!_hasMore || !_nextCursor) return;
    if (!filtersMatchLastApplied()) return applyFilters();
    _cursorStack.push(_currentPageCursor);
    _currentPageCursor = _nextCursor;
    fetchLogs({ cursor: _nextCursor });
  });

  document.getElementById('sl-export-csv')?.addEventListener('click', () => downloadExport('csv'));
  document.getElementById('sl-export-xlsx')?.addEventListener('click', () => downloadExport('xlsx'));
  document.getElementById('sl-clear')?.addEventListener('click', clearLogs);

  window.addEventListener('page-activated', (e) => onPageActivated(e.detail?.page));
  _lastAppliedFilterKey = getCurrentFilterKey();
}
/**
 * System Logs dashboard controller.
 */
import { fbGetIdToken, fbFirestore, fbCollection, fbQuery, fbOrderBy, fbLimit, fbOnSnapshot } from '../firebase-client.js';
import { showConfirmModal, escHtml, showAppToast } from '../ui/modal-ui.js';
import {
  EVENT_TYPE_GROUPS,
  SEVERITY_CHIPS,
  SOURCE_CHIPS,
  SYSTEM_LOGS_COLLECTION,
} from '../constants/log-constants.js';
import { createLog } from '../services/system-log.js';
import { loadUsers, getUsersList } from './user-management.js';
import { EVAL_RESPONDENTS, SYSTEM_LOG_USER_FILTER_SYSTEM } from '../constants/eval-users.js';
import { setFarmUsersForLogs, formatLogUser } from '../services/log-user-display.js';

const PAGE_SIZE = 25;
const SKELETON_ROWS = 8;

let _items = [];
let _nextCursor = null;
let _hasMore = false;
let _cursorStack = [];
let _currentPageCursor = null;
let _loading = false;
let _error = null;
let _pageActive = false;
let _realtimeUnsub = null;
let _knownIds = new Set();
let _newestLoadedAt = 0;
let _indexNotice = null;
let _totalCount = null;
let _totalPages = null;
let _fetchAbort = null;
let _summaryAbort = null;
let _fetchGeneration = 0;
let _lastAppliedFilterKey = '';
let _expandedRowId = null;
let _sort = { key: 'createdAt', dir: 'desc' };
let _summary = { total: null, error: null, warning: null, critical: null };

const _pendingFilters = {
  search: '',
  datePreset: '',
  from: '',
  to: '',
  severities: [],
  sources: [],
  users: [],
  eventType: '',
};

const _multiMeta = {
  severity: { detailsId: 'sl-severity-multi', optionsId: 'sl-severity-options', triggerId: 'sl-severity-trigger' },
  source: { detailsId: 'sl-source-multi', optionsId: 'sl-source-options', triggerId: 'sl-source-trigger' },
  user: { detailsId: 'sl-user-multi', optionsId: 'sl-user-options', triggerId: 'sl-user-trigger' },
};

function getPerms() {
  return window._rbacPerms || {};
}

function parseDateYmd(ymd) {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
}

function startOfLocalDayMs(ymd) {
  const parts = parseDateYmd(ymd);
  if (!parts) return null;
  return new Date(parts.y, parts.m, parts.d, 0, 0, 0, 0).getTime();
}

function endOfLocalDayMs(ymd) {
  const parts = parseDateYmd(ymd);
  if (!parts) return null;
  return new Date(parts.y, parts.m, parts.d, 23, 59, 59, 999).getTime();
}

function normalizeList(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter(Boolean).map((x) => String(x)))];
}

function buildFilterParams(filters = _pendingFilters) {
  const p = new URLSearchParams();
  const q = String(filters.search || '').trim();
  if (q) p.set('q', q);
  if (filters.eventType) p.set('eventType', filters.eventType);
  if (filters.severities.length) p.set('severity', normalizeList(filters.severities).join(','));
  if (filters.sources.length) p.set('source', normalizeList(filters.sources).join(','));
  if (filters.users.length) p.set('userId', normalizeList(filters.users).join(','));

  if (filters.from) {
    const fromMs = startOfLocalDayMs(filters.from);
    if (Number.isFinite(fromMs)) p.set('from', String(fromMs));
  }
  if (filters.to) {
    const toMs = endOfLocalDayMs(filters.to);
    if (Number.isFinite(toMs)) p.set('to', String(toMs));
  }
  return p;
}

function getCurrentFilterKey() {
  return buildFilterParams().toString();
}

function filtersMatchLastApplied() {
  return getCurrentFilterKey() === _lastAppliedFilterKey;
}

function filtersAreActive() {
  return [...buildFilterParams().keys()].length > 0;
}

function formatTimestamp(ms) {
  if (ms == null || !Number.isFinite(ms)) return '-';
  return new Date(ms).toLocaleString();
}

function severityBadgeClass(severity) {
  const s = String(severity || '').toLowerCase();
  if (s === 'critical') return 'sl-badge sl-badge--critical';
  if (s === 'error') return 'sl-badge sl-badge--error';
  if (s === 'warning') return 'sl-badge sl-badge--warning';
  return 'sl-badge sl-badge--info';
}

function renderSkeletonRows() {
  return Array.from({ length: SKELETON_ROWS }, () => `
    <tr class="sl-skeleton-row">
      <td><span class="sl-skeleton"></span></td>
      <td><span class="sl-skeleton sl-skeleton--short"></span></td>
      <td><span class="sl-skeleton sl-skeleton--short"></span></td>
      <td><span class="sl-skeleton sl-skeleton--short"></span></td>
      <td><span class="sl-skeleton"></span></td>
    </tr>
  `).join('');
}

function compareBySort(a, b) {
  const dirMult = _sort.dir === 'asc' ? 1 : -1;
  const key = _sort.key;
  if (key === 'createdAt') {
    return ((a.createdAt || 0) - (b.createdAt || 0)) * dirMult;
  }
  if (key === 'severity') {
    const order = { critical: 4, error: 3, warning: 2, info: 1 };
    return ((order[a.severity] || 0) - (order[b.severity] || 0)) * dirMult;
  }
  if (key === 'source') return String(a.source || '').localeCompare(String(b.source || '')) * dirMult;
  if (key === 'user') return formatLogUser(a).localeCompare(formatLogUser(b)) * dirMult;
  if (key === 'description') return String(a.description || '').localeCompare(String(b.description || '')) * dirMult;
  return 0;
}

function renderSortIndicators() {
  ['createdAt', 'severity', 'source', 'user', 'description'].forEach((key) => {
    const el = document.getElementById(`sl-sort-${key}`);
    if (!el) return;
    if (_sort.key !== key) {
      el.textContent = '';
      return;
    }
    el.textContent = _sort.dir === 'asc' ? '↑' : '↓';
  });
}

function renderTable() {
  const tbody = document.getElementById('sl-tbody');
  const card = document.getElementById('sl-table-card');
  if (!tbody) return;
  if (card) card.classList.toggle('is-loading', _loading && _items.length > 0);

  const errEl = document.getElementById('sl-error');
  if (errEl) {
    const showMsg = _error || _indexNotice;
    errEl.style.display = showMsg ? '' : 'none';
    errEl.textContent = showMsg || '';
    errEl.classList.toggle('sl-error-banner--info', !_error && !!_indexNotice);
  }

  if (_loading && !_items.length) {
    tbody.innerHTML = renderSkeletonRows();
    renderSortIndicators();
    return;
  }
  if (_error && !_items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="sl-empty">Could not load logs. Use Refresh to retry.</td></tr>';
    renderSortIndicators();
    return;
  }
  if (!_items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="sl-empty">No logs match your filters.</td></tr>';
    renderSortIndicators();
    return;
  }

  const view = [..._items].sort(compareBySort);
  const html = [];
  view.forEach((item) => {
    const isExpanded = _expandedRowId === item.id;
    html.push(`
      <tr class="sl-row ${isExpanded ? 'is-expanded' : ''}" data-id="${escHtml(item.id)}" tabindex="0" role="button" aria-expanded="${isExpanded ? 'true' : 'false'}">
        <td class="sl-ts">${escHtml(formatTimestamp(item.createdAt))}</td>
        <td><span class="${severityBadgeClass(item.severity)}">${escHtml(item.severity || '')}</span></td>
        <td>${escHtml(item.source || '')}</td>
        <td>${escHtml(formatLogUser(item))}</td>
        <td class="sl-desc">${escHtml(item.description || '')}</td>
      </tr>
    `);
    if (isExpanded) {
      const meta = item.metadata && Object.keys(item.metadata).length ? JSON.stringify(item.metadata, null, 2) : '-';
      html.push(`
        <tr class="sl-row-details">
          <td colspan="5">
            <div class="sl-detail-inline">
              <div class="sl-detail-inline-grid">
                <div><span class="sl-detail-label">Event type</span><span class="sl-mono">${escHtml(item.eventType || '-')}</span></div>
                <div><span class="sl-detail-label">User ID</span><span class="sl-mono">${escHtml(item.userId || '-')}</span></div>
              </div>
              <div class="sl-detail-inline-block">
                <span class="sl-detail-label">Metadata</span>
                <pre class="sl-meta-pre">${escHtml(meta)}</pre>
              </div>
            </div>
          </td>
        </tr>
      `);
    }
  });

  tbody.innerHTML = html.join('');
  tbody.querySelectorAll('.sl-row').forEach((row) => {
    row.addEventListener('click', () => toggleRowExpansion(row.getAttribute('data-id')));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleRowExpansion(row.getAttribute('data-id'));
      }
    });
  });

  _knownIds = new Set(_items.map((i) => i.id));
  if (_items[0]?.createdAt) _newestLoadedAt = _items[0].createdAt;
  renderSortIndicators();
}

function toggleRowExpansion(id) {
  if (!id) return;
  _expandedRowId = _expandedRowId === id ? null : id;
  renderTable();
}

function updatePaginationUi() {
  const prev = document.getElementById('sl-prev');
  const next = document.getElementById('sl-next');
  const pageLabel = document.getElementById('sl-page-label');
  const rangeLabel = document.getElementById('sl-range-label');
  const pageNum = _cursorStack.length + 1;

  if (prev) prev.disabled = _cursorStack.length === 0 || _loading;
  if (next) next.disabled = !_hasMore || _loading;

  if (pageLabel) {
    if (_totalPages != null) pageLabel.textContent = `Page ${pageNum} of ${_totalPages}`;
    else if (_hasMore) pageLabel.textContent = `Page ${pageNum} · more available`;
    else if (pageNum > 1 || _items.length) pageLabel.textContent = `Page ${pageNum}`;
    else pageLabel.textContent = 'No results';
  }

  if (rangeLabel) {
    if (_loading && !_items.length) rangeLabel.textContent = 'Loading logs...';
    else if (!_items.length && !_loading) rangeLabel.textContent = 'No entries on this page';
    else {
      const start = (pageNum - 1) * PAGE_SIZE + 1;
      const end = (pageNum - 1) * PAGE_SIZE + _items.length;
      if (_totalCount != null) rangeLabel.textContent = `Showing ${start.toLocaleString()}-${end.toLocaleString()} of ${_totalCount.toLocaleString()} entries`;
      else rangeLabel.textContent = `Showing ${start.toLocaleString()}-${end.toLocaleString()}${_hasMore ? ' (more pages available)' : ''}`;
    }
  }
}

function updateActionButtons() {
  const perms = getPerms();
  document.getElementById('sl-export-csv')?.classList.toggle('is-hidden', !perms.canExportLogs);
  document.getElementById('sl-export-xlsx')?.classList.toggle('is-hidden', !perms.canExportLogs);
  document.getElementById('sl-clear')?.classList.toggle('is-hidden', !perms.canClearLogs);
}

function setSummaryValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = Number.isFinite(value) ? value.toLocaleString() : '-';
}

function renderSummary() {
  setSummaryValue('sl-summary-total', _summary.total);
  setSummaryValue('sl-summary-error', _summary.error);
  setSummaryValue('sl-summary-warning', _summary.warning);
  setSummaryValue('sl-summary-critical', _summary.critical);
}

function getSeverityLabel(value) {
  return SEVERITY_CHIPS.find((c) => c.value === value)?.label || value;
}

function getSourceLabel(value) {
  return SOURCE_CHIPS.find((c) => c.value === value)?.label || value;
}

function labelForEvent(value) {
  for (const g of EVENT_TYPE_GROUPS) {
    const found = g.options.find((o) => o.value === value);
    if (found) return found.label;
  }
  return value;
}

function labelForUserFilter(value) {
  if (!value) return 'All users';
  if (value === SYSTEM_LOG_USER_FILTER_SYSTEM) return 'System (automated)';
  const evalMatch = EVAL_RESPONDENTS.find((r) => r.userId === value);
  if (evalMatch) return evalMatch.userName;
  const farm = getUsersList().find((u) => u.id === value);
  return farm?.displayName || value;
}

function datePresetLabel(preset) {
  const labels = {
    today: 'Today',
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
    eval: 'Evaluation (May 25-28)',
    custom: 'Custom',
  };
  return labels[preset] || 'All time';
}

function labelForDateFilter(filters = _pendingFilters) {
  if (filters.datePreset && filters.datePreset !== 'custom') return datePresetLabel(filters.datePreset);
  if (filters.from && filters.to) return `${filters.from} - ${filters.to}`;
  if (filters.from || filters.to) return `${filters.from || '...'} - ${filters.to || '...'}`;
  return 'All time';
}

function updateMultiTrigger(group) {
  const trigger = document.getElementById(_multiMeta[group].triggerId);
  if (!trigger) return;
  if (group === 'severity') {
    if (!_pendingFilters.severities.length) trigger.textContent = 'Severity: All';
    else trigger.textContent = `Severity: ${_pendingFilters.severities.length} selected`;
  } else if (group === 'source') {
    if (!_pendingFilters.sources.length) trigger.textContent = 'Source: All';
    else trigger.textContent = `Source: ${_pendingFilters.sources.length} selected`;
  } else if (group === 'user') {
    if (!_pendingFilters.users.length) trigger.textContent = 'User: All';
    else trigger.textContent = `User: ${_pendingFilters.users.length} selected`;
  }
}

function renderMultiOptions(group, options) {
  const menu = document.getElementById(_multiMeta[group].optionsId);
  if (!menu) return;
  const selected = group === 'severity'
    ? _pendingFilters.severities
    : group === 'source'
      ? _pendingFilters.sources
      : _pendingFilters.users;

  const html = options.map((opt) => {
    const checked = selected.includes(opt.value) ? 'checked' : '';
    return `
      <label class="sl-multi-option">
        <input type="checkbox" data-group="${group}" value="${escHtml(opt.value)}" ${checked} />
        <span>${escHtml(opt.label)}</span>
      </label>
    `;
  }).join('');
  menu.innerHTML = html;
  menu.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', () => {
      const values = [...menu.querySelectorAll('input[type="checkbox"]:checked')].map((x) => x.value);
      if (group === 'severity') _pendingFilters.severities = normalizeList(values);
      if (group === 'source') _pendingFilters.sources = normalizeList(values);
      if (group === 'user') _pendingFilters.users = normalizeList(values);
      updateMultiTrigger(group);
      updateActiveFilterChips();
    });
  });
  updateMultiTrigger(group);
}

function populateEventSelect() {
  const evt = document.getElementById('sl-filter-event');
  if (!evt) return;
  evt.innerHTML = '<option value="">All event types</option>';
  EVENT_TYPE_GROUPS.forEach((group) => {
    const og = document.createElement('optgroup');
    og.label = group.label;
    group.options.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      og.appendChild(opt);
    });
    evt.appendChild(og);
  });
}

function populateUserMulti() {
  const farmUsers = getUsersList().filter((u) => !EVAL_RESPONDENTS.some((e) => e.userId === u.id));
  const options = [
    { value: SYSTEM_LOG_USER_FILTER_SYSTEM, label: 'System (automated)' },
    ...EVAL_RESPONDENTS.map((r) => ({ value: r.userId, label: r.userName })),
    ...farmUsers.map((u) => ({ value: u.id, label: u.displayName })),
  ];
  renderMultiOptions('user', options);
}

async function loadUserDirectory() {
  try {
    await loadUsers();
    setFarmUsersForLogs(getUsersList());
    populateUserMulti();
  } catch (e) {
    console.warn('[SystemLogs] Could not load users for filters:', e);
    setFarmUsersForLogs([]);
    populateUserMulti();
  }
}

function clearFilterKey(key, value = '') {
  if (key === 'q') _pendingFilters.search = '';
  if (key === 'severity') _pendingFilters.severities = _pendingFilters.severities.filter((x) => x !== value);
  if (key === 'source') _pendingFilters.sources = _pendingFilters.sources.filter((x) => x !== value);
  if (key === 'eventType') _pendingFilters.eventType = '';
  if (key === 'user') _pendingFilters.users = _pendingFilters.users.filter((x) => x !== value);
  if (key === 'dates') {
    _pendingFilters.datePreset = '';
    _pendingFilters.from = '';
    _pendingFilters.to = '';
  }
  syncFiltersToUi();
  updateActiveFilterChips();
}

function updateActiveFilterChips() {
  const wrap = document.getElementById('sl-active-filters');
  if (!wrap) return;
  const chips = [];

  if (_pendingFilters.search) chips.push({ key: 'q', label: `Search: "${_pendingFilters.search}"`, value: '' });
  _pendingFilters.severities.forEach((v) => chips.push({ key: 'severity', label: `Severity: ${getSeverityLabel(v)}`, value: v }));
  _pendingFilters.sources.forEach((v) => chips.push({ key: 'source', label: `Source: ${getSourceLabel(v)}`, value: v }));
  if (_pendingFilters.eventType) chips.push({ key: 'eventType', label: `Event: ${labelForEvent(_pendingFilters.eventType)}`, value: '' });
  _pendingFilters.users.forEach((v) => chips.push({ key: 'user', label: `User: ${labelForUserFilter(v)}`, value: v }));
  if (_pendingFilters.datePreset || _pendingFilters.from || _pendingFilters.to) {
    chips.push({ key: 'dates', label: `Dates: ${labelForDateFilter()}`, value: '' });
  }

  if (!chips.length) {
    wrap.hidden = true;
    wrap.innerHTML = '';
    return;
  }

  wrap.hidden = false;
  wrap.innerHTML = chips.map((c) =>
    `<span class="sl-active-chip">${escHtml(c.label)}<button type="button" data-clear="${escHtml(c.key)}" data-value="${escHtml(c.value)}" aria-label="Remove filter">x</button></span>`
  ).join('');

  wrap.querySelectorAll('[data-clear]').forEach((btn) => {
    btn.addEventListener('click', () => clearFilterKey(btn.getAttribute('data-clear'), btn.getAttribute('data-value') || ''));
  });
}

function clearAllFilters() {
  _pendingFilters.search = '';
  _pendingFilters.datePreset = '';
  _pendingFilters.from = '';
  _pendingFilters.to = '';
  _pendingFilters.severities = [];
  _pendingFilters.sources = [];
  _pendingFilters.users = [];
  _pendingFilters.eventType = '';
  syncFiltersToUi();
  updateActiveFilterChips();
}

function formatDateYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function syncDatePresetUi() {
  const custom = document.getElementById('sl-custom-dates');
  if (custom) custom.classList.toggle('is-hidden', _pendingFilters.datePreset !== 'custom');
}

function applyDatePresetValues(preset) {
  if (!preset || preset === 'custom') {
    if (!preset) {
      _pendingFilters.from = '';
      _pendingFilters.to = '';
    }
    return;
  }

  const end = new Date();
  const start = new Date();
  if (preset === 'today') {
    _pendingFilters.from = formatDateYmd(end);
    _pendingFilters.to = formatDateYmd(end);
  } else if (preset === '7d') {
    start.setDate(start.getDate() - 6);
    _pendingFilters.from = formatDateYmd(start);
    _pendingFilters.to = formatDateYmd(end);
  } else if (preset === '30d') {
    start.setDate(start.getDate() - 29);
    _pendingFilters.from = formatDateYmd(start);
    _pendingFilters.to = formatDateYmd(end);
  } else if (preset === 'eval') {
    _pendingFilters.from = '2026-05-25';
    _pendingFilters.to = '2026-05-28';
  }
}

function validateDateRange() {
  if (_pendingFilters.datePreset === 'custom') {
    if (!_pendingFilters.from || !_pendingFilters.to) return 'Choose a start and end date for your custom range.';
    if (_pendingFilters.from > _pendingFilters.to) return 'Start date must be on or before the end date.';
    return null;
  }
  if ((_pendingFilters.from && !_pendingFilters.to) || (!_pendingFilters.from && _pendingFilters.to)) {
    return 'Choose both start and end dates, or clear the date fields.';
  }
  if (_pendingFilters.from && _pendingFilters.to && _pendingFilters.from > _pendingFilters.to) {
    return 'Start date must be on or before the end date.';
  }
  return null;
}

function syncFiltersToUi() {
  const search = document.getElementById('sl-search');
  const datePreset = document.getElementById('sl-date-preset');
  const from = document.getElementById('sl-date-from');
  const to = document.getElementById('sl-date-to');
  const eventType = document.getElementById('sl-filter-event');

  if (search) search.value = _pendingFilters.search;
  if (datePreset) datePreset.value = _pendingFilters.datePreset;
  if (from) from.value = _pendingFilters.from;
  if (to) to.value = _pendingFilters.to;
  if (eventType) eventType.value = _pendingFilters.eventType;

  const setChecks = (group, values) => {
    const menu = document.getElementById(_multiMeta[group].optionsId);
    if (!menu) return;
    menu.querySelectorAll('input[type="checkbox"]').forEach((x) => {
      x.checked = values.includes(x.value);
    });
    updateMultiTrigger(group);
  };
  setChecks('severity', _pendingFilters.severities);
  setChecks('source', _pendingFilters.sources);
  setChecks('user', _pendingFilters.users);
  syncDatePresetUi();
}

async function fetchSummary() {
  _summaryAbort?.abort();
  const controller = new AbortController();
  _summaryAbort = controller;
  try {
    const token = await fbGetIdToken();
    if (!token) throw new Error('Not signed in.');
    const params = buildFilterParams();
    const resp = await fetch(`/api/system-logs/summary?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error('Summary fetch failed.');
    const data = await resp.json();
    _summary = {
      total: data.total ?? null,
      error: data.error ?? null,
      warning: data.warning ?? null,
      critical: data.critical ?? null,
    };
  } catch (e) {
    if (e?.name === 'AbortError') return;
    _summary = { total: null, error: null, warning: null, critical: null };
  } finally {
    renderSummary();
  }
}

async function fetchLogs({ cursor = null, resetStack = false, includeCount = false, suppressValidationToast = false } = {}) {
  const dateErr = validateDateRange();
  if (dateErr) {
    if (!suppressValidationToast) showAppToast(dateErr, 'error');
    return;
  }

  _fetchAbort?.abort();
  const controller = new AbortController();
  _fetchAbort = controller;
  const generation = ++_fetchGeneration;

  _loading = true;
  _error = null;
  if (resetStack) {
    _totalCount = null;
    _totalPages = null;
  }
  renderTable();
  updatePaginationUi();

  try {
    const token = await fbGetIdToken();
    if (!token) throw new Error('Not signed in.');
    const params = buildFilterParams();
    params.set('pageSize', String(PAGE_SIZE));
    if (cursor) params.set('cursor', cursor);
    if (includeCount || (resetStack && !cursor)) params.set('includeCount', '1');

    const resp = await fetch(`/api/system-logs?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (generation !== _fetchGeneration) return;
    const data = await resp.json();
    if (!resp.ok) {
      if (data.code === 'INDEX_BUILDING') {
        throw new Error(
          'Firestore indexes are still building (usually 2-10 minutes). Open Firebase Console -> Firestore -> Indexes, wait until Enabled, then click Refresh.'
        );
      }
      throw new Error(data.error || 'Failed to load logs.');
    }

    _indexNotice = resp.headers.get('X-System-Logs-Index-Fallback') === '1'
      ? 'Indexes are still building - results may load slower until indexes are Enabled.'
      : null;

    _items = data.items || [];
    _nextCursor = data.nextCursor || null;
    _hasMore = !!data.hasMore;
    if (data.totalCount != null) _totalCount = data.totalCount;
    if (data.totalPages != null) _totalPages = data.totalPages;
    if (resetStack) {
      _cursorStack = [];
      _currentPageCursor = null;
      _lastAppliedFilterKey = getCurrentFilterKey();
      _expandedRowId = null;
    }

    updatePaginationUi();
    renderTable();
    setupRealtimeIfEligible();
  } catch (e) {
    if (e?.name === 'AbortError') return;
    if (generation !== _fetchGeneration) return;
    _error = e?.message || String(e);
    if (!cursor) _items = [];
    renderTable();
  } finally {
    if (generation === _fetchGeneration) {
      _loading = false;
      document.getElementById('sl-table-card')?.classList.remove('is-loading');
      updatePaginationUi();
    }
  }
}

async function applyFilters({ includeCount = true, suppressValidationToast = true } = {}) {
  updateActiveFilterChips();
  await Promise.all([
    fetchLogs({ resetStack: true, includeCount, suppressValidationToast }),
    fetchSummary(),
  ]);
}

function canUseRealtime() {
  if (!_pageActive) return false;
  if (_cursorStack.length > 0) return false;
  if (filtersAreActive()) return false;
  if (_sort.key !== 'createdAt' || _sort.dir !== 'desc') return false;
  return true;
}

function teardownRealtime() {
  if (_realtimeUnsub) {
    _realtimeUnsub();
    _realtimeUnsub = null;
  }
}

function setupRealtimeIfEligible() {
  teardownRealtime();
  if (!canUseRealtime()) return;
  const fs = fbFirestore();
  if (!fs) return;

  const q = fbQuery(
    fbCollection(fs, SYSTEM_LOGS_COLLECTION),
    fbOrderBy('createdAt', 'desc'),
    fbLimit(15),
  );

  _realtimeUnsub = fbOnSnapshot(
    q,
    (snap) => {
      const additions = [];
      snap.docChanges().forEach((change) => {
        if (change.type !== 'added') return;
        const id = change.doc.id;
        if (_knownIds.has(id)) return;
        const d = change.doc.data();
        let createdAtMs = null;
        const ca = d.createdAt;
        if (ca && typeof ca.toMillis === 'function') createdAtMs = ca.toMillis();
        else if (ca?.seconds != null) createdAtMs = ca.seconds * 1000;
        if (createdAtMs != null && createdAtMs <= _newestLoadedAt) return;
        additions.push({
          id,
          createdAt: createdAtMs,
          eventType: d.eventType,
          severity: d.severity,
          source: d.source,
          description: d.description,
          userId: d.userId || null,
          userName: d.userName || null,
          metadata: d.metadata || null,
        });
      });
      if (!additions.length) return;
      additions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      _items = [...additions, ..._items].slice(0, PAGE_SIZE + additions.length);
      _knownIds = new Set(_items.map((i) => i.id));
      if (_items[0]?.createdAt) _newestLoadedAt = _items[0].createdAt;
      renderTable();
      fetchSummary();
    },
    (err) => {
      if (String(err?.message || '').includes('index')) {
        _indexNotice = 'Live updates paused while Firestore indexes finish building. Use Refresh to reload the table.';
        renderTable();
      }
    },
  );
}

async function downloadExport(format) {
  const perms = getPerms();
  if (!perms.canExportLogs) return;
  try {
    const token = await fbGetIdToken();
    const params = buildFilterParams();
    params.set('format', format);
    const resp = await fetch(`/api/system-logs/export?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || 'Export failed.');
    }
    const blob = await resp.blob();
    const ext = format === 'csv' ? 'csv' : 'xls';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `system-logs.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(e?.message || String(e));
  }
}

async function clearLogs() {
  const perms = getPerms();
  if (!perms.canClearLogs) return;
  const ok = await showConfirmModal({
    title: 'Clear system logs',
    message: 'Delete all logs matching the current filters? This cannot be undone. An audit entry will be recorded.',
    confirmLabel: 'Clear logs',
    variant: 'danger',
  });
  if (!ok) return;
  try {
    const token = await fbGetIdToken();
    const params = buildFilterParams();
    const resp = await fetch(`/api/system-logs?${params}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Clear failed.');
    await applyFilters({ includeCount: true, suppressValidationToast: true });
  } catch (e) {
    alert(e?.message || String(e));
  }
}

function toggleAdvancedPanel() {
  const panel = document.getElementById('sl-advanced-panel');
  const btn = document.getElementById('sl-advanced-toggle');
  if (!panel || !btn) return;
  const show = panel.classList.contains('is-hidden');
  panel.classList.toggle('is-hidden', !show);
  btn.setAttribute('aria-expanded', show ? 'true' : 'false');
}

function wireSortHeaders() {
  document.querySelectorAll('#page-system-logs .sl-sort').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort-key');
      if (!key) return;
      if (_sort.key === key) _sort.dir = _sort.dir === 'asc' ? 'desc' : 'asc';
      else _sort = { key, dir: key === 'createdAt' ? 'desc' : 'asc' };
      renderTable();
    });
  });
}

function wireMultiCloseOnOutside() {
  document.addEventListener('click', (e) => {
    Object.values(_multiMeta).forEach((meta) => {
      const details = document.getElementById(meta.detailsId);
      if (!details || !details.open) return;
      if (!details.contains(e.target)) details.open = false;
    });
  });
}

function initFilterWidgets() {
  renderMultiOptions('severity', SEVERITY_CHIPS.map((x) => ({ value: x.value, label: x.label })));
  renderMultiOptions('source', SOURCE_CHIPS.map((x) => ({ value: x.value, label: x.label })));
  populateEventSelect();
  populateUserMulti();
  syncFiltersToUi();
  updateActiveFilterChips();
}

export function loadSystemLogs() {
  if (!getPerms().canViewLogs) return;
  applyFilters({ includeCount: true, suppressValidationToast: true });
}

export function onPageActivated(page) {
  _pageActive = page === 'system-logs';
  if (_pageActive) {
    updateActionButtons();
    loadUserDirectory().then(() => {
      syncFiltersToUi();
      loadSystemLogs();
    });
  } else {
    teardownRealtime();
  }
}

export function init() {
  updateActionButtons();
  initFilterWidgets();
  wireSortHeaders();
  wireMultiCloseOnOutside();
  renderSummary();
  syncDatePresetUi();

  document.getElementById('sl-search')?.addEventListener('input', (e) => {
    _pendingFilters.search = e.target.value.trim();
    updateActiveFilterChips();
  });

  document.getElementById('sl-date-preset')?.addEventListener('change', (e) => {
    _pendingFilters.datePreset = e.target.value || '';
    applyDatePresetValues(_pendingFilters.datePreset);
    syncFiltersToUi();
    updateActiveFilterChips();
  });

  document.getElementById('sl-date-from')?.addEventListener('change', (e) => {
    _pendingFilters.from = e.target.value || '';
    if (_pendingFilters.from || _pendingFilters.to) _pendingFilters.datePreset = 'custom';
    syncFiltersToUi();
    updateActiveFilterChips();
  });

  document.getElementById('sl-date-to')?.addEventListener('change', (e) => {
    _pendingFilters.to = e.target.value || '';
    if (_pendingFilters.from || _pendingFilters.to) _pendingFilters.datePreset = 'custom';
    syncFiltersToUi();
    updateActiveFilterChips();
  });

  document.getElementById('sl-filter-event')?.addEventListener('change', (e) => {
    _pendingFilters.eventType = e.target.value || '';
    updateActiveFilterChips();
  });

  document.getElementById('sl-advanced-toggle')?.addEventListener('click', toggleAdvancedPanel);

  document.getElementById('sl-apply')?.addEventListener('click', () => {
    applyFilters({ suppressValidationToast: false });
  });

  document.getElementById('sl-clear-filters')?.addEventListener('click', () => {
    clearAllFilters();
  });

  document.getElementById('sl-refresh')?.addEventListener('click', () => {
    createLog({
      eventType: 'dashboard.refresh',
      severity: 'info',
      source: 'user',
      description: 'System logs table refreshed',
    });
    applyFilters({ suppressValidationToast: false });
  });

  document.getElementById('sl-prev')?.addEventListener('click', () => {
    if (_cursorStack.length === 0) return;
    if (!filtersMatchLastApplied()) {
      applyFilters();
      return;
    }
    _currentPageCursor = _cursorStack.pop() ?? null;
    fetchLogs({ cursor: _currentPageCursor });
  });

  document.getElementById('sl-next')?.addEventListener('click', () => {
    if (!_hasMore || !_nextCursor) return;
    if (!filtersMatchLastApplied()) {
      applyFilters();
      return;
    }
    _cursorStack.push(_currentPageCursor);
    _currentPageCursor = _nextCursor;
    fetchLogs({ cursor: _nextCursor });
  });

  document.getElementById('sl-export-csv')?.addEventListener('click', () => downloadExport('csv'));
  document.getElementById('sl-export-xlsx')?.addEventListener('click', () => downloadExport('xlsx'));
  document.getElementById('sl-clear')?.addEventListener('click', clearLogs);

  window.addEventListener('page-activated', (e) => onPageActivated(e.detail?.page));
  _lastAppliedFilterKey = getCurrentFilterKey();
}
 

import {

  EVENT_TYPE_GROUPS,

  SEVERITY_CHIPS,

  SOURCE_CHIPS,

  SYSTEM_LOGS_COLLECTION,

} from '../constants/log-constants.js';

import { createLog } from '../services/system-log.js';
import { loadUsers, getUsersList } from './user-management.js';
import { EVAL_RESPONDENTS, SYSTEM_LOG_USER_FILTER_SYSTEM } from '../constants/eval-users.js';
import { setFarmUsersForLogs, formatLogUser } from '../services/log-user-display.js';



const PAGE_SIZE = 25;

const SKELETON_ROWS = 8;
const SEARCH_APPLY_DEBOUNCE_MS = 250;



let _items = [];

let _nextCursor = null;

let _hasMore = false;

let _cursorStack = [];

let _currentPageCursor = null;

let _loading = false;

let _error = null;

let _pageActive = false;

let _realtimeUnsub = null;

let _knownIds = new Set();

let _newestLoadedAt = 0;

let _indexNotice = null;

let _totalCount = null;

let _totalPages = null;

let _fetchAbort = null;

let _fetchGeneration = 0;
let _lastAppliedFilterKey = '';
let _searchApplyTimer = null;



function getPerms() {

  return window._rbacPerms || {};

}

function parseDateYmd(ymd) {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
}

function startOfLocalDayMs(ymd) {
  const parts = parseDateYmd(ymd);
  if (!parts) return null;
  return new Date(parts.y, parts.m, parts.d, 0, 0, 0, 0).getTime();
}

function endOfLocalDayMs(ymd) {
  const parts = parseDateYmd(ymd);
  if (!parts) return null;
  return new Date(parts.y, parts.m, parts.d, 23, 59, 59, 999).getTime();
}

function getCurrentFilterKey() {
  return buildFilterParams().toString();
}

function filtersMatchLastApplied() {
  return getCurrentFilterKey() === _lastAppliedFilterKey;
}



function buildFilterParams() {

  const p = new URLSearchParams();

  const severity = document.getElementById('sl-filter-severity')?.value || '';

  const eventType = document.getElementById('sl-filter-event')?.value || '';

  const source = document.getElementById('sl-filter-source')?.value || '';

  const userId = document.getElementById('sl-filter-user')?.value || '';

  const q = document.getElementById('sl-search')?.value?.trim() || '';

  const from = document.getElementById('sl-date-from')?.value || '';

  const to = document.getElementById('sl-date-to')?.value || '';



  if (severity) p.set('severity', severity);

  if (eventType) p.set('eventType', eventType);

  if (source) p.set('source', source);

  if (userId) p.set('userId', userId);

  if (q) p.set('q', q);

  if (from) {
    const fromMs = startOfLocalDayMs(from);
    if (Number.isFinite(fromMs)) p.set('from', String(fromMs));
  }

  if (to) {

    const toMs = endOfLocalDayMs(to);
    if (Number.isFinite(toMs)) p.set('to', String(toMs));

  }

  return p;

}



function filtersAreActive() {

  const p = buildFilterParams();

  return [...p.keys()].length > 0;

}



function formatTimestamp(ms) {

  if (ms == null || !Number.isFinite(ms)) return '—';

  return new Date(ms).toLocaleString();

}



function severityBadgeClass(severity) {

  const s = String(severity || '').toLowerCase();

  if (s === 'critical') return 'sl-badge sl-badge--critical';

  if (s === 'error') return 'sl-badge sl-badge--error';

  if (s === 'warning') return 'sl-badge sl-badge--warning';

  return 'sl-badge sl-badge--info';

}



function renderSkeletonRows() {

  return Array.from({ length: SKELETON_ROWS }, () => `

    <tr class="sl-skeleton-row">

      <td><span class="sl-skeleton"></span></td>

      <td><span class="sl-skeleton sl-skeleton--short"></span></td>

      <td><span class="sl-skeleton sl-skeleton--med"></span></td>

      <td><span class="sl-skeleton sl-skeleton--short"></span></td>

      <td><span class="sl-skeleton"></span></td>

      <td><span class="sl-skeleton sl-skeleton--short"></span></td>

    </tr>`).join('');

}



function renderTable() {

  const tbody = document.getElementById('sl-tbody');

  const card = document.getElementById('sl-table-card');

  if (!tbody) return;



  if (card) card.classList.toggle('is-loading', _loading && _items.length > 0);



  const errEl = document.getElementById('sl-error');

  if (errEl) {

    const showMsg = _error || _indexNotice;

    errEl.style.display = showMsg ? '' : 'none';

    errEl.textContent = showMsg || '';

    errEl.classList.toggle('sl-error-banner--info', !_error && !!_indexNotice);

  }



  if (_loading && !_items.length) {

    tbody.innerHTML = renderSkeletonRows();

    return;

  }



  if (_error && !_items.length) {

    tbody.innerHTML = '<tr><td colspan="6" class="sl-empty">Could not load logs. Use Refresh to retry.</td></tr>';

    return;

  }



  if (!_items.length) {

    tbody.innerHTML = '<tr><td colspan="6" class="sl-empty">No logs match your filters.</td></tr>';

    return;

  }



  tbody.innerHTML = _items

    .map(

      (item) => `

    <tr class="sl-row" data-id="${escHtml(item.id)}">

      <td class="sl-ts">${escHtml(formatTimestamp(item.createdAt))}</td>

      <td><span class="${severityBadgeClass(item.severity)}">${escHtml(item.severity || '')}</span></td>

      <td class="sl-mono">${escHtml(item.eventType || '')}</td>

      <td>${escHtml(item.source || '')}</td>

      <td class="sl-desc">${escHtml(item.description || '')}</td>

      <td>${escHtml(formatLogUser(item))}</td>

    </tr>`,

    )

    .join('');



  tbody.querySelectorAll('.sl-row').forEach((row) => {

    row.addEventListener('click', () => {

      const id = row.getAttribute('data-id');

      const item = _items.find((x) => x.id === id);

      if (item) openDetailModal(item);

    });

  });



  _knownIds = new Set(_items.map((i) => i.id));

  if (_items[0]?.createdAt) _newestLoadedAt = _items[0].createdAt;

}



function updatePaginationUi() {

  const prev = document.getElementById('sl-prev');

  const next = document.getElementById('sl-next');

  const pageLabel = document.getElementById('sl-page-label');

  const rangeLabel = document.getElementById('sl-range-label');

  const pageNum = _cursorStack.length + 1;



  if (prev) prev.disabled = _cursorStack.length === 0 || _loading;

  if (next) next.disabled = !_hasMore || _loading;



  if (pageLabel) {

    if (_totalPages != null) {

      pageLabel.textContent = `Page ${pageNum} of ${_totalPages}`;

    } else if (_hasMore) {

      pageLabel.textContent = `Page ${pageNum} · more available`;

    } else if (pageNum > 1 || _items.length) {

      pageLabel.textContent = `Page ${pageNum}`;

    } else {

      pageLabel.textContent = 'No results';

    }

  }



  if (rangeLabel) {

    if (_loading && !_items.length) {

      rangeLabel.textContent = 'Loading logs…';

    } else if (!_items.length && !_loading) {

      rangeLabel.textContent = 'No entries on this page';

    } else {

      const start = (pageNum - 1) * PAGE_SIZE + 1;

      const end = (pageNum - 1) * PAGE_SIZE + _items.length;

      if (_totalCount != null) {

        rangeLabel.textContent = `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${_totalCount.toLocaleString()} entries`;

      } else {

        rangeLabel.textContent = `Showing ${start.toLocaleString()}–${end.toLocaleString()}${_hasMore ? ' (more pages available)' : ''}`;

      }

    }

  }

}



function updateActionButtons() {

  const perms = getPerms();

  document.getElementById('sl-export-csv')?.classList.toggle('is-hidden', !perms.canExportLogs);

  document.getElementById('sl-export-xlsx')?.classList.toggle('is-hidden', !perms.canExportLogs);

  document.getElementById('sl-clear')?.classList.toggle('is-hidden', !perms.canClearLogs);

}



function wireChipGroup(containerId, hiddenInputId, chips, allLabel = 'All', onChange = null) {

  const container = document.getElementById(containerId);

  const hidden = document.getElementById(hiddenInputId);

  if (!container || !hidden) return;



  const allBtn = document.createElement('button');

  allBtn.type = 'button';

  allBtn.className = 'sl-chip active';

  allBtn.dataset.value = '';

  allBtn.textContent = allLabel;

  container.appendChild(allBtn);



  chips.forEach((chip) => {

    const btn = document.createElement('button');

    btn.type = 'button';

    btn.className = 'sl-chip';

    btn.dataset.value = chip.value;

    btn.textContent = chip.label;

    container.appendChild(btn);

  });



  container.addEventListener('click', (e) => {

    const btn = e.target.closest('.sl-chip');

    if (!btn) return;

    container.querySelectorAll('.sl-chip').forEach((b) => b.classList.remove('active'));

    btn.classList.add('active');

    hidden.value = btn.dataset.value || '';
    onChange?.();

  });

}



function populateEventSelect() {

  const evt = document.getElementById('sl-filter-event');

  if (!evt || evt.options.length > 1) return;



  EVENT_TYPE_GROUPS.forEach((group) => {

    const og = document.createElement('optgroup');

    og.label = group.label;

    group.options.forEach((o) => {

      const opt = document.createElement('option');

      opt.value = o.value;

      opt.textContent = o.label;

      og.appendChild(opt);

    });

    evt.appendChild(og);

  });

}



function labelForEvent(value) {

  for (const g of EVENT_TYPE_GROUPS) {

    const found = g.options.find((o) => o.value === value);

    if (found) return found.label;

  }

  return value;

}



function labelForUserFilter(value) {

  if (!value) return 'All users';

  if (value === SYSTEM_LOG_USER_FILTER_SYSTEM) return 'System (automated)';

  const evalMatch = EVAL_RESPONDENTS.find((r) => r.userId === value);

  if (evalMatch) return evalMatch.userName;

  const farm = getUsersList().find((u) => u.id === value);

  return farm?.displayName || value;

}



function populateUserSelect() {

  const sel = document.getElementById('sl-filter-user');

  if (!sel) return;

  const prev = sel.value;

  sel.innerHTML = '<option value="">All users</option>';

  const sysOpt = document.createElement('option');

  sysOpt.value = SYSTEM_LOG_USER_FILTER_SYSTEM;

  sysOpt.textContent = 'System (automated)';

  sel.appendChild(sysOpt);



  const evalGroup = document.createElement('optgroup');

  evalGroup.label = 'Evaluation respondents';

  EVAL_RESPONDENTS.forEach((r) => {

    const opt = document.createElement('option');

    opt.value = r.userId;

    opt.textContent = r.userName;

    evalGroup.appendChild(opt);

  });

  sel.appendChild(evalGroup);



  const farmUsers = getUsersList().filter(

    (u) => !EVAL_RESPONDENTS.some((e) => e.userId === u.id),

  );

  if (farmUsers.length) {

    const farmGroup = document.createElement('optgroup');

    farmGroup.label = 'Farm users';

    farmUsers.forEach((u) => {

      const opt = document.createElement('option');

      opt.value = u.id;

      opt.textContent = u.displayName;

      farmGroup.appendChild(opt);

    });

    sel.appendChild(farmGroup);

  }



  if (prev && [...sel.options].some((o) => o.value === prev)) {

    sel.value = prev;

  }

}



async function loadUserDirectory() {

  try {

    await loadUsers();

    setFarmUsersForLogs(getUsersList());

    populateUserSelect();

  } catch (e) {

    console.warn('[SystemLogs] Could not load users for filters:', e);

    setFarmUsersForLogs([]);

    populateUserSelect();

  }

}



function updateActiveFilterChips() {

  const wrap = document.getElementById('sl-active-filters');

  if (!wrap) return;



  const chips = [];

  const q = document.getElementById('sl-search')?.value?.trim();

  const severity = document.getElementById('sl-filter-severity')?.value;

  const source = document.getElementById('sl-filter-source')?.value;

  const eventType = document.getElementById('sl-filter-event')?.value;

  const userId = document.getElementById('sl-filter-user')?.value;

  const from = document.getElementById('sl-date-from')?.value;

  const to = document.getElementById('sl-date-to')?.value;



  if (q) chips.push({ key: 'q', label: `Search: “${q}”` });

  if (severity) {

    const lbl = SEVERITY_CHIPS.find((c) => c.value === severity)?.label || severity;

    chips.push({ key: 'severity', label: `Severity: ${lbl}` });

  }

  if (source) {

    const lbl = SOURCE_CHIPS.find((c) => c.value === source)?.label || source;

    chips.push({ key: 'source', label: `Source: ${lbl}` });

  }

  if (eventType) chips.push({ key: 'eventType', label: `Event: ${labelForEvent(eventType)}` });

  if (userId) chips.push({ key: 'user', label: `User: ${labelForUserFilter(userId)}` });

  if (from || to || document.getElementById('sl-date-preset')?.value) {
    chips.push({ key: 'dates', label: `Dates: ${labelForDateFilter()}` });
  }



  if (!chips.length) {

    wrap.hidden = true;

    wrap.innerHTML = '';

    return;

  }



  wrap.hidden = false;

  wrap.innerHTML = chips

    .map(

      (c) =>

        `<span class="sl-active-chip">${escHtml(c.label)}<button type="button" data-clear="${escHtml(c.key)}" aria-label="Remove filter">×</button></span>`,

    )

    .join('');



  wrap.querySelectorAll('[data-clear]').forEach((btn) => {

    btn.addEventListener('click', () => clearFilterKey(btn.getAttribute('data-clear')));

  });

}



function clearFilterKey(key) {

  if (key === 'q') document.getElementById('sl-search').value = '';

  if (key === 'severity') setChipValue('sl-severity-chips', 'sl-filter-severity', '');

  if (key === 'source') setChipValue('sl-source-chips', 'sl-filter-source', '');

  if (key === 'eventType') document.getElementById('sl-filter-event').value = '';

  if (key === 'user') document.getElementById('sl-filter-user').value = '';

  if (key === 'dates') {

    const presetEl = document.getElementById('sl-date-preset');

    if (presetEl) presetEl.value = '';

    document.getElementById('sl-date-from').value = '';

    document.getElementById('sl-date-to').value = '';

    syncDatePresetUi();

  }

  updateActiveFilterChips();

  applyFilters();

}



function setChipValue(containerId, hiddenInputId, value) {

  const container = document.getElementById(containerId);

  const hidden = document.getElementById(hiddenInputId);

  if (!container || !hidden) return;

  hidden.value = value;

  container.querySelectorAll('.sl-chip').forEach((btn) => {

    btn.classList.toggle('active', (btn.dataset.value || '') === value);

  });

}



function clearAllFilters() {

  document.getElementById('sl-search').value = '';

  setChipValue('sl-severity-chips', 'sl-filter-severity', '');

  setChipValue('sl-source-chips', 'sl-filter-source', '');

  document.getElementById('sl-filter-event').value = '';

  document.getElementById('sl-filter-user').value = '';

  const presetEl = document.getElementById('sl-date-preset');

  if (presetEl) presetEl.value = '';

  document.getElementById('sl-date-from').value = '';

  document.getElementById('sl-date-to').value = '';

  syncDatePresetUi();

  updateActiveFilterChips();

}

async function applyFilters({ includeCount = true, suppressValidationToast = true } = {}) {
  updateActiveFilterChips();
  await fetchLogs({ resetStack: true, includeCount, suppressValidationToast });
}

function scheduleSearchApply() {
  if (_searchApplyTimer) clearTimeout(_searchApplyTimer);
  _searchApplyTimer = setTimeout(() => {
    _searchApplyTimer = null;
    applyFilters();
  }, SEARCH_APPLY_DEBOUNCE_MS);
}



function formatDateYmd(date) {

  const y = date.getFullYear();

  const m = String(date.getMonth() + 1).padStart(2, '0');

  const d = String(date.getDate()).padStart(2, '0');

  return `${y}-${m}-${d}`;

}



function syncDatePresetUi() {

  const preset = document.getElementById('sl-date-preset')?.value || '';

  const custom = document.getElementById('sl-custom-dates');

  if (custom) custom.classList.toggle('is-hidden', preset !== 'custom');

}



function applyDatePresetValues(preset) {

  const fromEl = document.getElementById('sl-date-from');

  const toEl = document.getElementById('sl-date-to');

  if (!fromEl || !toEl) return;



  if (!preset || preset === 'custom') {

    if (!preset) {

      fromEl.value = '';

      toEl.value = '';

    }

    return;

  }



  const end = new Date();

  const start = new Date();



  if (preset === 'today') {

    fromEl.value = formatDateYmd(end);

    toEl.value = formatDateYmd(end);

  } else if (preset === '7d') {

    start.setDate(start.getDate() - 6);

    fromEl.value = formatDateYmd(start);

    toEl.value = formatDateYmd(end);

  } else if (preset === '30d') {

    start.setDate(start.getDate() - 29);

    fromEl.value = formatDateYmd(start);

    toEl.value = formatDateYmd(end);

  } else if (preset === 'eval') {

    fromEl.value = '2026-05-25';

    toEl.value = '2026-05-28';

  }

}



function labelForDateFilter() {

  const preset = document.getElementById('sl-date-preset')?.value || '';

  const from = document.getElementById('sl-date-from')?.value || '';

  const to = document.getElementById('sl-date-to')?.value || '';

  const presetLabels = {

    today: 'Today',

    '7d': 'Last 7 days',

    '30d': 'Last 30 days',

    eval: 'Evaluation (May 25–28)',

    custom: 'Custom',

  };

  if (preset && preset !== 'custom') return presetLabels[preset] || preset;

  if (from && to) return `${from} – ${to}`;

  if (from || to) return `${from || '…'} – ${to || '…'}`;

  return 'All time';

}



function validateDateRange() {

  const preset = document.getElementById('sl-date-preset')?.value || '';

  const from = document.getElementById('sl-date-from')?.value || '';

  const to = document.getElementById('sl-date-to')?.value || '';



  if (preset === 'custom') {

    if (!from || !to) return 'Choose a start and end date for your custom range.';

    if (from > to) return 'Start date must be on or before the end date.';

    return null;

  }



  if ((from && !to) || (!from && to)) {

    return 'Choose both start and end dates, or clear the date fields.';

  }

  if (from && to && from > to) return 'Start date must be on or before the end date.';

  return null;

}



async function fetchLogs({ cursor = null, resetStack = false, includeCount = false, suppressValidationToast = false } = {}) {

  const dateErr = validateDateRange();

  if (dateErr) {

    if (!suppressValidationToast) showAppToast(dateErr, 'error');

    return;

  }



  _fetchAbort?.abort();

  const controller = new AbortController();

  _fetchAbort = controller;

  const generation = ++_fetchGeneration;



  _loading = true;

  if (resetStack) {

    _totalCount = null;

    _totalPages = null;

  }

  _error = null;

  renderTable();

  updatePaginationUi();



  try {

    const token = await fbGetIdToken();

    if (!token) throw new Error('Not signed in.');



    const params = buildFilterParams();

    params.set('pageSize', String(PAGE_SIZE));

    if (cursor) params.set('cursor', cursor);

    if (includeCount || (resetStack && !cursor)) params.set('includeCount', '1');



    const resp = await fetch(`/api/system-logs?${params}`, {

      headers: { Authorization: `Bearer ${token}` },

      signal: controller.signal,

    });

    if (generation !== _fetchGeneration) return;



    const data = await resp.json();

    if (!resp.ok) {

      if (data.code === 'INDEX_BUILDING') {

        throw new Error(

          'Firestore indexes are still building (usually 2–10 minutes). Open the Firebase Console → Firestore → Indexes, wait until status is Enabled, then click Refresh.',

        );

      }

      throw new Error(data.error || 'Failed to load logs.');

    }



    _indexNotice = resp.headers.get('X-System-Logs-Index-Fallback') === '1'

      ? 'Indexes are still building — results may load slower until indexes are Enabled.'

      : null;



    _items = data.items || [];

    _nextCursor = data.nextCursor || null;

    _hasMore = !!data.hasMore;

    if (data.totalCount != null) _totalCount = data.totalCount;

    if (data.totalPages != null) _totalPages = data.totalPages;



    if (resetStack) {

      _cursorStack = [];

      _currentPageCursor = null;
      _lastAppliedFilterKey = getCurrentFilterKey();

    }



    updateActiveFilterChips();

    updatePaginationUi();

    renderTable();

    setupRealtimeIfEligible();

  } catch (e) {

    if (e?.name === 'AbortError') return;

    if (generation !== _fetchGeneration) return;

    _error = e?.message || String(e);

    if (!cursor) _items = [];

    renderTable();

  } finally {

    if (generation === _fetchGeneration) {

      _loading = false;

      document.getElementById('sl-table-card')?.classList.remove('is-loading');

      updatePaginationUi();

    }

  }

}



function canUseRealtime() {

  if (!_pageActive) return false;

  if (_cursorStack.length > 0) return false;

  if (filtersAreActive()) return false;

  return true;

}



function teardownRealtime() {

  if (_realtimeUnsub) {

    _realtimeUnsub();

    _realtimeUnsub = null;

  }

}



function setupRealtimeIfEligible() {

  teardownRealtime();

  if (!canUseRealtime()) return;



  const fs = fbFirestore();

  if (!fs) return;



  const q = fbQuery(

    fbCollection(fs, SYSTEM_LOGS_COLLECTION),

    fbOrderBy('createdAt', 'desc'),

    fbLimit(15),

  );



  _realtimeUnsub = fbOnSnapshot(

    q,

    (snap) => {

      const additions = [];

      snap.docChanges().forEach((change) => {

        if (change.type !== 'added') return;

        const id = change.doc.id;

        if (_knownIds.has(id)) return;

        const d = change.doc.data();

        let createdAtMs = null;

        const ca = d.createdAt;

        if (ca && typeof ca.toMillis === 'function') createdAtMs = ca.toMillis();

        else if (ca?.seconds != null) createdAtMs = ca.seconds * 1000;

        if (createdAtMs != null && createdAtMs <= _newestLoadedAt) return;



        additions.push({

          id,

          createdAt: createdAtMs,

          eventType: d.eventType,

          severity: d.severity,

          source: d.source,

          description: d.description,

          userId: d.userId || null,

          userName: d.userName || null,

          metadata: d.metadata || null,

        });

      });



      if (!additions.length) return;

      additions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      _items = [...additions, ..._items].slice(0, PAGE_SIZE + additions.length);

      _knownIds = new Set(_items.map((i) => i.id));

      if (_items[0]?.createdAt) _newestLoadedAt = _items[0].createdAt;

      renderTable();

    },

    (err) => {

      if (String(err?.message || '').includes('index')) {

        _indexNotice =

          'Live updates paused while Firestore indexes finish building. Use Refresh to reload the table.';

        renderTable();

      }

    },

  );

}



function openDetailModal(item) {

  const meta =

    item.metadata && Object.keys(item.metadata).length

      ? JSON.stringify(item.metadata, null, 2)

      : '—';



  const dlg = document.createElement('dialog');

  dlg.className = 'um-modal app-modal';

  dlg.innerHTML = `

    <div class="um-modal-inner">

      <div class="um-modal-head">

        <div>

          <div class="um-modal-title">Log details</div>

          <div class="um-modal-sub">${escHtml(item.eventType || '')}</div>

        </div>

        <button type="button" class="um-modal-close" data-action="close" aria-label="Close">

          <svg class="icon icon-20"><use href="#icon-x"/></svg>

        </button>

      </div>

      <div class="sl-detail-grid">

        <div class="sl-detail-row"><span class="sl-detail-label">Timestamp</span><span>${escHtml(formatTimestamp(item.createdAt))}</span></div>

        <div class="sl-detail-row"><span class="sl-detail-label">Severity</span><span class="${severityBadgeClass(item.severity)}">${escHtml(item.severity || '')}</span></div>

        <div class="sl-detail-row"><span class="sl-detail-label">Event type</span><span class="sl-mono">${escHtml(item.eventType || '')}</span></div>

        <div class="sl-detail-row"><span class="sl-detail-label">Source</span><span>${escHtml(item.source || '')}</span></div>

        <div class="sl-detail-row sl-detail-row--full"><span class="sl-detail-label">Description</span><span>${escHtml(item.description || '')}</span></div>

        <div class="sl-detail-row"><span class="sl-detail-label">User</span><span>${escHtml(formatLogUser(item))}</span></div>

        <div class="sl-detail-row"><span class="sl-detail-label">User ID</span><span class="sl-mono">${escHtml(item.userId || '—')}</span></div>

        <div class="sl-detail-row sl-detail-row--full"><span class="sl-detail-label">Metadata</span><pre class="sl-meta-pre">${escHtml(meta)}</pre></div>

      </div>

      <div class="um-modal-footer">

        <button type="button" class="btn btn-secondary" data-action="close">Close</button>

      </div>

    </div>`;



  document.body.appendChild(dlg);

  const { close } = wireAppDialog(dlg, { initialFocusSelector: '[data-action="close"]' });

  dlg.querySelectorAll('[data-action="close"]').forEach((btn) => {

    btn.addEventListener('click', () => {

      close();

      dlg.remove();

    });

  });

  dlg.showModal();

}



async function downloadExport(format) {

  const perms = getPerms();

  if (!perms.canExportLogs) return;



  try {

    const token = await fbGetIdToken();

    const params = buildFilterParams();

    params.set('format', format);

    const resp = await fetch(`/api/system-logs/export?${params}`, {

      headers: { Authorization: `Bearer ${token}` },

    });

    if (!resp.ok) {

      const data = await resp.json().catch(() => ({}));

      throw new Error(data.error || 'Export failed.');

    }

    const blob = await resp.blob();

    const ext = format === 'csv' ? 'csv' : 'xls';

    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');

    a.href = url;

    a.download = `system-logs.${ext}`;

    a.click();

    URL.revokeObjectURL(url);

  } catch (e) {

    alert(e?.message || String(e));

  }

}



async function clearLogs() {

  const perms = getPerms();

  if (!perms.canClearLogs) return;



  const ok = await showConfirmModal({

    title: 'Clear system logs',

    message:

      'Delete all logs matching the current filters? This cannot be undone. An audit entry will be recorded.',

    confirmLabel: 'Clear logs',

    variant: 'danger',

  });

  if (!ok) return;



  try {

    const token = await fbGetIdToken();

    const params = buildFilterParams();

    const resp = await fetch(`/api/system-logs?${params}`, {

      method: 'DELETE',

      headers: { Authorization: `Bearer ${token}` },

    });

    const data = await resp.json();

    if (!resp.ok) throw new Error(data.error || 'Clear failed.');

    await fetchLogs({ resetStack: true, includeCount: true });

  } catch (e) {

    alert(e?.message || String(e));

  }

}



export function loadSystemLogs() {

  if (!getPerms().canViewLogs) return;

  fetchLogs({ resetStack: true, includeCount: true });

}



export function onPageActivated(page) {

  _pageActive = page === 'system-logs';

  if (_pageActive) {

    updateActionButtons();

    loadUserDirectory().then(() => loadSystemLogs());

  } else {

    teardownRealtime();

  }

}



export function init() {

  wireChipGroup('sl-severity-chips', 'sl-filter-severity', SEVERITY_CHIPS, 'All', () => applyFilters());

  wireChipGroup('sl-source-chips', 'sl-filter-source', SOURCE_CHIPS, 'All', () => applyFilters());

  populateEventSelect();

  populateUserSelect();

  updateActionButtons();



  document.getElementById('sl-apply')?.addEventListener('click', () => {

    applyFilters({ suppressValidationToast: false });

  });



  document.getElementById('sl-clear-filters')?.addEventListener('click', () => {

    clearAllFilters();

    applyFilters();

  });



  document.getElementById('sl-search')?.addEventListener('keydown', (e) => {

    if (e.key === 'Enter') {

      e.preventDefault();

      if (_searchApplyTimer) clearTimeout(_searchApplyTimer);
      _searchApplyTimer = null;
      applyFilters({ suppressValidationToast: false });

    }

  });

  document.getElementById('sl-search')?.addEventListener('input', () => {
    updateActiveFilterChips();
    scheduleSearchApply();
  });



  document.getElementById('sl-date-preset')?.addEventListener('change', (e) => {

    const preset = e.target.value || '';

    applyDatePresetValues(preset);

    syncDatePresetUi();

    applyFilters();

  });

  ['sl-date-from', 'sl-date-to'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => {
      const presetEl = document.getElementById('sl-date-preset');
      if (presetEl && presetEl.value !== 'custom') presetEl.value = 'custom';
      syncDatePresetUi();
      applyFilters();
    });
  });

  document.getElementById('sl-filter-user')?.addEventListener('change', () => applyFilters());
  document.getElementById('sl-filter-event')?.addEventListener('change', () => applyFilters());



  syncDatePresetUi();



  document.getElementById('sl-refresh')?.addEventListener('click', () => {

    createLog({

      eventType: 'dashboard.refresh',

      severity: 'info',

      source: 'user',

      description: 'System logs table refreshed',

    });

    applyFilters({ suppressValidationToast: false });

  });



  document.getElementById('sl-prev')?.addEventListener('click', () => {

    if (_cursorStack.length === 0) return;
    if (!filtersMatchLastApplied()) {
      applyFilters();
      return;
    }

    _currentPageCursor = _cursorStack.pop() ?? null;

    fetchLogs({ cursor: _currentPageCursor });

  });



  document.getElementById('sl-next')?.addEventListener('click', () => {

    if (!_hasMore || !_nextCursor) return;
    if (!filtersMatchLastApplied()) {
      applyFilters();
      return;
    }

    _cursorStack.push(_currentPageCursor);

    _currentPageCursor = _nextCursor;

    fetchLogs({ cursor: _nextCursor });

  });



  document.getElementById('sl-export-csv')?.addEventListener('click', () => downloadExport('csv'));

  document.getElementById('sl-export-xlsx')?.addEventListener('click', () => downloadExport('xlsx'));

  document.getElementById('sl-clear')?.addEventListener('click', clearLogs);



  window.addEventListener('page-activated', (e) => {

    onPageActivated(e.detail?.page);

  });

  _lastAppliedFilterKey = getCurrentFilterKey();

}


