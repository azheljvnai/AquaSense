/**
 * Configuration Management UI
 * Handles configuration selection, creation, editing, activation, and deletion
 */
import {
  getConfigurations,
  createConfiguration,
  updateConfiguration,
  deleteConfiguration,
  setActiveConfiguration,
  deactivateConfiguration,
  loadActiveConfiguration,
  getActiveConfigId,
  getActiveSpecies,
  onConfigChange,
  applyConfig,
  SPECIES_PRESETS,
} from '../pond-config.js';
import { flexModalHtml, escapeHtml } from '../ui/templates.js';
import { showAppToast, showConfirmModal } from '../ui/modal-ui.js';
import {
  thresholdBandsFormHtml,
  fillThresholdForm,
  readThresholdsFromForm,
  validateThresholds,
  mergeConfigThresholdsForForm,
} from '../threshold-form.js';

let _configurations = [];
let _activeConfigId = null;

const CANONICAL_PRESET_IDS = new Set(['crayfish', 'tilapia', 'catfish', 'shrimp']);

function resolveSpeciesKey(species) {
  const key = String(species || '').toLowerCase();
  return SPECIES_PRESETS[key] ? key : 'crayfish';
}

function canEditConfig() {
  const perms = window._rbacPerms;
  // Default to true if permissions not yet loaded (during initialization)
  // This ensures UI renders even if RBAC hasn't initialized yet
  if (!perms) return true;
  return perms.canEditConfig;
}

// ─── Render Configuration Selector ────────────────────────────────────────────

function renderConfigurationSelector() {
  const container = document.getElementById('config-selector-container');
  if (!container) {
    console.error('[Config Management] Container not found during render');
    return;
  }

  console.log('[Config Management] Rendering selector. Configs:', _configurations.length, 'Active:', _activeConfigId, 'Can edit:', canEditConfig());

  const activeConfig = _configurations.find(c => c.id === _activeConfigId);

  let html = '<div class="config-selector-compact">';

  // Configuration Selector Dropdown
  html += `
    <div class="config-selector-row">
      <div class="config-selector-group">
        <label for="config-dropdown" class="config-label">
          <svg class="icon icon-16"><use href="#icon-settings"/></svg>
          Active Configuration
        </label>
        <select id="config-dropdown" class="config-dropdown" onchange="window.configManagement.handleConfigChange(this.value)">
  `;

  if (!activeConfig) {
    html += '<option value="" selected>Not Configured</option>';
  }

  // Add all configurations to dropdown
  for (const config of _configurations) {
    const isActive = config.id === _activeConfigId;
    html += `<option value="${config.id}" ${isActive ? 'selected' : ''}>
      ${escapeHtml(config.name || config.species)} ${config.isPreset ? '(Preset)' : ''}
    </option>`;
  }

  html += `
        </select>
      </div>
  `;

  // Action buttons
  if (canEditConfig()) {
    html += `
      <div class="config-actions-row">
        <button class="btn btn-sm btn-primary" onclick="window.configManagement.showCreateDialog()">
          <svg class="icon icon-14"><use href="#icon-plus"/></svg>
          Create Custom
        </button>
    `;
    
    if (activeConfig) {
      html += `
        <button class="btn btn-sm btn-outline" onclick="window.configManagement.editConfiguration('${activeConfig.id}')">
          <svg class="icon icon-14"><use href="#icon-edit"/></svg>
          Edit
        </button>
      `;
      
      html += `
        <button class="btn btn-sm btn-danger" onclick="window.configManagement.deleteConfig('${activeConfig.id}')">
          <svg class="icon icon-14"><use href="#icon-trash"/></svg>
          Delete
        </button>
      `;
      
      html += `
        <button class="btn btn-sm btn-warning" onclick="window.configManagement.deactivateConfig()">
          Deactivate
        </button>
      `;
    }
    
    html += `
      </div>
    `;
  }

  html += `
    </div>
  `;

  // Active configuration details
  if (activeConfig) {
    const t = mergeConfigThresholdsForForm(activeConfig);
    const speciesKey = String(activeConfig.species || 'crayfish').toLowerCase();
    const speciesPresetName = escapeHtml(SPECIES_PRESETS[speciesKey]?.name || speciesKey);
    const configTitle = escapeHtml(activeConfig.name || speciesPresetName);
    const typeChip = activeConfig.isPreset
      ? '<span class="config-type-chip config-type-chip--preset">Preset</span>'
      : '<span class="config-type-chip config-type-chip--custom">Custom</span>';
    html += `
      <div class="config-details-card config-active-card">
        <div class="config-active-hero">
          <div class="config-active-meta">
            ${typeChip}
            <span class="species-badge species-${speciesKey}">${speciesPresetName}</span>
          </div>
          <h2 class="config-active-name">${configTitle}</h2>
        </div>
        <h3 class="config-details-title">Current Thresholds</h3>
        <div class="config-thresholds-grid config-thresholds-showcase">
          <div class="threshold-item threshold-tile threshold-tile--ph">
            <div class="threshold-label">pH Range</div>
            <div class="threshold-value">${t.ph?.optimalMin ?? '—'} - ${t.ph?.optimalMax ?? '—'}</div>
          </div>
          <div class="threshold-item threshold-tile threshold-tile--temp">
            <div class="threshold-label">Temperature (°C)</div>
            <div class="threshold-value">${t.temp?.optimalMin ?? '—'} - ${t.temp?.optimalMax ?? '—'}</div>
          </div>
          <div class="threshold-item threshold-tile threshold-tile--do">
            <div class="threshold-label">Dissolved O₂ (mg/L)</div>
            <div class="threshold-value">${t.do?.optimalMax != null ? `${t.do.optimalMin} - ${t.do.optimalMax}` : `≥ ${t.do?.optimalMin ?? '—'}`}</div>
          </div>
          <div class="threshold-item threshold-tile threshold-tile--turb">
            <div class="threshold-label">Turbidity (NTU)</div>
            <div class="threshold-value">≤ ${t.turb?.optimalMax ?? '—'}</div>
          </div>
        </div>
      </div>
    `;
  } else {
    html += `
      <div class="config-not-configured">
        <svg class="icon icon-24"><use href="#icon-warning"/></svg>
        <div>
          <div class="notice-title">No Configuration Active</div>
          <div class="notice-sub">Select a configuration from the dropdown above to start monitoring</div>
        </div>
      </div>
    `;
  }

  html += '</div>';

  container.innerHTML = html;
}

