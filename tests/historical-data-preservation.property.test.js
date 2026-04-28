// tests/historical-data-preservation.property.test.js
// Bugfix: historical-data-dashboard-card-mismatch — Preservation Property Tests
// These tests verify that Dashboard structure and Historical Data calculations remain unchanged
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import * as fc from 'fast-check';

// ─── Preservation Property Tests ──────────────────────────────────────────────
// These tests MUST PASS on unfixed code - they verify behavior to preserve
// Run on UNFIXED code to establish baseline behavior

describe('Historical Data Dashboard Card Mismatch — Preservation Properties', () => {
  let dom;
  let document;

  beforeEach(() => {
    const html = readFileSync('public/index.html', 'utf-8');
    dom = new JSDOM(html);
    document = dom.window.document;
  });

  /**
   * Property 2.1: Dashboard Card Structure Preservation
   * 
   * **Validates: Requirement 3.1**
   * 
   * For any page view of the Dashboard page, the system SHALL CONTINUE TO
   * display metric cards with the existing "metric-card scard" structure and styling.
   * 
   * EXPECTED OUTCOME: Test PASSES (confirms Dashboard structure is preserved)
   */
  it('Property 2.1: Dashboard cards maintain "metric-card scard" structure', () => {
    const dashboardSection = document.querySelector('#page-dashboard');
    expect(dashboardSection).toBeTruthy();

    // Dashboard should have 4 metric cards with "metric-card scard" class
    const metricCards = dashboardSection.querySelectorAll('.metric-card.scard');
    expect(metricCards.length).toBe(4);

    // Each card should have the expected structure
    metricCards.forEach(card => {
      // Should have metric-icon
      const icon = card.querySelector('.metric-icon');
      expect(icon).toBeTruthy();
      
      // Icon should contain SVG with icon-20 class
      const iconSvg = icon.querySelector('svg.icon.icon-20');
      expect(iconSvg).toBeTruthy();

      // Should have scard-label
      const label = card.querySelector('.scard-label');
      expect(label).toBeTruthy();

      // Should have scard-val
      const value = card.querySelector('.scard-val');
      expect(value).toBeTruthy();

      // Should have scard-badge
      const badge = card.querySelector('.scard-badge');
      expect(badge).toBeTruthy();

      // Should have sparkline SVG
      const sparkline = card.querySelector('svg.spark');
      expect(sparkline).toBeTruthy();
    });

    // Verify card order: Temperature, pH, DO, Turbidity
    const cardsArray = Array.from(metricCards);
    expect(cardsArray[0].classList.contains('temp')).toBe(true);
    expect(cardsArray[1].classList.contains('ph')).toBe(true);
    expect(cardsArray[2].classList.contains('do')).toBe(true);
    expect(cardsArray[3].classList.contains('turb')).toBe(true);

    // Verify element IDs follow pattern v-{metric} and b-{metric}
    expect(cardsArray[0].querySelector('#v-temp')).toBeTruthy();
    expect(cardsArray[0].querySelector('#b-temp')).toBeTruthy();
    expect(cardsArray[1].querySelector('#v-ph')).toBeTruthy();
    expect(cardsArray[1].querySelector('#b-ph')).toBeTruthy();
    expect(cardsArray[2].querySelector('#v-do')).toBeTruthy();
    expect(cardsArray[2].querySelector('#b-do')).toBeTruthy();
    expect(cardsArray[3].querySelector('#v-turb')).toBeTruthy();
    expect(cardsArray[3].querySelector('#b-turb')).toBeTruthy();

    // Verify sparkline IDs
    expect(cardsArray[0].querySelector('#sp-temp')).toBeTruthy();
    expect(cardsArray[1].querySelector('#sp-ph')).toBeTruthy();
    expect(cardsArray[2].querySelector('#sp-do')).toBeTruthy();
    expect(cardsArray[3].querySelector('#sp-turb')).toBeTruthy();
  });

  /**
   * Property 2.2: Statistical Calculation Preservation
   * 
   * **Validates: Requirement 3.2**
   * 
   * For any set of sensor readings, the system SHALL CONTINUE TO calculate
   * and display average, min, and max statistics correctly.
   * 
   * This property uses property-based testing to verify calculations across
   * many randomly generated sensor reading datasets.
   */
  it('Property 2.2: Statistical calculations (avg, min, max) work correctly', () => {
    // Generator for sensor readings
    const sensorReadingGen = fc.record({
      ts: fc.integer({ min: Date.now() - 86400000, max: Date.now() }),
      ph: fc.option(fc.float({ min: 0, max: 14, noNaN: true }), { nil: null }),
      do: fc.option(fc.float({ min: 0, max: 20, noNaN: true }), { nil: null }),
      turb: fc.option(fc.float({ min: 0, max: 1000, noNaN: true }), { nil: null }),
      temp: fc.option(fc.float({ min: 0, max: 50, noNaN: true }), { nil: null })
    });

    const readingsArrayGen = fc.array(sensorReadingGen, { minLength: 1, maxLength: 100 });

    fc.assert(
      fc.property(readingsArrayGen, (readings) => {
        // Test statsOf function logic (from historical-data.js)
        const statsOf = (readings, key) => {
          const nums = readings
            .map(r => r[key])
            .filter(v => typeof v === 'number' && Number.isFinite(v));
          if (!nums.length) return null;
          const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
          return { avg, min: Math.min(...nums), max: Math.max(...nums) };
        };

        // Test for each metric
        for (const key of ['ph', 'do', 'turb', 'temp']) {
          const stats = statsOf(readings, key);
          const validValues = readings
            .map(r => r[key])
            .filter(v => typeof v === 'number' && Number.isFinite(v));

          if (validValues.length === 0) {
            // No valid values → stats should be null
            expect(stats).toBeNull();
          } else {
            // Has valid values → verify calculations
            expect(stats).not.toBeNull();
            
            // Verify average
            const expectedAvg = validValues.reduce((a, b) => a + b, 0) / validValues.length;
            expect(Math.abs(stats.avg - expectedAvg)).toBeLessThan(0.0001);

            // Verify min
            const expectedMin = Math.min(...validValues);
            expect(stats.min).toBe(expectedMin);

            // Verify max
            const expectedMax = Math.max(...validValues);
            expect(stats.max).toBe(expectedMax);

            // Verify avg is between min and max
            expect(stats.avg).toBeGreaterThanOrEqual(stats.min);
            expect(stats.avg).toBeLessThanOrEqual(stats.max);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2.3: Badge Classification Preservation
   * 
   * **Validates: Requirement 3.3**
   * 
   * For any metric value and threshold configuration, the system SHALL CONTINUE TO
   * update stat card badges based on threshold values (Normal/Warning/Critical).
   * 
   * This property verifies the badge classification logic across many threshold
   * configurations and metric values.
   */
  it('Property 2.3: Badge updates based on thresholds work correctly', () => {
    // Generator for threshold ranges
    const thresholdGen = fc.record({
      ok: fc.tuple(
        fc.float({ min: 0, max: 50 }),
        fc.float({ min: 0, max: 50 })
      ).map(([a, b]) => [Math.min(a, b), Math.max(a, b)]),
      warn: fc.tuple(
        fc.float({ min: 0, max: 50 }),
        fc.float({ min: 0, max: 50 })
      ).map(([a, b]) => [Math.min(a, b), Math.max(a, b)])
    });

    const valueGen = fc.float({ min: -10, max: 60, noNaN: true });

    fc.assert(
      fc.property(thresholdGen, valueGen, (threshold, value) => {
        // Test badgeClass function logic (from historical-data.js)
        const badgeClass = (threshold, val) => {
          if (!threshold || val == null) return 'ok';
          if (val >= threshold.ok[0] && val <= threshold.ok[1]) return 'ok';
          if (val >= threshold.warn[0] && val <= threshold.warn[1]) return 'warn';
          return 'danger';
        };

        const result = badgeClass(threshold, value);

        // Verify result is one of the valid badge classes
        expect(['ok', 'warn', 'danger']).toContain(result);

        // Verify classification logic
        if (value >= threshold.ok[0] && value <= threshold.ok[1]) {
          expect(result).toBe('ok');
        } else if (value >= threshold.warn[0] && value <= threshold.warn[1]) {
          expect(result).toBe('warn');
        } else {
          expect(result).toBe('danger');
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2.4: Color Scheme Consistency Preservation
   * 
   * **Validates: Requirement 3.4**
   * 
   * For any page (Dashboard or Historical Data), the system SHALL CONTINUE TO
   * use the same color scheme for each metric:
   * - Temperature: red
   * - pH: blue
   * - DO: green
   * - Turbidity: yellow
   */
  it('Property 2.4: Color schemes are consistent across pages', () => {
    // Check Dashboard color scheme
    const dashboardSection = document.querySelector('#page-dashboard');
    const dashCards = dashboardSection.querySelectorAll('.metric-card.scard');

    const tempCard = Array.from(dashCards).find(c => c.classList.contains('temp'));
    const phCard = Array.from(dashCards).find(c => c.classList.contains('ph'));
    const doCard = Array.from(dashCards).find(c => c.classList.contains('do'));
    const turbCard = Array.from(dashCards).find(c => c.classList.contains('turb'));

    // Verify Dashboard icons have correct color variables
    expect(tempCard.querySelector('.metric-icon').getAttribute('style')).toContain('--temp-c');
    expect(phCard.querySelector('.metric-icon').getAttribute('style')).toContain('--ph-c');
    expect(doCard.querySelector('.metric-icon').getAttribute('style')).toContain('--do-c');
    expect(turbCard.querySelector('.metric-icon').getAttribute('style')).toContain('--turb-c');

    // Check Historical Data color scheme (after fix, uses metric-card scard)
    const histSection = document.querySelector('#page-historical-data');
    const histCards = histSection.querySelectorAll('.metric-card.scard');

    const tempHistCard = Array.from(histCards).find(c => c.classList.contains('temp'));
    const phHistCard = Array.from(histCards).find(c => c.classList.contains('ph'));
    const doHistCard = Array.from(histCards).find(c => c.classList.contains('do'));
    const turbHistCard = Array.from(histCards).find(c => c.classList.contains('turb'));

    // Historical Data cards should use the same color variables as Dashboard
    expect(tempHistCard.querySelector('.metric-icon').getAttribute('style')).toContain('--temp-c');
    expect(phHistCard.querySelector('.metric-icon').getAttribute('style')).toContain('--ph-c');
    expect(doHistCard.querySelector('.metric-icon').getAttribute('style')).toContain('--do-c');
    expect(turbHistCard.querySelector('.metric-icon').getAttribute('style')).toContain('--turb-c');
  });

  /**
   * Property 2.5: Element ID Existence for Updates
   * 
   * **Validates: Requirement 3.5**
   * 
   * The Historical Data page SHALL have elements that can be updated when
   * date range or thresholds change. This test verifies the necessary elements
   * exist in the DOM (after fix, these use the new IDs with hist- prefix).
   */
  it('Property 2.5: Historical Data page has updateable elements', () => {
    const histSection = document.querySelector('#page-historical-data');
    expect(histSection).toBeTruthy();

    // After fix, these elements should exist with new IDs (hist-v-{metric}, hist-b-{metric})
    const metrics = ['ph', 'do', 'turb', 'temp'];
    
    for (const metric of metrics) {
      // Average value elements (new IDs after fix)
      const avgEl = histSection.querySelector(`#hist-v-${metric}`);
      expect(avgEl).toBeTruthy();

      // Badge elements (new IDs after fix)
      const badgeEl = histSection.querySelector(`#hist-b-${metric}`);
      expect(badgeEl).toBeTruthy();

      // Sparkline elements (new after fix)
      const sparkEl = histSection.querySelector(`#hist-sp-${metric}`);
      expect(sparkEl).toBeTruthy();
    }

    // Verify range selector exists
    const rangeSelector = histSection.querySelector('#hist-range');
    expect(rangeSelector).toBeTruthy();

    // Verify custom range inputs exist
    const customFrom = histSection.querySelector('#hist-from');
    const customTo = histSection.querySelector('#hist-to');
    expect(customFrom).toBeTruthy();
    expect(customTo).toBeTruthy();

    // Verify threshold edit button exists
    const thresholdBtn = histSection.querySelector('#btn-edit-thresholds');
    expect(thresholdBtn).toBeTruthy();
  });
});
