// tests/configuration-ui-cleanup.bugfix.test.js
// Bugfix: configuration-ui-cleanup — Bug Condition Exploration Test
// This test MUST FAIL on unfixed code - failure confirms the bugs exist
// DO NOT attempt to fix the test or the code when it fails
// This test encodes the expected behavior - it will validate the fix when it passes

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';

// ─── Mock ES module dependencies ─────────────────────────────────────────────

vi.mock('../public/js/pond-config.js', () => ({
  getConfigurations: vi.fn(() => Promise.resolve([
    { id: 'crayfish', species: 'crayfish', name: 'Crayfish', isPreset: true, thresholds: { ph: { optimalMin: 6.5, optimalMax: 8.5 }, temp: { optimalMin: 18, optimalMax: 24 }, do: { optimalMin: 5.0 }, turb: { optimalMax: 20 } } },
    { id: 'tilapia', species: 'tilapia', name: 'Tilapia', isPreset: true, thresholds: { ph: { optimalMin: 6.5, optimalMax: 8.5 }, temp: { optimalMin: 25, optimalMax: 30 }, do: { optimalMin: 5.0 }, turb: { optimalMax: 30 } } },
    { id: 'catfish', species: 'catfish', name: 'Catfish', isPreset: true, thresholds: { ph: { optimalMin: 6.5, optimalMax: 8.0 }, temp: { optimalMin: 24, optimalMax: 28 }, do: { optimalMin: 4.0 }, turb: { optimalMax: 40 } } },
    { id: 'shrimp', species: 'shrimp', name: 'Shrimp', isPreset: true, thresholds: { ph: { optimalMin: 7.0, optimalMax: 8.5 }, temp: { optimalMin: 26, optimalMax: 30 }, do: { optimalMin: 5.0 }, turb: { optimalMax: 15 } } },
  ])),
  createConfiguration: vi.fn(),
  updateConfiguration: vi.fn(),
  deleteConfiguration: vi.fn(),
  setActiveConfiguration: vi.fn(),
  deactivateConfiguration: vi.fn(),
  loadActiveConfiguration: vi.fn(() => Promise.resolve()),
  getActiveConfigId: vi.fn(() => 'crayfish'),
  getActiveSpecies: vi.fn(() => 'crayfish'),
  getActiveThresholds: vi.fn(() => ({
    ph: { optimalMin: 6.5, optimalMax: 8.5 },
    temp: { optimalMin: 18, optimalMax: 24 },
    do: { optimalMin: 5.0 },
    turb: { optimalMax: 20 },
  })),
  onConfigChange: vi.fn(),
  SPECIES_PRESETS: {
    crayfish: { name: 'Crayfish', species: 'crayfish', thresholds: { ph: { optimalMin: 6.5, optimalMax: 8.5 }, temp: { optimalMin: 18, optimalMax: 24 }, do: { optimalMin: 5.0 }, turb: { optimalMax: 20 } } },
    tilapia: { name: 'Tilapia', species: 'tilapia', thresholds: { ph: { optimalMin: 6.5, optimalMax: 8.5 }, temp: { optimalMin: 25, optimalMax: 30 }, do: { optimalMin: 5.0 }, turb: { optimalMax: 30 } } },
    catfish: { name: 'Catfish', species: 'catfish', thresholds: { ph: { optimalMin: 6.5, optimalMax: 8.0 }, temp: { optimalMin: 24, optimalMax: 28 }, do: { optimalMin: 4.0 }, turb: { optimalMax: 40 } } },
    shrimp: { name: 'Shrimp', species: 'shrimp', thresholds: { ph: { optimalMin: 7.0, optimalMax: 8.5 }, temp: { optimalMin: 26, optimalMax: 30 }, do: { optimalMin: 5.0 }, turb: { optimalMax: 15 } } },
  },
}));

vi.mock('../public/js/utils.js', () => ({
  getThresholds: vi.fn(() => ({
    ph: { ok: [6.5, 8.5], warn: [6.0, 9.0] },
    do: { ok: [5.0, 12.0], warn: [4.0, 14.0] },
    turb: { ok: [0, 50], warn: [0, 100] },
    temp: { ok: [20, 30], warn: [15, 35] },
  })),
  saveThresholds: vi.fn(),
  resetThresholds: vi.fn(),
}));