// Handle configuration dropdown change
async function handleConfigChange(configId) {
  if (!configId) {
    // User selected "Not Configured" - deactivate
    await deactivateConfig();
    return;
  }
  
  if (configId === _activeConfigId) {
    // Already active, no change needed
    return;
  }
  
  // Activate the selected configuration
  await activateConfig(configId);
}

// ─── Activate Configuration ───────────────────────────────────────────────────

async function activateConfig(configId) {
  try {
    await setActiveConfiguration(configId);
    _activeConfigId = configId;
    renderConfigurationSelector();
    showAppToast('Configuration activated successfully', 'success');
    
    // Notify dashboard and other components
    window.dispatchEvent(new CustomEvent('config-changed', {
      detail: { configId, species: getActiveSpecies() },
    }));
  } catch (e) {
    showAppToast(`Failed to activate configuration: ${e.message}`, 'error');
  }
}

// ─── Deactivate Configuration ─────────────────────────────────────────────────

async function deactivateConfig() {
  showConfirmModal({
    title: 'Deactivate configuration',
    subtitle: 'Species thresholds will no longer apply until another configuration is activated.',
    message: 'Deactivate the current active configuration?',
    confirmLabel: 'Deactivate',
    variant: 'warning',
    onConfirm: async () => {
      await deactivateConfiguration();
      _activeConfigId = null;
      renderConfigurationSelector();
      showAppToast('Configuration deactivated', 'success');
      window.dispatchEvent(new CustomEvent('config-changed', {
        detail: { configId: null, species: null },
      }));
    },
  });
}

// ─── Show Create Configuration Dialog ─────────────────────────────────────────

