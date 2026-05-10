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
import { getHistoryRange, spkData, mergeRtdbEntries, getBadge } from '../utils.js';

// ─── state ──────────────────────────────────────────────────────────────────

let weekOffset = 0;
let monthOffset = 0;

// ─── helpers ────────────────────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, '0'); }
function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function fmtTime(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fmtDateTime(d) { return `${fmtDate(d)} ${fmtTime(d)}`; }

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

/**
 * Format a 24-hour chart label with cross-day date disambiguation.
 * 
 * @param {Date} bucketEndDate - The end timestamp of the bucket
 * @param {number} bucketMs - The bucket size in milliseconds
 * @param {Date} windowStartDate - The start timestamp of the 24-hour window
 * @returns {string} Formatted label (e.g., "14:30" or "7 May 14:30")
 */
function format24hLabel(bucketEndDate, bucketMs, windowStartDate) {
  const startDay = windowStartDate.getDate();
  const endDay = bucketEndDate.getDate();
  const isCrossDay = startDay !== endDay;

  if (!isCrossDay) {
    // Same-day window: time only
    const opts = bucketMs >= 60 * 60 * 1000
      ? { hour: 'numeric' }
      : { hour: 'numeric', minute: '2-digit' };
    return bucketEndDate.toLocaleTimeString([], opts);
  }

  // Cross-day window: include date for labels on the later day
  const bucketDay = bucketEndDate.getDate();
  if (bucketDay === startDay) {
    // Earlier day: time only
    const opts = bucketMs >= 60 * 60 * 1000
      ? { hour: 'numeric' }
      : { hour: 'numeric', minute: '2-digit' };
    return bucketEndDate.toLocaleTimeString([], opts);
  } else {
    // Later day: "DD MMM HH:MM"
    const day = bucketEndDate.getDate();
    const month = bucketEndDate.toLocaleString('default', { month: 'short' });
    const time = bucketEndDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `${day} ${month} ${time}`;
  }
}

function getNavigatedRange(rangeVal, weekOffset, monthOffset, customFrom, customTo) {
  // Validate offsets: reset invalid values (NaN, Infinity) to 0
  const validWeekOffset = Number.isFinite(weekOffset) ? weekOffset : 0;
  const validMonthOffset = Number.isFinite(monthOffset) ? monthOffset : 0;

  const now = new Date();

  if (rangeVal === '24h') {
    // 24-hour range is always relative to "now" (no offset)
    return { from: new Date(now - 24*60*60*1000), to: now };
  }

  if (rangeVal === 'week') {
    // Compute the Monday of the current week
    const day = now.getDay();
    const currentMonday = new Date(now);
    currentMonday.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
    currentMonday.setHours(0, 0, 0, 0);

    // Apply offset (each offset unit = 7 days)
    const targetMonday = new Date(currentMonday);
    targetMonday.setDate(currentMonday.getDate() + validWeekOffset * 7);

    // Compute Sunday of the target week
    const targetSunday = new Date(targetMonday);
    targetSunday.setDate(targetMonday.getDate() + 6);
    targetSunday.setHours(23, 59, 59, 999);

    return { from: targetMonday, to: targetSunday };
  }

  if (rangeVal === 'month') {
    // Compute the first day of the target month
    const targetMonth = new Date(now.getFullYear(), now.getMonth() + validMonthOffset, 1, 0, 0, 0, 0);

    // Compute the last day of the target month
    const targetMonthEnd = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0, 23, 59, 59, 999);

    return { from: targetMonth, to: targetMonthEnd };
  }

  if (rangeVal === 'custom' && customFrom && customTo) {
    return {
      from: new Date(customFrom + 'T00:00:00'),
      to:   new Date(customTo   + 'T23:59:59'),
    };
  }

  // Fallback to 24h
  return { from: new Date(now - 24*60*60*1000), to: now };
}

function getRange(rangeVal, customFrom, customTo) {
  // Legacy wrapper for backward compatibility
  return getNavigatedRange(rangeVal, 0, 0, customFrom, customTo);
}

