/**
 * Historical Data feature.
 *
 * Works exactly like the dashboard "Water Quality Trends" chart:
 *   - Each stored reading is pushed as an individual point (no bucketing/averaging)
 *   - On range change the chart is cleared and replayed from the history store
 *   - On every new sensor reading the point is appended live (if it falls in range)
 *
 * Ranges:
 *   24h   → x-axis label: HH:MM
 *   week  → Mon 00:00 – Sun 23:59 of the current week, label: ddd HH:MM
 *   month → 1st – last day of current month, label: MM-DD HH:MM
 *   custom → user-supplied dates, label: MM-DD HH:MM
 */
import { initHistoricalChart, updateHistoricalChart } from '../charts.js';
import { getHistoryRange, getThresholds, saveThresholds, resetThresholds, spkData, mergeHistoryEntries } from '../utils.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, '0'); }
function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function fmtTime(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function getRange(rangeVal, customFrom, customTo) {
  const now = new Date();
  if (rangeVal === '24h') {
    return { from: new Date(now - 24*60*60*1000), to: now };
  }
  if (rangeVal === 'week') {
    const day = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
    mon.setHours(0, 0, 0, 0);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    sun.setHours(23, 59, 59, 999);
    return { from: mon, to: sun };
  }
  if (rangeVal === 'month') {
    return {
      from: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
      to:   new Date(now.getFullYear(), now.getMonth()+1, 0, 23, 59, 59, 999),
    };
  }
  if (rangeVal === 'custom' && customFrom && customTo) {
    return {
      from: new Date(customFrom + 'T00:00:00'),
      to:   new Date(customTo   + 'T23:59:59'),
    };
  }
  return { from: new Date(now - 24*60*60*1000), to: now };
}

function statsOf(readings, key) {
  const nums = readings.map(r => r[key]).filter(v => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return null;
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return { avg, min: Math.min(...nums), max: Math.max(...nums) };
}

function badgeClass(key, val) {
  const t = getThresholds()[key];
  if (!t || val == null) return 'ok';
  if (val >= t.ok[0] && val <= t.ok[1]) return 'ok';
  if (val >= t.warn[0] && val <= t.warn[1]) return 'warn';
  return 'danger';
}

// ─── main init ──────────────────────────────────────────────────────────────

export function init() {
  const histEl   = document.getElementById('hist-chart');
  const histChart = histEl ? initHistoricalChart(histEl) : null;

  let activeRange  = 'week';
  let activeMetric = 'all';
  let customFrom   = '';
  let customTo     = '';

  // ── range selector ────────────────────────────────────────────────────────
  const rangeEl       = document.getElementById('hist-range');
  const customRangeEl = document.getElementById('hist-custom-range');

  rangeEl?.addEventListener('change', () => {
    activeRange = rangeEl.value;
    if (customRangeEl) customRangeEl.style.display = activeRange === 'custom' ? 'flex' : 'none';
    if (activeRange !== 'custom') refresh();
  });

  document.getElementById('btn-hist-apply')?.addEventListener('click', () => {
    customFrom = document.getElementById('hist-from')?.value || '';
    customTo   = document.getElementById('hist-to')?.value   || '';
    if (!customFrom || !customTo) { alert('Select both From and To dates.'); return; }
    if (new Date(customFrom) > new Date(customTo)) { alert('From must be before To.'); return; }
    refresh();
  });

  // ── metric tabs ───────────────────────────────────────────────────────────
  document.querySelectorAll('.hist-metric-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.hist-metric-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeMetric = btn.getAttribute('data-metric') || 'all';
      // Just toggle visibility — no need to re-fetch data
      if (histChart) updateHistoricalChart(histChart, null, null, activeMetric);
    });
  });

  // ── export CSV ────────────────────────────────────────────────────────────
  document.getElementById('btn-hist-download')?.addEventListener('click', () => {
    const { from, to } = getRange(activeRange, customFrom, customTo);
    const readings = getHistoryRange(from.getTime(), to.getTime());
    if (!readings.length) { alert('No data to export for this range.'); return; }
    const rows = [
      ['"Timestamp"','"pH"','"DO (mg/L)"','"Turbidity (NTU)"','"Temp (°C)"'],
      ...readings.map(r => [
        `"${fmtDateTime(new Date(r.ts))}"`,
        r.ph?.toFixed(2)   ?? '',
        r.do?.toFixed(2)   ?? '',
        r.turb?.toFixed(2) ?? '',
        r.temp?.toFixed(2) ?? '',
      ].join(','))
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + rows], { type: 'text/csv;charset=utf-8' }));
    a.download = `sensor_history_${activeRange}_${fmtDate(new Date())}.csv`;
    a.click();
  });

  // ── threshold dialog ──────────────────────────────────────────────────────
  const btn  = document.getElementById('btn-edit-thresholds');
  const dlg  = document.getElementById('thresh-dlg');
  const form = document.getElementById('thresh-form');

  if (btn && dlg && form) {
    const inputs = Array.from(form.querySelectorAll('input[data-th]'));
    const getByPath = (obj, path) => path.split('.').reduce((c, p) => c?.[p], obj);
    const setByPath = (obj, path, val) => {
      const parts = path.split('.');
      let c = obj;
      for (let i = 0; i < parts.length - 1; i++) { c = c[parts[i]]; if (!c) return; }
      c[parts[parts.length - 1]] = val;
    };
    const populate = () => {
      const t = getThresholds();
      inputs.forEach(inp => {
        const v = getByPath(t, inp.getAttribute('data-th') || '');
        inp.value = typeof v === 'number' ? String(v) : '';
      });
    };
    const readForm = () => {
      const next = JSON.parse(JSON.stringify(getThresholds()));
      inputs.forEach(inp => {
        const n = Number(inp.value);
        if (Number.isFinite(n)) setByPath(next, inp.getAttribute('data-th') || '', n);
      });
      return next;
    };

    btn.addEventListener('click', () => {
      const perms = window._rbacPerms;
      if (perms && !perms.canEditThresholds) { alert('Access denied: Owner or Admin required.'); return; }
      populate();
      if (typeof dlg.showModal === 'function') dlg.showModal();
    });
    document.getElementById('btn-thresh-cancel')?.addEventListener('click', () => dlg.close());
    document.getElementById('btn-thresh-reset')?.addEventListener('click', () => {
      resetThresholds(); populate();
      window.dispatchEvent(new CustomEvent('thresholds-changed'));
    });
    document.getElementById('btn-thresh-save')?.addEventListener('click', () => {
      saveThresholds(readForm());
      window.dispatchEvent(new CustomEvent('thresholds-changed'));
      dlg.close();
    });
  }

  window.addEventListener('thresholds-changed', () => refresh());

  // ── chart helpers ─────────────────────────────────────────────────────────

  /**
   * Build chart data from stored history for the current range.
   *
   * - 24h:   one point per hour (hourly average), labels "00:00"–"23:00"
   * - week:  one point per day Mon–Sun (always all 7 days), label "Mon"–"Sun"
   * - month / custom: one point per calendar day, label "Apr 25" etc.
   */
  function buildChartData(readings, rangeVal, rangeFrom) {
    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

    // ── 24h: average per hour, always 24 buckets ──────────────────────────
    if (rangeVal === '24h') {
      // Build 24 hour-buckets keyed 0–23 relative to the start of the range
      const fromHour = new Date(rangeFrom);
      fromHour.setMinutes(0, 0, 0);
      const hourBuckets = Array.from({ length: 24 }, () => ({ ph: [], do: [], turb: [], temp: [] }));

      for (const r of readings) {
        const diffMs = r.ts - fromHour.getTime();
        const idx = Math.floor(diffMs / (60 * 60 * 1000));
        if (idx >= 0 && idx < 24) {
          for (const k of ['ph', 'do', 'turb', 'temp']) {
            if (typeof r[k] === 'number' && Number.isFinite(r[k])) hourBuckets[idx][k].push(r[k]);
          }
        }
      }

      const labels = hourBuckets.map((_, i) => {
        const d = new Date(fromHour.getTime() + i * 60 * 60 * 1000);
        return `${pad(d.getHours())}:00`;
      });

      return {
        labels,
        ph:   hourBuckets.map(b => avg(b.ph)),
        do:   hourBuckets.map(b => avg(b.do)),
        turb: hourBuckets.map(b => avg(b.turb)),
        temp: hourBuckets.map(b => avg(b.temp)),
      };
    }

    // ── week: always Mon–Sun (7 buckets), missing days → null ─────────────
    if (rangeVal === 'week') {
      // rangeFrom is already Monday 00:00:00
      const mon = new Date(rangeFrom);
      mon.setHours(0, 0, 0, 0);
      const dayBuckets = Array.from({ length: 7 }, () => ({ ph: [], do: [], turb: [], temp: [] }));

      for (const r of readings) {
        const diffMs = r.ts - mon.getTime();
        const idx = Math.floor(diffMs / (24 * 60 * 60 * 1000));
        if (idx >= 0 && idx < 7) {
          for (const k of ['ph', 'do', 'turb', 'temp']) {
            if (typeof r[k] === 'number' && Number.isFinite(r[k])) dayBuckets[idx][k].push(r[k]);
          }
        }
      }

      const WEEK_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      return {
        labels: WEEK_LABELS,
        ph:   dayBuckets.map(b => avg(b.ph)),
        do:   dayBuckets.map(b => avg(b.do)),
        turb: dayBuckets.map(b => avg(b.turb)),
        temp: dayBuckets.map(b => avg(b.temp)),
      };
    }

    // ── month / custom: average per calendar day ──────────────────────────
    if (!readings.length) return { labels: [], ph: [], do: [], turb: [], temp: [] };

    const dayBuckets = {};  // key: 'YYYY-MM-DD'
    for (const r of readings) {
      const d = new Date(r.ts);
      const key = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      if (!dayBuckets[key]) dayBuckets[key] = { ph: [], do: [], turb: [], temp: [], d };
      for (const k of ['ph', 'do', 'turb', 'temp']) {
        if (typeof r[k] === 'number' && Number.isFinite(r[k])) dayBuckets[key][k].push(r[k]);
      }
    }

    const labels = [], ph = [], doArr = [], turb = [], temp = [];
    for (const key of Object.keys(dayBuckets).sort()) {
      const b = dayBuckets[key];
      labels.push(`${b.d.toLocaleString('default', { month: 'short' })} ${b.d.getDate()}`);
      ph.push(avg(b.ph));
      doArr.push(avg(b.do));
      turb.push(avg(b.turb));
      temp.push(avg(b.temp));
    }

    return { labels, ph, do: doArr, turb, temp };
  }

  /**
   * Load the chart from stored history for the current range.
   */
  function loadChart() {
    if (!histChart) return;

    const { from, to } = getRange(activeRange, customFrom, customTo);
    const readings = getHistoryRange(from.getTime(), to.getTime());

    const noDataEl  = document.getElementById('hist-no-data');
    const chartWrap = document.getElementById('hist-chart-wrap');

    // Toggle scrollable class for 24h view
    if (chartWrap) {
      chartWrap.classList.toggle('scrollable-24h', activeRange === '24h');
    }

    // No persisted history yet — fall back to live spkData buffer (same as dashboard)
    if (!readings.length) {
      const len = (spkData.ph || []).length;
      if (!len) {
        if (noDataEl)  noDataEl.style.display  = 'flex';
        if (chartWrap) chartWrap.style.display = 'none';
        updateHistoricalChart(histChart, [], { ph: [], do: [], turb: [], temp: [] }, activeMetric);
        return;
      }

      if (noDataEl)  noDataEl.style.display  = 'none';
      if (chartWrap) chartWrap.style.display = 'block';

      const now = Date.now();
      const labels = Array.from({ length: len }, (_, i) =>
        fmtTime(new Date(now - (len - 1 - i) * 5000))
      );
      updateHistoricalChart(histChart, labels, {
        ph:   [...(spkData.ph   || [])],
        do:   [...(spkData.do   || [])],
        turb: [...(spkData.turb || [])],
        temp: [...(spkData.temp || [])],
      }, activeMetric);
      return;
    }

    if (noDataEl)  noDataEl.style.display  = 'none';
    if (chartWrap) chartWrap.style.display = 'block';

    const { labels, ph, do: doArr, turb, temp } = buildChartData(readings, activeRange, from.getTime());
    updateHistoricalChart(histChart, labels, { ph, do: doArr, turb, temp }, activeMetric);
  }

  // ── stat cards ────────────────────────────────────────────────────────────

  function updateStatCards() {
    const { from, to } = getRange(activeRange, customFrom, customTo);
    const readings = getHistoryRange(from.getTime(), to.getTime());

    for (const k of ['ph', 'do', 'turb', 'temp']) {
      const s = statsOf(readings, k);
      const avgEl   = document.getElementById(`hstat-${k}-avg`);
      const minEl   = document.getElementById(`hstat-${k}-min`);
      const maxEl   = document.getElementById(`hstat-${k}-max`);
      const badgeEl = document.getElementById(`hstat-${k}-badge`);
      if (avgEl) avgEl.textContent = s ? s.avg.toFixed(2) : '—';
      if (minEl) minEl.textContent = s ? s.min.toFixed(2) : '—';
      if (maxEl) maxEl.textContent = s ? s.max.toFixed(2) : '—';
      if (badgeEl) {
        if (s) {
          const c = badgeClass(k, s.avg);
          badgeEl.className = `hist-stat-badge ${c}`;
          badgeEl.textContent = c === 'ok' ? 'Normal' : c === 'warn' ? 'Warning' : 'Critical';
        } else {
          badgeEl.className = 'hist-stat-badge';
          badgeEl.textContent = '';
        }
      }
    }
  }

  // ── full refresh ──────────────────────────────────────────────────────────

  async function refresh() {
    // Fetch from RTDB first to get data recorded while browser was closed
    if (typeof window.fetchHistoryFromRTDB === 'function') {
      try {
        const { from, to } = getRange(activeRange, customFrom, customTo);
        const rtdbEntries = await window.fetchHistoryFromRTDB(from.getTime(), to.getTime());
        if (rtdbEntries.length) mergeHistoryEntries(rtdbEntries);
      } catch {
        // RTDB unavailable — fall back to local cache silently
      }
    }
    loadChart();
    updateStatCards();
  }

  // Initial render
  refresh();

  // Live append: when a new reading arrives, push it onto the chart if it
  // falls within the current range — exactly like pushChart on the dashboard.
  window.addEventListener('sensor-reading-recorded', () => {
    updateStatCards();

    if (!histChart) return;

    const { from, to } = getRange(activeRange, customFrom, customTo);
    const now = Date.now();

    // Only update if the current time is within the selected range
    if (now < from.getTime() || now > to.getTime()) return;

    // week / month / custom: daily averages — just reload the whole chart
    if (activeRange !== '24h') {
      loadChart();
      return;
    }

    // 24h: hourly buckets — reload the whole chart to recompute averages
    if (activeRange === '24h') {
      loadChart();
      return;
    }
  });
}