function showCreateDialog() {
  if (!document.getElementById('config-ph-opt-min')) {
    createDialogHTML();
  }
  const dialog = document.getElementById('create-config-dialog');
  if (!dialog) {
    createDialogHTML();
    return showCreateDialog();
  }
  
  // Reset form
  document.getElementById('config-name').value = '';
  document.getElementById('config-species').value = 'crayfish';
  
  // Populate threshold fields with preset values
  populateThresholdFields('crayfish');
  
  dialog.style.display = 'flex';
}

function createDialogHTML() {
  document.getElementById('create-config-dialog')?.remove();
  const close = "window.configManagement.closeDialog('create-config-dialog')";
  const bodyHtml = `
          <div class="form-group">
            <label for="config-name">Configuration Name</label>
            <input type="text" id="config-name" class="form-control" placeholder="e.g., Crayfish - Summer" required>
          </div>
          
          <div class="form-group">
            <label for="config-species">Species</label>
            <select id="config-species" class="form-control" onchange="window.configManagement.populateThresholdFields(this.value)">
              <option value="crayfish">Crayfish</option>
              <option value="tilapia">Tilapia</option>
              <option value="catfish">Catfish</option>
              <option value="shrimp">Shrimp</option>
            </select>
          </div>
          
          <h3>Threshold Settings</h3>
          <p class="muted text-sm threshold-form-hint">Set normal, warning, and critical bands. Leave optional fields empty if not used.</p>
          ${thresholdBandsFormHtml('config')}`;
  const footerHtml = `
          <button type="button" class="btn btn-secondary" onclick="${close}">Cancel</button>
          <button type="button" class="btn btn-primary" onclick="window.configManagement.saveNewConfiguration()">Create</button>`;
  document.body.insertAdjacentHTML(
    'beforeend',
    flexModalHtml({
      id: 'create-config-dialog',
      title: 'Create Configuration',
      bodyHtml,
      footerHtml,
      closeAction: close,
    }),
  );
}

// ─── Show Preset Assignment Dialog ────────────────────────────────────────────

function showPresetDialog() {
  const dialog = document.getElementById('preset-dialog');
  if (!dialog) {
    createPresetDialogHTML();
    return showPresetDialog();
  }
  
  dialog.style.display = 'flex';
}

function createPresetDialogHTML() {
  const close = "window.configManagement.closeDialog('preset-dialog')";
  const bodyHtml = `
          <p>Select a species preset to create a new configuration:</p>
          <div class="preset-grid">
            ${Object.entries(SPECIES_PRESETS).map(([key, preset]) => `
              <div class="preset-card" onclick="window.configManagement.assignPreset('${key}')">
                <span class="species-badge species-${key}">${escapeHtml(preset.name)}</span>
                <p>Optimal pH: ${preset.thresholds.ph.optimalMin} - ${preset.thresholds.ph.optimalMax}</p>
                <p>Optimal Temp: ${preset.thresholds.temp.optimalMin}°C - ${preset.thresholds.temp.optimalMax}°C</p>
              </div>
            `).join('')}
          </div>`;
  const footerHtml = `
          <button type="button" class="btn btn-secondary" onclick="${close}">Cancel</button>`;
  document.body.insertAdjacentHTML(
    'beforeend',
    flexModalHtml({
      id: 'preset-dialog',
      title: 'Assign Species Preset',
      bodyHtml,
      footerHtml,
      closeAction: close,
    }),
  );
}

async function assignPreset(species) {
  const preset = SPECIES_PRESETS[species];
  if (!preset) return;
  
  try {
    const result = await createConfiguration({
      name: preset.name,
      species: preset.species,
      thresholds: preset.thresholds,
      isPreset: false,
    });
    
    await loadConfigurations();
    renderConfigurationSelector();
    closeDialog('preset-dialog');
    showAppToast(`${preset.name} configuration created successfully`, 'success');
  } catch (e) {
    showAppToast(`Failed to create configuration: ${e.message}`, 'error');
  }
}

// ─── Edit Configuration ────────────────────────────────────────────────────────

function editConfiguration(configId) {
  const config = _configurations.find(c => c.id === configId);
  if (!config) return;

  if (!document.getElementById('edit-ph-opt-min')) {
    createEditDialogHTML();
  }

  const dialog = document.getElementById('edit-config-dialog');
  if (!dialog) {
    createEditDialogHTML();
    return editConfiguration(configId);
  }
  
  // Populate form with current values
  document.getElementById('edit-config-id').value = configId;
  document.getElementById('edit-config-name').value = config.name || config.species;
  document.getElementById('edit-config-species').value = resolveSpeciesKey(config.species);
  
  // Populate threshold fields (merged with species preset)
  fillThresholdForm('edit', mergeConfigThresholdsForForm(config));
  
  dialog.style.display = 'flex';
}