function updateNavigatorUI(rangeVal, weekOffset, monthOffset) {
  const weekNav = document.getElementById('hist-week-nav');
  const monthNav = document.getElementById('hist-month-nav');
  const weekPrevBtn = document.getElementById('hist-week-prev');
  const weekNextBtn = document.getElementById('hist-week-next');
  const monthPrevBtn = document.getElementById('hist-month-prev');
  const monthNextBtn = document.getElementById('hist-month-next');
  const weekLabel = document.getElementById('hist-week-label');
  const monthLabel = document.getElementById('hist-month-label');

  // Hide all navigators by default
  if (weekNav) weekNav.style.display = 'none';
  if (monthNav) monthNav.style.display = 'none';

  if (rangeVal === 'week') {
    // Show week navigator
    if (weekNav) weekNav.style.display = 'flex';

    // Update label
    const { from, to } = getNavigatedRange('week', weekOffset, 0, '', '');
    const monDay = from.getDate();
    const monMonth = from.toLocaleString('default', { month: 'short' });
    const sunDay = to.getDate();
    const sunMonth = to.toLocaleString('default', { month: 'short' });
    const year = to.getFullYear();
    if (weekLabel) {
      weekLabel.textContent = `Mon ${monDay} ${monMonth} – Sun ${sunDay} ${sunMonth} ${year}`;
    }

    // Enable/disable buttons
    if (weekPrevBtn) weekPrevBtn.disabled = false; // Always enabled
    if (weekNextBtn) weekNextBtn.disabled = (weekOffset >= 0); // Disable if at current week or future
  }

  if (rangeVal === 'month') {
    // Show month navigator
    if (monthNav) monthNav.style.display = 'flex';

    // Update label
    const { from } = getNavigatedRange('month', 0, monthOffset, '', '');
    const monthName = from.toLocaleString('default', { month: 'long' });
    const year = from.getFullYear();
    if (monthLabel) {
      monthLabel.textContent = `${monthName} ${year}`;
    }

    // Enable/disable buttons
    if (monthPrevBtn) monthPrevBtn.disabled = false; // Always enabled
    if (monthNextBtn) monthNextBtn.disabled = (monthOffset >= 0); // Disable if at current month or future
  }
}

