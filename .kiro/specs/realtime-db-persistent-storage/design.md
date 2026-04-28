# Realtime DB Persistent Storage Bugfix Design

## Overview

The AquaSense system currently has redundant history writes where both the ESP32 firmware and the frontend write sensor readings to the Firebase Realtime Database history path. The ESP32 already persists data to `/devices/{deviceId}/history/{key}` using timestamp-based keys, but the frontend's `writeHistoryEntry()` function in `firebase.js` also writes to the same path when receiving sensor updates via the `/sensors` listener. This creates duplicate database operations and potential key conflicts between the ESP32's "YYYY-MM-DD_HH-MM-SS" format and the frontend's millisecond timestamp format.

The fix is straightforward: remove the redundant `writeHistoryEntry()` call from the frontend's sensor data listener, allowing only the ESP32 to persist history data. The frontend will continue to update the UI and cache data locally via `recordSensorReading()`, but will not write to RTDB history.

## Glossary

- **Bug_Condition (C)**: The condition that triggers redundant writes - when the frontend receives sensor data from ESP32 and attempts to write to the history path that ESP32 has already written to
- **Property (P)**: The desired behavior - frontend should only update UI and localStorage, not write to RTDB history
- **Preservation**: Existing UI updates, localStorage caching, and history fetching functionality that must remain unchanged
- **writeHistoryEntry()**: The function in `public/js/firebase.js` that writes sensor readings to `/devices/{deviceId}/history/{ts}` - this is the source of redundant writes
- **onValue listener**: The Firebase listener in `connect()` that receives sensor updates from `/devices/{deviceId}/sensors`
- **recordSensorReading()**: The utility function in `public/js/utils.js` that caches sensor data to localStorage - this should continue working

## Bug Details

### Bug Condition

The bug manifests when the frontend receives sensor data updates from the ESP32 via the `/sensors` path listener. The `writeHistoryEntry()` function is called within the `onValue` callback, creating a duplicate write to the history path that the ESP32 has already populated.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type SensorDataEvent with fields {deviceId, ts, ph, do, turb, temp}
  OUTPUT: boolean
  
  RETURN frontendIsActive = true
         AND sensorDataReceived(input) = true
         AND writeHistoryEntry() is called
         AND ESP32AlreadyWroteHistory(input.deviceId, input.ts) = true