function createEditDialogHTML() {
  document.getElementById('edit-config-dialog')?.remove();
  const close = "window.configManagement.closeDialog('edit-config-dialog')";
  const bodyHtml = `
          <input type="hidden" id="edit-config-id">
          
          <div class="form-group">
            <label for="edit-config-name">Configuration Name</label>
            <input type="text" id="edit-config-name" class="form-control" required>
          </div>
          
          <div class="form-group">
            <label for="edit-config-species">Species</label>
            <select id="edit-config-species" class="form-control" disabled>
              <option value="crayfish">Crayfish</option>
              <option value="tilapia">Tilapia</option>
              <option value="catfish">Catfish</option>
              <option value="shrimp">Shrimp</option>
            </select>
          </div>
          
          <h3>Threshold Settings</h3>
          <p class="muted text-sm threshold-form-hint">Set normal, warning, and critical bands. Leave optional fields empty if not used.</p>
          ${thresholdBandsFormHtml('edit')}`;
  const footerHtml = `
          <button type="button" class="btn btn-secondary" onclick="${close}">Cancel</button>
          <button type="button" class="btn btn-primary" onclick="window.configManagement.saveEditedConfiguration()">Save Changes</button>`;
  document.body.insertAdjacentHTML(
    'beforeend',
    flexModalHtml({
      id: 'edit-config-dialog',
      title: 'Edit Configuration',
      bodyHtml,
      footerHtml,
      closeAction: close,
    }),
  );
}

// ─── Save New Configuration ────────────────────────────────────────────────────

async function saveNewConfiguration() {
  const name = document.getElementById('config-name').value.trim();
  const species = document.getElementById('config-species').value;

  if (!name) {
    showAppToast('Please enter a configuration name', 'error');
    return;
  }

  const thresholds = readThresholdsFromForm('config');
  const validationError = validateThresholds(thresholds);
  if (validationError) {
    showAppToast(validationError, 'error');
    return;
  }

  try {
    await createConfiguration({ name, species, thresholds, isPreset: false });
    await loadConfigurations();
    renderConfigurationSelector();
    closeDialog('create-config-dialog');
    showAppToast('Configuration created successfully', 'success');
  } catch (e) {
    showAppToast(`Failed to create configuration: ${e.message}`, 'error');
  }
}

// ─── Save Edited Configuration ─────────────────────────────────────────────────

async function saveEditedConfiguration() {
  const configId = document.getElementById('edit-config-id').value;
  const name = document.getElementById('edit-config-name').value.trim();
  const species = resolveSpeciesKey(document.getElementById('edit-config-species').value);

  if (!name) {
    showAppToast('Please enter a configuration name', 'error');
    return;
  }

  const thresholds = readThresholdsFromForm('edit');
  const validationError = validateThresholds(thresholds);
  if (validationError) {
    showAppToast(validationError, 'error');
    return;
  }

  try {
    if (configId === _activeConfigId) {
      applyConfig({ id: configId, name, species, thresholds });
    }

    await updateConfiguration(configId, { name, species, thresholds });
    await loadConfigurations();
    renderConfigurationSelector();
    closeDialog('edit-config-dialog');
    showAppToast('Configuration updated successfully', 'success');
    
    // If this was the active config, reload from server to stay in sync
    if (configId === _activeConfigId) {
      await loadActiveConfiguration();
      window.dispatchEvent(new CustomEvent('config-changed'));
    }
  } catch (e) {
    showAppToast(`Failed to update configuration: ${e.message}`, 'error');
  }
}

// ─── Delete Configuration ──────────────────────────────────────────────────────

