import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../auth/actor.js';
import { signedIn } from '../../auth/tokens.test-support.js';

/* ════════════════════════════════════════════════════════════════════════════
 * Managing the taxonomy, as an admin who is allowed to.
 *
 * The rules that are not about permission: a slug cannot be changed, a
 * duplicate is refused by name, a reorder names every row or none, and the
 * statuses table never ends up without a default.
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

vi.mock('../users/users.repository.js', () => usersRepository);
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

/** What the driver throws when a unique key refuses the write. */
function duplicate(key: string): Error & { code: string; sqlMessage: string } {
  return Object.assign(new Error('Duplicate entry'), {
    code: 'ER_DUP_ENTRY',
    errno: 1062,
    sqlMessage: `Duplicate entry 'Bug' for key '${key}'`,
  });
}

const app = createApp();

beforeEach(() => {
  usersRepository.findByExternalId.mockResolvedValue(ADMIN);

  categoriesRepository.listAll.mockResolvedValue(CATEGORY_ROWS);
  categoriesRepository.findById.mockResolvedValue({ id: 2, name: 'Feature', slug: 'feature' });
  categoriesRepository.allIds.mockResolvedValue([2, 4]);
  categoriesRepository.insert.mockResolvedValue(2);
  categoriesRepository.rename.mockResolvedValue(undefined);
  categoriesRepository.setOrder.mockResolvedValue(undefined);
  categoriesRepository.archive.mockResolvedValue(undefined);
  categoriesRepository.restore.mockResolvedValue(undefined);

  statusesRepository.listAll.mockResolvedValue(STATUS_ROWS);
  statusesRepository.findById.mockResolvedValue({ id: 5, name: 'Done', slug: 'done' });
  statusesRepository.allIds.mockResolvedValue([1, 5]);
  statusesRepository.countAll.mockResolvedValue(2);
  statusesRepository.insert.mockResolvedValue(1);
  statusesRepository.rename.mockResolvedValue(undefined);
  statusesRepository.setOrder.mockResolvedValue(undefined);
  statusesRepository.setDefault.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('the managed listing', () => {
  it('carries what a decision needs: order, retirement and usage', async () => {
    const response = await signedIn(request(app)).get('/api/categories?scope=all').expect(200);

    expect(response.body.data[0]).toMatchObject({
      sortOrder: 0,
      archivedAt: null,
      requestCount: 4,
    });
  });

  it('reports which status is the default, and how many sit in each', async () => {
    const response = await signedIn(request(app)).get('/api/statuses?scope=all').expect(200);

    expect(response.body.data.filter((row: { isDefault: boolean }) => row.isDefault)).toHaveLength(
      1,
    );
    expect(response.body.data[0].requestCount).toBe(6);
  });

  it('refuses a scope it does not have, rather than quietly serving the plain one', async () => {
    const response = await signedIn(request(app)).get('/api/categories?scope=archived');

    expect(response.status).toBe(422);
    expect(response.body.error.details[0].field).toBe('scope');
  });
});

describe('creating', () => {
  it('takes a name and a slug', async () => {
    await signedIn(request(app))
      .post('/api/categories')
      .send({ name: 'Documentation', slug: 'documentation' })
      .expect(201);

    expect(categoriesRepository.insert).toHaveBeenCalledWith('Documentation', 'documentation');
  });

  it('refuses a slug that is not one, before the database sees it', async () => {
    const response = await signedIn(request(app))
      .post('/api/categories')
      .send({ name: 'Documentation', slug: 'Not A Slug' });

    expect(response.status).toBe(422);
    expect(response.body.error.details[0].field).toBe('slug');
    expect(categoriesRepository.insert).not.toHaveBeenCalled();
  });

  it('names the conflict when the name is taken', async () => {
    categoriesRepository.insert.mockRejectedValue(duplicate('categories.uq_categories_name'));

    const response = await signedIn(request(app))
      .post('/api/categories')
      .send({ name: 'Bug', slug: 'bug-reports' });

    expect(response.status).toBe(422);
    expect(response.body.error.details[0]).toMatchObject({ field: 'name', code: 'DUPLICATE' });
    // Named, so the form can put it against the input rather than showing
    // "something went wrong" above the whole thing.
    expect(response.body.error.details[0].message).toContain('Bug');
  });

  it('names the conflict when the slug is taken', async () => {
    categoriesRepository.insert.mockRejectedValue(duplicate('categories.uq_categories_slug'));

    const response = await signedIn(request(app))
      .post('/api/categories')
      .send({ name: 'Bug reports', slug: 'bug' });

    expect(response.status).toBe(422);
    expect(response.body.error.details[0]).toMatchObject({ field: 'slug', code: 'DUPLICATE' });
    expect(response.body.error.details[0].message).toContain('bug');
  });

  it('lets an unrelated database failure through rather than calling it a duplicate', async () => {
    categoriesRepository.insert.mockRejectedValue(new Error('connection lost'));

    const response = await signedIn(request(app))
      .post('/api/categories')
      .send({ name: 'Documentation', slug: 'documentation' });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL');
  });
});

describe('renaming', () => {
  it('changes the name', async () => {
    await signedIn(request(app)).patch('/api/categories/2').send({ name: 'Features' }).expect(200);

    expect(categoriesRepository.rename).toHaveBeenCalledWith(2, 'Features');
  });

  it('refuses a slug sent alongside it, rather than ignoring it', async () => {
    // The slug is in URLs people have shared. There is no endpoint that changes
    // one, and an attempt to is answered rather than silently dropped.
    const response = await signedIn(request(app))
      .patch('/api/categories/2')
      .send({ name: 'Features', slug: 'features' });

    expect(response.status).toBe(422);
    expect(response.body.error.details[0].code).toBe('UNKNOWN_FIELD');
    expect(categoriesRepository.rename).not.toHaveBeenCalled();
  });

  it('404s for a row that does not exist', async () => {
    categoriesRepository.findById.mockResolvedValue(null);

    await signedIn(request(app)).patch('/api/categories/99').send({ name: 'Features' }).expect(404);

    expect(categoriesRepository.rename).not.toHaveBeenCalled();
  });
});

describe('reordering', () => {
  it('writes the whole order in one call', async () => {
    await signedIn(request(app))
      .put('/api/categories/order')
      .send({ ids: [4, 2] })
      .expect(200);

    expect(categoriesRepository.setOrder).toHaveBeenCalledWith([4, 2]);
  });

  it('refuses an order that leaves a row out', async () => {
    const response = await signedIn(request(app))
      .put('/api/categories/order')
      .send({ ids: [4] });

    // Accepting it would mean inventing a position for the one not named.
    expect(response.status).toBe(422);
    expect(response.body.error.details[0].code).toBe('INCOMPLETE');
    expect(categoriesRepository.setOrder).not.toHaveBeenCalled();
  });

  it('refuses an order that names a row twice', async () => {
    const response = await signedIn(request(app))
      .put('/api/categories/order')
      .send({ ids: [2, 2] });

    expect(response.status).toBe(422);
    expect(response.body.error.details[0].code).toBe('DUPLICATE');
    expect(categoriesRepository.setOrder).not.toHaveBeenCalled();
  });

  it('refuses an order naming something that is not there', async () => {
    const response = await signedIn(request(app))
      .put('/api/categories/order')
      .send({ ids: [2, 4, 99] });

    expect(response.status).toBe(422);
    expect(response.body.error.details[0].code).toBe('NOT_FOUND');
    expect(categoriesRepository.setOrder).not.toHaveBeenCalled();
  });
});

describe('retiring a category', () => {
  it('retires it without deleting it', async () => {
    await signedIn(request(app)).put('/api/categories/2/archive').expect(200);

    // archive, not delete: the requests carrying it keep rendering it.
    expect(categoriesRepository.archive).toHaveBeenCalledWith(2);
  });

  it('retires one that is still in use, because that is what retirement is for', async () => {
    // Four requests carry this category. The count informs the decision; it
    // does not block it.
    await signedIn(request(app)).put('/api/categories/2/archive').expect(200);

    expect(categoriesRepository.archive).toHaveBeenCalledWith(2);
  });

  it('restores it again', async () => {
    await signedIn(request(app)).delete('/api/categories/2/archive').expect(200);

    expect(categoriesRepository.restore).toHaveBeenCalledWith(2);
  });

  it('has no equivalent for statuses', async () => {
    // A status is a position requests are sitting in, not a label they carry.
    // Retiring one would strand them, so the route does not exist.
    await signedIn(request(app)).put('/api/statuses/5/archive').expect(404);
    await signedIn(request(app)).delete('/api/statuses/5/archive').expect(404);
  });
});

describe('the default status', () => {
  it('moves the default, and answers with the whole list', async () => {
    const response = await signedIn(request(app)).put('/api/statuses/5/default').expect(200);

    expect(statusesRepository.setDefault).toHaveBeenCalledWith(5);
    // Two rows changed: the one that gained it and the one that lost it.
    expect(response.body.data).toHaveLength(2);
  });

  it('has no endpoint that clears the default without naming a replacement', async () => {
    // This is what keeps the lower bound the schema cannot express. A table
    // with no default exists happily and refuses every new request.
    await signedIn(request(app)).delete('/api/statuses/1/default').expect(404);
  });

  it('makes the first status in an empty table the default', async () => {
    statusesRepository.countAll.mockResolvedValue(0);

    await signedIn(request(app))
      .post('/api/statuses')
      .send({ name: 'New', slug: 'new' })
      .expect(201);

    expect(statusesRepository.insert).toHaveBeenCalledWith('New', 'new', true);
  });

  it('does not make a later status the default', async () => {
    statusesRepository.countAll.mockResolvedValue(3);

    await signedIn(request(app))
      .post('/api/statuses')
      .send({ name: 'Blocked', slug: 'blocked' })
      .expect(201);

    // Adding a stage must not silently move where new requests arrive.
    expect(statusesRepository.insert).toHaveBeenCalledWith('Blocked', 'blocked', false);
  });
});
