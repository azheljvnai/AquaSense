// tests/historical-data-cards.bugfix.test.js
// Bugfix: historical-data-dashboard-card-mismatch — Bug Condition Exploration Test
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';

// ─── Bug Condition Exploration Test ──────────────────────────────────────────
// This test MUST FAIL on unfixed code - failure confirms the bug exists
// DO NOT attempt to fix the test or the code when it fails
// This test encodes the expected behavior - it will validate the fix when it passes

describe('Historical Data Dashboard Card Mismatch — Bug Condition Exploration', () => {
  let dom;
  let document;

  // Load the HTML file
  beforeEach(() => {
    const html = readFileSync('public/index.html', 'utf-8');
    dom = new JSDOM(html);
    document = dom.window.document;
  });

  /**
   * Property 1: Bug Condition - Historical Data Cards Match Dashboard Structure
   * 
   * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**
   * 
   * For any page view where the user navigates to the Historical Data page,
   * the system SHALL render metric cards with class "metric-card scard" matching
   * the Dashboard structure, including sparkline SVG elements with appropriate IDs,
   * icons with size 20px, and cards in the same order as Dashboard
   * (Temperature, pH, DO, Turbidity).
   * 
   * EXPECTED OUTCOME ON UNFIXED CODE: Test FAILS
   * - Cards use "hist-stat-card" class instead of "metric-card scard"
   * - Cards missing sparkline SVG elements
   * - Cards use "icon-16" instead of "icon-20"
   * - Cards in wrong order (pH, DO, Turbidity, Temperature)
   * - Cards use old element IDs (hstat-{metric}-avg, hstat-{metric}-badge)
   */
  it('Property 1: Historical Data cards should match Dashboard structure', () => {
    // Find the Historical Data section
    const histDataSection = document.querySelector('#page-historical-data');
    expect(histDataSection).toBeTruthy();

    // Test 1: Cards should have class "metric-card scard" (not "hist-stat-card")
    const metricCards = histDataSection.querySelectorAll('.metric-card.scard');
    const histStatCards = histDataSection.querySelectorAll('.hist-stat-card');
    
    expect(histStatCards.length).toBe(0); // Should have NO hist-stat-card elements
    expect(metricCards.length).toBe(4); // Should have 4 metric-card scard elements

    // Test 2: Cards should include sparkline SVG elements with correct IDs
    const sparklines = {
      temp: histDataSection.querySelector('#hist-sp-temp'),
      ph: histDataSection.querySelector('#hist-sp-ph'),
      do: histDataSection.querySelector('#hist-sp-do'),
      turb: histDataSection.querySelector('#hist-sp-turb')
    };

    expect(sparklines.temp).toBeTruthy();
    expect(sparklines.temp.tagName.toLowerCase()).toBe('svg');
    expect(sparklines.temp.classList.contains('spark')).toBe(true);

    expect(sparklines.ph).toBeTruthy();
    expect(sparklines.ph.tagName.toLowerCase()).toBe('svg');
    expect(sparklines.ph.classList.contains('spark')).toBe(true);

    expect(sparklines.do).toBeTruthy();
    expect(sparklines.do.tagName.toLowerCase()).toBe('svg');
    expect(sparklines.do.classList.contains('spark')).toBe(true);

    expect(sparklines.turb).toBeTruthy();
    expect(sparklines.turb.tagName.toLowerCase()).toBe('svg');
    expect(sparklines.turb.classList.contains('spark')).toBe(true);

    // Test 3: Card icons should use class "icon-20" (not "icon-16")
    const icons = histDataSection.querySelectorAll('.metric-icon svg.icon');
    expect(icons.length).toBe(4);
    
    icons.forEach(icon => {
      expect(icon.classList.contains('icon-20')).toBe(true);
      expect(icon.classList.contains('icon-16')).toBe(false);
    });

    // Test 4: Cards should be ordered: Temperature, pH, DO, Turbidity
    const cardsArray = Array.from(metricCards);
    expect(cardsArray.length).toBe(4);
    
    // Check order by class names
    expect(cardsArray[0].classList.contains('temp')).toBe(true);
    expect(cardsArray[1].classList.contains('ph')).toBe(true);
    expect(cardsArray[2].classList.contains('do')).toBe(true);
    expect(cardsArray[3].classList.contains('turb')).toBe(true);

    // Test 5: Cards should use element IDs "hist-v-{metric}" and "hist-b-{metric}"
    // (not "hstat-{metric}-avg" and "hstat-{metric}-badge")
    const valueElements = {
      temp: histDataSection.querySelector('#hist-v-temp'),
      ph: histDataSection.querySelector('#hist-v-ph'),
      do: histDataSection.querySelector('#hist-v-do'),
      turb: histDataSection.querySelector('#hist-v-turb')
    };

    const badgeElements = {
      temp: histDataSection.querySelector('#hist-b-temp'),
      ph: histDataSection.querySelector('#hist-b-ph'),
      do: histDataSection.querySelector('#hist-b-do'),
      turb: histDataSection.querySelector('#hist-b-turb')
    };

    // Should have new IDs
    expect(valueElements.temp).toBeTruthy();
    expect(valueElements.ph).toBeTruthy();
    expect(valueElements.do).toBeTruthy();
    expect(valueElements.turb).toBeTruthy();

    expect(badgeElements.temp).toBeTruthy();
    expect(badgeElements.ph).toBeTruthy();
    expect(badgeElements.do).toBeTruthy();
    expect(badgeElements.turb).toBeTruthy();

    // Should NOT have old IDs
    expect(histDataSection.querySelector('#hstat-temp-avg')).toBeNull();
    expect(histDataSection.querySelector('#hstat-ph-avg')).toBeNull();
    expect(histDataSection.querySelector('#hstat-do-avg')).toBeNull();
    expect(histDataSection.querySelector('#hstat-turb-avg')).toBeNull();

    expect(histDataSection.querySelector('#hstat-temp-badge')).toBeNull();
    expect(histDataSection.querySelector('#hstat-ph-badge')).toBeNull();
    expect(histDataSection.querySelector('#hstat-do-badge')).toBeNull();
    expect(histDataSection.querySelector('#hstat-turb-badge')).toBeNull();
  });
});
