import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getEmailJsServerEnv } from '../backend/lib/emailjs-env.js';

describe('getEmailJsServerEnv', () => {
  const KEYS = [
    'EMAILJS_PRIVATE_KEY',
    'EMAILJS_ACCESS_TOKEN',
    'EMAILJS_PRIVATE_API_KEY',
    'EMAILJS_PUBLIC_KEY',
    'EMAILJS_SERVICE_ID',
    'EMAILJS_TEMPLATE_ID',
  ];
  let snapshot;

  beforeEach(() => {
    snapshot = {};
    for (const k of KEYS) {
      snapshot[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (snapshot[k] !== undefined) process.env[k] = snapshot[k];
      else delete process.env[k];
    }
  });

  it('accepts EMAILJS_ACCESS_TOKEN as private key alias', () => {
    process.env.EMAILJS_ACCESS_TOKEN = 'priv-from-alias';
    process.env.EMAILJS_PUBLIC_KEY = 'pub';
    process.env.EMAILJS_SERVICE_ID = 'svc';
    process.env.EMAILJS_TEMPLATE_ID = 'tpl';
    const e = getEmailJsServerEnv();
    expect(e.configured).toBe(true);
    expect(e.privateKey).toBe('priv-from-alias');
  });

  it('prefers EMAILJS_PRIVATE_KEY over EMAILJS_ACCESS_TOKEN', () => {
    process.env.EMAILJS_PRIVATE_KEY = 'a';
    process.env.EMAILJS_ACCESS_TOKEN = 'b';
    process.env.EMAILJS_PUBLIC_KEY = 'p';
    process.env.EMAILJS_SERVICE_ID = 's';
    process.env.EMAILJS_TEMPLATE_ID = 't';
    expect(getEmailJsServerEnv().privateKey).toBe('a');
  });
});