// ─── Bug Condition Exploration Test ──────────────────────────────────────────
// Property 1: Bug Condition - Configuration UI Displays Correctly
//
// **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7**
//
// For any page load or configuration change event where a configuration is active,
// the Configuration UI SHALL display exactly 4 configurations in the dropdown,
// SHALL NOT display an "Assign Preset" button, SHALL display "Active preset: [Species Name]",
// SHALL populate all threshold input fields with the active configuration's values,
// SHALL NOT display a Temperature Alert Sensitivity slider, and SHALL hide the Save All Settings button.
//
// EXPECTED OUTCOME ON UNFIXED CODE: Tests FAIL
// - Dropdown may contain more than 4 configurations (duplicates)
// - "Assign Preset" button exists in the UI
// - Preset label shows "No active config" instead of "Active preset: Crayfish"
// - Threshold input fields are empty
// - Temperature Alert Sensitivity slider exists
// - Save All Settings button is visible
//
// EXPECTED OUTCOME ON FIXED CODE: Tests PASS

describe('Configuration UI Cleanup — Bug Condition Exploration', () => {
  let dom;
  let window;
  let document;

  beforeEach(async () => {
    // Load the real HTML
    const html = readFileSync('public/index.html', 'utf-8');
    dom = new JSDOM(html, {
      runScripts: 'dangerously',
      resources: 'usable',
      url: 'http://localhost',
    });
    window = dom.window;
    document = dom.window.document;

    // Mock window._rbacPerms for permission checks
    window._rbacPerms = {
      canEditConfig: true,
    };

    // Stub requestAnimationFrame
    window.requestAnimationFrame = vi.fn(cb => cb());
  });

  afterEach(() => {
    if (dom) {
      dom.window.close();
    }
  });

  /**
   * Property 1 — Test 1: Exactly 4 configurations in dropdown
   *
   * isBugCondition: configurationsDropdown.length > 4
   *
   * On UNFIXED code: Dropdown contains duplicates (e.g., 6 or 8 configurations) → FAILS
   * On FIXED code:   Dropdown contains exactly 4 configurations (one per species) → PASSES
   */
  it('Test 1: Configuration dropdown should contain exactly 4 configurations', async () => {
    const { init, loadConfigurationsAfterAuth } = await import('../public/js/features/config-management.js');

    const origDocument = globalThis.document;
    const origWindow = globalThis.window;
    globalThis.document = document;
    globalThis.window = window;

    try {
      // Initialize config management
      await init();
      await loadConfigurationsAfterAuth();

      // Allow async rendering to complete
      await new Promise(r => setTimeout(r, 100));

      const dropdown = document.getElementById('config-dropdown');
      expect(dropdown).not.toBeNull();

      // Count options (excluding "Not Configured" if present)
      const options = Array.from(dropdown.options).filter(opt => opt.value !== '');
      
      // On UNFIXED code: options.length > 4 (duplicates exist) → FAILS
      // On FIXED code:   options.length === 4 (one per species) → PASSES
      expect(options.length).toBe(4);
    } finally {
      globalThis.document = origDocument;
      globalThis.window = origWindow;
    }
  });

  /**
   * Property 1 — Test 2: "Assign Preset" button should NOT exist
   *
   * isBugCondition: assignPresetButton.isVisible == true
   *
   * On UNFIXED code: Button exists in the rendered HTML → FAILS
   * On FIXED code:   Button does not exist → PASSES
   */
  it('Test 2: "Assign Preset" button should NOT exist in config-management UI', async () => {
    const { init, loadConfigurationsAfterAuth } = await import('../public/js/features/config-management.js');

    const origDocument = globalThis.document;
    const origWindow = globalThis.window;
    globalThis.document = document;
    globalThis.window = window;

    try {
      await init();
      await loadConfigurationsAfterAuth();
      await new Promise(r => setTimeout(r, 100));

      // Search for "Assign Preset" button by text content
      const buttons = Array.from(document.querySelectorAll('button'));
      const assignPresetButton = buttons.find(btn => btn.textContent.includes('Assign Preset'));

      // On UNFIXED code: assignPresetButton exists → FAILS
      // On FIXED code:   assignPresetButton is undefined → PASSES
      expect(assignPresetButton).toBeUndefined();
    } finally {
      globalThis.document = origDocument;
      globalThis.window = origWindow;
    }
  });

  /**
   * Property 1 — Test 3: "Active preset: [Species Name]" label should display
   *
   * isBugCondition: activePresetLabel.text == "No active config" AND activeConfig != null
   *
   * On UNFIXED code: Label shows "No active config" when Crayfish is active → FAILS
   * On FIXED code:   Label shows "Active preset: Crayfish" → PASSES
   */
  it('Test 3: "Active preset: Crayfish" label should display when configuration is active', async () => {
    const configMgmt = await import('../public/js/features/config-management.js');
    const configFeature = await import('../public/js/features/configuration.js');

    const origDocument = globalThis.document;
    const origWindow = globalThis.window;
    globalThis.document = document;
    globalThis.window = window;

    try {
      await configMgmt.init();
      await configMgmt.loadConfigurationsAfterAuth();
      configFeature.init();
      await new Promise(r => setTimeout(r, 100));

      const label = document.getElementById('cfg-active-preset-label');
      expect(label).not.toBeNull();

      // On UNFIXED code: label.textContent === "No active config" → FAILS
      // On FIXED code:   label.textContent === "Active preset: Crayfish" → PASSES
      expect(label.textContent).toBe('Active preset: Crayfish');
    } finally {
      globalThis.document = origDocument;
      globalThis.window = origWindow;
    }
  });

  /**
   * Property 1 — Test 4: Threshold input fields should populate with active configuration values
   *
   * isBugCondition: thresholdInputs.values != activeConfig.thresholds
   *
   * On UNFIXED code: Input fields are empty or show default values → FAILS
   * On FIXED code:   Input fields show Crayfish preset values → PASSES
   */
  it('Test 4: Threshold input fields should populate with active configuration values', async () => {
    const configMgmt = await import('../public/js/features/config-management.js');
    const configFeature = await import('../public/js/features/configuration.js');

    const origDocument = globalThis.document;
    const origWindow = globalThis.window;
    globalThis.document = document;
    globalThis.window = window;

    try {
      await configMgmt.init();
      await configMgmt.loadConfigurationsAfterAuth();
      configFeature.init();
      await new Promise(r => setTimeout(r, 100));

      // Check pH inputs
      const phMin = document.getElementById('cfg-th-ph-min');
      const phMax = document.getElementById('cfg-th-ph-max');
      expect(phMin).not.toBeNull();
      expect(phMax).not.toBeNull();

      // On UNFIXED code: values are empty or incorrect → FAILS
      // On FIXED code:   values match Crayfish preset (6.5, 8.5) → PASSES
      expect(phMin.value).toBe('6.5');
      expect(phMax.value).toBe('8.5');

      // Check DO input
      const doMin = document.getElementById('cfg-th-do-min');
      expect(doMin).not.toBeNull();
      expect(doMin.value).toBe('5');

      // Check Turbidity input
      const turbMax = document.getElementById('cfg-th-turb-max');
      expect(turbMax).not.toBeNull();
      expect(turbMax.value).toBe('20');

      // Check Temperature inputs
      const tempMin = document.getElementById('cfg-temp-min');
      const tempMax = document.getElementById('cfg-temp-max');
      expect(tempMin).not.toBeNull();
      expect(tempMax).not.toBeNull();
      expect(tempMin.value).toBe('18');
      expect(tempMax.value).toBe('24');
    } finally {
      globalThis.document = origDocument;
      globalThis.window = origWindow;
    }
  });

  /**
   * Property 1 — Test 5: Temperature Alert Sensitivity slider should NOT exist
   *
   * isBugCondition: temperatureAlertSensitivitySlider.exists == true
   *
   * On UNFIXED code: Slider element exists in HTML → FAILS
   * On FIXED code:   Slider element does not exist → PASSES
   */
  it('Test 5: Temperature Alert Sensitivity slider should NOT exist', async () => {
    const origDocument = globalThis.document;
    const origWindow = globalThis.window;
    globalThis.document = document;
    globalThis.window = window;

    try {
      const slider = document.getElementById('cfg-temp-sens');

      // On UNFIXED code: slider exists → FAILS
      // On FIXED code:   slider is null → PASSES
      expect(slider).toBeNull();
    } finally {
      globalThis.document = origDocument;
      globalThis.window = origWindow;
    }
  });

  /**
   * Property 1 — Test 6: Save All Settings button should be hidden
   *
   * isBugCondition: saveAllSettingsButton.isVisible == true
   *
   * On UNFIXED code: Button is visible (display !== 'none') → FAILS
   * On FIXED code:   Button is hidden (display === 'none' or does not exist) → PASSES
   */
  it('Test 6: Save All Settings button should be hidden', async () => {
    const origDocument = globalThis.document;
    const origWindow = globalThis.window;
    globalThis.document = document;
    globalThis.window = window;

    try {
      const saveButton = document.getElementById('cfg-save');

      // On FIXED code: button either doesn't exist OR is hidden (display === 'none')
      if (saveButton === null) {
        // Button was removed entirely - this is acceptable
        expect(saveButton).toBeNull();
      } else {
        // Button exists but should be hidden
        const style = window.getComputedStyle(saveButton);
        // On UNFIXED code: display is not 'none' (button is visible) → FAILS
        // On FIXED code:   display is 'none' (button is hidden) → PASSES
        expect(style.display).toBe('none');
      }
    } finally {
      globalThis.document = origDocument;
      globalThis.window = origWindow;
    }
  });
});
