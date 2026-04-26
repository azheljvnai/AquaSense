/**
 * Pond Management UI — embedded in the Configuration section.
 * Static button listeners are wired ONCE in init().
 * Dynamic list buttons use event delegation on the list container.
 */
import {
  SPECIES_PRESETS,
  getPonds, createPond, updatePond,
  assignConfigToPond, getPondConfigurations, setActivePondConfig,
  updatePondConfiguration, deletePondConfiguration, deactivatePondConfig,
  loadActivePondConfig, seedSpeciesPresets,
} from '../pond-config.js';

const SPECIES_LABELS = {
  crayfish: 'Crayfish', tilapia: 'Tilapia', catfish: 'Catfish', shrimp: 'Shrimp',
};

function canEdit() {
  const p = window._rbacPerms;
  return !p || p.canEditConfig;
}

// Module-level state so callbacks always have current data
let _ponds = [];
let _currentPondId = null;

export async function init() {
  const container = document.getElementById('pond-mgmt-section');
  if (!container) return;

  // Wire static buttons ONCE
  document.getElementById('btn-add-pond')?.addEventListener('click', () => {
    openPondDialog(null, refreshPonds);
  });

  document.getElementById('btn-edit-pond')?.addEventListener('click', () => {
    if (!_currentPondId) return alert('Select a pond first.');
    const pond = _ponds.find(p => p.id === _currentPondId);
    openPondDialog(pond, refreshPonds);
  });

  document.getElementById('btn-assign-config')?.addEventListener('click', () => {
    if (!_currentPondId) return alert('Select a pond first.');
    openAssignConfigDialog(_currentPondId, () => renderPondConfigs(_currentPondId));
  });

  document.getElementById('pond-selector')?.addEventListener('change', async (e) => {
    const pondId = e.target.value;
    if (!pondId) return;
    _currentPondId = pondId;
    try { localStorage.setItem('aquasense.activePondId', pondId); } catch { /* ignore */ }
    await onPondSelected(pondId);
  });

  // Event delegation for dynamic config list buttons
  document.getElementById('pond-config-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;

    if (btn.classList.contains('btn-set-active')) {
      if (!canEdit()) return alert('Owner/Admin required.');
      btn.disabled = true;
      btn.textContent = 'Activating…';
      await setActivePondConfig(_currentPondId, id);
      await renderPondConfigs(_currentPondId);
      window.dispatchEvent(new CustomEvent('thresholds-changed'));
    }

    if (btn.classList.contains('btn-deactivate-cfg')) {
      if (!canEdit()) return alert('Owner/Admin required.');
      if (!confirm('Deactivate this configuration? The pond will have no active config until one is set.')) return;
      btn.disabled = true;
      btn.textContent = 'Deactivating…';
      await deactivatePondConfig(_currentPondId, id);
      await renderPondConfigs(_currentPondId);
      updateActiveBadge(null);
      // Propagate unconfigured state globally
      _propagatePondState(null);
      window.dispatchEvent(new CustomEvent('thresholds-changed'));
    }

    if (btn.classList.contains('btn-edit-cfg')) {
      const configs = await getPondConfigurations(_currentPondId);
      const cfg = configs.find(c => c.id === id);
      if (cfg) openEditConfigDialog(_currentPondId, cfg, () => renderPondConfigs(_currentPondId));
    }

    if (btn.classList.contains('btn-del-cfg')) {
      if (!canEdit()) return alert('Owner/Admin required.');
      if (!confirm('Remove this configuration from the pond?')) return;
      await deletePondConfiguration(id);
      await renderPondConfigs(_currentPondId);
    }

    if (btn.id === 'btn-assign-first') {
      openAssignConfigDialog(_currentPondId, () => renderPondConfigs(_currentPondId));
    }
  });

  // Expose loader — called by app.js after auth confirms
  window._pondMgmtOnUser = async () => {
    try { await seedSpeciesPresets(); } catch { /* offline */ }
    await refreshPonds();
  };
}

// ─── Pond Selector ────────────────────────────────────────────────────────────

