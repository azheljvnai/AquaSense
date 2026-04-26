/**
 * Global Pond Context — single source of truth for the active pond across all features.
 *
 * Usage:
 *   import { getActivePond, setActivePond, onActivePondChange, getPondList } from './pond-context.js';
 *
 * Events dispatched on window:
 *   'active-pond-changed'  — detail: { pond }  (pond is null when none selected)
 *   'pond-list-updated'    — detail: { ponds }
 */

const STORAGE_KEY = 'aquasense.activePondId';

let _activePond  = null;   // { id, name, species, ... } | null
let _ponds       = [];     // full list loaded from API
const _listeners = new Set();

// ─── Getters ──────────────────────────────────────────────────────────────────

export function getActivePond()  { return _activePond; }
export function getActivePondId(){ return _activePond?.id ?? null; }
export function getPondList()    { return _ponds; }

// ─── Setters ──────────────────────────────────────────────────────────────────

/**
 * Set the active pond by id. Pass null to clear.
 * Persists to localStorage and fires listeners + custom event.
 */
export function setActivePond(pondOrId) {
  if (!pondOrId) {
    _activePond = null;
    _persist(null);
    _notify();
    return;
  }
  const id   = typeof pondOrId === 'string' ? pondOrId : pondOrId.id;
  const pond = _ponds.find(p => p.id === id) || (typeof pondOrId === 'object' ? pondOrId : null);
  _activePond = pond;
  _persist(id);
  _notify();
}

/**
 * Replace the full pond list (called after API fetch).
 * Restores the previously persisted active pond selection but does NOT
 * fire active-pond-changed yet — that happens later once the config is
 * loaded and the pond is enriched with species data.
 */
export function setPondList(ponds) {
  _ponds = Array.isArray(ponds) ? ponds : [];
  window.dispatchEvent(new CustomEvent('pond-list-updated', { detail: { ponds: _ponds } }));

  // Restore persisted selection silently (no notify — species not known yet)
  const savedId = _loadPersisted();
  const match   = savedId ? _ponds.find(p => p.id === savedId) : null;
  if (match) {
    _activePond = match;
    // Don't call _notify() here — pond-management will call setActivePond()
    // with the species-enriched object once the config is loaded.
  } else if (_ponds.length > 0 && !_activePond) {
    _activePond = _ponds[0];
    _persist(_activePond.id);
    // Same — don't notify until enriched.
  }
}

// ─── Subscription ─────────────────────────────────────────────────────────────

/** Subscribe to active-pond changes. Returns an unsubscribe function. */
export function onActivePondChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// ─── Internals ────────────────────────────────────────────────────────────────

function _notify() {
  for (const fn of _listeners) {
    try { fn(_activePond); } catch { /* ignore */ }
  }
  window.dispatchEvent(new CustomEvent('active-pond-changed', { detail: { pond: _activePond } }));
}

function _persist(id) {
  try { localStorage.setItem(STORAGE_KEY, id ?? ''); } catch { /* ignore */ }
}

function _loadPersisted() {
  try { return localStorage.getItem(STORAGE_KEY) || null; } catch { return null; }
}
