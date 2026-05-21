import { describe, it, expect } from 'vitest';
import {
  validatePassword,
  passwordsMatch,
  PASSWORD_RULES,
} from '../public/js/password-rules.js';

describe('password-rules', () => {
  describe('validatePassword', () => {
    it('accepts a password that meets all rules', () => {
      const result = validatePassword('Abcdef1!');
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('rejects empty password', () => {
      const result = validatePassword('');
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBe(PASSWORD_RULES.length);
    });

    it('rejects password without uppercase', () => {
      const result = validatePassword('abcdef12');
      expect(result.ok).toBe(false);
      expect(result.errors).toContain('One uppercase letter');
    });

    it('rejects password without lowercase', () => {
      const result = validatePassword('ABCDEF12');
      expect(result.ok).toBe(false);
      expect(result.errors).toContain('One lowercase letter');
    });

    it('rejects password without a number', () => {
      const result = validatePassword('Abcdefgh');
      expect(result.ok).toBe(false);
      expect(result.errors).toContain('One number');
    });

    it('rejects password shorter than 8 characters', () => {
      const result = validatePassword('Ab1');
      expect(result.ok).toBe(false);
      expect(result.errors).toContain('At least 8 characters');
    });
  });

  describe('passwordsMatch', () => {
    it('returns true when password and confirm match', () => {
      expect(passwordsMatch('Abcdef12', 'Abcdef12')).toBe(true);
    });

    it('returns false when confirm differs', () => {
      expect(passwordsMatch('Abcdef12', 'Abcdef13')).toBe(false);
    });

    it('returns false when password is empty', () => {
      expect(passwordsMatch('', '')).toBe(false);
    });
  });
});
