import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from './auth/actor.js';
import { mintToken, signedIn, TEST_SUBJECT } from './auth/tokens.test-support.js';

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
const usersRepository = vi.hoisted(() => ({
  findByEmail: vi.fn(),
  findByExternalId: vi.fn(),
  updateEmail: vi.fn(),
  findById: vi.fn(),
  insert: vi.fn(),
  updateDisplayName: vi.fn(),
  countOtherAdmins: vi.fn(),
  anonymise: vi.fn(),
  departedRecently: vi.fn(),
}));
const requestsRepository = vi.hoisted(() => ({
  insert: vi.fn(),
  countRecentByAuthor: vi.fn(),
  insertUnderAuthorLimit: vi.fn(),
  findCategoryId: vi.fn(),
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
/**
 * Settings, stored nowhere.
 *
 * Both tables read back empty, so every setting resolves to the fallback in the
 * registry — which is exactly the state a fresh installation is in. These tests
 * therefore describe what this application does out of the box, and a test that
 * cares about a setting sets it here explicitly.
 */
const settingsRepository = vi.hoisted(() => ({
  readGlobal: vi.fn(),
  readForUser: vi.fn(),
  applyGlobal: vi.fn(),
  applyForUser: vi.fn(),
  clearAllForUser: vi.fn(),
  RESET: Symbol('reset'),
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
vi.mock('./modules/settings/settings.repository.js', () => settingsRepository);

/**
 * The whole of what the test suite fakes about authentication: where the
 * public keys come from.
 *
 * Everything downstream of this runs for real against these tokens — the
 * signature, the issuer, the audience, the expiry, and which key in the set
 * the header's `kid` selects. What is not exercised is the fetch, which is
 * the one part a container would have proved and nothing else would.
 *
 * It is a vi.fn rather than a fixed value so that one test can make the
 * provider unreachable — which is a different outcome from a bad token and has
 * to stay one.
 */
const jwks = vi.hoisted(() => ({ verificationKeys: vi.fn() }));
vi.mock('./auth/jwks.js', () => jwks);

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

beforeEach(async () => {
  // The published key set, exactly as createRemoteJWKSet would have returned it.
  const { testVerificationKeys } = await import('./auth/tokens.test-support.js');
  jwks.verificationKeys.mockReturnValue(testVerificationKeys);

  settingsRepository.readGlobal.mockResolvedValue(new Map());
  settingsRepository.readForUser.mockResolvedValue(new Map());
  requestsRepository.countRecentByAuthor.mockResolvedValue({ filed: 0, oldestInWindow: null });
  usersRepository.findByExternalId.mockResolvedValue(REGULAR_USER);
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
  votesRepository.cast.mockResolvedValue('cast');
  votesRepository.withdraw.mockResolvedValue(true);
  votesRepository.readState.mockResolvedValue({ requestId: 7, voteCount: 1, hasVoted: true });
  requestsRepository.insert.mockResolvedValue(11);
  // The limit is counted inside this write's own transaction now; the guard is
  // run so that a refusal still travels through the real path.
  requestsRepository.insertUnderAuthorLimit.mockImplementation(
    async (
      _input: unknown,
      _windowHours: number,
      guard: (usage: { filed: number; oldestInWindow: Date | null }) => void,
    ) => {
      guard(await requestsRepository.countRecentByAuthor());
      return 11;
    },
  );
  requestsRepository.findCategoryId.mockResolvedValue(2);
  usersRepository.departedRecently.mockResolvedValue(false);
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

    await signedIn(request(app)).post('/api/requests').send(VALID_BODY).expect(201);

    // Asked twice, deliberately: once at the edge before the body is inspected,
    // once in the service, which is the boundary any future caller crosses.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: REGULAR_USER.id }));
  });

  it('returns 403 when the policy denies, and writes nothing', async () => {
    vi.spyOn(requestPolicy, 'create').mockReturnValue(deny('Only an admin can do that.'));

    const response = await signedIn(request(app))
      .post('/api/requests')
      .send(VALID_BODY)
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(response.body.error.message).toBe('Only an admin can do that.');
    // The denial has to stop the work, not merely change the status code.
    expect(requestsRepository.insertUnderAuthorLimit).not.toHaveBeenCalled();
  });

  it('refuses with 403 and never a disguised 404', async () => {
    vi.spyOn(requestPolicy, 'create').mockReturnValue(deny('Nope.'));

    const response = await signedIn(request(app)).post('/api/requests').send(VALID_BODY);

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

    const response = await signedIn(request(app))
      .post('/api/requests')
      .send({ title: 'x', description: 'short', nonsense: true });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(response.body.error.details).toBeUndefined();
  });

  it('takes the author from the identity seam and ignores any author in the payload', async () => {
    await signedIn(request(app))
      .post('/api/requests')
      .send({ ...VALID_BODY, authorId: 999 })
      .expect(422);

    expect(requestsRepository.insertUnderAuthorLimit).not.toHaveBeenCalled();

    await signedIn(request(app)).post('/api/requests').send(VALID_BODY).expect(201);

    expect(requestsRepository.insertUnderAuthorLimit).toHaveBeenCalledWith(
      expect.objectContaining({ authorId: REGULAR_USER.id }),
      expect.any(Number),
      expect.any(Function),
    );
  });

  it('carries a denial through the real error middleware, in the one envelope', async () => {
    vi.spyOn(requestPolicy, 'create').mockReturnValue(deny('Only the author can do that.'));

    const response = await signedIn(request(app))
      .post('/api/requests')
      .send(VALID_BODY)
      .expect(403);

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

    await signedIn(request(app)).get('/api/requests').expect(200);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: REGULAR_USER.id }));
  });

  it('returns 403 when the policy denies, and reads nothing', async () => {
    vi.spyOn(requestPolicy, 'list').mockReturnValue(deny('Not for you.'));

    const response = await signedIn(request(app)).get('/api/requests').expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(requestsRepository.list).not.toHaveBeenCalled();
  });
});

describe('GET /api/categories', () => {
  it('consults the policy before reading', async () => {
    const spy = vi.spyOn(categoryPolicy, 'list');

    await signedIn(request(app)).get('/api/categories').expect(200);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: REGULAR_USER.id }));
  });

  it('returns 403 when the policy denies', async () => {
    vi.spyOn(categoryPolicy, 'list').mockReturnValue(deny('Not for you.'));

    await signedIn(request(app)).get('/api/categories').expect(403);

    expect(categoriesRepository.listActive).not.toHaveBeenCalled();
  });
});