async function refreshPonds() {
  try { _ponds = await getPonds(); } catch { _ponds = []; }

  const sel = document.getElementById('pond-selector');
  if (!sel) return;

  const prev = sel.value || localStorage.getItem('aquasense.activePondId') || '';
  sel.innerHTML = '<option value="">— Select Pond —</option>';
  for (const p of _ponds) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name || p.id;
    sel.appendChild(opt);
  }

  // Push pond list to global context (populates topbar selector)
  if (window._pondContext) window._pondContext.setPondList(_ponds);

  // Restore previously selected pond
  if (prev && sel.querySelector(`option[value="${prev}"]`)) {
    sel.value = prev;
    _currentPondId = prev;
    await onPondSelected(prev);
  }
}

async function onPondSelected(pondId) {
  const label = document.getElementById('pond-active-config-label');
  if (label) label.textContent = 'Loading…';
  try {
    const active = await loadActivePondConfig(pondId);
    updateActiveBadge(active);
    await renderPondConfigs(pondId);
    _propagatePondState(active);
  } catch {
    if (label) label.textContent = 'Error loading config';
  }
  window.dispatchEvent(new CustomEvent('thresholds-changed'));
}

/** Push the current pond + config state to the global context and water quality UI. */
function _propagatePondState(active) {
  const pond = _ponds.find(p => p.id === _currentPondId);
  if (!pond) return;

  // Only treat as configured if the config is explicitly active
  const isConfigured = !!(active?.isActive);

  // Update global pond context (topbar + dashboard badge).
  // Use null for species when unconfigured so the badge shows "Not Configured",
  // and a real species string when configured.
  if (window._pondContext) {
    const enriched = { ...pond, species: isConfigured ? (active.species || '') : null };
    window._pondContext.setActivePond(enriched);
  }

  // Update water quality page pond card
  const wqTitle  = document.getElementById('wq-pond-title');
  const wqStatus = document.getElementById('wq-pond-status');
  if (wqTitle)  wqTitle.textContent = pond.name || pond.id;
  if (wqStatus) {
    if (isConfigured) {
      wqStatus.textContent = 'Active';
      wqStatus.className   = 'badge-pill status-normal';
    } else {
      wqStatus.textContent = 'Not Configured';
      wqStatus.className   = 'badge-pill status-critical';
    }
  }
}

function updateActiveBadge(active) {
  const label = document.getElementById('pond-active-config-label');
  const badge = document.getElementById('pond-active-species');
  if (label) {
    label.textContent = active ? (active.name || active.species) : 'Not Configured';
    label.style.color = active ? '' : 'var(--red-dark, #ef4444)';
  }
  if (badge) {
    badge.textContent = active ? (SPECIES_LABELS[active.species] || active.species) : '';
    badge.className   = active
      ? `badge-pill species-badge species-${active.species}`
      : 'badge-pill';
    badge.style.display = active ? '' : 'none';
  }
}

// ─── Pond Config List ─────────────────────────────────────────────────────────

