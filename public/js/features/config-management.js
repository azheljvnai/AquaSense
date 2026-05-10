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
  SPECIES_PRESETS,
} from '../pond-config.js';

let _configurations = [];
let _activeConfigId = null;

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
      
      if (!activeConfig.isPreset) {
        html += `
          <button class="btn btn-sm btn-danger" onclick="window.configManagement.deleteConfig('${activeConfig.id}')">
            <svg class="icon icon-14"><use href="#icon-trash"/></svg>
            Delete
          </button>
        `;
      }
      
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
    const t = activeConfig.thresholds;
    html += `
      <div class="config-details-card">
        <h3 class="config-details-title">Current Thresholds</h3>
        <div class="config-thresholds-grid">
          <div class="threshold-item">
            <div class="threshold-label">pH Range</div>
            <div class="threshold-value">${t.ph?.optimalMin ?? '—'} - ${t.ph?.optimalMax ?? '—'}</div>
          </div>
          <div class="threshold-item">
            <div class="threshold-label">Temperature (°C)</div>
            <div class="threshold-value">${t.temp?.optimalMin ?? '—'} - ${t.temp?.optimalMax ?? '—'}</div>
          </div>
          <div class="threshold-item">
            <div class="threshold-label">Dissolved O₂ (mg/L)</div>
            <div class="threshold-value">≥ ${t.do?.optimalMin ?? '—'}</div>
          </div>
          <div class="threshold-item">
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
    showToast('Configuration activated successfully', 'success');
    
    // Notify dashboard and other components
    window.dispatchEvent(new CustomEvent('config-changed', {
      detail: { configId, species: getActiveSpecies() },
    }));
  } catch (e) {
    showToast(`Failed to activate configuration: ${e.message}`, 'error');
  }
}

// ─── Deactivate Configuration ─────────────────────────────────────────────────

async function deactivateConfig() {
  if (!confirm('Are you sure you want to deactivate the current configuration?')) return;
  
  try {
    await deactivateConfiguration();
    _activeConfigId = null;
    renderConfigurationSelector();
    showToast('Configuration deactivated', 'success');
    
    // Notify dashboard and other components
    window.dispatchEvent(new CustomEvent('config-changed', {
      detail: { configId: null, species: null },
    }));
  } catch (e) {
    showToast(`Failed to deactivate configuration: ${e.message}`, 'error');
  }
}

// ─── Show Create Configuration Dialog ─────────────────────────────────────────

function showCreateDialog() {
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
  const dialogHTML = `
    <div id="create-config-dialog" class="modal" style="display:none;">
      <div class="modal-content">
        <div class="modal-header">
          <h2>Create Configuration</h2>
          <button class="modal-close" onclick="window.configManagement.closeDialog('create-config-dialog')">&times;</button>
        </div>
        <div class="modal-body">
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
          
          <div class="threshold-grid">
            <div class="form-group">
              <label for="config-ph-min">pH Min</label>
              <input type="number" id="config-ph-min" class="form-control" step="0.1" required>
            </div>
            <div class="form-group">
              <label for="config-ph-max">pH Max</label>
              <input type="number" id="config-ph-max" class="form-control" step="0.1" required>
            </div>
            
            <div class="form-group">
              <label for="config-temp-min">Temperature Min (°C)</label>
              <input type="number" id="config-temp-min" class="form-control" step="0.1" required>
            </div>
            <div class="form-group">
              <label for="config-temp-max">Temperature Max (°C)</label>
              <input type="number" id="config-temp-max" class="form-control" step="0.1" required>
            </div>
            
            <div class="form-group">
              <label for="config-do-min">DO Min (mg/L)</label>
              <input type="number" id="config-do-min" class="form-control" step="0.1" required>
            </div>
            
            <div class="form-group">
              <label for="config-turb-max">Turbidity Max (NTU)</label>
              <input type="number" id="config-turb-max" class="form-control" step="1" required>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="window.configManagement.closeDialog('create-config-dialog')">Cancel</button>
          <button class="btn btn-primary" onclick="window.configManagement.saveNewConfiguration()">Create</button>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', dialogHTML);
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
  const dialogHTML = `
    <div id="preset-dialog" class="modal" style="display:none;">
      <div class="modal-content">
        <div class="modal-header">
          <h2>Assign Species Preset</h2>
          <button class="modal-close" onclick="window.configManagement.closeDialog('preset-dialog')">&times;</button>
        </div>
        <div class="modal-body">
          <p>Select a species preset to create a new configuration:</p>
          <div class="preset-grid">
            ${Object.entries(SPECIES_PRESETS).map(([key, preset]) => `
              <div class="preset-card" onclick="window.configManagement.assignPreset('${key}')">
                <span class="species-badge species-${key}">${preset.name}</span>
                <p>Optimal pH: ${preset.thresholds.ph.optimalMin} - ${preset.thresholds.ph.optimalMax}</p>
                <p>Optimal Temp: ${preset.thresholds.temp.optimalMin}°C - ${preset.thresholds.temp.optimalMax}°C</p>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="window.configManagement.closeDialog('preset-dialog')">Cancel</button>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', dialogHTML);
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
    showToast(`${preset.name} configuration created successfully`, 'success');
  } catch (e) {
    showToast(`Failed to create configuration: ${e.message}`, 'error');
  }
}

