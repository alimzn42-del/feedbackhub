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
 * SELF-VOTING IS THE FIRST REAL REFUSAL
 * -------------------------------------
 * Until slice 2 no endpoint could return 403 at all: every rule a route
 * reached allowed any authenticated user, so these tests could only prove the
 * mechanism by making the policy deny artificially.
 *
 * "You cannot vote on your own request" changed that. It is refused end to end
 * below, with nothing stubbed to make it happen, and the write is asserted not
 * to have occurred.
 *
 * PINNING IS THE FIRST ROLE-BASED REFUSAL
 * ---------------------------------------
 * Self-voting refuses everybody equally. Pinning is the first rule that refuses
 * based on WHO you are, so it is the one that proves the admin boundary end to
 * end — a regular user, a real route, a real 403, nothing stubbed.
 *
 * AND THE LAST TWO ARE WRITTEN
 * ----------------------------
 * Two tests were outstanding from slice 1 to slice 5, named in every handoff:
 * a non-owner refused a request edit, and a regular user refused a status
 * change. Neither could be written, because neither endpoint existed — the
 * rules were unit-tested and nothing called them.
 *
 * Both are below, through the real routes, with the write asserted not to have
 * happened. Every rule in requestPolicy now has an endpoint asking it.
 * ══════════════════════════════════════════════════════════════════════════ */

/* Every repository is replaced. These tests are about the authorization path,
   not about SQL, and they must not need a running database. */
const usersRepository = vi.hoisted(() => ({ findByEmail: vi.fn() }));
const requestsRepository = vi.hoisted(() => ({
  insert: vi.fn(),
  findById: vi.fn(),
  findListItemById: vi.fn(),
  findAuthorId: vi.fn(),
  exists: vi.fn(),
  list: vi.fn(),
  listPinned: vi.fn(),
  count: vi.fn(),
  pin: vi.fn(),
  unpin: vi.fn(),
  updateContent: vi.fn(),
  updateStatus: vi.fn(),
  remove: vi.fn(),
}));
const votesRepository = vi.hoisted(() => ({
  cast: vi.fn(),
  withdraw: vi.fn(),
  readState: vi.fn(),
}));
const categoriesRepository = vi.hoisted(() => ({
  listActive: vi.fn(),
  findActiveId: vi.fn(),
  findIdsBySlugs: vi.fn(),
}));
const statusesRepository = vi.hoisted(() => ({
  findDefaultId: vi.fn(),
  findActiveId: vi.fn(),
  listActive: vi.fn(),
  findIdsBySlugs: vi.fn(),
}));

vi.mock('./modules/users/users.repository.js', () => usersRepository);
vi.mock('./modules/requests/requests.repository.js', () => requestsRepository);
vi.mock('./modules/categories/categories.repository.js', () => categoriesRepository);
vi.mock('./modules/statuses/statuses.repository.js', () => statusesRepository);
vi.mock('./modules/votes/votes.repository.js', () => votesRepository);

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

