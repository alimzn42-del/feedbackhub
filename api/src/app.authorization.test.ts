import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from './auth/actor.js';

/* ════════════════════════════════════════════════════════════════════════════
 * Route-level authorization.
 *
 * The policy unit tests in src/policy prove the RULES are written correctly.
 * They cannot prove the HANDLER ASKS. Those are different claims, and the one
 * that ships as a vulnerability is always the second: an endpoint that forgets
 * to check keeps every policy unit test green.
 *
 * These tests travel through the real Express app — the real middleware chain,
 * the real error handler, the real status codes.
 *
 * WHAT SLICE 1 CANNOT COVER YET
 * -----------------------------
 * No endpoint in this slice can return 403. Every rule a route reaches — create
 * a request, list requests, list categories — allows any authenticated user.
 * Edit, delete, change-status and pin have policy rules but no routes yet, so
 * "a non-owner is refused" and "a regular user is refused an admin action"
 * have nothing to travel through.
 *
 * So these tests prove the mechanism instead: the handler consults the policy,
 * and a denial from that policy becomes a 403 in the correct envelope rather
 * than a 404, a 500 or a silent success. When the first denying endpoint lands,
 * asserting the real cases is a few lines using the same harness — and doing it
 * is part of that slice's definition of done, not optional.
 * ══════════════════════════════════════════════════════════════════════════ */

/* Every repository is replaced. These tests are about the authorization path,
   not about SQL, and they must not need a running database. */
const usersRepository = vi.hoisted(() => ({ findByEmail: vi.fn() }));
const requestsRepository = vi.hoisted(() => ({
  insert: vi.fn(),
  findById: vi.fn(),
  list: vi.fn(),
  count: vi.fn(),
}));
const categoriesRepository = vi.hoisted(() => ({
  listActive: vi.fn(),
  findActiveId: vi.fn(),
}));
const statusesRepository = vi.hoisted(() => ({ findDefaultId: vi.fn() }));

vi.mock('./modules/users/users.repository.js', () => usersRepository);
vi.mock('./modules/requests/requests.repository.js', () => requestsRepository);
vi.mock('./modules/categories/categories.repository.js', () => categoriesRepository);
vi.mock('./modules/statuses/statuses.repository.js', () => statusesRepository);

const { createApp } = await import('./app.js');
const { requestPolicy } = await import('./policy/requests.policy.js');
const { categoryPolicy } = await import('./policy/categories.policy.js');
const { deny } = await import('./policy/index.js');

const REGULAR_USER: Actor = {
  id: 2,
  externalId: null,
  email: 'dana@feedbackhub.local',
  displayName: 'Dana Okafor',
  role: 'user',
};

const VALID_BODY = {
  title: 'Dark mode for the board',
  description: 'Reading the board in the evening is harsh and a dark theme would help.',
  categoryId: 2,
};

const app = createApp();

