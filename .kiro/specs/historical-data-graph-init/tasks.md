# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - 24h Default on Initialization
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to the concrete failing case — navigating to the Historical Data page and asserting `activeRange === '24h'` and `rangeEl.value === '24h'` immediately after `init()` is called
  - Create `tests/historical-data-graph-init.bugfix.test.js`
  - Set up JSDOM with `public/index.html` and mock `Chart`, `fetchHistoryFromRTDB`, `getHistoryRange`, `spkData`, `mergeHistoryEntries`, `getThresholds`, `saveThresholds`, `resetThresholds`
  - Test 1: Call `init()` and assert `activeRange === '24h'` (isBugCondition: `activeRange == 'week'` after init)
  - Test 2: Call `init()` and assert `document.getElementById('hist-range').value === '24h'` (select element not synced)
  - Test 3: Mock `fetchHistoryFromRTDB` and assert it is called with a `from` timestamp within ±5 seconds of `Date.now() - 24*60*60*1000` (called with start-of-week instead)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct — it proves the bug exists: `activeRange` is `'week'`, select shows "This Week", fetch uses start-of-week timestamp)
  - Document counterexamples found (e.g., `activeRange` is `'week'` instead of `'24h'` after `init()`)
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Init Interactions Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Create `tests/historical-data-graph-init-preservation.property.test.js`
  - Set up JSDOM with `public/index.html` and the same mocks as task 1
  - Observe on UNFIXED code: manually changing `hist-range` select to `week` after init triggers a week-range fetch
  - Observe on UNFIXED code: clicking metric tab buttons calls `updateHistoricalChart` with `null` labels/data (no re-fetch)
  - Observe on UNFIXED code: `sensor-reading-recorded` event causes `loadChart()` to be called when current time is within range
  - Write property-based test (fast-check): for any range value in `['week', 'month']`, simulating a manual range change after init produces a fetch with the correct start/end timestamps (from Preservation Requirements 3.1 in design)
  - Write property-based test (fast-check): for any metric tab value in `['all', 'ph', 'do', 'turb', 'temp']`, clicking the tab calls `updateHistoricalChart` with `null` labels/data (Preservation Requirement 3.2)
  - Verify all preservation tests PASS on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Fix for historical data graph initializing with wrong default range

  - [x] 3.1 Implement the fix in `public/js/features/historical-data.js`
    - Change `let activeRange = 'week';` to `let activeRange = '24h';` (line ~68 in `init()`)
    - After the `rangeEl` reference is obtained, add `if (rangeEl) rangeEl.value = '24h';` to sync the select element programmatically
    - _Bug_Condition: isBugCondition(input) where input.targetPage == 'historical-data' AND activeRange == 'week' after init_
    - _Expected_Behavior: activeRange === '24h', rangeEl.value === '24h', fetchHistoryFromRTDB called with from ≈ now - 24h, chart scrolled to rightmost position_
    - _Preservation: Manual range changes, metric tab switches, live append, custom date range, CSV export, and horizontal scrolling all remain unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 3.2 Fix the HTML `<select>` default in `public/index.html`
    - Move the `selected` attribute from `<option value="week">` to `<option value="24h">`
    - This ensures the dropdown visually shows "Last 24 Hours" even before JS runs
    - _Requirements: 2.2_

  - [x] 3.3 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - 24h Default on Initialization
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior (activeRange === '24h', select synced, fetch uses 24h window)
    - Run `tests/historical-data-graph-init.bugfix.test.js` on FIXED code
    - **EXPECTED OUTCOME**: Tests PASS (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.4 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Init Interactions Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run `tests/historical-data-graph-init-preservation.property.test.js` on FIXED code
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions in manual range changes, metric tabs, live append, etc.)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint - Ensure all tests pass
  - Run the full test suite: `npx vitest --run`
  - Ensure all tests pass, ask the user if questions arise.
