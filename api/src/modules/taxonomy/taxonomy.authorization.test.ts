import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../auth/actor.js';
import { bearerFor, signedIn } from '../../auth/tokens.test-support.js';

/* ════════════════════════════════════════════════════════════════════════════
 * Managing the taxonomy: who may, and what happens when they may not.
 *
 * The screen being hidden from a regular user is a courtesy. These tests go
 * through the real routes and prove the refusal, and every one of them asserts
 * that the write did not happen — a 403 that still wrote is the failure that
 * looks like a pass.
 *
 * There is one test per mutation rather than a loop over them, because a loop
 * that silently covers four endpoints and misses the fifth reads exactly like
 * one that covers all five.
 * ══════════════════════════════════════════════════════════════════════════ */

const usersRepository = vi.hoisted(() => ({
  findByEmail: vi.fn(),
  findByExternalId: vi.fn(),
  updateEmail: vi.fn(),
}));

const categoriesRepository = vi.hoisted(() => ({
  listActive: vi.fn(),
  listAll: vi.fn(),
  findActiveId: vi.fn(),
  findIdsBySlugs: vi.fn(),
  findById: vi.fn(),
  insert: vi.fn(),
  rename: vi.fn(),
  setOrder: vi.fn(),
  allIds: vi.fn(),
  archive: vi.fn(),
  restore: vi.fn(),
}));

const statusesRepository = vi.hoisted(() => ({
  listActive: vi.fn(),
  listAll: vi.fn(),
  findDefaultId: vi.fn(),
  findActiveId: vi.fn(),
  findIdsBySlugs: vi.fn(),
  findById: vi.fn(),
  countAll: vi.fn(),
  insert: vi.fn(),
  rename: vi.fn(),
  setOrder: vi.fn(),
  allIds: vi.fn(),
  setDefault: vi.fn(),
}));

/**
 * Settings, stored nowhere: both tables read back empty, so everything resolves
 * to the fallback in the registry — the state a fresh installation is in.
 */
/**
 * The requests repository imports VISIBLE_COMMENT from here, so a mock of this
 * module has to carry it: a SQL fragment, not a function, and the queries it is
 * interpolated into are never run in these tests.
 */
const commentsRepository = vi.hoisted(() => ({
  countPending: vi.fn(),
  VISIBLE_COMMENT: 'c.deleted_at IS NULL',
  APPROVED_FOR_VIEWER: '(1 = 1)',
}));

const settingsRepository = vi.hoisted(() => ({
  readGlobal: vi.fn(),
  readForUser: vi.fn(),
  applyGlobal: vi.fn(),
  applyForUser: vi.fn(),
  clearAllForUser: vi.fn(),
  RESET: Symbol('reset'),
}));

vi.mock('../users/users.repository.js', () => usersRepository);
vi.mock('../settings/settings.repository.js', () => settingsRepository);
vi.mock('../comments/comments.repository.js', () => commentsRepository);
vi.mock('../categories/categories.repository.js', () => categoriesRepository);
vi.mock('../statuses/statuses.repository.js', () => statusesRepository);

/**
 * The whole of what the test suite fakes about authentication: where the
 * public keys come from.
 *
 * Everything downstream of this runs for real against these tokens — the
 * signature, the issuer, the audience, the expiry, and which key in the set
 * the header's `kid` selects. What is not exercised is the fetch, which is
 * the one part a container would have proved and nothing else would.
 */
vi.mock('../../auth/jwks.js', async () => {
  const { testVerificationKeys } = await import('../../auth/tokens.test-support.js');
  return { verificationKeys: () => testVerificationKeys };
});

const { createApp } = await import('../../app.js');

const REGULAR_USER: Actor = {
  id: 2,
  externalId: null,
  email: 'dana@feedbackhub.local',
  displayName: 'Dana Okafor',
  role: 'user',
};

const ADMIN: Actor = {
  id: 1,
  externalId: null,
  email: 'admin@feedbackhub.local',
  displayName: 'Robin Alvarez',
  role: 'admin',
};

const CATEGORY_ROWS = [
  { id: 2, name: 'Feature', slug: 'feature', sortOrder: 0, archivedAt: null, requestCount: 4 },
  { id: 4, name: 'Bug', slug: 'bug', sortOrder: 1, archivedAt: null, requestCount: 0 },
];

