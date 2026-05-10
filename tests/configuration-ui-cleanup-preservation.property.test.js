// tests/configuration-ui-cleanup-preservation.property.test.js
// Bugfix: configuration-ui-cleanup — Preservation Property Tests
// These tests verify that configuration management functionality remains unchanged
// **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**
//
// EXPECTED OUTCOME: Tests PASS on unfixed code (confirms baseline behavior to preserve)

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import * as fc from 'fast-check';

// ─── Mock ES module dependencies ─────────────────────────────────────────────

let mockConfigurations = [
  { id: 'crayfish', species: 'crayfish', name: 'Crayfish', isPreset: true, thresholds: { ph: { optimalMin: 6.5, optimalMax: 8.5 }, temp: { optimalMin: 18, optimalMax: 24 }, do: { optimalMin: 5.0 }, turb: { optimalMax: 20 } } },
  { id: 'tilapia', species: 'tilapia', name: 'Tilapia', isPreset: true, thresholds: { ph: { optimalMin: 6.5, optimalMax: 8.5 }, temp: { optimalMin: 25, optimalMax: 30 }, do: { optimalMin: 5.0 }, turb: { optimalMax: 30 } } },
  { id: 'catfish', species: 'catfish', name: 'Catfish', isPreset: true, thresholds: { ph: { optimalMin: 6.5, optimalMax: 8.0 }, temp: { optimalMin: 24, optimalMax: 28 }, do: { optimalMin: 4.0 }, turb: { optimalMax: 40 } } },
  { id: 'shrimp', species: 'shrimp', name: 'Shrimp', isPreset: true, thresholds: { ph: { optimalMin: 7.0, optimalMax: 8.5 }, temp: { optimalMin: 26, optimalMax: 30 }, do: { optimalMin: 5.0 }, turb: { optimalMax: 15 } } },
];

let mockActiveConfigId = 'crayfish';
let mockActiveSpecies = 'crayfish';

const mockGetConfigurations = vi.fn(() => Promise.resolve([...mockConfigurations]));
const mockCreateConfiguration = vi.fn((config) => {
  const newConfig = { ...config, id: `custom-${Date.now()}` };
  mockConfigurations.push(newConfig);
  return Promise.resolve(newConfig);
});
const mockUpdateConfiguration = vi.fn((id, updates) => {
  const index = mockConfigurations.findIndex(c => c.id === id);
  if (index !== -1) {
    mockConfigurations[index] = { ...mockConfigurations[index], ...updates };
  }
  return Promise.resolve();
});
const mockDeleteConfiguration = vi.fn((id) => {
  mockConfigurations = mockConfigurations.filter(c => c.id !== id);
  return Promise.resolve();
});
const mockSetActiveConfiguration = vi.fn((id) => {
  mockActiveConfigId = id;
  const config = mockConfigurations.find(c => c.id === id);
  mockActiveSpecies = config?.species || null;
  return Promise.resolve();
});
const mockDeactivateConfiguration = vi.fn(() => {
  mockActiveConfigId = null;
  mockActiveSpecies = null;
  return Promise.resolve();
});
const mockLoadActiveConfiguration = vi.fn(() => Promise.resolve());
const mockGetActiveConfigId = vi.fn(() => mockActiveConfigId);
const mockGetActiveSpecies = vi.fn(() => mockActiveSpecies);
const mockGetActiveThresholds = vi.fn(() => {
  const config = mockConfigurations.find(c => c.id === mockActiveConfigId);
  return config?.thresholds || null;
});
const mockOnConfigChange = vi.fn();

