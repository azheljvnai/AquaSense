# Bugfix Requirements Document

## Introduction

The AquaSense IoT water quality monitoring system has redundant history writes that create unnecessary database operations and potential data conflicts. The ESP32 firmware already writes sensor readings to both `/devices/{deviceId}/sensors` (live data) and `/devices/{deviceId}/history/{key}` (historical data) in the `sendFirebase()` function. However, the frontend also writes to the history path via `writeHistoryEntry()` in `firebase.js` when it receives sensor updates, creating duplicate writes for the same data. This redundancy wastes database operations and could cause timestamp/key conflicts between the ESP32's timestamp format and the frontend's millisecond timestamp format.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the ESP32 writes sensor data to `/devices/{deviceId}/sensors` AND `/devices/{deviceId}/history/{key}` THEN the frontend also writes the same data to `/devices/{deviceId}/history/{ts}` creating duplicate database operations

1.2 WHEN sensor data arrives at the frontend THEN the system performs an unnecessary write operation to the history path even though the ESP32 has already persisted the data

1.3 WHEN the ESP32 uses timestamp format "YYYY-MM-DD_HH-MM-SS" as the history key AND the frontend uses millisecond timestamp as the key THEN the system creates two different history entries for the same sensor reading with different key formats

### Expected Behavior (Correct)

2.1 WHEN the ESP32 writes sensor data to `/devices/{deviceId}/sensors` AND `/devices/{deviceId}/history/{key}` THEN the frontend SHALL NOT write duplicate data to the history path

2.2 WHEN the frontend receives sensor data updates THEN the system SHALL only update the UI and local cache without writing to the RTDB history path

2.3 WHEN sensor readings are persisted to history THEN the system SHALL use only the ESP32's timestamp format as the key to avoid duplicate entries

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the frontend receives sensor data THEN the system SHALL CONTINUE TO display live sensor readings on the dashboard

3.2 WHEN the frontend receives sensor data THEN the system SHALL CONTINUE TO record readings to localStorage via `recordSensorReading()` for local caching

3.3 WHEN users query historical data for a specific time range THEN the system SHALL CONTINUE TO fetch data from `/devices/{deviceId}/history` using `fetchHistoryFromRTDB()`

3.4 WHEN the frontend merges RTDB history with localStorage cache THEN the system SHALL CONTINUE TO deduplicate entries by timestamp via `mergeHistoryEntries()`

3.5 WHEN users export historical data to CSV THEN the system SHALL CONTINUE TO include all available readings in the export

3.6 WHEN the ESP32 writes to the history path THEN the system SHALL CONTINUE TO use the timestamp-based key format for natural ordering

## Bug Condition Analysis

### Bug Condition Function

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type SensorDataEvent with fields {source, deviceId, ts, ph, do, turb, temp}
  OUTPUT: boolean
  
  // Returns true when frontend receives sensor data that ESP32 already persisted
  RETURN X.source = "ESP32" AND frontendIsActive = true
END FUNCTION
```

### Property Specification - Fix Checking

```pascal
// Property: No Redundant History Writes
FOR ALL X WHERE isBugCondition(X) DO
  // After fix, frontend does not write to history when ESP32 already did
  frontendHistoryWrites ← countWritesToPath('/devices/' + X.deviceId + '/history/*')
  ASSERT frontendHistoryWrites = 0
END FOR
```

### Property Specification - Preservation Checking

```pascal
// Property: Existing Functionality Preserved
FOR ALL X WHERE NOT isBugCondition(X) DO
  // UI updates, localStorage caching, and history fetching remain unchanged
  ASSERT displayUpdated(X) = true AND
         localStorageUpdated(X) = true AND
         historyFetchWorks(X) = true
END FOR
```

### Counterexample

**Scenario:** ESP32 sends reading at 2024-01-15 10:30:45, frontend is active

**Input:**
```javascript
{
  source: "ESP32",
  deviceId: "device001",
  ts: "2024-01-15 10:30:45",
  ph: 7.2,
  do: 8.5,
  turb: 12.3,
  temp: 24.1
}
```

**Current (Buggy) Behavior:**
- ESP32 writes to `/devices/device001/history/2024-01-15_10-30-45` ✓
- Frontend receives update via `/devices/device001/sensors` listener
- Frontend calls `writeHistoryEntry()` and writes to `/devices/device001/history/1705315845000` ✓
- **Result:** Two history entries for the same reading with different keys

**Expected (Fixed) Behavior:**
- ESP32 writes to `/devices/device001/history/2024-01-15_10-30-45` ✓
- Frontend receives update via `/devices/device001/sensors` listener
- Frontend updates UI and localStorage only (no RTDB write)
- **Result:** Single history entry with ESP32's timestamp key
