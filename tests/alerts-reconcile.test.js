/**
 * Alerts metadata refresh — must not auto-resolve on page load / threshold refresh.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../public/js/firebase-client.js', () => ({
  fbAuth: vi.fn(() => ({ currentUser: null })),
  fbFirestore: vi.fn(),
  fbCollection: vi.fn(),
  fbAddDoc: vi.fn(),
  fbServerTimestamp: vi.fn(),
  fbQuery: vi.fn(),
  fbOrderBy: vi.fn(),
  fbLimit: vi.fn(),
  fbGetDocs: vi.fn(),
  fbUpdateDoc: vi.fn(),
  fbDoc: vi.fn(),
  fbWhere: vi.fn(),
  fbOnSnapshot: vi.fn(),
  fbWriteBatch: vi.fn(),
  fbGetIdToken: vi.fn(),
}));

vi.mock('../public/js/ui/templates.js', () => ({
  alertPondFilterButton: vi.fn(),
  alertEmptyListRow: vi.fn(),
  escapeHtml: (s) => s,
}));

vi.mock('../public/js/ui/modal-ui.js', () => ({
  showAppToast: vi.fn(),
  showConfirmModal: vi.fn(),
}));

vi.mock('../public/js/features/notifications.js', () => ({
  handleAlerts: vi.fn(),
}));

import { applyConfig, SPECIES_PRESETS } from '../public/js/pond-config.js';
import {
  normalizeAlertVal,
  refreshAlertMetadataForAlerts,
  buildAlertsConfigFingerprint,
  shouldAutoResolveAlertsOnConfigApply,
} from '../public/js/features/alerts.js';

describe('normalizeAlertVal', () => {
  it('returns finite numbers as-is', () => {
    expect(normalizeAlertVal(7.5)).toBe(7.5);
    expect(normalizeAlertVal(0)).toBe(0);
  });

  it('returns NaN for null and undefined (not 0)', () => {
    expect(Number.isNaN(normalizeAlertVal(null))).toBe(true);
    expect(Number.isNaN(normalizeAlertVal(undefined))).toBe(true);
  });

  it('coerces numeric strings', () => {
    expect(normalizeAlertVal('9.2')).toBe(9.2);
  });

  it('returns NaN for non-numeric strings', () => {
    expect(Number.isNaN(normalizeAlertVal(''))).toBe(true);
    expect(Number.isNaN(normalizeAlertVal('abc'))).toBe(true);
  });
});

describe('refreshAlertMetadataForAlerts', () => {
  beforeEach(() => {
    applyConfig({ species: 'crayfish', thresholds: null, id: 'test' });
  });

  it('does not mark unresolved alerts as resolved when stored val is still out of range', () => {
    const alerts = [
      {
        id: 'ph-1',
        ts: Date.now(),
        key: 'ph',
        val: 9.5,
        severity: 'critical',
        badge: 'danger',
        label: 'Critical: pH in Crayfish',
        description: 'pH out of range',
        pond: 'Crayfish',
        resolved: false,
      },
    ];

    const { changed } = refreshAlertMetadataForAlerts(alerts);

    expect(alerts[0].resolved).toBe(false);
    expect(changed).toBe(true);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].label).toContain('Critical');
  });

  it('does not auto-resolve on page-load hydrate (fingerprint was null)', () => {
    const fp = buildAlertsConfigFingerprint('crayfish', SPECIES_PRESETS.crayfish.thresholds);
    expect(shouldAutoResolveAlertsOnConfigApply(null, fp)).toBe(false);
  });

  it('does not auto-resolve when config fingerprint is unchanged', () => {
    const fp = buildAlertsConfigFingerprint('crayfish', SPECIES_PRESETS.crayfish.thresholds);
    expect(shouldAutoResolveAlertsOnConfigApply(fp, fp)).toBe(false);
  });

  it('auto-resolves on config change when stored val is optimal under new thresholds', () => {
    const fpA = buildAlertsConfigFingerprint('strict', SPECIES_PRESETS.crayfish.thresholds);
    const fpB = buildAlertsConfigFingerprint('tilapia', SPECIES_PRESETS.tilapia.thresholds);
    expect(shouldAutoResolveAlertsOnConfigApply(fpA, fpB)).toBe(true);

    const alerts = [
      {
        id: 'ph-optimal',
        ts: Date.now(),
        key: 'ph',
        val: 7.0,
        severity: 'warning',
        badge: 'warn',
        label: 'Old label',
        description: 'Old description',
        pond: 'Crayfish',
        resolved: false,
      },
    ];

    const { changed, toResolve } = refreshAlertMetadataForAlerts(alerts, { autoResolveIfOptimal: true });

    expect(alerts[0].resolved).toBe(true);
    expect(changed).toBe(true);
    expect(toResolve).toEqual(['ph-optimal']);
  });

  it('does not auto-resolve when stored val would now classify as optimal (default)', () => {
    const alerts = [
      {
        id: 'ph-optimal',
        ts: Date.now(),
        key: 'ph',
        val: 7.0,
        severity: 'warning',
        badge: 'warn',
        label: 'Old label',
        description: 'Old description',
        pond: 'Crayfish',
        resolved: false,
      },
    ];

    const { changed } = refreshAlertMetadataForAlerts(alerts);

    expect(alerts[0].resolved).toBe(false);
    expect(changed).toBe(false);
  });

  it('skips alerts with missing val (null does not coerce to 0)', () => {
    const alerts = [
      {
        id: 'turb-missing',
        ts: Date.now(),
        key: 'turb',
        val: normalizeAlertVal(null),
        severity: 'critical',
        badge: 'danger',
        label: 'Critical: Turbidity',
        description: 'Missing val',
        pond: 'Crayfish',
        resolved: false,
      },
    ];

    const { changed } = refreshAlertMetadataForAlerts(alerts);

    expect(alerts[0].resolved).toBe(false);
    expect(changed).toBe(false);
  });

  it('updates label and description when thresholds still classify alert as active', () => {
    const alerts = [
      {
        id: 'do-1',
        ts: Date.now(),
        key: 'do',
        val: 4.0,
        severity: 'critical',
        badge: 'danger',
        label: 'Stale label',
        description: 'Stale description',
        pond: 'Crayfish',
        resolved: false,
      },
    ];

    refreshAlertMetadataForAlerts(alerts);

    expect(alerts[0].resolved).toBe(false);
    expect(alerts[0].label).toContain('Dissolved');
    expect(alerts[0].description).toContain('4.0');
  });
});