const STATUS_ROWS = [
  { id: 1, name: 'New', slug: 'new', sortOrder: 0, isDefault: true, requestCount: 6 },
  { id: 5, name: 'Done', slug: 'done', sortOrder: 1, isDefault: false, requestCount: 2 },
];

const app = createApp();

beforeEach(() => {
  settingsRepository.readGlobal.mockResolvedValue(new Map());
  commentsRepository.countPending.mockResolvedValue(3);
  settingsRepository.readForUser.mockResolvedValue(new Map());
  usersRepository.findByExternalId.mockResolvedValue(REGULAR_USER);

  categoriesRepository.listAll.mockResolvedValue(CATEGORY_ROWS);
  categoriesRepository.listActive.mockResolvedValue([{ id: 2, name: 'Feature', slug: 'feature' }]);
  categoriesRepository.findById.mockResolvedValue({ id: 2, name: 'Feature', slug: 'feature' });
  categoriesRepository.allIds.mockResolvedValue([2, 4]);
  categoriesRepository.insert.mockResolvedValue(2);

  statusesRepository.listAll.mockResolvedValue(STATUS_ROWS);
  statusesRepository.listActive.mockResolvedValue([{ id: 1, name: 'New', slug: 'new' }]);
  statusesRepository.findById.mockResolvedValue({ id: 1, name: 'New', slug: 'new' });
  statusesRepository.allIds.mockResolvedValue([1, 5]);
  statusesRepository.countAll.mockResolvedValue(2);
  statusesRepository.insert.mockResolvedValue(1);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

/** Nothing in either taxonomy was written. */
function nothingWritten(): void {
  for (const repository of [categoriesRepository, statusesRepository]) {
    expect(repository.insert).not.toHaveBeenCalled();
    expect(repository.rename).not.toHaveBeenCalled();
    expect(repository.setOrder).not.toHaveBeenCalled();
  }
  expect(categoriesRepository.archive).not.toHaveBeenCalled();
  expect(categoriesRepository.restore).not.toHaveBeenCalled();
  expect(statusesRepository.setDefault).not.toHaveBeenCalled();
}

describe('a regular user, refused at every category mutation', () => {
  it('cannot create one', async () => {
    const response = await signedIn(request(app))
      .post('/api/categories')
      .send({ name: 'Documentation', slug: 'documentation' });

    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe('Only an admin can manage categories.');
    nothingWritten();
  });

  it('cannot rename one', async () => {
    const response = await signedIn(request(app))
      .patch('/api/categories/2')
      .send({ name: 'Features' });

    expect(response.status).toBe(403);
    nothingWritten();
  });

  it('cannot reorder them', async () => {
    const response = await signedIn(request(app))
      .put('/api/categories/order')
      .send({ ids: [4, 2] });

    expect(response.status).toBe(403);
    nothingWritten();
  });

  it('cannot retire one', async () => {
    const response = await signedIn(request(app)).put('/api/categories/2/archive');

    expect(response.status).toBe(403);
    nothingWritten();
  });

  it('cannot restore one', async () => {
    const response = await signedIn(request(app)).delete('/api/categories/2/archive');

    expect(response.status).toBe(403);
    nothingWritten();
  });

  it('cannot read the managed listing, with its counts', async () => {
    const response = await signedIn(request(app)).get('/api/categories?scope=all');

    expect(response.status).toBe(403);
    expect(categoriesRepository.listAll).not.toHaveBeenCalled();
  });

  it('can still read the plain listing, which every form needs', async () => {
    const response = await signedIn(request(app)).get('/api/categories').expect(200);

    // Refusing this would break filing a request for everybody.
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].requestCount).toBeUndefined();
  });

  it('is refused before the body is validated', async () => {
    // Nonsense in three ways. A handler that validated first would answer 422
    // and describe the payload to somebody who may not send one.
    const response = await signedIn(request(app))
      .post('/api/categories')
      .send({ name: '', slug: 'Not A Slug', nonsense: true });

    expect(response.status).toBe(403);
    expect(response.body.error.details).toBeUndefined();
  });
});