END FUNCTION
```

### Examples

- **Example 1**: ESP32 sends reading at 2024-01-15 10:30:45 with pH=7.2, DO=8.5, turb=12.3, temp=24.1
  - **Current behavior**: ESP32 writes to `/history/2024-01-15_10-30-45`, frontend writes to `/history/1705315845000`
  - **Expected behavior**: Only ESP32 writes to `/history/2024-01-15_10-30-45`

- **Example 2**: ESP32 sends reading at 2024-01-15 14:22:10 with pH=7.0, DO=8.2, turb=15.1, temp=23.8
  - **Current behavior**: Two history entries created with different key formats
  - **Expected behavior**: Single history entry with ESP32's timestamp key

- **Example 3**: Multiple sensor readings arrive within 1 second
  - **Current behavior**: Double the number of history entries (ESP32 + frontend writes)
  - **Expected behavior**: Only ESP32's entries exist in history

- **Edge case**: Frontend is offline when ESP32 sends data, then comes online later
  - **Expected behavior**: History already exists from ESP32, frontend just displays it without writing

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Live sensor data display on the dashboard must continue to update in real-time
- localStorage caching via `recordSensorReading()` must continue to work for offline access
- Historical data fetching via `fetchHistoryFromRTDB()` must continue to work correctly
- Chart updates and dashboard card updates must continue to function
- CSV export functionality must continue to include all historical data
- The "last updated" timestamp display must continue to show when data was received

**Scope:**
All inputs that do NOT involve writing to the RTDB history path should be completely unaffected by this fix. This includes:
- UI updates when sensor data arrives
- localStorage write operations for local caching
- Reading from the history path for charts and reports
- Manual feed button functionality
- Schedule saving functionality
- All other Firebase operations (feeding, schedules, etc.)

## Hypothesized Root Cause

Based on the bug description and code analysis, the root cause is clear:

1. **Legacy Design Decision**: The `writeHistoryEntry()` function was originally added to ensure history persistence when the browser was the only component writing sensor data. This was before the ESP32 firmware was updated to write history directly.

2. **Incomplete Migration**: When the ESP32 firmware was updated to write to the history path (as documented in `ESP32_HISTORY_SETUP.md` Option A), the frontend code was not updated to remove the redundant write operation.

3. **No Deduplication Logic**: The system lacks any mechanism to detect that history has already been written by the ESP32, so the frontend blindly writes every sensor update it receives.

4. **Different Key Formats**: The ESP32 uses "YYYY-MM-DD_HH-MM-SS" format while the frontend uses millisecond timestamps, causing two separate entries for the same reading rather than overwriting.

## Correctness Properties

Property 1: Bug Condition - No Redundant History Writes

_For any_ sensor data event received by the frontend where the ESP32 has already written the data to the history path, the fixed frontend code SHALL NOT write to the RTDB history path, eliminating duplicate database operations.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - UI and Caching Functionality

_For any_ sensor data event received by the frontend, the fixed code SHALL continue to update the UI, update localStorage via `recordSensorReading()`, and fetch historical data correctly, preserving all existing display and caching functionality.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

**File**: `public/js/firebase.js`

**Function**: `connect()` - specifically the `onValue` listener callback for `/devices/{deviceId}/sensors`

**Specific Changes**:
1. **Remove `writeHistoryEntry()` call**: Delete the line that calls `writeHistoryEntry(DEVICE, ts, ph, doV, turb, temp)` from the sensor data listener callback

2. **Remove `writeHistoryEntry()` function definition**: Delete the entire `writeHistoryEntry()` function since it will no longer be used anywhere in the codebase

3. **Keep UI updates**: Ensure the `onSensorData` callback is still invoked to update dashboard cards and charts

4. **Keep localStorage caching**: Ensure `recordSensorReading()` is still called (this happens in the `onSensorData` callback chain, not in firebase.js)

5. **Update comments**: Add a comment explaining that history persistence is handled by the ESP32 firmware, not the frontend

### Code Changes

**Before (lines 67-75 in firebase.js):**
```javascript
onValue(ref(fbDb, DEVICE + '/sensors'), (snap) => {
  const d = snap.val();
  if (!d) return;
  onStatus('ONLINE', true);
  // ... UI updates ...
  const ph = parseFloat(d.ph) || 0, doV = parseFloat(d.do) || 0, turb = parseFloat(d.turb) || 0, temp = parseFloat(d.temp) || 0;

  // Write to RTDB history so data persists even when browser is closed
  const ts = d.ts ? Number(d.ts) : Date.now();
  writeHistoryEntry(DEVICE, ts, ph, doV, turb, temp);

  if (onSensorData) onSensorData(ph, doV, turb, temp, ts);
}, (err) => {
  // error handler
});
```

**After:**
```javascript
onValue(ref(fbDb, DEVICE + '/sensors'), (snap) => {
  const d = snap.val();
  if (!d) return;
  onStatus('ONLINE', true);
  // ... UI updates ...
  const ph = parseFloat(d.ph) || 0, doV = parseFloat(d.do) || 0, turb = parseFloat(d.turb) || 0, temp = parseFloat(d.temp) || 0;

  // History persistence is handled by ESP32 firmware (see ESP32_HISTORY_SETUP.md)
  // Frontend only updates UI and localStorage cache
  const ts = d.ts ? Number(d.ts) : Date.now();

  if (onSensorData) onSensorData(ph, doV, turb, temp, ts);
}, (err) => {
  // error handler
});
```

**Remove function (lines 127-135 in firebase.js):**
```javascript
/**
 * Write a single sensor reading to RTDB history.
 * Path: /devices/{deviceId}/history/{ts}
 * Uses the sensor timestamp (or Date.now()) as the key so entries are
 * naturally ordered and de-duplicated by the device's own clock.
 */
