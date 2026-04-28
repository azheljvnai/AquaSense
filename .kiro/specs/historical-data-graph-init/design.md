# Historical Data Graph Init Bugfix Design

## Overview

When the user first navigates to the Historical Data page, the chart renders empty. The root cause is twofold: (1) `init()` sets `activeRange = 'week'` and the `<select>` element also defaults to `week`, so `refresh()` fetches only the current calendar week — which may contain no data — instead of the last 24 hours; and (2) even when the `24h` range is active and data exists, the chart does not scroll to show the most recent 6 hours by default.

The fix requires two targeted changes in `public/js/features/historical-data.js`:
- Change the initial `activeRange` value from `'week'` to `'24h'` and sync the `<select>` element to match.
- Ensure `resizeAndScrollChart` is called after the initial `refresh()` so the chart viewport is scrolled to the rightmost (most recent) position.

The HTML `<select>` in `public/index.html` also needs its `selected` attribute moved from the `week` option to the `24h` option so the UI reflects the correct default.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — the Historical Data page initializes with `activeRange = 'week'` instead of `'24h'`, causing an empty chart on first load
- **Property (P)**: The desired behavior — on initialization the page SHALL fetch and display the last 24 hours of data, with the chart scrolled to show the most recent 6 hours
- **Preservation**: All other range selections, metric tab switching, live append, CSV export, and custom date range behavior that must remain unchanged
- **activeRange**: The module-level variable in `public/js/features/historical-data.js` that controls which time window is fetched and rendered
- **refresh()**: The async function in `historical-data.js` that fetches RTDB data for the current range and then calls `loadChart()` and `updateStatCards()`
- **resizeAndScrollChart(rangeVal)**: The function in `historical-data.js` that sets the canvas width and scrolls `hist-chart-wrap` to the rightmost position
- **VISIBLE_HOURS**: Constant (6) controlling how many hours are visible in the `24h` chart viewport before horizontal scrolling

## Bug Details

### Bug Condition

The bug manifests when the user navigates to the Historical Data page for the first time. The `init()` function initializes `activeRange` to `'week'` and calls `refresh()`, which fetches only the current calendar week. If no readings exist for the current week (e.g., it is early Monday), the chart is empty. Even when data exists, the `24h` default view with a 6-hour visible window is never applied on initialization.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type PageNavigation
  OUTPUT: boolean

  RETURN input.targetPage == 'historical-data'
         AND activeRange == 'week'                  // initialized to wrong default
         AND NOT chartShowsLast24Hours(input)        // 24h data not fetched
         AND NOT chartScrolledToMostRecent(input)    // viewport not at rightmost position
