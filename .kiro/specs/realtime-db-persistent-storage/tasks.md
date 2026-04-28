# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Redundant History Writes Detection
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate redundant writes from frontend
  - **Scoped PBT Approach**: Scope the property to concrete sensor data events where ESP32 has already written to history
  - Test that when frontend receives sensor data from ESP32, it does NOT write to the RTDB history path
  - Monitor Firebase writes and count history entries created per sensor update
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (frontend writes to history, creating duplicates)
  - Document counterexamples found (e.g., "Two history entries created: /history/2024-01-15_10-30-45 from ESP32 and /history/1705315845000 from frontend")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - UI and Caching Functionality
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for sensor data updates
  - Verify UI updates correctly when sensor data arrives
  - Verify localStorage caching via `recordSensorReading()` works
  - Verify `fetchHistoryFromRTDB()` retrieves ESP32-written history correctly
  - Verify chart updates display historical data
  - Verify "last updated" timestamp display updates
  - Write property-based tests capturing these observed behavior patterns
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (confirms baseline UI/caching behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [ ] 3. Fix redundant history writes

  - [x] 3.1 Remove redundant writeHistoryEntry() call from sensor listener
    - Open `public/js/firebase.js`
    - Locate the `onValue` listener for `/devices/{deviceId}/sensors` in the `connect()` function (around line 67)
    - Remove the line that calls `writeHistoryEntry(DEVICE, ts, ph, doV, turb, temp)`
    - Replace the comment "Write to RTDB history so data persists even when browser is closed" with "History persistence is handled by ESP32 firmware (see ESP32_HISTORY_SETUP.md)"
    - Add comment "Frontend only updates UI and localStorage cache"
    - Keep the `onSensorData` callback invocation to preserve UI updates
    - _Bug_Condition: isBugCondition(X) where X.source = "ESP32" AND frontendIsActive = true_
    - _Expected_Behavior: frontendHistoryWrites = 0 for all sensor events_
    - _Preservation: UI updates, localStorage caching, and history fetching remain unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 3.2 Remove unused writeHistoryEntry() function definition
    - Open `public/js/firebase.js`
    - Locate the `writeHistoryEntry()` function definition (around line 127)
    - Delete the entire function including its JSDoc comment
    - This function is no longer needed since ESP32 handles history persistence
    - _Requirements: 2.1, 2.2_

  - [x] 3.3 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - No Redundant History Writes
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - Verify that frontend no longer writes to history path when receiving sensor data
    - Verify only one history entry exists per sensor reading (from ESP32)
    - **EXPECTED OUTCOME**: Test PASSES (confirms redundant writes eliminated)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.4 Verify preservation tests still pass
    - **Property 2: Preservation** - UI and Caching Functionality
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - Verify UI updates continue to work correctly
    - Verify localStorage caching continues to work
    - Verify history fetching continues to work
    - Verify chart updates continue to work
    - Verify "last updated" display continues to work
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 4. Checkpoint - Ensure all tests pass
  - Run all property-based tests (bug condition + preservation)
  - Verify no redundant history writes occur
  - Verify all UI and caching functionality works correctly
  - Verify historical data display and CSV export work correctly
  - If any issues arise, investigate and ask the user for guidance