async function renderPondConfigs(pondId) {
  const list = document.getElementById('pond-config-list');
  if (!list) return;
  list.innerHTML = '<div class="pond-cfg-loading">Loading configurations…</div>';

  let configs = [];
  try {
    configs = await getPondConfigurations(pondId);
  } catch {
    list.innerHTML = '<div class="pond-cfg-empty">Could not load configurations.</div>';
    return;
  }

  if (!configs.length) {
    list.innerHTML = `<div class="pond-cfg-empty">No configurations assigned to this pond.
      <button class="btn btn-sm btn-outline" id="btn-assign-first" style="margin-left:8px;">Assign Species Config</button>
    </div>`;
    return;
  }

  const hasActive = configs.some(c => c.isActive);

  // If no config is active, show a prominent "not configured" notice
  // plus a collapsed list of available (inactive) configs to re-activate
  if (!hasActive) {
    const inactiveRows = configs.map(cfg => `
      <div class="pond-cfg-row">
        <div class="pond-cfg-info">
          <span class="pond-cfg-name">${cfg.name || cfg.species}</span>
          <span class="badge-pill species-badge species-${cfg.species}">${SPECIES_LABELS[cfg.species] || cfg.species}</span>
          <span class="badge-pill" style="background:#f1f5f9;color:#64748b;font-size:0.65rem;">Inactive</span>
        </div>
        <div class="pond-cfg-actions">
          ${canEdit() ? `<button class="btn btn-sm btn-outline btn-set-active" data-id="${cfg.id}">Set Active</button>` : ''}
          ${canEdit() ? `<button class="btn btn-sm btn-outline btn-edit-cfg" data-id="${cfg.id}">Edit</button>` : ''}
          ${canEdit() ? `<button class="btn btn-sm btn-danger-outline btn-del-cfg" data-id="${cfg.id}">Remove</button>` : ''}
        </div>
      </div>`).join('');

    list.innerHTML = `
      <div class="pond-not-configured">
        <svg class="icon icon-20" style="color:var(--text-muted)"><use href="#icon-warning"/></svg>
        <div>
          <div class="pond-not-configured-title">Not Configured</div>
          <div class="pond-not-configured-sub">This pond has no active configuration. Set one of the configs below as active, or assign a new one.</div>
        </div>
        ${canEdit() ? `<button class="btn btn-sm btn-primary" id="btn-assign-first">Assign Config</button>` : ''}
      </div>
      <div class="pond-cfg-inactive-list">${inactiveRows}</div>`;
    return;
  }

  list.innerHTML = configs.map(cfg => `
    <div class="pond-cfg-row${cfg.isActive ? ' pond-cfg-active' : ''}">
      <div class="pond-cfg-info">
        <span class="pond-cfg-name">${cfg.name || cfg.species}</span>
        <span class="badge-pill species-badge species-${cfg.species}">${SPECIES_LABELS[cfg.species] || cfg.species}</span>
        ${cfg.isActive ? '<span class="badge-pill status-normal" style="font-size:0.65rem;">Active</span>' : ''}
      </div>
      <div class="pond-cfg-actions">
        ${!cfg.isActive && canEdit() ? `<button class="btn btn-sm btn-outline btn-set-active" data-id="${cfg.id}">Set Active</button>` : ''}
        ${cfg.isActive && canEdit() ? `<button class="btn btn-sm btn-warning-outline btn-deactivate-cfg" data-id="${cfg.id}">Deactivate</button>` : ''}
        ${canEdit() ? `<button class="btn btn-sm btn-outline btn-edit-cfg" data-id="${cfg.id}">Edit</button>` : ''}
        ${canEdit() && !cfg.isActive ? `<button class="btn btn-sm btn-danger-outline btn-del-cfg" data-id="${cfg.id}">Remove</button>` : ''}
      </div>
    </div>`).join('');
}

// ─── Dialogs ──────────────────────────────────────────────────────────────────

