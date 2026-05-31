import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { mockState } from './mocks/firebase-admin.js';

// Ensure firebase-admin resolves to our stub (via vitest.config.js alias).
import { createApp } from '../backend/server.js';

describe('backend API auth/roles (automated)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    mockState.authVerifyIdToken = async () => ({ uid: 'u1' });
    mockState.usersDocGet = async () => ({
      exists: true,
      data: () => ({ role: 'farmer' }),
    });
    mockState.usersCollectionGet = async () => ({ docs: [] });
    mockState.pondsCollectionGet = async () => ({ docs: [] });
  });

  it('GET /api/config is public (no Authorization required)', async () => {
    const app = createApp();
    const r = await request(app).get('/api/config');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('firebaseDatabaseUrl');
    expect(r.body).toHaveProperty('deviceId');
  });

  it('GET /api/users returns 401 without Authorization header', async () => {
    const app = createApp();
    const r = await request(app).get('/api/users');
    expect(r.status).toBe(401);
  });

  it('GET /api/users returns 403 for non-admin/non-owner role', async () => {
    const app = createApp();
    mockState.usersDocGet = async () => ({
      exists: true,
      data: () => ({ role: 'farmer' }),
    });
    const r = await request(app)
      .get('/api/users')
      .set('Authorization', 'Bearer test-token');
    expect(r.status).toBe(403);
  });

  it('GET /api/users returns 200 for owner role', async () => {
    const app = createApp();

    mockState.usersDocGet = async () => ({
      exists: true,
      data: () => ({ role: 'owner' }),
    });

    const docs = [
      {
        id: 'userA',
        data: () => ({
          email: 'a@example.com',
          displayName: 'A',
          phone: '',
          role: 'farmer',
          status: 'active',
          farmId: '',
          createdAt: null,
        }),
        ref: { delete: vi.fn() },
      },
    ];

    mockState.usersCollectionGet = async () => ({ docs });
    mockState.authGetUser = async (uid) => ({ uid });

    const r = await request(app)
      .get('/api/users')
      .set('Authorization', 'Bearer test-token');

    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body[0]).toHaveProperty('id', 'userA');
  });

  it('GET /api/ponds returns 401 without Authorization', async () => {
    const app = createApp();
    const r = await request(app).get('/api/ponds');
    expect(r.status).toBe(401);
  });

  it('GET /api/ponds returns ponds list for any authenticated user', async () => {
    const app = createApp();
    mockState.usersDocGet = async () => ({ exists: true, data: () => ({ role: 'farmer' }) });
    mockState.pondsCollectionGet = async () => ({
      docs: [
        { id: 'p1', data: () => ({ name: 'Pond 1' }) },
        { id: 'p2', data: () => ({ name: 'Pond 2' }) },
      ],
    });

    const r = await request(app)
      .get('/api/ponds')
      .set('Authorization', 'Bearer test-token');

    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(2);
    expect(r.body[0]).toHaveProperty('id', 'p1');
  });

  it('PATCH /api/users/me saves notificationPrefs for farmer role', async () => {
    const app = createApp();
    mockState.authVerifyIdToken = async () => ({ uid: 'farmer-1' });
    mockState.usersDocGet = async () => ({
      exists: true,
      data: () => ({ role: 'farmer', email: 'farmer@example.com' }),
    });
    const prefsSet = vi.fn().mockResolvedValue(undefined);
    mockState.notificationPrefsSet = prefsSet;

    const r = await request(app)
      .patch('/api/users/me')
      .set('Authorization', 'Bearer test-token')
      .send({
        notificationPrefs: {
          email: { enabled: true, address: 'farmer@example.com' },
          sms: { enabled: false },
        },
      });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true });
    expect(prefsSet).toHaveBeenCalledWith(
      'farmer-1',
      'settings',
      expect.objectContaining({
        email: { enabled: true, address: 'farmer@example.com' },
        sms: { enabled: false },
      }),
      { merge: true },
    );
  });

  it('PATCH /api/users/me rejects invalid email when email alerts enabled', async () => {
    const app = createApp();
    mockState.authVerifyIdToken = async () => ({ uid: 'farmer-1' });
    mockState.usersDocGet = async () => ({
      exists: true,
      data: () => ({ role: 'farmer', email: '' }),
    });

    const r = await request(app)
      .patch('/api/users/me')
      .set('Authorization', 'Bearer test-token')
      .send({
        notificationPrefs: {
          email: { enabled: true, address: 'not-an-email' },
          sms: { enabled: false },
        },
      });

    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/invalid email/i);
  });
});

