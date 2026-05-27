import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../backend/server.js';

describe('security: /api/config exposure regression', () => {
  it('does not expose server-only secrets in /api/config', async () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{"type":"service_account","private_key":"SECRET"}';
    process.env.UNISMS_SECRET_KEY = 'SECRET';
    process.env.EMAILJS_PRIVATE_KEY = 'SECRET';

    const app = createApp();
    const r = await request(app).get('/api/config');

    expect(r.status).toBe(200);
    const json = JSON.stringify(r.body);

    expect(json).not.toMatch(/service_account/i);
    expect(json).not.toMatch(/private_key/i);
    expect(json).not.toContain('UNISMS_SECRET_KEY');
    expect(json).not.toContain('EMAILJS_PRIVATE_KEY');
  });
});