// ─── Edit Configuration ────────────────────────────────────────────────────────

function editConfiguration(configId) {
  const config = _configurations.find(c => c.id === configId);
  if (!config) return;
  
  const dialog = document.getElementById('edit-config-dialog');
  if (!dialog) {
    createEditDialogHTML();
    return editConfiguration(configId);
  }
  
  // Populate form with current values
  document.getElementById('edit-config-id').value = configId;
  document.getElementById('edit-config-name').value = config.name || config.species;
  document.getElementById('edit-config-species').value = config.species;
  
  // Populate threshold fields
  const t = config.thresholds;
  document.getElementById('edit-ph-min').value = t.ph?.optimalMin ?? 6.5;
  document.getElementById('edit-ph-max').value = t.ph?.optimalMax ?? 8.5;
  document.getElementById('edit-temp-min').value = t.temp?.optimalMin ?? 20;
  document.getElementById('edit-temp-max').value = t.temp?.optimalMax ?? 30;
  document.getElementById('edit-do-min').value = t.do?.optimalMin ?? 5;
  document.getElementById('edit-turb-max').value = t.turb?.optimalMax ?? 40;
  
  dialog.style.display = 'flex';
}

function createEditDialogHTML() {
  const dialogHTML = `
    <div id="edit-config-dialog" class="modal" style="display:none;">
      <div class="modal-content">
        <div class="modal-header">
          <h2>Edit Configuration</h2>
          <button class="modal-close" onclick="window.configManagement.closeDialog('edit-config-dialog')">&times;</button>
        </div>
        <div class="modal-body">
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
          
          <div class="threshold-grid">
            <div class="form-group">
              <label for="edit-ph-min">pH Min</label>
              <input type="number" id="edit-ph-min" class="form-control" step="0.1" required>
            </div>
            <div class="form-group">
              <label for="edit-ph-max">pH Max</label>
              <input type="number" id="edit-ph-max" class="form-control" step="0.1" required>
            </div>
            
            <div class="form-group">
              <label for="edit-temp-min">Temperature Min (°C)</label>
              <input type="number" id="edit-temp-min" class="form-control" step="0.1" required>
            </div>
            <div class="form-group">
              <label for="edit-temp-max">Temperature Max (°C)</label>
              <input type="number" id="edit-temp-max" class="form-control" step="0.1" required>
            </div>
            
            <div class="form-group">
              <label for="edit-do-min">DO Min (mg/L)</label>
              <input type="number" id="edit-do-min" class="form-control" step="0.1" required>
            </div>
            
            <div class="form-group">
              <label for="edit-turb-max">Turbidity Max (NTU)</label>
              <input type="number" id="edit-turb-max" class="form-control" step="1" required>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="window.configManagement.closeDialog('edit-config-dialog')">Cancel</button>
          <button class="btn btn-primary" onclick="window.configManagement.saveEditedConfiguration()">Save Changes</button>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', dialogHTML);
}

// ─── Save New Configuration ────────────────────────────────────────────────────

async function saveNewConfiguration() {
  const name = document.getElementById('config-name').value.trim();
  const species = document.getElementById('config-species').value;
  
  if (!name) {
    showToast('Please enter a configuration name', 'error');
    return;
  }
  
  // Validate thresholds
  const phMin = parseFloat(document.getElementById('config-ph-min').value);
  const phMax = parseFloat(document.getElementById('config-ph-max').value);
  const tempMin = parseFloat(document.getElementById('config-temp-min').value);
  const tempMax = parseFloat(document.getElementById('config-temp-max').value);
  const doMin = parseFloat(document.getElementById('config-do-min').value);
  const turbMax = parseFloat(document.getElementById('config-turb-max').value);
  
  if (phMin >= phMax) {
    showToast('pH Min must be less than pH Max', 'error');
    return;
  }
  
  if (tempMin >= tempMax) {
    showToast('Temperature Min must be less than Temperature Max', 'error');
    return;
  }
  
  if (doMin < 0 || turbMax < 0) {
    showToast('Threshold values cannot be negative', 'error');
    return;
  }
  
  try {
    const thresholds = {
      ph: { optimalMin: phMin, optimalMax: phMax },
      temp: { optimalMin: tempMin, optimalMax: tempMax },
      do: { optimalMin: doMin },
      turb: { optimalMax: turbMax },
    };
    
    await createConfiguration({ name, species, thresholds, isPreset: false });
    await loadConfigurations();
    renderConfigurationSelector();
    closeDialog('create-config-dialog');
    showToast('Configuration created successfully', 'success');
  } catch (e) {
    showToast(`Failed to create configuration: ${e.message}`, 'error');
  }
}

// ─── Save Edited Configuration ─────────────────────────────────────────────────

async function saveEditedConfiguration() {
  const configId = document.getElementById('edit-config-id').value;
  const name = document.getElementById('edit-config-name').value.trim();
  
  if (!name) {
    showToast('Please enter a configuration name', 'error');
    return;
  }
  
  // Validate thresholds
  const phMin = parseFloat(document.getElementById('edit-ph-min').value);
  const phMax = parseFloat(document.getElementById('edit-ph-max').value);
  const tempMin = parseFloat(document.getElementById('edit-temp-min').value);
  const tempMax = parseFloat(document.getElementById('edit-temp-max').value);
  const doMin = parseFloat(document.getElementById('edit-do-min').value);
  const turbMax = parseFloat(document.getElementById('edit-turb-max').value);
  
  if (phMin >= phMax) {
    showToast('pH Min must be less than pH Max', 'error');
    return;
  }
  
  if (tempMin >= tempMax) {
    showToast('Temperature Min must be less than Temperature Max', 'error');
    return;
  }
  
  if (doMin < 0 || turbMax < 0) {
    showToast('Threshold values cannot be negative', 'error');
    return;
  }
  
  try {
    const thresholds = {
      ph: { optimalMin: phMin, optimalMax: phMax },
      temp: { optimalMin: tempMin, optimalMax: tempMax },
      do: { optimalMin: doMin },
      turb: { optimalMax: turbMax },
    };
    
    await updateConfiguration(configId, { name, thresholds });
    await loadConfigurations();
    renderConfigurationSelector();
    closeDialog('edit-config-dialog');
    showToast('Configuration updated successfully', 'success');
    
    // If this was the active config, reload it
    if (configId === _activeConfigId) {
      await loadActiveConfiguration();
      window.dispatchEvent(new CustomEvent('config-changed'));
    }
  } catch (e) {
    showToast(`Failed to update configuration: ${e.message}`, 'error');
  }
}

// ─── Delete Configuration ──────────────────────────────────────────────────────

async function deleteConfig(configId) {
  const config = _configurations.find(c => c.id === configId);
  if (!config) return;
  
  if (!confirm(`Are you sure you want to delete "${config.name || config.species}"?`)) return;
  
  try {
    await deleteConfiguration(configId);
    await loadConfigurations();
    renderConfigurationSelector();
    showToast('Configuration deleted successfully', 'success');
  } catch (e) {
    showToast(`Failed to delete configuration: ${e.message}`, 'error');
  }
}

// ─── Helper Functions ──────────────────────────────────────────────────────────

function populateThresholdFields(species) {
  const preset = SPECIES_PRESETS[species];
  if (!preset) return;
  
  const t = preset.thresholds;
  document.getElementById('config-ph-min').value = t.ph.optimalMin;
  document.getElementById('config-ph-max').value = t.ph.optimalMax;
  document.getElementById('config-temp-min').value = t.temp.optimalMin;
  document.getElementById('config-temp-max').value = t.temp.optimalMax;
  document.getElementById('config-do-min').value = t.do.optimalMin;
  document.getElementById('config-turb-max').value = t.turb.optimalMax;
}

function closeDialog(dialogId) {
  const dialog = document.getElementById(dialogId);
  if (dialog) dialog.style.display = 'none';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message, type = 'info') {
  // Simple toast notification
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    background: ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#17a2b8'};
    color: white;
    border-radius: 4px;
    z-index: 10000;
    animation: slideIn 0.3s ease-out;
  `;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
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
    showToast('Failed to load configurations: ' + e.message, 'error');
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
