// tests/router.test.js
import { describe, it, expect } from 'vitest';
import { pageFromPath, pathFromPage } from '../public/js/router.js';

describe('router', () => {
  describe('pageFromPath', () => {
    it('maps root to dashboard', () => {
      expect(pageFromPath('/')).toBe('dashboard');
    });

    it('maps /dashboard to dashboard', () => {
      expect(pageFromPath('/dashboard')).toBe('dashboard');
    });

    it('maps /configuration to configuration', () => {
      expect(pageFromPath('/configuration')).toBe('configuration');
    });

    it('strips trailing slashes', () => {
      expect(pageFromPath('/feeding/')).toBe('feeding');
      expect(pageFromPath('/reports///')).toBe('reports');
    });

    it('maps /account to account-profile', () => {
      expect(pageFromPath('/account')).toBe('account-profile');
    });

    it('returns null for unknown paths', () => {
      expect(pageFromPath('/unknown')).toBeNull();
      expect(pageFromPath('/api/users')).toBeNull();
    });
  });

  describe('pathFromPage', () => {
    it('maps dashboard to root', () => {
      expect(pathFromPage('dashboard')).toBe('/');
    });

    it('maps configuration to /configuration', () => {
      expect(pathFromPage('configuration')).toBe('/configuration');
    });

    it('maps account-profile to /account', () => {
      expect(pathFromPage('account-profile')).toBe('/account');
    });

    it('falls back to / for unknown pages', () => {
      expect(pathFromPage('nonexistent')).toBe('/');
    });
  });

  describe('round-trip', () => {
    const pages = [
      'dashboard',
      'water-quality',
      'historical-data',
      'feeding',
      'alerts',
      'reports',
      'configuration',
      'user-management',
      'account-profile',
    ];

    for (const page of pages) {
      it(`round-trips ${page}`, () => {
        const path = pathFromPage(page);
        expect(pageFromPath(path)).toBe(page);
      });
    }
  });
});
