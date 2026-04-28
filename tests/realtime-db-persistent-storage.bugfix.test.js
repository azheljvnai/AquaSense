// tests/realtime-db-persistent-storage.bugfix.test.js
// Bugfix: realtime-db-persistent-storage — Bug Condition Exploration Test
// This test MUST FAIL on unfixed code - failure confirms the bug exists
// DO NOT attempt to fix the test or the code when it fails
// This test encodes the expected behavior - it will validate the fix when it passes

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// ─── Bug Condition Exploration Test ──────────────────────────────────────────
// This test analyzes the firebase.js code to detect the redundant write pattern

describe('Realtime DB Persistent Storage — Bug Condition Exploration', () => {

  /**
   * Property 1: Bug Condition - No Redundant History Writes
   * 
   * **Validates: Requirements 2.1, 2.2, 2.3**
   * 
   * For any sensor data event received by the frontend where the ESP32 has already
   * written the data to the history path, the fixed frontend code SHALL NOT write
   * to the RTDB history path, eliminating duplicate database operations.
   * 
   * EXPECTED OUTCOME ON UNFIXED CODE: Test FAILS
   * - Frontend code contains writeHistoryEntry() function
   * - Frontend code calls writeHistoryEntry() in the sensor data listener
   * - This creates duplicate writes (ESP32 already wrote to history)
   * 
   * EXPECTED OUTCOME ON FIXED CODE: Test PASSES
   * - Frontend code does NOT call writeHistoryEntry() in sensor listener
   * - writeHistoryEntry() function is removed (no longer needed)
   * - Only ESP32 writes to history path
   */
  it('Property 1: Frontend code should NOT contain writeHistoryEntry() call in sensor listener', () => {
    // Read the firebase.js file
    const firebaseCode = readFileSync('public/js/firebase.js', 'utf-8');

    // ─── ASSERTION 1: writeHistoryEntry() function should NOT exist ───────────
    // After fix: this function should be completely removed
    // On UNFIXED code: function exists (test FAILS)
    // On FIXED code: function does not exist (test PASSES)
    
    const hasWriteHistoryFunction = /function\s+writeHistoryEntry\s*\(/.test(firebaseCode);
    expect(hasWriteHistoryFunction).toBe(false);

    // ─── ASSERTION 2: No call to writeHistoryEntry() in sensor listener ──────
    // After fix: no calls to writeHistoryEntry anywhere
    // On UNFIXED code: call exists in onValue listener (test FAILS)
    // On FIXED code: no calls exist (test PASSES)
    
    const hasWriteHistoryCall = /writeHistoryEntry\s*\(/.test(firebaseCode);
    expect(hasWriteHistoryCall).toBe(false);

    // ─── ASSERTION 3: Sensor listener should NOT write to history ────────────
    // Check that the onValue listener for /sensors does not contain
    // any Firebase set() calls to history paths
    
    // Extract the connect() function
    const connectFunctionMatch = firebaseCode.match(
      /export\s+async\s+function\s+connect\s*\([^)]*\)\s*{[\s\S]*?^}/m
    );
    
    if (connectFunctionMatch) {
      const connectFunction = connectFunctionMatch[0];
      
      // Find the onValue listener for /sensors
      const sensorListenerMatch = connectFunction.match(
        /onValue\s*\(\s*ref\s*\(\s*fbDb\s*,\s*DEVICE\s*\+\s*['"]\/sensors['"]\s*\)[^{]*{[\s\S]*?}\s*,\s*\([^)]*\)\s*=>\s*{/
      );
      
      if (sensorListenerMatch) {
        const sensorListener = sensorListenerMatch[0];
        
        // Check for any set() calls to history paths within the sensor listener
        const hasHistoryWrite = /set\s*\(\s*ref\s*\([^)]*history/.test(sensorListener);
        expect(hasHistoryWrite).toBe(false);
      }
    }
  });

  /**
   * Property 1.1: Bug Condition - Code Comment Verification
   * 
   * Verify that the code contains appropriate comments explaining that
   * history persistence is handled by ESP32, not the frontend.
   */
  it('Property 1.1: Code should document that ESP32 handles history persistence', () => {
    const firebaseCode = readFileSync('public/js/firebase.js', 'utf-8');

    // After fix: should contain comment about ESP32 handling history
    // This is a softer check - we verify the comment exists after the fix
    
    // Extract the connect() function
    const connectFunctionMatch = firebaseCode.match(
      /export\s+async\s+function\s+connect\s*\([^)]*\)\s*{[\s\S]*?^}/m
    );
    
    if (connectFunctionMatch) {
      const connectFunction = connectFunctionMatch[0];
      
      // Check for comment about ESP32 handling history
      const hasESP32Comment = /ESP32.*history|history.*ESP32/i.test(connectFunction);
      
      // On UNFIXED code: comment says "Write to RTDB history so data persists"
      // On FIXED code: comment says "History persistence is handled by ESP32"
      
      // We check that the OLD comment is NOT present
      const hasOldComment = /Write to RTDB history so data persists/.test(connectFunction);
      expect(hasOldComment).toBe(false);
      
      // And the NEW comment IS present
      expect(hasESP32Comment).toBe(true);
    }
  });

  /**
   * Property 1.2: Bug Condition - Counterexample Documentation
   * 
   * This test documents the specific counterexample from the bugfix spec:
   * 
   * **Scenario:** ESP32 sends reading at 2024-01-15 10:30:45
   * 
   * **Current (Buggy) Behavior:**
   * - ESP32 writes to /devices/device001/history/2024-01-15_10-30-45
   * - Frontend receives update via /devices/device001/sensors listener
   * - Frontend calls writeHistoryEntry() and writes to /devices/device001/history/1705315845000
   * - Result: Two history entries for the same reading with different keys
   * 
   * **Expected (Fixed) Behavior:**
   * - ESP32 writes to /devices/device001/history/2024-01-15_10-30-45
   * - Frontend receives update via /devices/device001/sensors listener
   * - Frontend updates UI and localStorage only (no RTDB write)
   * - Result: Single history entry with ESP32's timestamp key
   */
  it('Property 1.2: Counterexample - Redundant writes create duplicate history entries', () => {
    const firebaseCode = readFileSync('public/js/firebase.js', 'utf-8');

    // This test documents the bug condition through code analysis
    // The bug manifests when:
    // 1. ESP32 writes to /history/{timestamp-key}
    // 2. ESP32 writes to /sensors (triggers frontend listener)
    // 3. Frontend listener calls writeHistoryEntry()
    // 4. Frontend writes to /history/{millisecond-timestamp}
    // Result: Two entries for the same sensor reading

    // Verify the bug pattern is NOT present in the code
    const connectFunctionMatch = firebaseCode.match(
      /export\s+async\s+function\s+connect\s*\([^)]*\)\s*{[\s\S]*?^}/m
    );
    
    expect(connectFunctionMatch).toBeTruthy();
    
    if (connectFunctionMatch) {
      const connectFunction = connectFunctionMatch[0];
      
      // The bug pattern: sensor listener contains writeHistoryEntry call
      // On UNFIXED code: this pattern exists (test FAILS)
      // On FIXED code: this pattern does not exist (test PASSES)
      
      const bugPattern = /onValue.*\/sensors.*writeHistoryEntry/s;
      const hasBugPattern = bugPattern.test(connectFunction);
      
      expect(hasBugPattern).toBe(false);
    }
  });
});