function openPondDialog(pond, onSaved) {
  if (!canEdit()) return alert('Owner/Admin required.');
  const isEdit = !!pond;
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const dlg = document.createElement('dialog');
  dlg.className = 'um-modal';
  dlg.innerHTML = `
    <div class="um-modal-inner">
      <div class="um-modal-head">
        <div>
          <div class="um-modal-title">${isEdit ? 'Edit Pond' : 'Add Pond'}</div>
          <div class="um-modal-sub">${isEdit ? 'Update pond details.' : 'Create a new pond.'}</div>
        </div>
        <button class="um-modal-close" id="pd-x" aria-label="Close"><svg class="icon icon-16"><use href="#icon-x"/></svg></button>
      </div>
      <div class="um-form-grid">
        <div class="um-field"><label>Pond Name</label><input id="pd-name" type="text" value="${esc(pond?.name)}" placeholder="e.g. Pond 1" /></div>
        <div class="um-field"><label>Location / Notes</label><input id="pd-location" type="text" value="${esc(pond?.location)}" placeholder="Optional" /></div>
        <div class="um-field"><label>Capacity (m³)</label><input id="pd-capacity" type="text" value="${esc(pond?.capacity)}" placeholder="Optional" /></div>
      </div>
      <div id="pd-error" style="color:var(--red-dark);font-size:0.8rem;margin-bottom:8px;display:none;"></div>
      <div class="um-modal-footer">
        <button type="button" class="btn btn-outline" id="pd-cancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="pd-save">${isEdit ? 'Save Changes' : 'Create Pond'}</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  const close = () => { dlg.close(); setTimeout(() => dlg.remove(), 0); };
  dlg.querySelector('#pd-x').addEventListener('click', close);
  dlg.querySelector('#pd-cancel').addEventListener('click', close);
  dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));
  dlg.querySelector('#pd-save').addEventListener('click', async () => {
    const errEl = dlg.querySelector('#pd-error');
    const name = dlg.querySelector('#pd-name').value.trim();
    if (!name) { errEl.textContent = 'Pond name is required.'; errEl.style.display = 'block'; return; }
    const data = {
      name,
      location: dlg.querySelector('#pd-location').value.trim(),
      capacity: dlg.querySelector('#pd-capacity').value.trim(),
    };
    try {
      if (isEdit) await updatePond(pond.id, data);
      else await createPond(data);
      close();
      await onSaved();
    } catch (e) {
      errEl.textContent = 'Save failed: ' + (e?.message || String(e));
      errEl.style.display = 'block';
    }
  });
}

function openAssignConfigDialog(pondId, onSaved) {
  if (!canEdit()) return alert('Owner/Admin required.');
  const speciesOptions = Object.entries(SPECIES_PRESETS)
    .map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  const dlg = document.createElement('dialog');
  dlg.className = 'um-modal';
  dlg.innerHTML = `
    <div class="um-modal-inner">
      <div class="um-modal-head">
        <div>
          <div class="um-modal-title">Assign Species Configuration</div>
          <div class="um-modal-sub">Add a species preset to this pond.</div>
        </div>
        <button class="um-modal-close" id="ac-x" aria-label="Close"><svg class="icon icon-16"><use href="#icon-x"/></svg></button>
      </div>
      <div class="um-form-grid">
        <div class="um-field"><label>Species</label><select id="ac-species">${speciesOptions}</select></div>
        <div class="um-field"><label>Config Name (optional)</label><input id="ac-name" type="text" placeholder="e.g. Crayfish – Summer" /></div>
      </div>
      <div id="ac-error" style="color:var(--red-dark);font-size:0.8rem;margin-bottom:8px;display:none;"></div>
      <div class="um-modal-footer">
        <button type="button" class="btn btn-outline" id="ac-cancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="ac-save">Assign</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  const close = () => { dlg.close(); setTimeout(() => dlg.remove(), 0); };
  dlg.querySelector('#ac-x').addEventListener('click', close);
  dlg.querySelector('#ac-cancel').addEventListener('click', close);
  dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));
  dlg.querySelector('#ac-save').addEventListener('click', async () => {
    const errEl = dlg.querySelector('#ac-error');
    const species = dlg.querySelector('#ac-species').value;
    const name = dlg.querySelector('#ac-name').value.trim() || (SPECIES_LABELS[species] + ' Config');
    const preset = SPECIES_PRESETS[species];
    try {
      await assignConfigToPond(pondId, { name, species, thresholds: preset.thresholds });
      close();
      await onSaved();
    } catch (e) {
      errEl.textContent = 'Failed: ' + (e?.message || String(e));
      errEl.style.display = 'block';
    }
  });
}