vi.mock('../public/js/pond-config.js', () => ({
  getConfigurations: mockGetConfigurations,
  createConfiguration: mockCreateConfiguration,
  updateConfiguration: mockUpdateConfiguration,
  deleteConfiguration: mockDeleteConfiguration,
  setActiveConfiguration: mockSetActiveConfiguration,
  deactivateConfiguration: mockDeactivateConfiguration,
  loadActiveConfiguration: mockLoadActiveConfiguration,
  getActiveConfigId: mockGetActiveConfigId,
  getActiveSpecies: mockGetActiveSpecies,
  getActiveThresholds: mockGetActiveThresholds,
  onConfigChange: mockOnConfigChange,
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

// ─── Preservation Property Tests ──────────────────────────────────────────────
// Property 2: Preservation - Configuration Management Functionality
//
// For any user interaction with configuration management features (create, edit,
// delete, activate, deactivate), the fixed code SHALL produce exactly the same
// behavior as the original code, preserving all CRUD operations, validation logic,
// dialog functionality, and threshold display in the config-management card.

describe('Configuration UI Cleanup — Preservation Properties', () => {
  let dom;
  let window;
  let document;

  beforeEach(async () => {
    // Reset mock state
    mockConfigurations = [
      { id: 'crayfish', species: 'crayfish', name: 'Crayfish', isPreset: true, thresholds: { ph: { optimalMin: 6.5, optimalMax: 8.5 }, temp: { optimalMin: 18, optimalMax: 24 }, do: { optimalMin: 5.0 }, turb: { optimalMax: 20 } } },
      { id: 'tilapia', species: 'tilapia', name: 'Tilapia', isPreset: true, thresholds: { ph: { optimalMin: 6.5, optimalMax: 8.5 }, temp: { optimalMin: 25, optimalMax: 30 }, do: { optimalMin: 5.0 }, turb: { optimalMax: 30 } } },
      { id: 'catfish', species: 'catfish', name: 'Catfish', isPreset: true, thresholds: { ph: { optimalMin: 6.5, optimalMax: 8.0 }, temp: { optimalMin: 24, optimalMax: 28 }, do: { optimalMin: 4.0 }, turb: { optimalMax: 40 } } },
      { id: 'shrimp', species: 'shrimp', name: 'Shrimp', isPreset: true, thresholds: { ph: { optimalMin: 7.0, optimalMax: 8.5 }, temp: { optimalMin: 26, optimalMax: 30 }, do: { optimalMin: 5.0 }, turb: { optimalMax: 15 } } },
    ];
    mockActiveConfigId = 'crayfish';
    mockActiveSpecies = 'crayfish';

    // Clear mock call history
    mockGetConfigurations.mockClear();
    mockCreateConfiguration.mockClear();
    mockUpdateConfiguration.mockClear();
    mockDeleteConfiguration.mockClear();
    mockSetActiveConfiguration.mockClear();
    mockDeactivateConfiguration.mockClear();
    mockLoadActiveConfiguration.mockClear();

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

    // Mock window.confirm to auto-accept
    window.confirm = vi.fn(() => true);

    // Stub requestAnimationFrame
    window.requestAnimationFrame = vi.fn(cb => cb());
  });

  afterEach(() => {
    if (dom) {
      dom.window.close();
    }
  });

  /**
   * Property 2.1: Configuration Selection Activates Configuration
   *
   * **Validates: Requirement 3.1**
   *
   * For any configuration selection from the dropdown, the system SHALL CONTINUE TO
   * activate that configuration and display its thresholds.
   *
   * EXPECTED OUTCOME: Test PASSES (confirms baseline behavior is preserved)
   */
  it('Property 2.1: Configuration selection from dropdown activates that configuration', async () => {
    const { init, loadConfigurationsAfterAuth } = await import('../public/js/features/config-management.js');

    const origDocument = globalThis.document;
    const origWindow = globalThis.window;
    globalThis.document = document;
    globalThis.window = window;

    try {
      await init();
      await loadConfigurationsAfterAuth();
      await new Promise(r => setTimeout(r, 100));

      const dropdown = document.getElementById('config-dropdown');
      expect(dropdown).not.toBeNull();

      // Verify initial state (Crayfish active)
      expect(dropdown.value).toBe('crayfish');
      expect(mockActiveConfigId).toBe('crayfish');

      // Change to Tilapia
      dropdown.value = 'tilapia';
      dropdown.dispatchEvent(new window.Event('change'));
      await new Promise(r => setTimeout(r, 50));

      // Verify setActiveConfiguration was called
      expect(mockSetActiveConfiguration).toHaveBeenCalledWith('tilapia');
      expect(mockActiveConfigId).toBe('tilapia');

      // Verify threshold display updated
      const thresholdCard = document.querySelector('.config-details-card');
      expect(thresholdCard).not.toBeNull();
      expect(thresholdCard.textContent).toContain('25');
      expect(thresholdCard.textContent).toContain('30');
    } finally {
      globalThis.document = origDocument;
      globalThis.window = origWindow;
    }
  });

  /**
   * Property 2.2: "Create Custom" Button Opens Dialog
   *
   * **Validates: Requirement 3.2**
   *
   * For any click on the "Create Custom" button, the system SHALL CONTINUE TO
   * open the create configuration dialog.
   *
   * EXPECTED OUTCOME: Test PASSES (confirms baseline behavior is preserved)
   */
  it('Property 2.2: "Create Custom" button opens create configuration dialog', async () => {
    const { init, loadConfigurationsAfterAuth } = await import('../public/js/features/config-management.js');

    const origDocument = globalThis.document;
    const origWindow = globalThis.window;
    globalThis.document = document;
    globalThis.window = window;

    try {
      await init();
      await loadConfigurationsAfterAuth();
      await new Promise(r => setTimeout(r, 100));

      // Find "Create Custom" button
      const buttons = Array.from(document.querySelectorAll('button'));
      const createButton = buttons.find(btn => btn.textContent.includes('Create Custom'));
      expect(createButton).not.toBeNull();

      // Click the button
      createButton.click();
      await new Promise(r => setTimeout(r, 50));

      // Verify dialog is displayed
      const dialog = document.getElementById('create-config-dialog');
      expect(dialog).not.toBeNull();
      expect(dialog.style.display).toBe('flex');

      // Verify dialog has expected form fields
      expect(document.getElementById('config-name')).not.toBeNull();
      expect(document.getElementById('config-species')).not.toBeNull();
      expect(document.getElementById('config-ph-min')).not.toBeNull();
      expect(document.getElementById('config-ph-max')).not.toBeNull();
      expect(document.getElementById('config-temp-min')).not.toBeNull();
      expect(document.getElementById('config-temp-max')).not.toBeNull();
      expect(document.getElementById('config-do-min')).not.toBeNull();
      expect(document.getElementById('config-turb-max')).not.toBeNull();
    } finally {
      globalThis.document = origDocument;
      globalThis.window = origWindow;
    }
  });

  /**
   * Property 2.3: "Edit" Button Exists for Active Configuration
   *
   * **Validates: Requirement 3.3**
   *
   * For any active configuration, the system SHALL CONTINUE TO display an "Edit"
   * button that can be used to edit the configuration.
   *
   * EXPECTED OUTCOME: Test PASSES (confirms baseline behavior is preserved)
   */
  it('Property 2.3: "Edit" button exists for active configuration', async () => {
    const { init, loadConfigurationsAfterAuth } = await import('../public/js/features/config-management.js');

    const origDocument = globalThis.document;
    const origWindow = globalThis.window;
    globalThis.document = document;
    globalThis.window = window;

    try {
      await init();
      await loadConfigurationsAfterAuth();
      await new Promise(r => setTimeout(r, 100));

      // Find "Edit" button
      const buttons = Array.from(document.querySelectorAll('button'));
      const editButton = buttons.find(btn => btn.textContent.includes('Edit'));
      
      // Verify Edit button exists for active configuration
      expect(editButton).not.toBeNull();
      expect(editButton.textContent).toContain('Edit');
    } finally {
      globalThis.document = origDocument;
      globalThis.window = origWindow;
    }
  });

  /**
   * Property 2.4: "Delete" Button Exists for Custom Configurations
   *
   * **Validates: Requirement 3.4**
   *
   * For any custom configuration (not presets), the system SHALL CONTINUE TO
   * display a "Delete" button that can be used to delete the configuration.
   *
   * EXPECTED OUTCOME: Test PASSES (confirms baseline behavior is preserved)
   */
  it('Property 2.4: "Delete" button exists for custom configurations (not presets)', async () => {
    // Add a custom configuration
    mockConfigurations.push({
      id: 'custom-1',
      species: 'crayfish',
      name: 'Custom Crayfish',
      isPreset: false,
      thresholds: { ph: { optimalMin: 7.0, optimalMax: 8.0 }, temp: { optimalMin: 20, optimalMax: 22 }, do: { optimalMin: 6.0 }, turb: { optimalMax: 15 } }
    });
    mockActiveConfigId = 'custom-1';
    mockActiveSpecies = 'crayfish';

    const { init, loadConfigurationsAfterAuth } = await import('../public/js/features/config-management.js');

    const origDocument = globalThis.document;
    const origWindow = globalThis.window;
    globalThis.document = document;
    globalThis.window = window;

    try {
      await init();
      await loadConfigurationsAfterAuth();
      await new Promise(r => setTimeout(r, 100));

      // Verify custom configuration is active
      const dropdown = document.getElementById('config-dropdown');
      expect(dropdown.value).toBe('custom-1');

      // Find "Delete" button (should exist for custom config)
      const buttons = Array.from(document.querySelectorAll('button'));
      const deleteButton = buttons.find(btn => btn.textContent.includes('Delete'));
      
      // Verify Delete button exists for custom configuration
      expect(deleteButton).not.toBeNull();
      expect(deleteButton.textContent).toContain('Delete');
    } finally {
      globalThis.document = origDocument;
      globalThis.window = origWindow;
    }
  });

  /**
   * Property 2.5: "Deactivate" Button Exists for Active Configuration
   *
   * **Validates: Requirement 3.5**
   *
   * For any active configuration, the system SHALL CONTINUE TO display a
   * "Deactivate" button that can be used to deactivate the configuration.
   *
   * EXPECTED OUTCOME: Test PASSES (confirms baseline behavior is preserved)
   */
  it('Property 2.5: "Deactivate" button exists for active configuration', async () => {
    const { init, loadConfigurationsAfterAuth } = await import('../public/js/features/config-management.js');

    const origDocument = globalThis.document;
    const origWindow = globalThis.window;
    globalThis.document = document;
    globalThis.window = window;

    try {
      await init();
      await loadConfigurationsAfterAuth();
      await new Promise(r => setTimeout(r, 100));

      // Verify initial state (Crayfish active)
      expect(mockActiveConfigId).toBe('crayfish');

      // Find "Deactivate" button
      const buttons = Array.from(document.querySelectorAll('button'));
      const deactivateButton = buttons.find(btn => btn.textContent.includes('Deactivate'));
      
      // Verify Deactivate button exists for active configuration
      expect(deactivateButton).not.toBeNull();
      expect(deactivateButton.textContent).toContain('Deactivate');
    } finally {
      globalThis.document = origDocument;
      globalThis.window = origWindow;
    }
  });

  /**
   * Property 2.6: Threshold Display in Config-Management Card
   *
   * **Validates: Requirement 3.6**
   *
   * For any active configuration, the config-management card SHALL CONTINUE TO
   * display pH, Temperature, DO, and Turbidity threshold values correctly.
   *
   * EXPECTED OUTCOME: Test PASSES (confirms baseline behavior is preserved)
   */
  it('Property 2.6: Threshold display in config-management card shows pH, Temperature, DO, and Turbidity values', async () => {
    const { init, loadConfigurationsAfterAuth } = await import('../public/js/features/config-management.js');

    const origDocument = globalThis.document;
    const origWindow = globalThis.window;
    globalThis.document = document;
    globalThis.window = window;

    try {
      await init();
      await loadConfigurationsAfterAuth();
      await new Promise(r => setTimeout(r, 100));

      // Find threshold display card
      const thresholdCard = document.querySelector('.config-details-card');
      expect(thresholdCard).not.toBeNull();

      // Verify card title
      const title = thresholdCard.querySelector('.config-details-title');
      expect(title).not.toBeNull();
      expect(title.textContent).toBe('Current Thresholds');

      // Verify threshold grid exists
      const grid = thresholdCard.querySelector('.config-thresholds-grid');
      expect(grid).not.toBeNull();

      // Verify all threshold items exist
      const items = grid.querySelectorAll('.threshold-item');
      expect(items.length).toBe(4);

      // Verify pH threshold
      const phItem = Array.from(items).find(item => 
        item.querySelector('.threshold-label')?.textContent === 'pH Range'
      );
      expect(phItem).not.toBeNull();
      expect(phItem.querySelector('.threshold-value').textContent).toBe('6.5 - 8.5');

      // Verify Temperature threshold
      const tempItem = Array.from(items).find(item => 
        item.querySelector('.threshold-label')?.textContent === 'Temperature (°C)'
      );
      expect(tempItem).not.toBeNull();
      expect(tempItem.querySelector('.threshold-value').textContent).toBe('18 - 24');

      // Verify DO threshold
      const doItem = Array.from(items).find(item => 
        item.querySelector('.threshold-label')?.textContent === 'Dissolved O₂ (mg/L)'
      );
      expect(doItem).not.toBeNull();
      expect(doItem.querySelector('.threshold-value').textContent).toBe('≥ 5');

      // Verify Turbidity threshold
      const turbItem = Array.from(items).find(item => 
        item.querySelector('.threshold-label')?.textContent === 'Turbidity (NTU)'
      );
      expect(turbItem).not.toBeNull();
      expect(turbItem.querySelector('.threshold-value').textContent).toBe('≤ 20');
    } finally {
      globalThis.document = origDocument;
      globalThis.window = origWindow;
    }
  });

  /**
   * Property 2.7: Switching Configurations Updates Thresholds
   *
   * **Validates: Requirement 3.7**
   *
   * For any configuration switch, the system SHALL CONTINUE TO update the
   * displayed thresholds in the config-management card.
   *
   * This property uses property-based testing to verify threshold updates
   * across many configuration switches.
   *
   * EXPECTED OUTCOME: Test PASSES (confirms baseline behavior is preserved)
   */
  it('Property 2.7: Switching between configurations updates displayed thresholds', async () => {
    const { init, loadConfigurationsAfterAuth } = await import('../public/js/features/config-management.js');

    const origDocument = globalThis.document;
    const origWindow = globalThis.window;
    globalThis.document = document;
    globalThis.window = window;

    try {
      await init();
      await loadConfigurationsAfterAuth();
      await new Promise(r => setTimeout(r, 100));

      // Generator for configuration IDs
      const configIdGen = fc.constantFrom('crayfish', 'tilapia', 'catfish', 'shrimp');

      await fc.assert(
        fc.asyncProperty(configIdGen, async (configId) => {
          // Switch to configuration
          const dropdown = document.getElementById('config-dropdown');
          dropdown.value = configId;
          dropdown.dispatchEvent(new window.Event('change'));
          await new Promise(r => setTimeout(r, 50));

          // Get expected thresholds
          const config = mockConfigurations.find(c => c.id === configId);
          expect(config).not.toBeNull();

          // Verify threshold display updated
          const thresholdCard = document.querySelector('.config-details-card');
          expect(thresholdCard).not.toBeNull();

          const grid = thresholdCard.querySelector('.config-thresholds-grid');
          const items = grid.querySelectorAll('.threshold-item');

          // Verify pH
          const phItem = Array.from(items).find(item => 
            item.querySelector('.threshold-label')?.textContent === 'pH Range'
          );
          const phValue = phItem.querySelector('.threshold-value').textContent;
          expect(phValue).toBe(`${config.thresholds.ph.optimalMin} - ${config.thresholds.ph.optimalMax}`);

          // Verify Temperature
          const tempItem = Array.from(items).find(item => 
            item.querySelector('.threshold-label')?.textContent === 'Temperature (°C)'
          );
          const tempValue = tempItem.querySelector('.threshold-value').textContent;
          expect(tempValue).toBe(`${config.thresholds.temp.optimalMin} - ${config.thresholds.temp.optimalMax}`);

          // Verify DO
          const doItem = Array.from(items).find(item => 
            item.querySelector('.threshold-label')?.textContent === 'Dissolved O₂ (mg/L)'
          );
          const doValue = doItem.querySelector('.threshold-value').textContent;
          expect(doValue).toBe(`≥ ${config.thresholds.do.optimalMin}`);

          // Verify Turbidity
          const turbItem = Array.from(items).find(item => 
            item.querySelector('.threshold-label')?.textContent === 'Turbidity (NTU)'
          );
          const turbValue = turbItem.querySelector('.threshold-value').textContent;
          expect(turbValue).toBe(`≤ ${config.thresholds.turb.optimalMax}`);
        }),
        { numRuns: 20 }
      );
    } finally {
      globalThis.document = origDocument;
      globalThis.window = origWindow;
    }
  });

  /**
   * Property 2.8: "No Configuration Active" Message Displays When Appropriate
   *
   * **Validates: Requirement 3.6**
   *
   * When no configuration is selected, the system SHALL CONTINUE TO display
   * "No Configuration Active" message in the config-management UI.
   *
   * EXPECTED OUTCOME: Test PASSES (confirms baseline behavior is preserved)
   */
  it('Property 2.8: "No Configuration Active" message displays when no configuration is selected', async () => {
    // Start with no active configuration
    mockActiveConfigId = null;
    mockActiveSpecies = null;

    const { init, loadConfigurationsAfterAuth } = await import('../public/js/features/config-management.js');

    const origDocument = globalThis.document;
    const origWindow = globalThis.window;
    globalThis.document = document;
    globalThis.window = window;

    try {
      await init();
      await loadConfigurationsAfterAuth();
      await new Promise(r => setTimeout(r, 100));

      // Verify "No Configuration Active" message is displayed
      const notConfiguredDiv = document.querySelector('.config-not-configured');
      expect(notConfiguredDiv).not.toBeNull();

      const noticeTitle = notConfiguredDiv.querySelector('.notice-title');
      expect(noticeTitle).not.toBeNull();
      expect(noticeTitle.textContent).toBe('No Configuration Active');

      const noticeSub = notConfiguredDiv.querySelector('.notice-sub');
      expect(noticeSub).not.toBeNull();
      expect(noticeSub.textContent).toContain('Select a configuration');

      // Verify threshold card is NOT displayed
      const thresholdCard = document.querySelector('.config-details-card');
      expect(thresholdCard).toBeNull();
    } finally {
      globalThis.document = origDocument;
      globalThis.window = origWindow;
    }
  });
});