END FUNCTION
```

### Examples

- **Example 1**: User opens the app on a Monday morning → navigates to Historical Data → chart is empty because `activeRange = 'week'` fetches Mon 00:00–Sun 23:59 of the current week and no readings exist yet (actual: empty chart; expected: last 24 hours of data rendered)
- **Example 2**: User navigates to Historical Data mid-week with sensor data → chart shows weekly averages per day instead of hourly data for the last 24 hours (actual: week view; expected: 24h view with 6-hour visible window)
- **Example 3**: User navigates to Historical Data with 24 hours of data → chart renders all 24 hourly buckets but the viewport starts at hour 0 (oldest) instead of scrolling to the most recent 6 hours (actual: scrollLeft = 0; expected: scrollLeft = scrollWidth)
- **Example 4 (edge case)**: User navigates to Historical Data when no data exists at all → chart shows empty state correctly regardless of range (expected: no-data message shown, no crash)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Manually selecting `week`, `month`, or `custom` range must continue to fetch and render data for the selected range correctly
- Switching between metric tabs (All, pH, DO, Turbidity, Temp) must continue to toggle dataset visibility without re-fetching data
- Live append via `sensor-reading-recorded` event must continue to update the chart in real time
- Custom date range validation (From before To, both fields required) must continue to work
- Horizontal scrolling on the `24h` range must continue to allow navigation through earlier timestamps
- CSV export must continue to export all readings for the currently selected range
- The `resizeAndScrollChart` behavior for non-`24h` ranges (full-width, no scroll) must remain unchanged

**Scope:**
All inputs that do NOT involve the initial page load of the Historical Data page are completely unaffected by this fix. This includes:
- Manual range changes after the page has loaded
- Metric tab switches
- Live sensor reading appends
- Custom date range queries
- CSV export actions
- Threshold dialog interactions

## Hypothesized Root Cause

Based on code analysis of `public/js/features/historical-data.js`:

1. **Wrong initial `activeRange` value**: Line `let activeRange = 'week';` sets the default to `'week'`. The initial `refresh()` call at the bottom of `init()` uses this value, so it fetches the current calendar week instead of the last 24 hours.

2. **`<select>` element not synced**: In `public/index.html`, the `<select id="hist-range">` has `<option value="week" selected>This Week</option>`, so the dropdown visually shows "This Week" even though the fix will change the JS default to `'24h'`. The `selected` attribute must be moved to the `24h` option.

3. **`resizeAndScrollChart` not called on initial load path**: The initial `refresh()` → `loadChart()` call does invoke `resizeAndScrollChart(activeRange)` at the end of `loadChart()`, but only when `readings.length > 0`. When the fallback `spkData` path is taken (no persisted history), `resizeAndScrollChart` is also called. However, if `activeRange` is `'week'` on init, `resizeAndScrollChart` receives `'week'` and does not set the wide canvas or scroll — so even after the fix changes `activeRange` to `'24h'`, we must verify the scroll path is exercised correctly.

4. **No explicit `rangeEl.value` sync on init**: After changing `activeRange` to `'24h'` in JS, the `<select>` element's `.value` must also be set programmatically (or via the `selected` attribute in HTML) so the UI and state are consistent.

## Correctness Properties

Property 1: Bug Condition - 24h Default on Initialization

_For any_ navigation to the Historical Data page (isBugCondition returns true), the fixed `init()` function SHALL set `activeRange` to `'24h'`, trigger a fetch for the last 24 hours of sensor data, render the chart with hourly buckets, and scroll the chart viewport to the rightmost (most recent) position so that the last 6 hours are visible by default.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Non-Init Interactions Unchanged

_For any_ user interaction that is NOT the initial page load (isBugCondition returns false) — including manual range changes, metric tab switches, live sensor appends, custom date queries, and CSV exports — the fixed code SHALL produce exactly the same behavior as the original code, preserving all existing range-fetch, visibility-toggle, and export functionality.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `public/js/features/historical-data.js`

**Function**: `init()`

**Specific Changes**:
1. **Change initial `activeRange`**: Replace `let activeRange = 'week';` with `let activeRange = '24h';`
   - This ensures the first `refresh()` call fetches the last 24 hours

2. **Sync `<select>` element on init**: After the `rangeEl` reference is obtained, add `if (rangeEl) rangeEl.value = '24h';` so the dropdown reflects the correct default without relying solely on the HTML `selected` attribute

**File**: `public/index.html`

**Section**: `<select id="hist-range">` options

**Specific Changes**:
3. **Move `selected` attribute**: Change `<option value="24h">Last 24 Hours</option>` to `<option value="24h" selected>Last 24 Hours</option>` and remove `selected` from the `week` option
   - This ensures the correct option is pre-selected even before JS runs

No changes are needed to `resizeAndScrollChart` itself — it already handles the `24h` case correctly (wide canvas + scroll to right). The fix simply ensures it is called with `'24h'` on initialization.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that inspect the initial state of `activeRange` and the `<select>` element value after `init()` is called, and verify that `refresh()` is invoked with `'24h'`. Run these tests on the UNFIXED code to observe failures.

**Test Cases**:
1. **Initial Range Test**: Call `init()` and assert `activeRange === '24h'` immediately after (will fail on unfixed code — actual value is `'week'`)
2. **Select Element Sync Test**: Call `init()` and assert `document.getElementById('hist-range').value === '24h'` (will fail on unfixed code — actual value is `'week'`)
3. **Fetch Range Test**: Mock `fetchHistoryFromRTDB` and assert it is called with a `from` timestamp approximately 24 hours before `Date.now()` on init (will fail on unfixed code — called with start-of-week timestamp)
4. **Scroll Test**: Call `init()` with mock data and assert `hist-chart-wrap.scrollLeft > 0` after render (may fail on unfixed code if `resizeAndScrollChart` is not called with `'24h'`)

**Expected Counterexamples**:
- `activeRange` is `'week'` instead of `'24h'` after `init()`
- `fetchHistoryFromRTDB` is called with a start-of-week timestamp instead of `now - 24h`
- Possible causes: wrong initial variable value, HTML `selected` attribute on wrong option

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL pageNav WHERE isBugCondition(pageNav) DO
  result := init_fixed()
  ASSERT activeRange == '24h'
  ASSERT rangeEl.value == '24h'
  ASSERT fetchHistoryFromRTDB called with from ≈ now - 24h
  ASSERT hist-chart-wrap.scrollLeft == hist-chart-wrap.scrollWidth (after render)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalBehavior(input) = fixedBehavior(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for manual range changes and metric tab switches, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Manual Range Change Preservation**: Observe that selecting `week`, `month`, or `custom` after init fetches the correct range on unfixed code, then verify this continues after fix
2. **Metric Tab Preservation**: Observe that clicking metric tabs toggles visibility without re-fetching on unfixed code, then verify this continues after fix
3. **Live Append Preservation**: Observe that `sensor-reading-recorded` events append data correctly on unfixed code, then verify this continues after fix
4. **CSV Export Preservation**: Observe that export uses the currently selected range on unfixed code, then verify this continues after fix

### Unit Tests

- Test that `activeRange` is `'24h'` immediately after `init()` is called
- Test that the `hist-range` select element value is `'24h'` after `init()`
- Test that `fetchHistoryFromRTDB` is called with a `from` value within ±5 seconds of `Date.now() - 24*60*60*1000`
- Test that manually changing the range select to `week` still triggers a week-range fetch
- Test that metric tab clicks call `updateHistoricalChart` with `null` labels/data (no re-fetch)
- Test edge case: `init()` with no data available shows the no-data state correctly

### Property-Based Tests

- Generate random sensor reading arrays and verify that after `init()` only readings within the last 24 hours are rendered in the chart
- Generate random range values (`week`, `month`, `custom`) and verify that manually selecting them after init produces the same fetch behavior as the original code
- Generate random sequences of metric tab clicks and verify dataset visibility toggles are identical between original and fixed code
- Test that `resizeAndScrollChart('24h')` always results in `scrollLeft === scrollWidth` regardless of container width

### Integration Tests

- Test full user flow: page loads → chart shows last 24 hours → user switches to `week` → chart shows weekly data → user switches back to `24h` → chart shows last 24 hours again
- Test that the `hist-range` dropdown visually shows "Last 24 Hours" on page load (HTML `selected` attribute fix)
- Test that horizontal scrolling works after init: chart is scrolled to the right, and the user can scroll left to see earlier hours
- Test that a live `sensor-reading-recorded` event while on the `24h` range appends correctly and re-scrolls to the right