describe('every /api route establishes an identity first', () => {
  /**
   * Somebody the application has never seen is provisioned, not refused.
   *
   * The moment the registration policy is for: a genuine token, and no local
   * row yet. What the provider vouched for is copied in — the subject becomes
   * external_id, and the address and name come from the token rather than being
   * invented.
   */
  it('provisions somebody it has never seen, when registration is open', async () => {
    usersRepository.findByExternalId.mockResolvedValue(null);
    usersRepository.insert.mockResolvedValue({ ...REGULAR_USER, id: 99 });

    await signedIn(request(app)).get('/api/requests').expect(200);

    expect(usersRepository.insert).toHaveBeenCalledWith({
      email: 'dana@feedbackhub.local',
      displayName: 'Dana Okafor',
      externalId: TEST_SUBJECT,
    });
    expect(requestsRepository.list).toHaveBeenCalled();
  });

  /**
   * The request that comes right after somebody deletes their own account.
   *
   * This is the case that shipped without a test, and the absence is why it
   * shipped: the account is anonymised, external_id cleared, so findByExternalId
   * answers null — the same null a stranger gets. Without the deleted-subject
   * check the seam reads that as a first arrival and provisions a fresh account,
   * and the person who just left is signed straight back in as a new id with
   * their own name on it.
   *
   * It must refuse, as 401 so the browser signs out, and it must NOT provision.
   */
  it('refuses a token whose account was just deleted, and provisions nothing', async () => {
    usersRepository.findByExternalId.mockResolvedValue(null);
    usersRepository.departedRecently.mockResolvedValue(true);

    const response = await signedIn(request(app)).get('/api/requests');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    expect(usersRepository.insert).not.toHaveBeenCalled();
  });

  /**
   * The role is not in the token and cannot be put there.
   *
   * Everybody arrives as an ordinary user; the seeded admin is an admin because
   * a row says so. There is no claim a provider could add — and no realm
   * misconfiguration — that promotes anybody, because nothing in this path ever
   * reads one.
   */
  it('never takes a role from the provider', async () => {
    usersRepository.findByExternalId.mockResolvedValue(null);
    usersRepository.insert.mockResolvedValue({ ...REGULAR_USER, id: 99 });

    await signedIn(request(app)).get('/api/requests').expect(200);

    expect(usersRepository.insert).toHaveBeenCalledWith(
      expect.not.objectContaining({ role: expect.anything() }),
    );
  });

  /**
   * An address that moved upstream updates the account it belongs to — and the
   * account is still found by subject, never by address.
   */
  it('copies an email the provider has changed, onto the row the subject names', async () => {
    usersRepository.findByExternalId.mockResolvedValue({
      ...REGULAR_USER,
      email: 'dana.okafor@feedbackhub.local',
    });

    const response = await signedIn(request(app)).get('/api/bootstrap').expect(200);

    expect(usersRepository.updateEmail).toHaveBeenCalledWith(
      REGULAR_USER.id,
      'dana@feedbackhub.local',
    );
    // And the request it arrived on already sees the new one.
    expect(response.body.data.user.email).toBe('dana@feedbackhub.local');
    expect(usersRepository.insert).not.toHaveBeenCalled();
  });

  /**
   * The display name is the person's, not the provider's.
   *
   * It is copied once, when the account is created, and the account screen owns
   * it afterwards. Overwriting it on every request would make that screen a
   * control that appears to work and silently does nothing.
   */
  it('does not overwrite a display name the person has since chosen', async () => {
    usersRepository.findByExternalId.mockResolvedValue({
      ...REGULAR_USER,
      displayName: 'Dana O.',
    });

    const response = await signedIn(request(app)).get('/api/bootstrap').expect(200);

    expect(usersRepository.updateDisplayName).not.toHaveBeenCalled();
    expect(response.body.data.user.displayName).toBe('Dana O.');
  });

  /**
   * And refused when the policy says so, before any handler runs.
   *
   * The check lives in this application and not in the identity provider: a
   * person can authenticate perfectly and still not be admitted here. This is
   * that refusal, on an ordinary route, with the read asserted not to have
   * happened.
   */
  it('refuses somebody the registration policy does not admit', async () => {
    usersRepository.findByExternalId.mockResolvedValue(null);
    settingsRepository.readGlobal.mockResolvedValue(
      new Map<string, unknown>([
        ['registration.policy', 'domains'],
        ['registration.allowedDomains', ['elsewhere.example']],
      ]),
    );

    const response = await signedIn(request(app)).get('/api/requests');

    expect(response.status).toBe(403);
    expect(usersRepository.insert).not.toHaveBeenCalled();
    expect(requestsRepository.list).not.toHaveBeenCalled();
  });

  /**
   * The seam still fails loudly when it is the SERVER that is wrong rather than
   * the caller — the identity mode compiled in is not one this build can serve.
   */
  it('refuses to serve at all when no identity provider is wired up', async () => {
    usersRepository.findByExternalId.mockRejectedValue(
      new (await import('./http/errors.js')).MisconfigurationError('No identity provider.'),
    );

    const response = await signedIn(request(app)).get('/api/requests');

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('SERVER_MISCONFIGURED');
    expect(requestsRepository.list).not.toHaveBeenCalled();
  });

  it('leaves the health probe outside the identity chain', async () => {
    usersRepository.findByExternalId.mockResolvedValue(null);
    usersRepository.insert.mockResolvedValue(REGULAR_USER);

    await signedIn(request(app)).get('/health').expect(200);
  });

  /**
   * The browser has to be able to ask where to sign in before it is able to
   * sign in, so this one route sits in front of the identity middleware. It is
   * the only one that does, and it is asserted here so that it stays that way.
   */
  /**
   * The payload is exactly what a public OIDC client legitimately publishes,
   * and `toEqual` rather than `toMatchObject` is the point: this fails if a
   * field is ever ADDED.
   *
   * Nothing about the verification path belongs here. Not the audience — which
   * is what this API insists a token was minted for, and is a fact about the
   * server rather than an instruction to the browser. Not the key set, not the
   * clock tolerance, not the identity mode's internals. An unauthenticated
   * caller learns where to go and who to say they are, and nothing about how
   * they will be checked when they come back.
   */
  it('publishes only what a public client is entitled to know', async () => {
    const config = await request(app).get('/api/auth/config').expect(200);

    expect(config.body.data).toEqual({
      mode: 'keycloak',
      issuer: 'http://localhost:8080/realms/feedbackhub',
      clientId: 'feedbackhub-web',
    });

    // Named individually, because "no extra fields" is the assertion above and
    // this is the reason for it.
    const serialised = JSON.stringify(config.body);
    expect(serialised).not.toContain('feedbackhub-api'); // the audience
    expect(serialised).not.toContain('certs');
    expect(serialised).not.toContain('CLOCK');
  });

  /**
   * ONE unauthenticated route under /api, and this fails if a second appears.
   *
   * The behavioural half — bootstrap and requests answering 401 — cannot catch
   * a NEW route being mounted in front of the identity middleware, because a
   * test only knows about the paths it names. So this asserts the structure
   * instead: exactly one router is mounted before attachCurrentUser, and it is
   * the auth one.
   *
   * Adding `app.use('/api/anything', router)` above that line makes the count
   * two and fails here, which is the whole point of the test.
   */
  it('mounts exactly one router in front of the identity middleware', async () => {
    // Express's own layer stack. Route handlers registered with app.get are
    // named 'handle'; mounted routers are named 'router'.
    const stack = (app as unknown as { router: { stack: { name: string }[] } }).router.stack;
    const identityAt = stack.findIndex((layer) => layer.name === 'attachCurrentUser');

    expect(identityAt).toBeGreaterThan(-1);

    const routersBefore = stack.slice(0, identityAt).filter((layer) => layer.name === 'router');

    expect(routersBefore).toHaveLength(1);

    // And that one is reachable without a token, while everything mounted
    // after the middleware is not.
    await request(app).get('/api/auth/config').expect(200);
    await request(app).get('/api/bootstrap').expect(401);
    await request(app).get('/api/requests').expect(401);
    await request(app).get('/api/settings').expect(401);
    await request(app).get('/api/categories').expect(401);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 *                       WHAT A TOKEN HAS TO SURVIVE
 *
 * These are the tests the whole approach to the suite was chosen for. No
 * Keycloak is running. The tokens below are minted by the test process against
 * a key it generated, and everything the application does with them after that
 * is the real implementation: the signature is genuinely checked against the
 * published set, the `kid` genuinely has to match, and `iss`, `aud` and `exp`
 * are genuinely compared.
 *
 * A suite that stubbed verification would pass all of these while proving none
 * of them.
 * ══════════════════════════════════════════════════════════════════════════ */
describe('token verification', () => {
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('refuses a request with no token', async () => {
    const response = await request(app).get('/api/requests');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
    expect(requestsRepository.list).not.toHaveBeenCalled();
  });

  it('refuses an Authorization header that is not a bearer credential', async () => {
    const response = await request(app)
      .get('/api/requests')
      .set('Authorization', 'Basic ZGFuYTpodW50ZXIy');

    expect(response.status).toBe(401);
    expect(requestsRepository.list).not.toHaveBeenCalled();
  });

  it('refuses an expired token', async () => {
    const expired = await mintToken({ expiresInSeconds: -60 });

    const response = await request(app).get('/api/requests').set(bearer(expired));

    expect(response.status).toBe(401);
    expect(requestsRepository.list).not.toHaveBeenCalled();
  });

  it('refuses a malformed token', async () => {
    const response = await request(app).get('/api/requests').set(bearer('not.a.token'));

    expect(response.status).toBe(401);
    expect(requestsRepository.list).not.toHaveBeenCalled();
  });

  /**
   * The check that is easiest to leave out and most worth having. This token is
   * perfectly signed by the realm this API trusts — it was simply minted for a
   * different client. Without the audience check, every other client of the
   * same realm would be a way in here.
   */
  it('refuses a well-formed token issued for a different client', async () => {
    const elsewhere = await mintToken({ audience: 'some-other-client' });

    const response = await request(app).get('/api/requests').set(bearer(elsewhere));

    expect(response.status).toBe(401);
    expect(requestsRepository.list).not.toHaveBeenCalled();
  });

  it('refuses a token from a realm this API does not accept', async () => {
    const foreignRealm = await mintToken({ issuer: 'http://localhost:8080/realms/somewhere-else' });

    const response = await request(app).get('/api/requests').set(bearer(foreignRealm));

    expect(response.status).toBe(401);
  });

  it('refuses a token signed with a key the provider never published', async () => {
    const forged = await mintToken({ signedByAStranger: true });

    const response = await request(app).get('/api/requests').set(bearer(forged));

    expect(response.status).toBe(401);
  });

  it('refuses a token naming a key the published set does not contain', async () => {
    const wrongKey = await mintToken({ unknownKeyId: true });

    const response = await request(app).get('/api/requests').set(bearer(wrongKey));

    expect(response.status).toBe(401);
  });

  /**
   * Verifying and being admitted are different, and this is the seam between
   * them: the token is genuine and the account is still refused, by name.
   */
  it('refuses a valid token for somebody the registration policy excludes', async () => {
    usersRepository.findByExternalId.mockResolvedValue(null);
    settingsRepository.readGlobal.mockResolvedValue(
      new Map<string, unknown>([
        ['registration.policy', 'domains'],
        ['registration.allowedDomains', ['elsewhere.example']],
      ]),
    );

    const response = await signedIn(request(app)).get('/api/requests');

    expect(response.status).toBe(403);
    expect(response.body.error.message).toMatch(/not open for registration/i);
    // Refused by naming the rule, never the admitted domains: that would answer
    // a question about the installation for somebody who was not let in.
    expect(response.body.error.message).not.toMatch(/elsewhere\.example/);
    expect(usersRepository.insert).not.toHaveBeenCalled();
  });

  /**
   * An unverified address is never given an account.
   *
   * Without this, an installation restricted to a domain could be entered by
   * registering somebody else's address at a provider that does not check it.
   * The realm is configured to link only on a verified email; this is the same
   * rule asserted a second time, where it does not depend on the provider being
   * configured correctly.
   */
  it('refuses to provision an address the provider has not verified', async () => {
    usersRepository.findByExternalId.mockResolvedValue(null);
    const unverified = await mintToken({ emailVerified: false });

    const response = await request(app).get('/api/requests').set(bearer(unverified));

    expect(response.status).toBe(401);
    expect(usersRepository.insert).not.toHaveBeenCalled();
  });

  it('does not let an unverified address overwrite a verified one', async () => {
    usersRepository.findByExternalId.mockResolvedValue({
      ...REGULAR_USER,
      email: 'dana@feedbackhub.local',
    });
    const claimingAnotherAddress = await mintToken({
      email: 'admin@feedbackhub.local',
      emailVerified: false,
    });

    await request(app).get('/api/bootstrap').set(bearer(claimingAnotherAddress)).expect(200);

    expect(usersRepository.updateEmail).not.toHaveBeenCalled();
  });

  /**
   * The provider being down is not the caller's session ending.
   *
   * A 401 here would tell every client in the building that it had been signed
   * out — and this application's own interceptor would act on it — turning a
   * Keycloak restart into a mass sign-out that outlasts the restart. The token
   * may well be perfectly good; we simply cannot check it.
   */
  it('answers 503, not 401, when the key set cannot be reached', async () => {
    jwks.verificationKeys.mockImplementation(() => {
      throw new TypeError('fetch failed');
    });

    const response = await signedIn(request(app)).get('/api/requests');

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(requestsRepository.list).not.toHaveBeenCalled();
  });

  it('refuses a token that verifies but identifies nobody', async () => {
    const anonymous = await mintToken({ email: '' });

    const response = await request(app).get('/api/requests').set(bearer(anonymous));

    expect(response.status).toBe(401);
  });

  /**
   * Four refusals that are one status code and four different problems.
   *
   * A missing token is a client that never signed in; an expired one is an
   * ordinary session ending; a malformed one is somebody probing; a wrong
   * audience is a client pointed at the wrong realm. An operator who cannot
   * tell them apart is reading a log that says 401 and nothing else — so the
   * reason goes to the log, and never into the response body, where it would
   * describe the installation to somebody who has not been let into it.
   */
  it('distinguishes why it refused, in the log and not on the wire', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await request(app).get('/api/requests');
    await request(app).get('/api/requests').set(bearer('not.a.token'));
    await request(app)
      .get('/api/requests')
      .set(bearer(await mintToken({ expiresInSeconds: -60 })));
    const audience = await request(app)
      .get('/api/requests')
      .set(bearer(await mintToken({ audience: 'some-other-client' })));

    const logged = warn.mock.calls.map(([line]) => String(line));

    expect(logged.some((line) => line.includes('token.missing'))).toBe(true);
    expect(logged.some((line) => line.includes('token.malformed'))).toBe(true);
    expect(logged.some((line) => line.includes('token.expired'))).toBe(true);
    expect(logged.some((line) => line.includes('token.audience'))).toBe(true);

    // Every line carries the request id, which is what joins it to the caller's
    // copy of the same refusal.
    expect(logged.every((line) => /^\[[^\]]+\] 401 /.test(line))).toBe(true);

    // And none of it reached the caller.
    expect(JSON.stringify(audience.body)).not.toMatch(/token\./);
  });
});

describe('POST /api/requests/:id/vote', () => {
  it('refuses the author voting on their own request, end to end', async () => {
    // The first genuine 403 in this codebase. Nothing is stubbed to produce it:
    // the request really is authored by the caller, and the real policy refuses.
    requestsRepository.findAuthorId.mockResolvedValue(REGULAR_USER.id);

    const response = await signedIn(request(app)).post('/api/requests/7/vote');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(response.body.error.message).toBe('You cannot vote on your own request.');
    // Refused, and nothing was written.
    expect(votesRepository.cast).not.toHaveBeenCalled();
  });

  it('allows voting on a request filed by someone else', async () => {
    requestsRepository.findAuthorId.mockResolvedValue(99);

    const response = await signedIn(request(app)).post('/api/requests/7/vote').expect(201);

    expect(response.body.data).toEqual({ requestId: 7, voteCount: 1, hasVoted: true });
    expect(votesRepository.cast).toHaveBeenCalledWith(7, REGULAR_USER.id);
  });

  it('takes the voter from the identity seam, never from the request', async () => {
    await signedIn(request(app)).post('/api/requests/7/vote').send({ userId: 999 }).expect(201);

    // There is nowhere in the URL or the payload to name a different voter, so
    // "vote for yourself only" cannot be violated rather than merely being
    // checked. The id passed to the repository is the acting user's, always.
    expect(votesRepository.cast).toHaveBeenCalledWith(7, REGULAR_USER.id);
  });

  it('reports a second vote as a conflict rather than a silent success', async () => {
    votesRepository.cast.mockResolvedValue('already-voted');

    const response = await signedIn(request(app)).post('/api/requests/7/vote');

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('404s for a request that does not exist, before deciding anything', async () => {
    requestsRepository.findAuthorId.mockResolvedValue(null);

    const response = await signedIn(request(app)).post('/api/requests/7/vote');

    expect(response.status).toBe(404);
    expect(votesRepository.cast).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric request id', async () => {
    const response = await signedIn(request(app)).post('/api/requests/abc/vote');

    expect(response.status).toBe(422);
    expect(response.body.error.details[0].field).toBe('id');
  });
});

describe('DELETE /api/requests/:id/vote', () => {
  it('withdraws the vote belonging to the caller, returning the new state', async () => {
    votesRepository.readState.mockResolvedValue({ requestId: 7, voteCount: 0, hasVoted: false });

    const response = await signedIn(request(app)).delete('/api/requests/7/vote').expect(200);

    expect(response.body.data).toEqual({ requestId: 7, voteCount: 0, hasVoted: false });
    expect(votesRepository.withdraw).toHaveBeenCalledWith(7, REGULAR_USER.id);
  });

  it('is idempotent when there was no vote to withdraw', async () => {
    // Unlike casting, repeating this changes nothing, so there is no
    // conflicting state to report.
    votesRepository.withdraw.mockResolvedValue(false);
    votesRepository.readState.mockResolvedValue({ requestId: 7, voteCount: 0, hasVoted: false });

    await signedIn(request(app)).delete('/api/requests/7/vote').expect(200);
  });

  it('404s for a request that does not exist', async () => {
    requestsRepository.findAuthorId.mockResolvedValue(null);

    await signedIn(request(app)).delete('/api/requests/7/vote').expect(404);
  });
});

describe('PUT /api/requests/:id/pin — the admin boundary, end to end', () => {
  it('refuses a regular user, with nothing stubbed to make it refuse', async () => {
    // REGULAR_USER has role 'user'. The real policy, the real route, a real 403.
    // This is the test that could not be written until an admin-only endpoint
    // existed: every earlier refusal applied to everybody equally.
    const response = await signedIn(request(app)).put('/api/requests/7/pin');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(response.body.error.message).toBe('Only an admin can pin or unpin a request.');
    expect(requestsRepository.pin).not.toHaveBeenCalled();
  });

  it('refuses a regular user unpinning, too', async () => {
    const response = await signedIn(request(app)).delete('/api/requests/7/pin');

    expect(response.status).toBe(403);
    expect(requestsRepository.unpin).not.toHaveBeenCalled();
  });

  it('refuses before checking whether the request exists', async () => {
    // A refused caller should not be able to probe which ids are real.
    requestsRepository.exists.mockResolvedValue(false);

    const response = await signedIn(request(app)).put('/api/requests/999999/pin');

    expect(response.status).toBe(403);
    expect(response.status).not.toBe(404);
    expect(requestsRepository.exists).not.toHaveBeenCalled();
  });

  it('allows an admin, and records who pinned it', async () => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);

    const response = await signedIn(request(app)).put('/api/requests/7/pin').expect(200);

    expect(requestsRepository.pin).toHaveBeenCalledWith(7, ADMIN.id);
    expect(response.body.data.isPinned).toBe(true);
    expect(response.body.data.pinnedBy.displayName).toBe('Robin Alvarez');
  });

  it('lets an admin unpin', async () => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);

    await signedIn(request(app)).delete('/api/requests/7/pin').expect(200);

    expect(requestsRepository.unpin).toHaveBeenCalledWith(7);
  });

  it('404s for an admin pinning something that is not there', async () => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);
    requestsRepository.exists.mockResolvedValue(false);

    await signedIn(request(app)).put('/api/requests/7/pin').expect(404);

    expect(requestsRepository.pin).not.toHaveBeenCalled();
  });

  it('does not treat re-pinning as a conflict', async () => {
    // Re-pinning refreshes who and when, which is what makes the panel's
    // most-recent-first order mean anything. There is no state to conflict with.
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);

    await signedIn(request(app)).put('/api/requests/7/pin').expect(200);
    await signedIn(request(app)).put('/api/requests/7/pin').expect(200);

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

    const asUser = await signedIn(request(app)).get('/api/requests').expect(200);
    expect(asUser.body.data[0].canPin).toBe(false);
    expect(asUser.body.data[0].canVote).toBe(true);

    usersRepository.findByExternalId.mockResolvedValue(ADMIN);
    const asAdmin = await signedIn(request(app)).get('/api/requests').expect(200);
    expect(asAdmin.body.data[0].canPin).toBe(true);
  });
});

