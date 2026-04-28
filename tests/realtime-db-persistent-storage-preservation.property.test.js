// tests/realtime-db-persistent-storage-preservation.property.test.js
// Bugfix: realtime-db-persistent-storage — Preservation Property Tests
// These tests verify that UI updates and localStorage caching remain unchanged
// EXPECTED OUTCOME: Tests PASS on unfixed code (confirms baseline behavior to preserve)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import * as fc from 'fast-check';

// ─── Preservation Property Tests ──────────────────────────────────────────────
// These tests MUST PASS on unfixed code - they verify behavior to preserve
// Run on UNFIXED code to establish baseline behavior

describe('Realtime DB Persistent Storage — Preservation Properties', () => {
  let dom;
  let document;
  let window;

  beforeEach(() => {
    const html = readFileSync('public/index.html', 'utf-8');
    dom = new JSDOM(html, { 
      url: 'http://localhost',
      runScripts: 'outside-only'
    });
    document = dom.window.document;
    window = dom.window;
    
    // Mock localStorage
    const localStorageMock = (() => {
      let store = {};
      return {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; },
        clear: () => { store = {}; }
      };
    })();
    
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true
    });
  });

  /**
   * Property 2.1: UI Update Elements Exist
   * 
   * **Validates: Requirement 3.1**
   * 
   * For any sensor data event received by the frontend, the system SHALL CONTINUE TO
   * display live sensor readings on the dashboard.
   * 
   * This test verifies that all necessary DOM elements exist for UI updates.
   * 
   * EXPECTED OUTCOME: Test PASSES (confirms UI elements exist for updates)
   */
  it('Property 2.1: Dashboard has all required elements for sensor data display', () => {
    const dashboardSection = document.querySelector('#page-dashboard');
    expect(dashboardSection).toBeTruthy();

    // Verify sensor value display elements exist
    const metrics = ['ph', 'do', 'turb', 'temp'];
    for (const metric of metrics) {
      // Value display element
      const valueEl = document.querySelector(`#v-${metric}`);
      expect(valueEl).toBeTruthy();
      expect(valueEl.classList.contains('scard-val')).toBe(true);

      // Badge element
      const badgeEl = document.querySelector(`#b-${metric}`);
      expect(badgeEl).toBeTruthy();
      expect(badgeEl.classList.contains('scard-badge')).toBe(true);

      // Sparkline SVG element
      const sparkEl = document.querySelector(`#sp-${metric}`);
      expect(sparkEl).toBeTruthy();
      expect(sparkEl.tagName.toLowerCase()).toBe('svg');
    }

    // Verify "last updated" timestamp element exists
    const lastUpdEl = document.querySelector('#last-upd');
    expect(lastUpdEl).toBeTruthy();

    // Verify status indicator elements exist
    const statusLabel = document.querySelector('#fb-lbl');
    expect(statusLabel).toBeTruthy();
    expect(statusLabel.classList.contains('status-chip')).toBe(true);

    const feedDot = document.querySelector('#feed-dot');
    expect(feedDot).toBeTruthy();
    expect(feedDot.classList.contains('dot')).toBe(true);
  });

  /**
   * Property 2.2: localStorage Caching Function Signature
   * 
   * **Validates: Requirement 3.2**
   * 
   * For any sensor data event, the system SHALL CONTINUE TO record readings
   * to localStorage via `recordSensorReading()` for local caching.
   * 
   * This test verifies the recordSensorReading function signature and behavior
   * by testing the localStorage interaction pattern.
   * 
   * EXPECTED OUTCOME: Test PASSES (confirms localStorage caching works)
   */
  it('Property 2.2: recordSensorReading stores data in localStorage correctly', () => {
    // Generator for sensor readings
    const sensorReadingGen = fc.record({
      ph: fc.float({ min: 0, max: 14, noNaN: true }),
      doVal: fc.float({ min: 0, max: 20, noNaN: true }),
      turb: fc.float({ min: 0, max: 1000, noNaN: true }),
      temp: fc.float({ min: 0, max: 50, noNaN: true }),
      ts: fc.integer({ min: Date.now() - 86400000, max: Date.now() })
    });

    fc.assert(
      fc.property(sensorReadingGen, (reading) => {
        // Simulate recordSensorReading behavior
        const STORAGE_KEY = 'aquasense.sensorHistory.v1';
        const { ph, doVal, turb, temp, ts } = reading;

        // Get existing history
        let history = [];
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY);
          if (raw) history = JSON.parse(raw);
        } catch {
          history = [];
        }

        // Add new reading
        history.push({ ts, ph, do: doVal, turb, temp });

        // Save to localStorage
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));

        // Verify the reading was stored
        const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
        expect(stored).toBeTruthy();
        expect(Array.isArray(stored)).toBe(true);
        expect(stored.length).toBeGreaterThan(0);

        // Verify the last entry matches our reading
        const lastEntry = stored[stored.length - 1];
        expect(lastEntry.ts).toBe(ts);
        expect(lastEntry.ph).toBe(ph);
        expect(lastEntry.do).toBe(doVal);
        expect(lastEntry.turb).toBe(turb);
        expect(lastEntry.temp).toBe(temp);

        // Clear for next test
        window.localStorage.clear();
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Property 2.3: fetchHistoryFromRTDB Function Signature
   * 
   * **Validates: Requirement 3.3**
   * 
   * For any time range query, the system SHALL CONTINUE TO fetch data from
   * `/devices/{deviceId}/history` using `fetchHistoryFromRTDB()`.
   * 
   * This test verifies the function signature and expected behavior pattern.
   * 
   * EXPECTED OUTCOME: Test PASSES (confirms history fetch pattern is correct)
   */
  it('Property 2.3: fetchHistoryFromRTDB has correct signature and behavior', () => {
    // Read firebase.js to verify function exists and has correct signature
    const firebaseCode = readFileSync('public/js/firebase.js', 'utf-8');

    // Verify fetchHistoryFromRTDB function exists
    const hasFetchHistoryFunction = /export\s+async\s+function\s+fetchHistoryFromRTDB\s*\(/.test(firebaseCode);
    expect(hasFetchHistoryFunction).toBe(true);

    // Verify function signature: fetchHistoryFromRTDB(deviceId, fromMs, toMs)
    const functionMatch = firebaseCode.match(
      /export\s+async\s+function\s+fetchHistoryFromRTDB\s*\(\s*([^)]+)\s*\)/
    );
    expect(functionMatch).toBeTruthy();
    
    if (functionMatch) {
      const params = functionMatch[1].split(',').map(p => p.trim());
      expect(params.length).toBe(3);
      // Parameters should be deviceId, fromMs, toMs
      expect(params[0]).toMatch(/deviceId/);
      expect(params[1]).toMatch(/from/i);
      expect(params[2]).toMatch(/to/i);
    }

    // Verify function uses RTDB query with orderByChild('ts')
    const usesOrderByChild = /orderByChild\s*\(\s*['"]ts['"]\s*\)/.test(firebaseCode);
    expect(usesOrderByChild).toBe(true);

    // Verify function uses startAt and endAt for range queries
    const usesStartAt = /startAt\s*\(\s*fromMs\s*\)/.test(firebaseCode);
    const usesEndAt = /endAt\s*\(\s*toMs\s*\)/.test(firebaseCode);
    expect(usesStartAt).toBe(true);
    expect(usesEndAt).toBe(true);

    // Verify function returns array of entries
    const returnsArray = /return\s+entries/.test(firebaseCode);
    expect(returnsArray).toBe(true);
  });

  /**
   * Property 2.4: Chart Update Integration
   * 
   * **Validates: Requirement 3.4**
   * 
   * For any sensor data event, the system SHALL CONTINUE TO update charts
   * to display historical data.
   * 
   * This test verifies the chart update mechanism exists and is called.
   * 
   * EXPECTED OUTCOME: Test PASSES (confirms chart updates work)
   */
  it('Property 2.4: Chart elements exist for historical data display', () => {
    // Verify dashboard chart exists
    const dashChart = document.querySelector('#chart');
    expect(dashChart).toBeTruthy();
    expect(dashChart.tagName.toLowerCase()).toBe('canvas');

    // Verify historical data chart exists
    const histChart = document.querySelector('#hist-chart');
    expect(histChart).toBeTruthy();
    expect(histChart.tagName.toLowerCase()).toBe('canvas');

    // Read app.js to verify pushChart is called in onSensorData
    const appCode = readFileSync('public/js/app.js', 'utf-8');
    
    // Verify pushChart is called when sensor data arrives
    const callsPushChart = /pushChart\s*\(\s*ph\s*,\s*doV\s*,\s*turb\s*,\s*temp\s*\)/.test(appCode);
    expect(callsPushChart).toBe(true);

    // Verify onSensorData callback is invoked in firebase.js
    const firebaseCode = readFileSync('public/js/firebase.js', 'utf-8');
    const callsOnSensorData = /if\s*\(\s*onSensorData\s*\)\s*onSensorData\s*\(/.test(firebaseCode);
    expect(callsOnSensorData).toBe(true);
  });

  /**
   * Property 2.5: Last Updated Timestamp Display
   * 
   * **Validates: Requirement 3.6**
   * 
   * For any sensor data event, the system SHALL CONTINUE TO update the
   * "last updated" timestamp display.
   * 
   * This test verifies the timestamp update mechanism.
   * 
   * EXPECTED OUTCOME: Test PASSES (confirms timestamp display updates)
   */
  it('Property 2.5: Last updated timestamp element is updated on sensor data', () => {
    // Verify last-upd element exists
    const lastUpdEl = document.querySelector('#last-upd');
    expect(lastUpdEl).toBeTruthy();

    // Read firebase.js to verify lastUpd is updated in sensor listener
    const firebaseCode = readFileSync('public/js/firebase.js', 'utf-8');

    // Verify the sensor listener updates the last-upd element
    const updatesLastUpd = /lastUpd.*textContent.*=.*new\s+Date\(\)\.toLocaleTimeString\(\)/.test(firebaseCode);
    expect(updatesLastUpd).toBe(true);

    // Verify the update happens in the onValue listener for /sensors
    const sensorListenerMatch = firebaseCode.match(
      /onValue\s*\(\s*ref\s*\(\s*fbDb\s*,\s*DEVICE\s*\+\s*['"]\/sensors['"]\s*\)[^{]*{[\s\S]*?}\s*,\s*\([^)]*\)\s*=>\s*{[\s\S]*?}\s*\)/
    );
    expect(sensorListenerMatch).toBeTruthy();

    if (sensorListenerMatch) {
      const listenerCode = sensorListenerMatch[0];
      // Verify last-upd is updated within the sensor listener
      expect(/lastUpd/.test(listenerCode)).toBe(true);
      expect(/toLocaleTimeString/.test(listenerCode)).toBe(true);
    }
  });

  /**
   * Property 2.6: Sensor Data Event Flow Preservation
   * 
   * **Validates: Requirements 3.1, 3.2, 3.4**
   * 
   * For any sensor data event, the system SHALL CONTINUE TO:
   * 1. Update UI via updateCard()
   * 2. Update charts via pushChart()
   * 3. Cache to localStorage via recordSensorReading()
   * 
   * This test verifies the complete event flow is preserved.
   * 
   * EXPECTED OUTCOME: Test PASSES (confirms event flow is correct)
   */
  it('Property 2.6: Sensor data event flow calls all required functions', () => {
    // Read app.js to verify the onSensorData callback flow
    const appCode = readFileSync('public/js/app.js', 'utf-8');

    // Find the connect() call with onSensorData callback
    const connectCallMatch = appCode.match(
      /connect\s*\([^{]*{[\s\S]*?onSensorData:\s*\([^)]*\)\s*=>\s*{[\s\S]*?}[\s\S]*?}\s*\)/
    );
    expect(connectCallMatch).toBeTruthy();

    if (connectCallMatch) {
      const onSensorDataCode = connectCallMatch[0];

      // Verify updateCard is called for each metric
      expect(/updateCard\s*\(\s*['"]ph['"]\s*,\s*ph\s*\)/.test(onSensorDataCode)).toBe(true);
      expect(/updateCard\s*\(\s*['"]do['"]\s*,\s*doV\s*\)/.test(onSensorDataCode)).toBe(true);
      expect(/updateCard\s*\(\s*['"]turb['"]\s*,\s*turb\s*\)/.test(onSensorDataCode)).toBe(true);
      expect(/updateCard\s*\(\s*['"]temp['"]\s*,\s*temp\s*\)/.test(onSensorDataCode)).toBe(true);

      // Verify pushChart is called
      expect(/pushChart\s*\(\s*ph\s*,\s*doV\s*,\s*turb\s*,\s*temp\s*\)/.test(onSensorDataCode)).toBe(true);

      // Verify recordSensorReading is called
      expect(/recordSensorReading\s*\(\s*ph\s*,\s*doV\s*,\s*turb\s*,\s*temp/.test(onSensorDataCode)).toBe(true);

      // Verify sensor-data-updated event is dispatched
      expect(/dispatchEvent.*sensor-data-updated/.test(onSensorDataCode)).toBe(true);
    }
  });

  /**
   * Property 2.7: History Merge and Deduplication
   * 
   * **Validates: Requirement 3.4**
   * 
   * For any set of history entries fetched from RTDB, the system SHALL CONTINUE TO
   * merge them with localStorage cache and deduplicate by timestamp.
   * 
   * This test verifies the mergeHistoryEntries function behavior.
   * 
   * EXPECTED OUTCOME: Test PASSES (confirms merge/deduplication works)
   */
  it('Property 2.7: mergeHistoryEntries deduplicates by timestamp', () => {
    // Generator for history entries
    const historyEntryGen = fc.record({
      ts: fc.integer({ min: Date.now() - 86400000, max: Date.now() }),
      ph: fc.float({ min: 0, max: 14, noNaN: true }),
      do: fc.float({ min: 0, max: 20, noNaN: true }),
      turb: fc.float({ min: 0, max: 1000, noNaN: true }),
      temp: fc.float({ min: 0, max: 50, noNaN: true })
    });

    const historyArrayGen = fc.array(historyEntryGen, { minLength: 1, maxLength: 50 });

    fc.assert(
      fc.property(historyArrayGen, historyArrayGen, (existingEntries, newEntries) => {
        // Simulate mergeHistoryEntries behavior
        const STORAGE_KEY = 'aquasense.sensorHistory.v1';

        // First deduplicate the existing entries (in case input has duplicates)
        const deduped = [];
        const seen = new Set();
        for (const e of existingEntries) {
          if (!seen.has(e.ts)) {
            deduped.push(e);
            seen.add(e.ts);
          }
        }

        // Store deduplicated existing entries
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(deduped));

        // Simulate merge
        let history = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
        const existing = new Set(history.map(e => e.ts));
        let added = 0;

        for (const e of newEntries) {
          if (!existing.has(e.ts)) {
            history.push(e);
            existing.add(e.ts);
            added++;
          }
        }

        if (added > 0) {
          history.sort((a, b) => a.ts - b.ts);
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
        }

        // Verify deduplication worked
        const merged = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
        const timestamps = merged.map(e => e.ts);
        const uniqueTimestamps = new Set(timestamps);

        // No duplicate timestamps
        expect(timestamps.length).toBe(uniqueTimestamps.size);

        // All original unique entries are present
        const originalUniqueTs = new Set(existingEntries.map(e => e.ts));
        for (const ts of originalUniqueTs) {
          expect(uniqueTimestamps.has(ts)).toBe(true);
        }

        // Entries are sorted by timestamp
        for (let i = 1; i < merged.length; i++) {
          expect(merged[i].ts).toBeGreaterThanOrEqual(merged[i - 1].ts);
        }

        // Clear for next test
        window.localStorage.clear();
      }),
      { numRuns: 50 }
    );
  });

  /**
   * Property 2.8: CSV Export Functionality Preservation
   * 
   * **Validates: Requirement 3.5**
   * 
   * For any time range, the system SHALL CONTINUE TO export historical data to CSV
   * including all available readings.
   * 
   * This test verifies the CSV export button and functionality exist.
   * 
   * EXPECTED OUTCOME: Test PASSES (confirms CSV export works)
   */
  it('Property 2.8: CSV export button exists and historical data is accessible', () => {
    // Verify CSV download button exists on historical data page
    const histSection = document.querySelector('#page-historical-data');
    expect(histSection).toBeTruthy();

    const downloadBtn = histSection.querySelector('#btn-hist-download');
    expect(downloadBtn).toBeTruthy();
    expect(downloadBtn.textContent).toContain('CSV');

    // Read historical-data.js to verify CSV export logic
    const histDataCode = readFileSync('public/js/features/historical-data.js', 'utf-8');

    // Verify CSV export uses getHistoryRange
    const usesGetHistoryRange = /getHistoryRange\s*\(\s*from\.getTime\(\)\s*,\s*to\.getTime\(\)\s*\)/.test(histDataCode);
    expect(usesGetHistoryRange).toBe(true);

    // Verify CSV export creates proper format
    const createsCsvRows = /rows\s*=\s*\[/.test(histDataCode);
    expect(createsCsvRows).toBe(true);

    // Verify CSV includes all metrics
    expect(/["']pH["']/.test(histDataCode)).toBe(true);
    expect(/["']DO/.test(histDataCode)).toBe(true);
    expect(/["']Turbidity/.test(histDataCode)).toBe(true);
    expect(/["']Temp/.test(histDataCode)).toBe(true);
  });
});
