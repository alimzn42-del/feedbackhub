import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../auth/actor.js';
import { signedIn } from '../../auth/tokens.test-support.js';

/* ════════════════════════════════════════════════════════════════════════════
 * Filtering and sorting the board.
 *
 * These travel through the real Express app and stop at the repository, which
 * is replaced. What is being proved here is the CONTRACT — what a URL means,
 * what it is refused for, and what reaches the query — not what MySQL then does
 * with it. The SQL itself is exercised against a real database; the notes for
 * that are in notes/ai-log.md.
 *
 * The claim that matters most in this file is the negative one: a filter value
 * that names nothing must be REFUSED. Silently ignoring it returns the whole
 * board, which is indistinguishable from a filter that matched everything, and
 * the user reads a wrong answer as a right one.
 * ══════════════════════════════════════════════════════════════════════════ */

const usersRepository = vi.hoisted(() => ({
  findByEmail: vi.fn(),
  findByExternalId: vi.fn(),
  updateEmail: vi.fn(),
}));
const requestsRepository = vi.hoisted(() => ({
  countRecentByAuthor: vi.fn(),
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
const categoriesRepository = vi.hoisted(() => ({
  listActive: vi.fn(),
  findActiveId: vi.fn(),
  findIdsBySlugs: vi.fn(),
}));
const statusesRepository = vi.hoisted(() => ({
  findDefaultId: vi.fn(),
  listActive: vi.fn(),
  findIdsBySlugs: vi.fn(),
}));

vi.mock('../users/users.repository.js', () => usersRepository);
vi.mock('./requests.repository.js', () => requestsRepository);
vi.mock('../categories/categories.repository.js', () => categoriesRepository);
vi.mock('../statuses/statuses.repository.js', () => statusesRepository);
vi.mock('../settings/settings.repository.js', () => settingsRepository);

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

const STATUSES = [
  { id: 3, name: 'Planned', slug: 'planned' },
  { id: 5, name: 'Done', slug: 'done' },
];

const CATEGORIES = [
  { id: 2, name: 'Feature', slug: 'feature' },
  { id: 4, name: 'Bug', slug: 'bug' },
];

const app = createApp();

/** The arguments the repository was called with on the last list. */
function lastListCall(): Record<string, unknown> {
  const calls = requestsRepository.list.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0] as Record<string, unknown>;
}

beforeEach(() => {
  settingsRepository.readGlobal.mockResolvedValue(new Map());
  settingsRepository.readForUser.mockResolvedValue(new Map());
  usersRepository.findByExternalId.mockResolvedValue(REGULAR_USER);
  requestsRepository.list.mockResolvedValue({ items: [], total: 0 });
  requestsRepository.listPinned.mockResolvedValue({ items: [], total: 0 });

  // Every slug asked about is resolved, unless a test says otherwise.
  statusesRepository.findIdsBySlugs.mockImplementation((slugs: string[]) =>
    Promise.resolve(STATUSES.filter((status) => slugs.includes(status.slug))),
  );
  categoriesRepository.findIdsBySlugs.mockImplementation((slugs: string[]) =>
    Promise.resolve(CATEGORIES.filter((category) => slugs.includes(category.slug))),
  );
  statusesRepository.listActive.mockResolvedValue(STATUSES);
  categoriesRepository.listActive.mockResolvedValue(CATEGORIES);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('GET /api/requests — sorting', () => {
  it('sorts by newest when no sort is asked for', async () => {
    await signedIn(request(app)).get('/api/requests').expect(200);

    // The board opens on what was filed most recently.
    expect(lastListCall()['sort']).toBe('newest');
  });

  it('leaves the shelf out of it — the list default and the shelf default differ', async () => {
    await signedIn(request(app)).get('/api/requests').expect(200);

    // The board opens on newest; the shelf opens on most recently pinned. Two
    // defaults, deliberately, and neither is the other's fallback.
    expect(lastListCall()['sort']).toBe('newest');
  });

  it('passes each supported ordering through to the query', async () => {
    for (const sort of ['votes', 'newest', 'oldest'] as const) {
      await signedIn(request(app)).get('/api/requests').query({ sort }).expect(200);
      expect(lastListCall()['sort']).toBe(sort);
    }
  });

  it('refuses an ordering it does not have, rather than falling back to the default', async () => {
    const response = await signedIn(request(app))
      .get('/api/requests')
      .query({ sort: 'controversial' });

    // Falling back would answer a question nobody asked and look like it worked.
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details[0].field).toBe('sort');
    expect(requestsRepository.list).not.toHaveBeenCalled();
  });
});

describe('GET /api/requests — filtering by taxonomy', () => {
  it('accepts a comma-separated list of slugs and filters on the resolved ids', async () => {
    await signedIn(request(app)).get('/api/requests').query({ status: 'planned,done' }).expect(200);

    expect(statusesRepository.findIdsBySlugs).toHaveBeenCalledWith(['planned', 'done']);
    expect(lastListCall()['statusIds']).toEqual([3, 5]);
  });

  it('reads a repeated parameter as the same list', async () => {
    // ?status=planned&status=done is what a form produces; the comma form is
    // what somebody types. They mean the same thing.
    await signedIn(request(app)).get('/api/requests?status=planned&status=done').expect(200);

    expect(lastListCall()['statusIds']).toEqual([3, 5]);
  });

  it('combines the two taxonomies', async () => {
    await signedIn(request(app))
      .get('/api/requests')
      .query({ status: 'planned', category: 'bug' })
      .expect(200);

    const call = lastListCall();
    expect(call['statusIds']).toEqual([3]);
    expect(call['categoryIds']).toEqual([4]);
  });

  it('refuses a slug that names nothing, and names the value back', async () => {
    const response = await signedIn(request(app)).get('/api/requests').query({ status: 'planed' });

    expect(response.status).toBe(422);
    expect(response.body.error.details).toHaveLength(1);
    expect(response.body.error.details[0]).toMatchObject({
      field: 'status',
      code: 'NOT_FOUND',
    });
    expect(response.body.error.details[0].message).toContain('planed');
    expect(requestsRepository.list).not.toHaveBeenCalled();
  });

  it('reports every unknown slug, not just the first', async () => {
    const response = await signedIn(request(app))
      .get('/api/requests')
      .query({ status: 'planed,dnoe,done' });

    // One entry per bad value, so the filter bar can drop exactly the chips
    // that are wrong and keep the one that is right.
    expect(response.status).toBe(422);
    expect(response.body.error.details).toHaveLength(2);
  });

  it('refuses a value that is not a slug at all', async () => {
    const response = await signedIn(request(app))
      .get('/api/requests')
      .query({ category: 'DROP TABLE' });

    expect(response.status).toBe(422);
    // Indexed, because the filter is a list: "category[0]" says which of the
    // values is the bad one, where a bare "category" would only say that one is.
    expect(response.body.error.details[0].field).toBe('category[0]');
    // Refused by shape, before anything is asked of the database.
    expect(categoriesRepository.findIdsBySlugs).not.toHaveBeenCalled();
  });

  it('treats an empty value as no filter rather than as a filter for nothing', async () => {
    await signedIn(request(app)).get('/api/requests?status=').expect(200);

    expect(lastListCall()['statusIds']).toBeUndefined();
    expect(statusesRepository.findIdsBySlugs).not.toHaveBeenCalled();
  });

  it('does not ask the same slug twice', async () => {
    await signedIn(request(app))
      .get('/api/requests')
      .query({ status: 'done,done,done' })
      .expect(200);

    expect(statusesRepository.findIdsBySlugs).toHaveBeenCalledWith(['done']);
  });
});

describe('GET /api/requests — mine', () => {
  it('resolves "mine" to the caller from the identity seam', async () => {
    await signedIn(request(app)).get('/api/requests').query({ mine: 'true' }).expect(200);

    expect(lastListCall()['authorId']).toBe(REGULAR_USER.id);
  });

  it('applies no author filter when mine is false or absent', async () => {
    await signedIn(request(app)).get('/api/requests').query({ mine: 'false' }).expect(200);
    expect(lastListCall()['authorId']).toBeUndefined();

    await signedIn(request(app)).get('/api/requests').expect(200);
    expect(lastListCall()['authorId']).toBeUndefined();
  });

  it('refuses an author named in the URL, so nobody can page through someone else', async () => {
    // There is no authorId parameter and there will not be one: "mine" is
    // answered from the identity seam. A caller naming an author is refused as
    // an unknown parameter rather than quietly honoured.
    const response = await signedIn(request(app)).get('/api/requests').query({ authorId: 99 });

    expect(response.status).toBe(422);
    expect(response.body.error.details[0].code).toBe('UNKNOWN_FIELD');
    expect(requestsRepository.list).not.toHaveBeenCalled();
  });

  it('refuses a flag it cannot read as a yes or a no', async () => {
    // Reading "yes" as false would hide the board from somebody who asked to
    // see their own requests, and say nothing about it.
    const response = await signedIn(request(app)).get('/api/requests').query({ mine: 'yes' });

    expect(response.status).toBe(422);
    expect(response.body.error.details[0].field).toBe('mine');
  });
});

describe('GET /api/requests — search', () => {
  it('passes the term through to the query', async () => {
    await signedIn(request(app)).get('/api/requests').query({ q: 'dark mode' }).expect(200);

    expect(lastListCall()['search']).toBe('dark mode');
  });

  it('trims the term, and treats a blank one as absent', async () => {
    await signedIn(request(app)).get('/api/requests').query({ q: '  dark  ' }).expect(200);
    expect(lastListCall()['search']).toBe('dark');

    await signedIn(request(app)).get('/api/requests').query({ q: '   ' }).expect(200);
    expect(lastListCall()['search']).toBeUndefined();
  });

  it('refuses a term too short to mean anything', async () => {
    const response = await signedIn(request(app)).get('/api/requests').query({ q: 'a' });

    // One character matches most of the board, so it costs a full scan to tell
    // the user nothing.
    expect(response.status).toBe(422);
    expect(response.body.error.details[0].field).toBe('q');
  });

  it('refuses a term longer than the ceiling', async () => {
    const response = await signedIn(request(app))
      .get('/api/requests')
      .query({ q: 'x'.repeat(101) });

    expect(response.status).toBe(422);
    expect(response.body.error.details[0].field).toBe('q');
  });
});

describe('GET /api/requests — filters and paging together', () => {
  it('keeps paging server-side with the filters applied', async () => {
    await signedIn(request(app))
      .get('/api/requests')
      .query({ status: 'done', page: 2, pageSize: 5 })
      .expect(200);

    const call = lastListCall();
    expect(call).toMatchObject({ limit: 5, offset: 5, statusIds: [5] });
  });

  it('reports the page against the filtered total, not the whole board', async () => {
    requestsRepository.list.mockResolvedValue({ items: [], total: 3 });

    const response = await signedIn(request(app))
      .get('/api/requests')
      .query({ status: 'done', pageSize: 20 })
      .expect(200);

    expect(response.body.page).toMatchObject({ total: 3, totalPages: 1 });
  });
});

describe('GET /api/requests — where the pinned requests go', () => {
  it('keeps them out of the default board, where the shelf holds them', async () => {
    await signedIn(request(app)).get('/api/requests').expect(200);

    // A request appears in exactly one place on the default board.
    expect(lastListCall()['includePinned']).toBe(false);
  });

  it('puts them in the results as soon as anything is filtered', async () => {
    for (const query of [
      { status: 'done' },
      { category: 'bug' },
      { mine: 'true' },
      { q: 'dark' },
    ]) {
      await signedIn(request(app)).get('/api/requests').query(query).expect(200);

      // The shelf is gone from the filtered screen, so a pinned request that
      // matches has to be in the results or it is nowhere at all.
      expect(lastListCall()['includePinned']).toBe(true);
    }
  });

  it('keeps the shelf when only the ordering changed', async () => {
    await signedIn(request(app)).get('/api/requests').query({ sort: 'oldest' }).expect(200);

    // Reordering the board hides nothing from it, so the shelf still makes
    // sense beside it. Sorting is not filtering.
    expect(lastListCall()['includePinned']).toBe(false);
  });

  it('counts them in the total once they are in the results', async () => {
    requestsRepository.list.mockResolvedValue({ items: [], total: 7 });

    const response = await signedIn(request(app))
      .get('/api/requests')
      .query({ q: 'dark' })
      .expect(200);

    // One result set, one total. The pinned exclusion from the count applies
    // to the default board only.
    expect(response.body.page.total).toBe(7);
    expect(lastListCall()['includePinned']).toBe(true);
  });
});

describe('GET /api/requests/pinned', () => {
  it('orders by most recently pinned when no ordering is asked for', async () => {
    await signedIn(request(app)).get('/api/requests/pinned').expect(200);

    // Undefined, not a default: it is what tells the repository to use pin
    // order, which is what puts a freshly pinned request in the three the panel
    // shows before it is expanded.
    expect(requestsRepository.listPinned).toHaveBeenCalledWith(
      REGULAR_USER.id,
      expect.any(Boolean),
      expect.any(Number),
      undefined,
    );
  });

  it('follows the board ordering when one was asked for', async () => {
    await signedIn(request(app)).get('/api/requests/pinned').query({ sort: 'oldest' }).expect(200);

    // The shelf is a group within the board, not a separate view. A board
    // sorted oldest-first with a shelf on top sorted by something else is two
    // answers to one question.
    expect(requestsRepository.listPinned).toHaveBeenCalledWith(
      REGULAR_USER.id,
      expect.any(Boolean),
      expect.any(Number),
      'oldest',
    );
  });

  it('refuses the board filters, because a filtered board has no shelf', async () => {
    const response = await signedIn(request(app))
      .get('/api/requests/pinned')
      .query({ status: 'done' });

    expect(response.status).toBe(422);
    expect(response.body.error.details[0].code).toBe('UNKNOWN_FIELD');
    expect(requestsRepository.listPinned).not.toHaveBeenCalled();
  });

  it('refuses an ordering it does not have', async () => {
    const response = await signedIn(request(app))
      .get('/api/requests/pinned')
      .query({ sort: 'loudest' });

    expect(response.status).toBe(422);
    expect(response.body.error.details[0].field).toBe('sort');
  });
});

describe('GET /api/statuses', () => {
  it('offers the statuses the filter bar needs, without the archived ones', async () => {
    const response = await signedIn(request(app)).get('/api/statuses').expect(200);

    expect(response.body.data).toEqual(STATUSES);
    expect(statusesRepository.listActive).toHaveBeenCalled();
  });

  it('returns the taxonomy envelope, with no page block to describe', async () => {
    const response = await signedIn(request(app)).get('/api/statuses').expect(200);

    expect(response.body.page).toBeUndefined();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Finding what is waiting for moderation.
 *
 * This filter is the discovery path for comment approval: the header says how
 * many are waiting, and the link lands on the requests that carry them. It is
 * admin-only, and refused rather than ignored — a filter that quietly did
 * nothing would tell a regular user that nothing is waiting, which is a wrong
 * answer to a question they were not allowed to ask.
 * ──────────────────────────────────────────────────────────────────────────── */
/** The moderation filter is the first thing on this board only an admin may ask. */
const ADMIN: Actor = { ...REGULAR_USER, id: 1, displayName: 'Robin Alvarez', role: 'admin' };

describe('GET /api/requests?pending=true', () => {
  it('asks the repository for requests carrying a waiting comment', async () => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);

    await signedIn(request(app)).get('/api/requests?pending=true').expect(200);

    expect(requestsRepository.list).toHaveBeenCalledWith(
      expect.objectContaining({ pendingOnly: true }),
    );
  });

  it('403s a regular user, and reads nothing', async () => {
    const response = await signedIn(request(app)).get('/api/requests?pending=true');

    expect(response.status).toBe(403);
    expect(requestsRepository.list).not.toHaveBeenCalled();
  });

  /**
   * It narrows the board, so the pinned shelf folds in like it does for every
   * other filter. The two implementations of "is this filtered" — one here, one
   * in the web app — have to agree, or pinned rows appear twice or vanish.
   */
  it('counts as filtering, so the shelf is not asked for', async () => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);

    await signedIn(request(app)).get('/api/requests?pending=true').expect(200);

    expect(requestsRepository.list).toHaveBeenCalledWith(
      expect.objectContaining({ includePinned: true }),
    );
  });

  it('is absent from the query when nobody asked for it', async () => {
    await signedIn(request(app)).get('/api/requests').expect(200);

    expect(requestsRepository.list).toHaveBeenCalledWith(
      expect.objectContaining({ pendingOnly: undefined }),
    );
  });
});
