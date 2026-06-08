import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { mockState } from './mocks/firebase-admin.js';
import { createApp } from '../backend/server.js';

describe('system logs policy API', () => {
  beforeEach(() => {
    mockState.systemLogsStore = [];
    mockState.authVerifyIdToken = async () => ({ uid: 'farmer-1' });
    mockState.usersDocGet = async () => ({
      exists: true,
      data: () => ({ role: 'farmer', displayName: 'Farmer' }),
    });
  });

  it('POST sensor.reading returns 204 and does not store', async () => {
    const app = createApp();
    const r = await request(app)
      .post('/api/system-logs')
      .set('Authorization', 'Bearer test-token')
      .send({
        eventType: 'sensor.reading',
        severity: 'info',
        source: 'sensor',
        description: 'Routine reading',
      });
    expect(r.status).toBe(204);
    expect(mockState.systemLogsStore.length).toBe(0);
  });
});