describe('a regular user, refused at every status mutation', () => {
  it('cannot create one', async () => {
    const response = await signedIn(request(app))
      .post('/api/statuses')
      .send({ name: 'Blocked', slug: 'blocked' });

    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe('Only an admin can manage statuses.');
    nothingWritten();
  });

  it('cannot rename one', async () => {
    const response = await signedIn(request(app)).patch('/api/statuses/1').send({ name: 'Triage' });

    expect(response.status).toBe(403);
    nothingWritten();
  });

  it('cannot reorder them', async () => {
    const response = await signedIn(request(app))
      .put('/api/statuses/order')
      .send({ ids: [5, 1] });

    expect(response.status).toBe(403);
    nothingWritten();
  });

  it('cannot move the default', async () => {
    const response = await signedIn(request(app)).put('/api/statuses/5/default');

    expect(response.status).toBe(403);
    nothingWritten();
  });

  it('cannot read the managed listing', async () => {
    const response = await signedIn(request(app)).get('/api/statuses?scope=all');

    expect(response.status).toBe(403);
    expect(statusesRepository.listAll).not.toHaveBeenCalled();
  });
});

describe('what the interface is told it may do', () => {
  it('tells a regular user it may manage nothing', async () => {
    const response = await signedIn(request(app)).get('/api/bootstrap').expect(200);

    expect(response.body.data.capabilities).toEqual({
      canManageCategories: false,
      canManageStatuses: false,
      canManageSettings: false,
    });
  });

  it('tells an admin it may manage all three', async () => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);

    const response = await signedIn(request(app)).get('/api/bootstrap').expect(200);

    expect(response.body.data.capabilities).toEqual({
      canManageCategories: true,
      canManageStatuses: true,
      canManageSettings: true,
    });
  });

  /**
   * The rule, restated where this slice changed it.
   *
   * Until now the browser was told nothing about itself at all. It is now told
   * WHO it is — id, name, email — because it edits those on the settings screen
   * and writes them back to an address that names the account.
   *
   * What has not changed is the half that mattered: it is never told WHAT it
   * is. There is no role in this payload, and every permission still arrives as
   * an answer the server worked out. A client cannot derive a single one of
   * them from what it is given here, which is the property the rule was
   * protecting.
   */
  it('says who the caller is, and never what they are', async () => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);

    // One of the few places the token has to describe the same person the
    // repository returns: this asserts the caller's own address, and a token
    // naming somebody else would be reconciled onto the row before the payload
    // was built — which is correct behaviour and a different test.
    const response = await signedIn(request(app), await bearerFor(ADMIN))
      .get('/api/bootstrap')
      .expect(200);

    expect(response.body.data.user).toEqual({
      id: ADMIN.id,
      email: ADMIN.email,
      displayName: ADMIN.displayName,
    });

    expect(JSON.stringify(response.body)).not.toContain('"role"');
  });

  /**
   * The administrative settings are withheld, not merely uneditable.
   *
   * This is the one place on this board where a field is hidden rather than
   * refused on write, so it is asserted directly: the rate limit and the
   * registration policy are absent from a regular user's payload, by name.
   */
  it('withholds the administrative settings from a regular user', async () => {
    const response = await signedIn(request(app)).get('/api/bootstrap').expect(200);
    const keys = Object.keys(response.body.data.settings);

    expect(keys).not.toContain('submissions.perUserPerDay');
    expect(keys).not.toContain('registration.policy');
    expect(keys).not.toContain('comments.requireApproval');
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The moderation indicator.
 *
 * The count is the whole discovery path for comment approval — without one,
 * waiting comments sit forever and the setting does nothing. It travels in the
 * startup payload so the header can show it before anything else has loaded.
 *
 * It is ABSENT rather than zero in the two cases where the question does not
 * apply, because a header badge showing 0 and a header with nothing in it are
 * different statements.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('how many comments are waiting', () => {
  const gateUp = () =>
    settingsRepository.readGlobal.mockResolvedValue(
      new Map<string, unknown>([['comments.requireApproval', true]]),
    );

  it('tells an admin, while the gate is up', async () => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);
    gateUp();

    const response = await signedIn(request(app)).get('/api/bootstrap').expect(200);

    expect(response.body.data.pendingComments).toBe(3);
  });

  it('says nothing to a regular user, even while the gate is up', async () => {
    gateUp();

    const response = await signedIn(request(app)).get('/api/bootstrap').expect(200);

    expect(response.body.data).not.toHaveProperty('pendingComments');
    expect(commentsRepository.countPending).not.toHaveBeenCalled();
  });

  /** With approval off there is no such thing as a waiting comment. */
  it('says nothing to anybody while the gate is down', async () => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);

    const response = await signedIn(request(app)).get('/api/bootstrap').expect(200);

    expect(response.body.data).not.toHaveProperty('pendingComments');
    expect(commentsRepository.countPending).not.toHaveBeenCalled();
  });
});
