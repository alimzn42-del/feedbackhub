import request from 'supertest';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { closePool } from '../../src/db/pool.js';
import { closeAdminConnection, one, resetToFresh, seededIds } from './database.js';
import { ADMIN, DANA, bearerFor, schemaVersion, signedIn } from './harness.js';

/* The harness proving itself: a real schema, a real seed, a real token verified
   through a real JWKS fetch, and a real row read back by the real repository.
   If this file fails, nothing else at L1 means anything. */

const app = createApp();

beforeAll(async () => {
  await resetToFresh();
});

afterAll(async () => {
  await closePool();
  await closeAdminConnection();
});

describe('the L1 harness', () => {
  it('migrated to the schema version this code expects', () => {
    expect(schemaVersion).toBe(13);
  });

  it('seeded the three people, four categories and six statuses', async () => {
    expect(await one('SELECT COUNT(*) FROM users')).toBe(3);
    expect(await one('SELECT COUNT(*) FROM categories')).toBe(4);
    expect(await one('SELECT COUNT(*) FROM statuses')).toBe(6);
    expect(await one('SELECT COUNT(*) FROM app_settings')).toBe(0);
    expect(await one('SELECT COUNT(*) FROM feedback_requests')).toBe(0);
  });

  it('resolves a bearer to the seeded person it names, against the real table', async () => {
    const response = await signedIn(request(app), await bearerFor(DANA)).get('/api/bootstrap');

    expect(response.status).toBe(200);
    expect(response.body.data.user).toMatchObject({
      email: DANA.email,
      displayName: DANA.displayName,
    });
    expect(response.body.data.user.id).toBe((await seededIds())[DANA.email]);
  });

  it('serves the admin a different set of capabilities, from the same route', async () => {
    const asAdmin = await signedIn(request(app), await bearerFor(ADMIN)).get('/api/bootstrap');
    const asDana = await signedIn(request(app), await bearerFor(DANA)).get('/api/bootstrap');

    expect(asAdmin.status).toBe(200);
    expect(asAdmin.body.data.capabilities).not.toEqual(asDana.body.data.capabilities);
  });

  it('refuses a request with no token before it reaches a route', async () => {
    const response = await request(app).get('/api/requests');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('writes a request through the real repository and reads it back in SQL', async () => {
    const created = await signedIn(request(app), await bearerFor(DANA))
      .post('/api/requests')
      .send({
        title: 'The harness files a request',
        description: 'Twenty characters at the very least, so the schema is satisfied by it.',
        categoryId: (await one<number>("SELECT id FROM categories WHERE slug = 'bug'")) as number,
      });

    expect(created.status).toBe(201);
    expect(await one('SELECT COUNT(*) FROM feedback_requests')).toBe(1);
    expect(await one('SELECT title FROM feedback_requests')).toBe('The harness files a request');
  });
});