function writeHistoryEntry(devicePath, ts, ph, doVal, turb, temp) {
  if (!fbDb) return;
  const key = String(ts);
  set(ref(fbDb, `${devicePath}/history/${key}`), { ts, ph, do: doVal, turb, temp })
    .catch(() => { /* silently ignore write failures (offline, permissions) */ });
}
```

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the redundant writes on unfixed code, then verify the fix eliminates duplicate writes while preserving all UI and caching functionality.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the redundant writes BEFORE implementing the fix. Confirm that both ESP32 and frontend are writing to the history path.

**Test Plan**: Monitor Firebase Realtime Database writes using Firebase console or Admin SDK listeners. Simulate ESP32 sensor updates and observe that two writes occur to the history path with different key formats. Run these observations on the UNFIXED code to confirm the bug.

**Test Cases**:
1. **Duplicate Write Detection**: Send a sensor reading from ESP32, observe two history entries created (will show bug on unfixed code)
2. **Key Format Mismatch**: Verify ESP32 uses "YYYY-MM-DD_HH-MM-SS" format while frontend uses millisecond timestamp (will show bug on unfixed code)
3. **Write Count Test**: Count the number of writes to `/history` path per sensor update (should be 2 on unfixed code, 1 on fixed code)
4. **Rapid Updates Test**: Send multiple sensor readings quickly and count total history entries (will show 2x entries on unfixed code)

**Expected Counterexamples**:
- Two history entries per sensor reading with different keys
- Possible causes: frontend `writeHistoryEntry()` call in sensor listener, no deduplication logic

### Fix Checking

**Goal**: Verify that for all sensor data events, the fixed frontend does not write to the RTDB history path.

**Pseudocode:**
```
FOR ALL sensorEvent WHERE frontendReceivesSensorData(sensorEvent) DO
  writeCountBefore := countHistoryWrites(sensorEvent.deviceId)
  processSensorUpdate(sensorEvent)
  writeCountAfter := countHistoryWrites(sensorEvent.deviceId)
  ASSERT writeCountAfter = writeCountBefore  // No new writes from frontend
END FOR
```

### Preservation Checking

**Goal**: Verify that for all sensor data events, the fixed frontend continues to update UI and localStorage correctly.

**Pseudocode:**
```
FOR ALL sensorEvent WHERE frontendReceivesSensorData(sensorEvent) DO
  uiStateBefore := captureUIState()
  localStorageBefore := captureLocalStorage()
  
  processSensorUpdate_fixed(sensorEvent)
  
  ASSERT uiUpdated(uiStateBefore, sensorEvent) = true
  ASSERT localStorageUpdated(localStorageBefore, sensorEvent) = true
  ASSERT historyFetchStillWorks() = true
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across different sensor value ranges
- It catches edge cases like missing fields, null values, or extreme readings
- It provides strong guarantees that UI and caching behavior is unchanged for all sensor updates

**Test Plan**: Observe behavior on UNFIXED code first for UI updates and localStorage caching, then write property-based tests capturing that behavior and verify it continues after the fix.

**Test Cases**:
1. **UI Update Preservation**: Verify dashboard cards update with new sensor values after fix
2. **localStorage Preservation**: Verify `recordSensorReading()` continues to cache data locally after fix
3. **History Fetch Preservation**: Verify `fetchHistoryFromRTDB()` continues to retrieve ESP32-written history correctly
4. **Chart Update Preservation**: Verify charts continue to display historical data after fix
5. **Last Updated Display Preservation**: Verify timestamp display continues to update after fix
6. **CSV Export Preservation**: Verify exported data includes all ESP32-written history entries

### Unit Tests

- Test that sensor data listener updates UI state correctly
- Test that sensor data listener does NOT call any RTDB write functions
- Test that `fetchHistoryFromRTDB()` retrieves ESP32-written entries correctly
- Test that localStorage caching continues to work via `recordSensorReading()`
- Test edge cases: missing timestamp field, null sensor values, offline scenarios

### Property-Based Tests

- Generate random sensor readings and verify frontend never writes to history path
- Generate random sensor readings and verify UI always updates correctly
- Generate random time ranges and verify history fetching works with ESP32-written data
- Test that localStorage caching works across many random sensor value combinations

### Integration Tests

- Test full sensor update flow: ESP32 writes → frontend receives → UI updates → no duplicate write
- Test historical data display: ESP32 writes history → frontend fetches → charts display correctly
- Test offline/online transitions: ESP32 writes while frontend offline → frontend comes online → displays existing history without writing
- Test CSV export includes only ESP32-written history entries (no duplicates)