describe('GET /api/requests/pinned', () => {
  it('is not paginated, and reports the true total separately', async () => {
    requestsRepository.listPinned.mockResolvedValue({ items: [], total: 0 });

    const response = await signedIn(request(app)).get('/api/requests/pinned').expect(200);

    expect(response.body).toEqual({ data: [], total: 0 });
    expect(response.body.page).toBeUndefined();
  });

  it('is not read as a request id', async () => {
    // '/pinned' is mounted before ':id' routes. If that ever regresses this
    // fails rather than 404ing mysteriously.
    await signedIn(request(app)).get('/api/requests/pinned').expect(200);

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
    const response = await signedIn(request(app)).patch('/api/requests/7').send(EDIT);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(response.body.error.message).toBe('Only the author can edit this request.');
    expect(requestsRepository.updateContent).not.toHaveBeenCalled();
  });

  it("refuses an ADMIN editing somebody else's words", async () => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);

    const response = await signedIn(request(app)).patch('/api/requests/7').send(EDIT);

    // Moderation is deleting a request or changing its status. It is not
    // rewriting what somebody wrote under their own name, and the admin
    // boundary is deliberately narrower here than it is for deletion.
    expect(response.status).toBe(403);
    expect(requestsRepository.updateContent).not.toHaveBeenCalled();
  });

  it('lets the author edit their own', async () => {
    requestsRepository.findAuthorId.mockResolvedValue(REGULAR_USER.id);

    await signedIn(request(app)).patch('/api/requests/7').send(EDIT).expect(200);

    expect(requestsRepository.updateContent).toHaveBeenCalledWith(7, {
      title: EDIT.title,
      description: EDIT.description,
      categoryId: 2,
    });
  });

  it('checks permission before validating the body', async () => {
    // Three things wrong with this payload. A handler that validated first
    // would answer 422 and enumerate the schema for somebody who may not edit.
    const response = await signedIn(request(app))
      .patch('/api/requests/7')
      .send({ title: 'x', description: 'short', nonsense: true });

    expect(response.status).toBe(403);
    expect(response.body.error.details).toBeUndefined();
  });

  it('answers 404 for a request that does not exist, before anything else', async () => {
    requestsRepository.findAuthorId.mockResolvedValue(null);

    const response = await signedIn(request(app)).patch('/api/requests/404').send(EDIT);

    expect(response.status).toBe(404);
    expect(requestsRepository.updateContent).not.toHaveBeenCalled();
  });

  it('refuses a status smuggled into the edit payload', async () => {
    requestsRepository.findAuthorId.mockResolvedValue(REGULAR_USER.id);

    const response = await signedIn(request(app))
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
    const response = await signedIn(request(app)).delete('/api/requests/7');

    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe(
      'Only the author or an admin can delete this request.',
    );
    expect(requestsRepository.remove).not.toHaveBeenCalled();
  });

  it('lets the author delete their own', async () => {
    requestsRepository.findAuthorId.mockResolvedValue(REGULAR_USER.id);

    await signedIn(request(app)).delete('/api/requests/7').expect(204);

    expect(requestsRepository.remove).toHaveBeenCalledWith(7);
  });

  it("lets an admin delete somebody else's, unlike editing it", async () => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);

    await signedIn(request(app)).delete('/api/requests/7').expect(204);

    // The two rules differ on purpose: an admin moderates by removing, never by
    // rewriting.
    expect(requestsRepository.remove).toHaveBeenCalledWith(7);
  });

  it('answers 404 for a request that does not exist', async () => {
    requestsRepository.findAuthorId.mockResolvedValue(null);

    await signedIn(request(app)).delete('/api/requests/404').expect(404);

    expect(requestsRepository.remove).not.toHaveBeenCalled();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * PUT /api/requests/:id/status — the other outstanding test.
 * ══════════════════════════════════════════════════════════════════════════ */

describe('PUT /api/requests/:id/status', () => {
  it('refuses a regular user with 403, and changes nothing', async () => {
    const response = await signedIn(request(app))
      .put('/api/requests/7/status')
      .send({ statusId: 4 });

    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe('Only an admin can change a request status.');
    expect(requestsRepository.updateStatus).not.toHaveBeenCalled();
  });

  it('refuses before looking anything up', async () => {
    await signedIn(request(app)).put('/api/requests/7/status').send({ statusId: 4 }).expect(403);

    // The rule depends on the caller alone, so a refused caller learns nothing
    // about the request — not even whether it exists.
    expect(requestsRepository.exists).not.toHaveBeenCalled();
    expect(statusesRepository.findActiveId).not.toHaveBeenCalled();
  });

  it('refuses before validating the body, for the same reason', async () => {
    const response = await signedIn(request(app))
      .put('/api/requests/7/status')
      .send({ nonsense: true });

    expect(response.status).toBe(403);
    expect(response.body.error.details).toBeUndefined();
  });

  it('lets an admin change it', async () => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);

    await signedIn(request(app)).put('/api/requests/7/status').send({ statusId: 4 }).expect(200);

    expect(requestsRepository.updateStatus).toHaveBeenCalledWith(7, 4);
  });

  it('refuses a status that is archived or does not exist, next to the field', async () => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);
    statusesRepository.findActiveId.mockResolvedValue(null);

    const response = await signedIn(request(app))
      .put('/api/requests/7/status')
      .send({ statusId: 999 });

    expect(response.status).toBe(422);
    expect(response.body.error.details[0]).toMatchObject({
      field: 'statusId',
      code: 'NOT_FOUND',
    });
    expect(requestsRepository.updateStatus).not.toHaveBeenCalled();
  });

  it('answers 404 for a request that does not exist', async () => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);
    requestsRepository.exists.mockResolvedValue(false);

    await signedIn(request(app)).put('/api/requests/404/status').send({ statusId: 4 }).expect(404);

    expect(requestsRepository.updateStatus).not.toHaveBeenCalled();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * What the browser is told it may do.
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the per-row permission answers', () => {
  it('tells the author what they may do to their own request', async () => {
    const response = await signedIn(request(app)).get('/api/requests/11').expect(200);

    // findById is stubbed with REGULAR_USER as the author.
    expect(response.body.data).toMatchObject({
      canEdit: true,
      canDelete: true,
      canChangeStatus: false,
      canPin: false,
    });
  });

  it('tells an admin they may moderate but not rewrite', async () => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);

    const response = await signedIn(request(app)).get('/api/requests/11').expect(200);

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

    const response = await signedIn(request(app)).get('/api/requests/11').expect(200);

    expect(response.body.data.canDelete).toBe(false);
  });
});
