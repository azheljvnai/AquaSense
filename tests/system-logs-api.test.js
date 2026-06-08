import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { mockState } from './mocks/firebase-admin.js';
import { createApp } from '../backend/server.js';

describe('system logs API', () => {
  beforeEach(() => {
    mockState.systemLogsStore = [];
    mockState.authVerifyIdToken = async () => ({ uid: 'admin-1' });
    mockState.usersDocGet = async () => ({
      exists: true,
      data: () => ({ role: 'admin', displayName: 'Admin User', email: 'admin@test.com' }),
    });
  });

  it('POST /api/system-logs returns 401 without token', async () => {
    const app = createApp();
    const r = await request(app).post('/api/system-logs').send({
      eventType: 'user.login',
      severity: 'info',
      source: 'user',
      description: 'Test',
    });
    expect(r.status).toBe(401);
  });

  it('POST /api/system-logs creates a log for authenticated user', async () => {
    const app = createApp();
    const r = await request(app)
      .post('/api/system-logs')
      .set('Authorization', 'Bearer test-token')
      .send({
        eventType: 'user.login',
        severity: 'info',
        source: 'user',
        description: 'User logged in successfully',
      });
    expect(r.status).toBe(201);
    expect(r.body.id).toBeTruthy();
    expect(mockState.systemLogsStore.length).toBe(1);
  });

  it('GET /api/system-logs returns 403 for farmer', async () => {
    const app = createApp();
    mockState.usersDocGet = async () => ({
      exists: true,
      data: () => ({ role: 'farmer' }),
    });
    const r = await request(app)
      .get('/api/system-logs')
      .set('Authorization', 'Bearer test-token');
    expect(r.status).toBe(403);
  });

  it('GET /api/system-logs returns 200 for owner', async () => {
    const app = createApp();
    mockState.usersDocGet = async () => ({
      exists: true,
      data: () => ({ role: 'owner' }),
    });
    mockState.systemLogsStore.push({
      id: 'log-1',
      data: {
        eventType: 'user.login',
        severity: 'info',
        source: 'user',
        description: 'Login',
        createdAt: { toMillis: () => Date.now() },
      },
    });
    const r = await request(app)
      .get('/api/system-logs')
      .set('Authorization', 'Bearer test-token');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.items)).toBe(true);
  });

  it('GET /api/system-logs?includeCount=1 returns totalCount for owner', async () => {
    const app = createApp();
    mockState.usersDocGet = async () => ({
      exists: true,
      data: () => ({ role: 'owner' }),
    });
    for (let i = 0; i < 3; i += 1) {
      mockState.systemLogsStore.push({
        id: `log-${i}`,
        data: {
          eventType: 'user.login',
          severity: 'info',
          source: 'user',
          description: `Login ${i}`,
          createdAt: { toMillis: () => Date.now() - i * 1000 },
        },
      });
    }
    const r = await request(app)
      .get('/api/system-logs?includeCount=1&pageSize=2')
      .set('Authorization', 'Bearer test-token');
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(2);
    expect(r.body.totalCount).toBe(3);
    expect(r.body.totalPages).toBe(2);
  });

  it('GET /api/system-logs supports comma-separated multi filters', async () => {
    const app = createApp();
    mockState.usersDocGet = async () => ({
      exists: true,
      data: () => ({ role: 'owner' }),
    });

    mockState.systemLogsStore.push(
      {
        id: 'log-error',
        data: {
          eventType: 'error.exception',
          severity: 'error',
          source: 'system',
          description: 'Error event',
          createdAt: { toMillis: () => Date.now() - 1000 },
        },
      },
      {
        id: 'log-warning',
        data: {
          eventType: 'system.health.check',
          severity: 'warning',
          source: 'sensor',
          description: 'Warning event',
          createdAt: { toMillis: () => Date.now() - 500 },
        },
      },
      {
        id: 'log-info',
        data: {
          eventType: 'user.login',
          severity: 'info',
          source: 'user',
          description: 'Info event',
          createdAt: { toMillis: () => Date.now() },
        },
      },
    );

    const r = await request(app)
      .get('/api/system-logs?severity=error,warning&source=system,sensor')
      .set('Authorization', 'Bearer test-token');

    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(2);
    expect(r.body.items.every((x) => ['error', 'warning'].includes(x.severity))).toBe(true);
    expect(r.body.items.every((x) => ['system', 'sensor'].includes(x.source))).toBe(true);
  });

  it('GET /api/system-logs/summary returns aggregate counters', async () => {
    const app = createApp();
    mockState.usersDocGet = async () => ({
      exists: true,
      data: () => ({ role: 'owner' }),
    });
    mockState.systemLogsStore.push(
      {
        id: 'log-1',
        data: {
          eventType: 'error.exception',
          severity: 'error',
          source: 'system',
          description: 'Error 1',
          createdAt: { toMillis: () => Date.now() - 3000 },
        },
      },
      {
        id: 'log-2',
        data: {
          eventType: 'error.exception',
          severity: 'error',
          source: 'system',
          description: 'Error 2',
          createdAt: { toMillis: () => Date.now() - 2000 },
        },
      },
      {
        id: 'log-3',
        data: {
          eventType: 'system.health.check',
          severity: 'warning',
          source: 'sensor',
          description: 'Warning 1',
          createdAt: { toMillis: () => Date.now() - 1000 },
        },
      },
      {
        id: 'log-4',
        data: {
          eventType: 'system.startup',
          severity: 'critical',
          source: 'system',
          description: 'Critical 1',
          createdAt: { toMillis: () => Date.now() },
        },
      },
    );

    const r = await request(app)
      .get('/api/system-logs/summary')
      .set('Authorization', 'Bearer test-token');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(4);
    expect(r.body.error).toBe(2);
    expect(r.body.warning).toBe(1);
    expect(r.body.critical).toBe(1);
  });

  it('GET /api/system-logs/export returns CSV for owner', async () => {
    const app = createApp();
    mockState.usersDocGet = async () => ({
      exists: true,
      data: () => ({ role: 'owner' }),
    });
    mockState.systemLogsStore.push({
      id: 'log-1',
      data: {
        eventType: 'user.login',
        severity: 'info',
        source: 'user',
        description: 'Login',
        userName: 'A',
        createdAt: { toMillis: () => Date.now() },
      },
    });
    const r = await request(app)
      .get('/api/system-logs/export?format=csv')
      .set('Authorization', 'Bearer test-token');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/csv/);
    expect(r.text).toContain('Timestamp');
  });

  it('DELETE /api/system-logs requires admin', async () => {
    const app = createApp();
    mockState.usersDocGet = async () => ({
      exists: true,
      data: () => ({ role: 'owner' }),
    });
    const r = await request(app)
      .delete('/api/system-logs')
      .set('Authorization', 'Bearer test-token');
    expect(r.status).toBe(403);
  });

  it('DELETE /api/system-logs clears logs and writes audit entry for admin', async () => {
    const app = createApp();
    mockState.systemLogsStore.push({
      id: 'log-1',
      data: {
        eventType: 'user.login',
        severity: 'info',
        source: 'user',
        description: 'Login',
        createdAt: { toMillis: () => Date.now() },
      },
    });
    const r = await request(app)
      .delete('/api/system-logs')
      .set('Authorization', 'Bearer test-token');
    expect(r.status).toBe(200);
    expect(r.body.deletedCount).toBeGreaterThanOrEqual(0);
    const audit = mockState.systemLogsStore.find((x) => x.data.eventType === 'audit.logs_cleared');
    expect(audit).toBeTruthy();
  });
});
