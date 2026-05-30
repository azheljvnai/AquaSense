/**
 * Water quality — dashboard badges (client).
 * Module: public/js/pond-config.js getBadgeForSpecies
 * Demo: UI status chips match server threshold-eval for the same reading.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../public/js/firebase-client.js', () => ({
  fbGetIdToken: vi.fn(),
  fbFirestore: vi.fn(),
  fbAddDoc: vi.fn(),
  fbCollection: vi.fn(),
  fbServerTimestamp: vi.fn(),
}));

import { getBadgeForThresholds } from '../backend/lib/threshold-eval.js';
import { applyConfig, getBadgeForSpecies, SPECIES_PRESETS } from '../public/js/pond-config.js';

describe('pond-config getBadgeForSpecies', () => {
  const crayfishThresholds = SPECIES_PRESETS.crayfish.thresholds;

  beforeEach(() => {
    applyConfig({ species: 'crayfish', thresholds: null, id: 'test' });
  });

  // Unknown species / no thresholds → placeholder badge
  it('returns dash label when active thresholds are null', () => {
    applyConfig({ species: 'unknown_species', thresholds: null, id: 'empty' });
    expect(getBadgeForSpecies('ph', 7)).toEqual({ c: 'ok', l: '—' });
    applyConfig({ species: 'crayfish', thresholds: null, id: 'test' });
  });

  it('returns Normal for optimal pH', () => {
    expect(getBadgeForSpecies('ph', 7.0)).toEqual({ c: 'ok', l: 'Normal' });
  });

  it('returns Warning for crayfish DO in low acceptable band', () => {
    expect(getBadgeForSpecies('do', 4.7).c).toBe('warn');
  });

  it('returns Critical for turbidity above acceptable max', () => {
    expect(getBadgeForSpecies('turb', 90).c).toBe('danger');
  });

  // Client badge.c/l must equal server getBadgeForThresholds (single source of truth)
  it('matches threshold-eval for same thresholds and reading', () => {
    const key = 'do';
    const val = 4.0;
    const clientBadge = getBadgeForSpecies(key, val);
    const serverBadge = getBadgeForThresholds(key, val, crayfishThresholds);
    expect(clientBadge.c).toBe(serverBadge.c);
    expect(clientBadge.l).toBe(serverBadge.l);
  });
});