function openEditConfigDialog(pondId, cfg, onSaved) {
  if (!canEdit()) return alert('Owner/Admin required.');
  const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const t = cfg.thresholds || SPECIES_PRESETS[cfg.species]?.thresholds || {};
  const ph = t.ph || {}; const temp = t.temp || {}; const doT = t.do || {}; const turb = t.turb || {};

  const dlg = document.createElement('dialog');
  dlg.className = 'um-modal um-modal-wide';
  dlg.innerHTML = `
    <div class="um-modal-inner">
      <div class="um-modal-head">
        <div>
          <div class="um-modal-title">Edit Configuration — ${esc(cfg.name || cfg.species)}</div>
          <div class="um-modal-sub">Customize thresholds for this pond configuration.</div>
        </div>
        <button class="um-modal-close" id="ec-x" aria-label="Close"><svg class="icon icon-16"><use href="#icon-x"/></svg></button>
      </div>
      <div class="um-form-grid" style="grid-template-columns:1fr 1fr;">
        <div class="um-field"><label>Config Name</label><input id="ec-name" type="text" value="${esc(cfg.name)}" /></div>
        <div class="um-field"><label>Species</label>
          <select id="ec-species">
            ${Object.entries(SPECIES_PRESETS).map(([k, v]) => `<option value="${k}"${cfg.species === k ? ' selected' : ''}>${v.name}</option>`).join('')}
          </select>
        </div>
        <div class="um-field"><label>pH Optimal Min</label><input id="ec-ph-min" type="number" step="0.1" value="${ph.optimalMin ?? ''}" /></div>
        <div class="um-field"><label>pH Optimal Max</label><input id="ec-ph-max" type="number" step="0.1" value="${ph.optimalMax ?? ''}" /></div>
        <div class="um-field"><label>Temp Optimal Min (°C)</label><input id="ec-temp-min" type="number" step="0.1" value="${temp.optimalMin ?? ''}" /></div>
        <div class="um-field"><label>Temp Optimal Max (°C)</label><input id="ec-temp-max" type="number" step="0.1" value="${temp.optimalMax ?? ''}" /></div>
        <div class="um-field"><label>DO Optimal Min (mg/L)</label><input id="ec-do-min" type="number" step="0.1" value="${doT.optimalMin ?? ''}" /></div>
        <div class="um-field"><label>Turbidity Optimal Max (NTU)</label><input id="ec-turb-max" type="number" step="1" value="${turb.optimalMax ?? ''}" /></div>
      </div>
      <div id="ec-error" style="color:var(--red-dark);font-size:0.8rem;margin-bottom:8px;display:none;"></div>
      <div class="um-modal-footer">
        <button type="button" class="btn btn-outline" id="ec-cancel">Cancel</button>
        <button type="button" class="btn btn-outline" id="ec-reset">Reset to Preset</button>
        <button type="button" class="btn btn-primary" id="ec-save">Save</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  const close = () => { dlg.close(); setTimeout(() => dlg.remove(), 0); };
  dlg.querySelector('#ec-x').addEventListener('click', close);
  dlg.querySelector('#ec-cancel').addEventListener('click', close);
  dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));

  dlg.querySelector('#ec-reset').addEventListener('click', () => {
    const species = dlg.querySelector('#ec-species').value;
    const p = SPECIES_PRESETS[species]?.thresholds || {};
    dlg.querySelector('#ec-ph-min').value   = p.ph?.optimalMin   ?? '';
    dlg.querySelector('#ec-ph-max').value   = p.ph?.optimalMax   ?? '';
    dlg.querySelector('#ec-temp-min').value = p.temp?.optimalMin ?? '';
    dlg.querySelector('#ec-temp-max').value = p.temp?.optimalMax ?? '';
    dlg.querySelector('#ec-do-min').value   = p.do?.optimalMin   ?? '';
    dlg.querySelector('#ec-turb-max').value = p.turb?.optimalMax ?? '';
  });

  dlg.querySelector('#ec-save').addEventListener('click', async () => {
    const errEl = dlg.querySelector('#ec-error');
    const species = dlg.querySelector('#ec-species').value;
    const name = dlg.querySelector('#ec-name').value.trim() || cfg.name;
    const preset = SPECIES_PRESETS[species]?.thresholds || {};
    const n = id => { const v = Number(dlg.querySelector(id)?.value); return Number.isFinite(v) ? v : null; };
    const thresholds = {
      ph:   { ...preset.ph,   optimalMin: n('#ec-ph-min')   ?? preset.ph?.optimalMin,   optimalMax: n('#ec-ph-max')   ?? preset.ph?.optimalMax },
      temp: { ...preset.temp, optimalMin: n('#ec-temp-min') ?? preset.temp?.optimalMin, optimalMax: n('#ec-temp-max') ?? preset.temp?.optimalMax },
      do:   { ...preset.do,   optimalMin: n('#ec-do-min')   ?? preset.do?.optimalMin },
      turb: { ...preset.turb, optimalMax: n('#ec-turb-max') ?? preset.turb?.optimalMax },
    };
    try {
      await updatePondConfiguration(cfg.id, { name, species, thresholds });
      if (cfg.isActive) {
        const { applyConfig } = await import('../pond-config.js');
        applyConfig({ species, thresholds });
      }
      close();
      await onSaved();
    } catch (e) {
      errEl.textContent = 'Save failed: ' + (e?.message || String(e));
      errEl.style.display = 'block';
    }
  });
}