/** Used by every rule that refuses on WHO you are: pinning, status, deletion. */
const ADMIN: Actor = {
  id: 1,
  externalId: null,
  email: 'admin@feedbackhub.local',
  displayName: 'Robin Alvarez',
  role: 'admin',
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
  statusesRepository.findActiveId.mockResolvedValue(4);
  requestsRepository.updateContent.mockResolvedValue(undefined);
  requestsRepository.updateStatus.mockResolvedValue(undefined);
  requestsRepository.remove.mockResolvedValue(undefined);
  statusesRepository.listActive.mockResolvedValue([{ id: 1, name: 'New', slug: 'new' }]);
  statusesRepository.findIdsBySlugs.mockResolvedValue([]);
  categoriesRepository.findIdsBySlugs.mockResolvedValue([]);
  requestsRepository.findAuthorId.mockResolvedValue(99);
  requestsRepository.exists.mockResolvedValue(true);
  requestsRepository.listPinned.mockResolvedValue({ items: [], total: 0 });
  requestsRepository.pin.mockResolvedValue(undefined);
  requestsRepository.unpin.mockResolvedValue(undefined);
  requestsRepository.findListItemById.mockResolvedValue({
    id: 7,
    title: VALID_BODY.title,
    excerpt: VALID_BODY.description,
    excerptTruncated: false,
    category: { id: 2, name: 'Feature', slug: 'feature' },
    status: { id: 1, name: 'New', slug: 'new' },
    author: { id: 99, displayName: 'Someone Else' },
    isPinned: true,
    pinnedAt: '2026-08-21T09:00:00.000Z',
    pinnedBy: { id: 1, displayName: 'Robin Alvarez' },
    voteCount: 0,
    hasVoted: false,
    createdAt: '2026-08-21T05:00:00.000Z',
    updatedAt: '2026-08-21T05:00:00.000Z',
  });
  votesRepository.cast.mockResolvedValue(true);
  votesRepository.withdraw.mockResolvedValue(true);
  votesRepository.readState.mockResolvedValue({ requestId: 7, voteCount: 1, hasVoted: true });
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

describe('POST /api/requests/:id/vote', () => {
  it('refuses the author voting on their own request, end to end', async () => {
    // The first genuine 403 in this codebase. Nothing is stubbed to produce it:
    // the request really is authored by the caller, and the real policy refuses.
    requestsRepository.findAuthorId.mockResolvedValue(REGULAR_USER.id);

    const response = await request(app).post('/api/requests/7/vote');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(response.body.error.message).toBe('You cannot vote on your own request.');
    // Refused, and nothing was written.
    expect(votesRepository.cast).not.toHaveBeenCalled();
  });

  it('allows voting on a request filed by someone else', async () => {
    requestsRepository.findAuthorId.mockResolvedValue(99);

    const response = await request(app).post('/api/requests/7/vote').expect(201);

    expect(response.body.data).toEqual({ requestId: 7, voteCount: 1, hasVoted: true });
    expect(votesRepository.cast).toHaveBeenCalledWith(7, REGULAR_USER.id);
  });

  it('takes the voter from the identity seam, never from the request', async () => {
    await request(app).post('/api/requests/7/vote').send({ userId: 999 }).expect(201);

    // There is nowhere in the URL or the payload to name a different voter, so
    // "vote for yourself only" cannot be violated rather than merely being
    // checked. The id passed to the repository is the acting user's, always.
    expect(votesRepository.cast).toHaveBeenCalledWith(7, REGULAR_USER.id);
  });

  it('reports a second vote as a conflict rather than a silent success', async () => {
    votesRepository.cast.mockResolvedValue(false);

    const response = await request(app).post('/api/requests/7/vote');

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('404s for a request that does not exist, before deciding anything', async () => {
    requestsRepository.findAuthorId.mockResolvedValue(null);

    const response = await request(app).post('/api/requests/7/vote');

    expect(response.status).toBe(404);
    expect(votesRepository.cast).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric request id', async () => {
    const response = await request(app).post('/api/requests/abc/vote');

    expect(response.status).toBe(422);
    expect(response.body.error.details[0].field).toBe('id');
  });
});

describe('DELETE /api/requests/:id/vote', () => {
  it('withdraws the vote belonging to the caller, returning the new state', async () => {
    votesRepository.readState.mockResolvedValue({ requestId: 7, voteCount: 0, hasVoted: false });

    const response = await request(app).delete('/api/requests/7/vote').expect(200);

    expect(response.body.data).toEqual({ requestId: 7, voteCount: 0, hasVoted: false });
    expect(votesRepository.withdraw).toHaveBeenCalledWith(7, REGULAR_USER.id);
  });

  it('is idempotent when there was no vote to withdraw', async () => {
    // Unlike casting, repeating this changes nothing, so there is no
    // conflicting state to report.
    votesRepository.withdraw.mockResolvedValue(false);
    votesRepository.readState.mockResolvedValue({ requestId: 7, voteCount: 0, hasVoted: false });

    await request(app).delete('/api/requests/7/vote').expect(200);
  });

  it('404s for a request that does not exist', async () => {
    requestsRepository.findAuthorId.mockResolvedValue(null);

    await request(app).delete('/api/requests/7/vote').expect(404);
  });
});

describe('PUT /api/requests/:id/pin — the admin boundary, end to end', () => {
  it('refuses a regular user, with nothing stubbed to make it refuse', async () => {
    // REGULAR_USER has role 'user'. The real policy, the real route, a real 403.
    // This is the test that could not be written until an admin-only endpoint
    // existed: every earlier refusal applied to everybody equally.
    const response = await request(app).put('/api/requests/7/pin');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(response.body.error.message).toBe('Only an admin can pin or unpin a request.');
    expect(requestsRepository.pin).not.toHaveBeenCalled();
  });

  it('refuses a regular user unpinning, too', async () => {
    const response = await request(app).delete('/api/requests/7/pin');

    expect(response.status).toBe(403);
    expect(requestsRepository.unpin).not.toHaveBeenCalled();
  });

  it('refuses before checking whether the request exists', async () => {
    // A refused caller should not be able to probe which ids are real.
    requestsRepository.exists.mockResolvedValue(false);

    const response = await request(app).put('/api/requests/999999/pin');

    expect(response.status).toBe(403);
    expect(response.status).not.toBe(404);
    expect(requestsRepository.exists).not.toHaveBeenCalled();
  });

  it('allows an admin, and records who pinned it', async () => {
    usersRepository.findByEmail.mockResolvedValue(ADMIN);

    const response = await request(app).put('/api/requests/7/pin').expect(200);

    expect(requestsRepository.pin).toHaveBeenCalledWith(7, ADMIN.id);
    expect(response.body.data.isPinned).toBe(true);
    expect(response.body.data.pinnedBy.displayName).toBe('Robin Alvarez');
  });

  it('lets an admin unpin', async () => {
    usersRepository.findByEmail.mockResolvedValue(ADMIN);

    await request(app).delete('/api/requests/7/pin').expect(200);

    expect(requestsRepository.unpin).toHaveBeenCalledWith(7);
  });

  it('404s for an admin pinning something that is not there', async () => {
    usersRepository.findByEmail.mockResolvedValue(ADMIN);
    requestsRepository.exists.mockResolvedValue(false);

    await request(app).put('/api/requests/7/pin').expect(404);

    expect(requestsRepository.pin).not.toHaveBeenCalled();
  });

  it('does not treat re-pinning as a conflict', async () => {
    // Re-pinning refreshes who and when, which is what makes the panel's
    // most-recent-first order mean anything. There is no state to conflict with.
    usersRepository.findByEmail.mockResolvedValue(ADMIN);

    await request(app).put('/api/requests/7/pin').expect(200);
    await request(app).put('/api/requests/7/pin').expect(200);

    expect(requestsRepository.pin).toHaveBeenCalledTimes(2);
  });

  it('tells every user which actions are open to them, per row', async () => {
    requestsRepository.list.mockResolvedValue({
      items: [
        {
          id: 7,
          title: 't',
          excerpt: 'e',
          excerptTruncated: false,
          category: { id: 2, name: 'Feature', slug: 'feature' },
          status: { id: 1, name: 'New', slug: 'new' },
          author: { id: 99, displayName: 'Someone Else' },
          isPinned: false,
          pinnedAt: null,
          pinnedBy: null,
          voteCount: 0,
          hasVoted: false,
          createdAt: '2026-08-21T05:00:00.000Z',
          updatedAt: '2026-08-21T05:00:00.000Z',
        },
      ],
      total: 1,
    });

    const asUser = await request(app).get('/api/requests').expect(200);
    expect(asUser.body.data[0].canPin).toBe(false);
    expect(asUser.body.data[0].canVote).toBe(true);

    usersRepository.findByEmail.mockResolvedValue(ADMIN);
    const asAdmin = await request(app).get('/api/requests').expect(200);
    expect(asAdmin.body.data[0].canPin).toBe(true);
  });
});

describe('GET /api/requests/pinned', () => {
  it('is not paginated, and reports the true total separately', async () => {
    requestsRepository.listPinned.mockResolvedValue({ items: [], total: 0 });

    const response = await request(app).get('/api/requests/pinned').expect(200);

    expect(response.body).toEqual({ data: [], total: 0 });
    expect(response.body.page).toBeUndefined();
  });

  it('is not read as a request id', async () => {
    // '/pinned' is mounted before ':id' routes. If that ever regresses this
    // fails rather than 404ing mysteriously.
    await request(app).get('/api/requests/pinned').expect(200);

    expect(requestsRepository.listPinned).toHaveBeenCalled();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * PATCH /api/requests/:id — the outstanding edit test, finally writable.
 * ══════════════════════════════════════════════════════════════════════════ */

describe('PATCH /api/requests/:id', () => {
  const EDIT = {
    title: 'Dark mode for the whole board',
    description: 'Reading the board in the evening is harsh and a dark theme would help a lot.',
    categoryId: 2,
  };

  it('refuses a non-owner with 403, and writes nothing', async () => {
    // findAuthorId answers 99; the acting user is 2. Nothing is stubbed to make
    // this refusal happen — it is the real rule, through the real route.
    const response = await request(app).patch('/api/requests/7').send(EDIT);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(response.body.error.message).toBe('Only the author can edit this request.');
    expect(requestsRepository.updateContent).not.toHaveBeenCalled();
  });

  it('refuses an ADMIN editing somebody else\'s words', async () => {
    usersRepository.findByEmail.mockResolvedValue(ADMIN);

    const response = await request(app).patch('/api/requests/7').send(EDIT);

    // Moderation is deleting a request or changing its status. It is not
    // rewriting what somebody wrote under their own name, and the admin
    // boundary is deliberately narrower here than it is for deletion.
    expect(response.status).toBe(403);
    expect(requestsRepository.updateContent).not.toHaveBeenCalled();
  });

  it('lets the author edit their own', async () => {
    requestsRepository.findAuthorId.mockResolvedValue(REGULAR_USER.id);

    await request(app).patch('/api/requests/7').send(EDIT).expect(200);

    expect(requestsRepository.updateContent).toHaveBeenCalledWith(7, {
      title: EDIT.title,
      description: EDIT.description,
      categoryId: 2,
    });
  });

  it('checks permission before validating the body', async () => {
    // Three things wrong with this payload. A handler that validated first
    // would answer 422 and enumerate the schema for somebody who may not edit.
    const response = await request(app)
      .patch('/api/requests/7')
      .send({ title: 'x', description: 'short', nonsense: true });

    expect(response.status).toBe(403);
    expect(response.body.error.details).toBeUndefined();
  });

  it('answers 404 for a request that does not exist, before anything else', async () => {
    requestsRepository.findAuthorId.mockResolvedValue(null);

    const response = await request(app).patch('/api/requests/404').send(EDIT);

    expect(response.status).toBe(404);
    expect(requestsRepository.updateContent).not.toHaveBeenCalled();
  });

  it('refuses a status smuggled into the edit payload', async () => {
    requestsRepository.findAuthorId.mockResolvedValue(REGULAR_USER.id);

    const response = await request(app)
      .patch('/api/requests/7')
      .send({ ...EDIT, statusId: 5 });

    // Not the author's to set, and rejected by name rather than dropped.
    expect(response.status).toBe(422);
    expect(response.body.error.details[0].code).toBe('UNKNOWN_FIELD');
    expect(requestsRepository.updateContent).not.toHaveBeenCalled();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * DELETE /api/requests/:id
 * ══════════════════════════════════════════════════════════════════════════ */

describe('DELETE /api/requests/:id', () => {
  it('refuses a non-owner with 403, and deletes nothing', async () => {
    const response = await request(app).delete('/api/requests/7');

    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe(
      'Only the author or an admin can delete this request.',
    );
    expect(requestsRepository.remove).not.toHaveBeenCalled();
  });

  it('lets the author delete their own', async () => {
    requestsRepository.findAuthorId.mockResolvedValue(REGULAR_USER.id);

    await request(app).delete('/api/requests/7').expect(204);

    expect(requestsRepository.remove).toHaveBeenCalledWith(7);
  });

  it('lets an admin delete somebody else\'s, unlike editing it', async () => {
    usersRepository.findByEmail.mockResolvedValue(ADMIN);

    await request(app).delete('/api/requests/7').expect(204);

    // The two rules differ on purpose: an admin moderates by removing, never by
    // rewriting.
    expect(requestsRepository.remove).toHaveBeenCalledWith(7);
  });

  it('answers 404 for a request that does not exist', async () => {
    requestsRepository.findAuthorId.mockResolvedValue(null);

    await request(app).delete('/api/requests/404').expect(404);

    expect(requestsRepository.remove).not.toHaveBeenCalled();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * PUT /api/requests/:id/status — the other outstanding test.
 * ══════════════════════════════════════════════════════════════════════════ */

describe('PUT /api/requests/:id/status', () => {
  it('refuses a regular user with 403, and changes nothing', async () => {
    const response = await request(app).put('/api/requests/7/status').send({ statusId: 4 });

    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe('Only an admin can change a request status.');
    expect(requestsRepository.updateStatus).not.toHaveBeenCalled();
  });

  it('refuses before looking anything up', async () => {
    await request(app).put('/api/requests/7/status').send({ statusId: 4 }).expect(403);

    // The rule depends on the caller alone, so a refused caller learns nothing
    // about the request — not even whether it exists.
    expect(requestsRepository.exists).not.toHaveBeenCalled();
    expect(statusesRepository.findActiveId).not.toHaveBeenCalled();
  });

  it('refuses before validating the body, for the same reason', async () => {
    const response = await request(app).put('/api/requests/7/status').send({ nonsense: true });

    expect(response.status).toBe(403);
    expect(response.body.error.details).toBeUndefined();
  });

  it('lets an admin change it', async () => {
    usersRepository.findByEmail.mockResolvedValue(ADMIN);

    await request(app).put('/api/requests/7/status').send({ statusId: 4 }).expect(200);

    expect(requestsRepository.updateStatus).toHaveBeenCalledWith(7, 4);
  });

  it('refuses a status that is archived or does not exist, next to the field', async () => {
    usersRepository.findByEmail.mockResolvedValue(ADMIN);
    statusesRepository.findActiveId.mockResolvedValue(null);

    const response = await request(app).put('/api/requests/7/status').send({ statusId: 999 });

    expect(response.status).toBe(422);
    expect(response.body.error.details[0]).toMatchObject({
      field: 'statusId',
      code: 'NOT_FOUND',
    });
    expect(requestsRepository.updateStatus).not.toHaveBeenCalled();
  });

  it('answers 404 for a request that does not exist', async () => {
    usersRepository.findByEmail.mockResolvedValue(ADMIN);
    requestsRepository.exists.mockResolvedValue(false);

    await request(app).put('/api/requests/404/status').send({ statusId: 4 }).expect(404);

    expect(requestsRepository.updateStatus).not.toHaveBeenCalled();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * What the browser is told it may do.
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the per-row permission answers', () => {
  it('tells the author what they may do to their own request', async () => {
    const response = await request(app).get('/api/requests/11').expect(200);

    // findById is stubbed with REGULAR_USER as the author.
    expect(response.body.data).toMatchObject({
      canEdit: true,
      canDelete: true,
      canChangeStatus: false,
      canPin: false,
    });
  });

  it('tells an admin they may moderate but not rewrite', async () => {
    usersRepository.findByEmail.mockResolvedValue(ADMIN);

    const response = await request(app).get('/api/requests/11').expect(200);

    expect(response.body.data).toMatchObject({
      canEdit: false,
      canDelete: true,
      canChangeStatus: true,
      canPin: true,
    });
  });

  it('answers with the same rules the endpoints enforce, not a copy of them', async () => {
    // The rule is stubbed at the policy, and the ANSWER in the payload changes
    // with it — which is what proves the row is asking the policy rather than
    // reimplementing it next door.
    vi.spyOn(requestPolicy, 'delete').mockReturnValue(deny('No.'));

    const response = await request(app).get('/api/requests/11').expect(200);

    expect(response.body.data.canDelete).toBe(false);
  });
});