async function deleteConfig(configId) {
  const config = _configurations.find(c => c.id === configId);
  if (!config) return;

  const name = config.name || config.species || configId;
  const isCanonicalPreset = config.isPreset && CANONICAL_PRESET_IDS.has(configId);
  const presetNote = isCanonicalPreset
    ? ' This is a built-in species preset; it can be re-created on server startup when no presets exist.'
    : '';
  showConfirmModal({
    title: 'Delete configuration',
    subtitle: 'This permanently removes the configuration.',
    message: `Delete "${name}"?${presetNote}`,
    confirmLabel: 'Delete',
    destructive: true,
    onConfirm: async () => {
      try {
        if (configId === _activeConfigId || config.isActive) {
          await deactivateConfiguration();
          _activeConfigId = null;
        }
        await deleteConfiguration(configId);
        await loadConfigurations();
        renderConfigurationSelector();
        showAppToast('Configuration deleted successfully', 'success');
        window.dispatchEvent(new CustomEvent('config-changed', {
          detail: { configId: null, species: null },
        }));
      } catch (e) {
        showAppToast(`Failed to delete configuration: ${e.message}`, 'error');
        throw e;
      }
    },
  });
}

// ─── Helper Functions ──────────────────────────────────────────────────────────

function populateThresholdFields(species) {
  const preset = SPECIES_PRESETS[species];
  if (!preset) return;
  fillThresholdForm('config', preset.thresholds);
}

function closeDialog(dialogId) {
  const dialog = document.getElementById(dialogId);
  if (dialog) dialog.style.display = 'none';
}

// ─── Load Configurations ───────────────────────────────────────────────────────

async function loadConfigurations() {
  try {
    console.log('[Config Management] Fetching configurations from API...');
    const allConfigs = await getConfigurations();
    
    // Remove duplicates based on species for presets
    const seen = new Set();
    _configurations = allConfigs.filter(config => {
      if (config.isPreset) {
        if (seen.has(config.species)) {
          console.warn('[Config Management] Duplicate preset found for species:', config.species, '- skipping');
          return false;
        }
        seen.add(config.species);
      }
      return true;
    });
    
    _activeConfigId = getActiveConfigId();
    console.log('[Config Management] Loaded', _configurations.length, 'configurations (filtered from', allConfigs.length, ')');
    console.log('[Config Management] Active config ID:', _activeConfigId);
  } catch (e) {
    console.error('Failed to load configurations:', e);
    showAppToast('Failed to load configurations: ' + e.message, 'error');
    // Set empty array so UI can still render
    _configurations = [];
  }
}

// ─── Initialize ────────────────────────────────────────────────────────────────

export async function init() {
  console.log('[Config Management] Initializing...');
  
  // Check if container exists
  const container = document.getElementById('config-selector-container');
  if (!container) {
    console.error('[Config Management] Container #config-selector-container not found!');
    return;
  }
  
  console.log('[Config Management] Container found. Waiting for authentication...');
  
  // Render initial empty state
  renderConfigurationSelector();
  
  // Listen for configuration changes
  onConfigChange(() => {
    _activeConfigId = getActiveConfigId();
    renderConfigurationSelector();
  });
  
  // Expose functions to window for onclick handlers
  window.configManagement = {
    handleConfigChange,
    activateConfig,
    deactivateConfig,
    showCreateDialog,
    showPresetDialog,
    editConfiguration,
    deleteConfig,
    saveNewConfiguration,
    saveEditedConfiguration,
    assignPreset,
    populateThresholdFields,
    closeDialog,
  };
  
  console.log('[Config Management] Initialization complete (waiting for auth to load data)');
}

/**
 * Load configurations after user is authenticated
 * Called by app.js after authentication is confirmed
 */
export async function loadConfigurationsAfterAuth() {
  console.log('[Config Management] Loading configurations after authentication...');
  
  try {
    // Load active configuration
    await loadActiveConfiguration();
    console.log('[Config Management] Active configuration loaded');
  } catch (e) {
    console.error('[Config Management] Failed to load active configuration:', e);
  }
  
  try {
    // Load all configurations
    await loadConfigurations();
    console.log('[Config Management] All configurations loaded:', _configurations.length);
  } catch (e) {
    console.error('[Config Management] Failed to load configurations:', e);
  }
  
  // Render UI with loaded data
  console.log('[Config Management] Rendering UI with loaded data...');
  renderConfigurationSelector();
}