function statsOf(readings, key) {
  const nums = readings.map(r => r[key]).filter(v => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return null;
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return { avg, min: Math.min(...nums), max: Math.max(...nums) };
}

function badgeClass(key, val) {
  if (val == null) return 'ok';
  return getBadge(key, val).c;
}

// ─── main init ──────────────────────────────────────────────────────────────

export function init() {
  const histEl   = document.getElementById('hist-chart');
  const histChart = histEl ? initHistoricalChart(histEl) : null;

  let activeRange  = '24h';
  let activeMetric = 'all';
  let customFrom   = '';
  let customTo     = '';
  let pinnedToLatest = true;
  let lastHourKey = '';
  let isPageActive = false;

  // Determine initial visibility (in case the app loads directly on this page).
  try {
    const pageEl = document.getElementById('page-historical-data');
    isPageActive = !!pageEl?.classList?.contains('active');
  } catch {
    // ignore
  }

  // ── range selector ────────────────────────────────────────────────────────
  const rangeEl       = document.getElementById('hist-range');
  const customRangeEl = document.getElementById('hist-custom-range');
  if (rangeEl) rangeEl.value = '24h';

  rangeEl?.addEventListener('change', () => {
    const previousRange = activeRange;
    activeRange = rangeEl.value;
    
    // Reset offsets when changing away from week or month
    // Preserve offsets when switching between week and month
    if (previousRange === 'week' && activeRange !== 'week' && activeRange !== 'month') {
      weekOffset = 0;
    }
    if (previousRange === 'month' && activeRange !== 'month' && activeRange !== 'week') {
      monthOffset = 0;
    }
    // Reset week offset when switching to week from non-month range
    if (activeRange === 'week' && previousRange !== 'month') {
      weekOffset = 0;
    }
    // Reset month offset when switching to month from non-week range
    if (activeRange === 'month' && previousRange !== 'week') {
      monthOffset = 0;
    }
    
    if (customRangeEl) customRangeEl.style.display = activeRange === 'custom' ? 'flex' : 'none';
    
    // Update navigator UI after range change
    updateNavigatorUI(activeRange, weekOffset, monthOffset);
    
    if (activeRange !== 'custom') refresh();
  });

  document.getElementById('btn-hist-apply')?.addEventListener('click', () => {
    customFrom = document.getElementById('hist-from')?.value || '';
    customTo   = document.getElementById('hist-to')?.value   || '';
    if (!customFrom || !customTo) { alert('Select both From and To dates.'); return; }
    if (new Date(customFrom) > new Date(customTo)) { alert('From must be before To.'); return; }
    refresh();
  });

  // ── navigation buttons ────────────────────────────────────────────────────
  document.getElementById('hist-week-prev')?.addEventListener('click', () => {
    weekOffset--;
    refresh();
  });

  document.getElementById('hist-week-next')?.addEventListener('click', () => {
    weekOffset++;
    refresh();
  });

  document.getElementById('hist-month-prev')?.addEventListener('click', () => {
    monthOffset--;
    refresh();
  });

  document.getElementById('hist-month-next')?.addEventListener('click', () => {
    monthOffset++;
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
  // Threshold editor UI intentionally removed from Historical Data.
  // If thresholds are changed elsewhere, refreshing keeps badges/stat cards in sync.
  window.addEventListener('thresholds-changed', () => refresh());

  // ── chart helpers ─────────────────────────────────────────────────────────

  /** Visible time buckets in the 24h chart viewport (iOS Health-style) */
  const VISIBLE_BUCKETS = 6;

  // Latest computed 24h bucketing (used for sizing the scrollable canvas)
  let last24hBucketCount = 24;

  /**
   * For the 24h range: expand the canvas to fit the full 24h bucket series but
   * only show VISIBLE_BUCKETS worth of width, then scroll to the right end so
   * the most-recent buckets are visible by default.
   * For all other ranges: reset to full-width (no scroll).
   */
  function resizeAndScrollChart(rangeVal) {
    const chartWrap = document.getElementById('hist-chart-wrap');
    const canvas    = document.getElementById('hist-chart');
    if (!chartWrap || !canvas || !histChart) return;

    const containerWidth  = chartWrap.clientWidth  || 600;
    const containerHeight = chartWrap.clientHeight || 300;

    if (rangeVal === '24h') {
      const bucketCount = Math.max(1, last24hBucketCount || 24);
      // Canvas is bucketCount / VISIBLE_BUCKETS × the container width so each bucket is equal-sized
      const totalWidth = Math.round(containerWidth * (bucketCount / VISIBLE_BUCKETS));
      canvas.style.width  = totalWidth + 'px';
      canvas.width        = totalWidth;
    } else {
      // Non-24h ranges fill the container normally
      canvas.style.width  = containerWidth + 'px';
      canvas.width        = containerWidth;
    }

    canvas.style.height = '100%';
    canvas.height       = containerHeight;
    histChart.resize();
    // Chart.js may not repaint after a manual canvas resize unless we force a redraw.
    histChart.update('none');

    // Only auto-follow latest if user hasn't scrolled away.
    requestAnimationFrame(() => {
      if (rangeVal === '24h' && pinnedToLatest) chartWrap.scrollLeft = chartWrap.scrollWidth;
    });
  }

  function median(nums) {
    const arr = nums.filter(n => typeof n === 'number' && Number.isFinite(n)).slice().sort((a, b) => a - b);
    if (!arr.length) return null;
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
  }

  function pick24hBucketMs(readings) {
    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
    // "Nice" bucket sizes; smaller = more detailed. Keep <= 288 buckets (5-min buckets).
    const NICE = [
      5 * 60 * 1000,   // 5m  → 288 buckets
      10 * 60 * 1000,  // 10m → 144 buckets
      15 * 60 * 1000,  // 15m → 96 buckets
      30 * 60 * 1000,  // 30m → 48 buckets
      60 * 60 * 1000,  // 1h  → 24 buckets
      2 * 60 * 60 * 1000, // 2h → 12 buckets
      3 * 60 * 60 * 1000, // 3h → 8 buckets
      4 * 60 * 60 * 1000, // 4h → 6 buckets
    ];

    if (!Array.isArray(readings) || readings.length < 4) return 60 * 60 * 1000;

    // Estimate sampling interval from recent data (robust to gaps)
    const ts = readings.map(r => r.ts).filter(n => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
    if (ts.length < 4) return 60 * 60 * 1000;

    const dts = [];
    for (let i = 1; i < ts.length; i++) {
      const dt = ts[i] - ts[i - 1];
      if (dt > 0 && dt <= 2 * 60 * 60 * 1000) dts.push(dt); // ignore big gaps
      if (dts.length >= 250) break;
    }
    const medDt = median(dts) || 60 * 1000;

    // Aim for ~30 samples per bucket, then snap upward to a "nice" bucket size.
    const target = Math.max(60 * 1000, Math.min(4 * 60 * 60 * 1000, medDt * 30));
    let chosen = NICE[NICE.length - 1];
    for (const b of NICE) {
      if (b >= target) { chosen = b; break; }
    }

    // Safety: keep bucket count reasonable (<=288) and >=6 so viewport makes sense.
    let buckets = Math.round(TWENTY_FOUR_HOURS_MS / chosen);
    if (buckets > 288) {
      chosen = 10 * 60 * 1000;
      buckets = Math.round(TWENTY_FOUR_HOURS_MS / chosen);
    }
    if (buckets < VISIBLE_BUCKETS) {
      chosen = 4 * 60 * 60 * 1000;
    }
    return chosen;
  }

  /**
   * Build chart data from stored history for the current range.
   *
   * - 24h:   time buckets (auto-picked size), show last 6 buckets by default
   * - week:  one point per day Mon–Sun (always all 7 days), label "Mon"–"Sun"
   * - month / custom: one point per calendar day, label "Apr 25" etc.
   */
  function buildChartData(readings, rangeVal, rangeFrom, rangeTo) {
    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

    // ── 24h: time buckets (dynamic), show 6 buckets at a time ─────────────
    // The canvas is widened so only the most recent 6 buckets are visible by default,
    // with horizontal scroll for earlier buckets (including across midnight).
    if (rangeVal === '24h') {
      const toMs = typeof rangeTo === 'number' && Number.isFinite(rangeTo) ? rangeTo : Date.now();
      const bucketMs = pick24hBucketMs(readings);
      const bucketCount = Math.max(1, Math.round((24 * 60 * 60 * 1000) / bucketMs));
      // Ensure the 24h window ends at "toMs" (now) like iOS Health
      const fromMs = toMs - bucketCount * bucketMs;
      const buckets = Array.from({ length: bucketCount }, () => ({ ph: [], do: [], turb: [], temp: [] }));

      for (const r of readings) {
        const diffMs = r.ts - fromMs;
        const idx = Math.floor(diffMs / bucketMs);
        if (idx >= 0 && idx < bucketCount) {
          for (const k of ['ph', 'do', 'turb', 'temp']) {
            if (typeof r[k] === 'number' && Number.isFinite(r[k])) buckets[idx][k].push(r[k]);
          }
        }
      }

      const windowStartDate = new Date(fromMs);
      const labels = buckets.map((_, i) => {
        const bucketEndDate = new Date(fromMs + (i + 1) * bucketMs);
        return format24hLabel(bucketEndDate, bucketMs, windowStartDate);
      });

      last24hBucketCount = bucketCount;
      return {
        labels,
        ph:   buckets.map(b => avg(b.ph)),
        do:   buckets.map(b => avg(b.do)),
        turb: buckets.map(b => avg(b.turb)),
        temp: buckets.map(b => avg(b.temp)),
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
    // Include all days in the selected range so missing days show as gaps.
    const startDay = new Date(rangeFrom);
    startDay.setHours(0, 0, 0, 0);

    const endDay = new Date(
      readings.length
        ? Math.max(...readings.map(r => r.ts).filter(Number.isFinite))
        : startDay.getTime(),
    );
    endDay.setHours(23, 59, 59, 999);

    const dayBuckets = {}; // key: 'YYYY-MM-DD'
    for (const r of readings) {
      const d = new Date(r.ts);
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (!dayBuckets[key]) dayBuckets[key] = { ph: [], do: [], turb: [], temp: [], d };
      for (const k of ['ph', 'do', 'turb', 'temp']) {
        if (typeof r[k] === 'number' && Number.isFinite(r[k])) dayBuckets[key][k].push(r[k]);
      }
    }

    const labels = [], ph = [], doArr = [], turb = [], temp = [];
    for (let d = new Date(startDay); d <= endDay; d.setDate(d.getDate() + 1)) {
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const b = dayBuckets[key];
      labels.push(`${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}`);
      ph.push(b ? avg(b.ph) : null);
      doArr.push(b ? avg(b.do) : null);
      turb.push(b ? avg(b.turb) : null);
      temp.push(b ? avg(b.temp) : null);
    }

    return { labels, ph, do: doArr, turb, temp };
  }

  /**
   * Load the chart from stored history for the current range.
   */
  function loadChart() {
    if (!histChart) return;

    const { from, to } = getNavigatedRange(activeRange, weekOffset, monthOffset, customFrom, customTo);
    const readings = getHistoryRange(from.getTime(), to.getTime());

    const noDataEl  = document.getElementById('hist-no-data');
    const chartWrap = document.getElementById('hist-chart-wrap');

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
      resizeAndScrollChart(activeRange);
      return;
    }

    if (noDataEl)  noDataEl.style.display  = 'none';
    if (chartWrap) chartWrap.style.display = 'block';

    const { labels, ph, do: doArr, turb, temp } = buildChartData(readings, activeRange, from.getTime(), to.getTime());
    updateHistoricalChart(histChart, labels, { ph, do: doArr, turb, temp }, activeMetric);
    resizeAndScrollChart(activeRange);
  }

  // ── stat cards ────────────────────────────────────────────────────────────

  function updateStatCards() {
    const { from, to } = getNavigatedRange(activeRange, weekOffset, monthOffset, customFrom, customTo);
    const readings = getHistoryRange(from.getTime(), to.getTime());

    for (const k of ['ph', 'do', 'turb', 'temp']) {
      const s = statsOf(readings, k);
      const avgEl   = document.getElementById(`hist-v-${k}`);
      const badgeEl = document.getElementById(`hist-b-${k}`);
      if (avgEl) avgEl.textContent = s ? s.avg.toFixed(2) : '—';
      if (badgeEl) {
        if (s) {
          const c = badgeClass(k, s.avg);
          badgeEl.className = `scard-badge ${c}`;
          badgeEl.textContent = c === 'ok' ? 'Normal' : c === 'warn' ? 'Warning' : 'Critical';
        } else {
          badgeEl.className = 'scard-badge';
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
        const { from, to } = getNavigatedRange(activeRange, weekOffset, monthOffset, customFrom, customTo);
        const rtdbEntries = await window.fetchHistoryFromRTDB(from.getTime(), to.getTime());
        if (rtdbEntries.length) mergeRtdbEntries(rtdbEntries);
      } catch {
        // RTDB unavailable — fall back to local cache silently
      }
    }
    
    // Update navigator UI after data fetch completes
    updateNavigatorUI(activeRange, weekOffset, monthOffset);
    
    loadChart();
    updateStatCards();
  }

  // Initial render
  refresh();

  // App-level auth hydration triggers this after login so charts can re-render
  // with persisted RTDB records even if initial page load happened pre-auth.
  window.addEventListener('history-cache-updated', () => {
    refresh();
  });

  // Track whether user is following the "latest" end of the 24h scroller.
  const chartWrap = document.getElementById('hist-chart-wrap');
  chartWrap?.addEventListener('scroll', () => {
    const slack = 24; // px tolerance
    pinnedToLatest = (chartWrap.scrollLeft + chartWrap.clientWidth) >= (chartWrap.scrollWidth - slack);
  }, { passive: true });

  // When the Historical Data page becomes visible, force a resize + redraw.
  window.addEventListener('page-activated', (e) => {
    const page = e?.detail?.page;
    isPageActive = page === 'historical-data';
    if (!isPageActive) return;
    // Ensure the chart uses the correct (now-visible) container size.
    resizeAndScrollChart(activeRange);
    // If the chart previously blanked due to a hidden resize, this forces a repaint.
    histChart?.update('none');
  });

  // If layout changes while active (window resize, sidebar collapse, etc.), keep canvas in sync.
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => {
      if (!isPageActive) return;
      resizeAndScrollChart(activeRange);
    });
    const wrap = document.getElementById('hist-chart-wrap');
    if (wrap) ro.observe(wrap);
  } else {
    window.addEventListener('resize', () => {
      if (!isPageActive) return;
      resizeAndScrollChart(activeRange);
    }, { passive: true });
  }

  // Auto-advance the 24h chart as time progresses even if no new readings arrive.
  // This keeps the initial 6h window truly "most recent 6 hours" over time,
  // while not interrupting users who scroll back in history.
  setInterval(() => {
    if (activeRange !== '24h') return;
    const now = new Date();
    const hourKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
    if (hourKey === lastHourKey) return;
    lastHourKey = hourKey;
    refresh();
  }, 30_000);

  // Live append: when a new reading arrives, push it onto the chart if it
  // falls within the current range — exactly like pushChart on the dashboard.
  window.addEventListener('sensor-reading-recorded', () => {
    updateStatCards();

    if (!histChart) return;

    // Only append live data if viewing the current period
    const isCurrentPeriod = (activeRange === 'week' && weekOffset === 0) ||
                            (activeRange === 'month' && monthOffset === 0) ||
                            (activeRange === '24h');

    if (!isCurrentPeriod) {
      // Viewing a past period — do not append live data
      return;
    }

    const { from, to } = getNavigatedRange(activeRange, weekOffset, monthOffset, customFrom, customTo);
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