beforeEach(() => {
  usersRepository.findByEmail.mockResolvedValue(REGULAR_USER);
  categoriesRepository.findActiveId.mockResolvedValue(2);
  categoriesRepository.listActive.mockResolvedValue([{ id: 2, name: 'Feature', slug: 'feature' }]);
  statusesRepository.findDefaultId.mockResolvedValue(1);
  requestsRepository.insert.mockResolvedValue(11);
  requestsRepository.list.mockResolvedValue({ items: [], total: 0 });
  requestsRepository.findById.mockResolvedValue({
    id: 11,
    title: VALID_BODY.title,
    description: VALID_BODY.description,
    category: { id: 2, name: 'Feature', slug: 'feature' },
    status: { id: 1, name: 'New', slug: 'new' },
    author: { id: REGULAR_USER.id, displayName: REGULAR_USER.displayName },
    isPinned: false,
    createdAt: '2026-08-21T05:00:00.000Z',
    updatedAt: '2026-08-21T05:00:00.000Z',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('POST /api/requests', () => {
  it('consults the policy, with the acting user, before doing any work', async () => {
    const spy = vi.spyOn(requestPolicy, 'create');

    await request(app).post('/api/requests').send(VALID_BODY).expect(201);

    // Asked twice, deliberately: once at the edge before the body is inspected,
    // once in the service, which is the boundary any future caller crosses.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: REGULAR_USER.id }));
  });

  it('returns 403 when the policy denies, and writes nothing', async () => {
    vi.spyOn(requestPolicy, 'create').mockReturnValue(deny('Only an admin can do that.'));

    const response = await request(app).post('/api/requests').send(VALID_BODY).expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(response.body.error.message).toBe('Only an admin can do that.');
    // The denial has to stop the work, not merely change the status code.
    expect(requestsRepository.insert).not.toHaveBeenCalled();
  });

  it('refuses with 403 and never a disguised 404', async () => {
    vi.spyOn(requestPolicy, 'create').mockReturnValue(deny('Nope.'));

    const response = await request(app).post('/api/requests').send(VALID_BODY);

    // Decision 5: the board is internal and fully visible, so there is nothing
    // to conceal by pretending the resource is not there.
    expect(response.status).toBe(403);
    expect(response.status).not.toBe(404);
    expect(response.body.error.code).not.toBe('NOT_FOUND');
  });

  it('checks permission before validating the body', async () => {
    // Order matters. Validating first tells a caller who may not perform the
    // action which fields exist and what each one must look like.
    //
    // The body below is invalid in three ways, so a handler that validated
    // first would answer 422 and enumerate them. It must answer 403 instead.
    vi.spyOn(requestPolicy, 'create').mockReturnValue(deny('Nope.'));

    const response = await request(app)
      .post('/api/requests')
      .send({ title: 'x', description: 'short', nonsense: true });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(response.body.error.details).toBeUndefined();
  });

  it('takes the author from the identity seam and ignores any author in the payload', async () => {
    await request(app)
      .post('/api/requests')
      .send({ ...VALID_BODY, authorId: 999 })
      .expect(422);

    expect(requestsRepository.insert).not.toHaveBeenCalled();

    await request(app).post('/api/requests').send(VALID_BODY).expect(201);

    expect(requestsRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ authorId: REGULAR_USER.id }),
    );
  });

  it('carries a denial through the real error middleware, in the one envelope', async () => {
    vi.spyOn(requestPolicy, 'create').mockReturnValue(deny('Only the author can do that.'));

    const response = await request(app).post('/api/requests').send(VALID_BODY).expect(403);

    expect(response.body).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Only the author can do that.',
        requestId: expect.any(String),
      },
    });
    expect(response.headers['x-request-id']).toBe(response.body.error.requestId);
  });
});

describe('GET /api/requests', () => {
  it('consults the policy before reading', async () => {
    const spy = vi.spyOn(requestPolicy, 'list');

    await request(app).get('/api/requests').expect(200);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: REGULAR_USER.id }));
  });

  it('returns 403 when the policy denies, and reads nothing', async () => {
    vi.spyOn(requestPolicy, 'list').mockReturnValue(deny('Not for you.'));

    const response = await request(app).get('/api/requests').expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(requestsRepository.list).not.toHaveBeenCalled();
  });
});

describe('GET /api/categories', () => {
  it('consults the policy before reading', async () => {
    const spy = vi.spyOn(categoryPolicy, 'list');

    await request(app).get('/api/categories').expect(200);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: REGULAR_USER.id }));
  });

  it('returns 403 when the policy denies', async () => {
    vi.spyOn(categoryPolicy, 'list').mockReturnValue(deny('Not for you.'));

    await request(app).get('/api/categories').expect(403);

    expect(categoriesRepository.listActive).not.toHaveBeenCalled();
  });
});

describe('every /api route establishes an identity first', () => {
  it('refuses to serve a request whose identity cannot be resolved', async () => {
    // The seam is configured but names a user who does not exist. This is a
    // server misconfiguration, not a caller error, and it must not fall through
    // to a handler with an undefined actor.
    usersRepository.findByEmail.mockResolvedValue(null);

    const response = await request(app).get('/api/requests');

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('SERVER_MISCONFIGURED');
    expect(requestsRepository.list).not.toHaveBeenCalled();
  });

  it('leaves the health probe outside the identity chain', async () => {
    usersRepository.findByEmail.mockResolvedValue(null);

    await request(app).get('/health').expect(200);
  });
});
