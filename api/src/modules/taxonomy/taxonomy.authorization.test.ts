import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../auth/actor.js';

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

const usersRepository = vi.hoisted(() => ({ findByEmail: vi.fn() }));

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
  usersRepository.findByEmail.mockResolvedValue(REGULAR_USER);

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
    const response = await request(app)
      .post('/api/categories')
      .send({ name: 'Documentation', slug: 'documentation' });

    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe('Only an admin can manage categories.');
    nothingWritten();
  });

  it('cannot rename one', async () => {
    const response = await request(app).patch('/api/categories/2').send({ name: 'Features' });

    expect(response.status).toBe(403);
    nothingWritten();
  });

  it('cannot reorder them', async () => {
    const response = await request(app).put('/api/categories/order').send({ ids: [4, 2] });

    expect(response.status).toBe(403);
    nothingWritten();
  });

  it('cannot retire one', async () => {
    const response = await request(app).put('/api/categories/2/archive');

    expect(response.status).toBe(403);
    nothingWritten();
  });

  it('cannot restore one', async () => {
    const response = await request(app).delete('/api/categories/2/archive');

    expect(response.status).toBe(403);
    nothingWritten();
  });

  it('cannot read the managed listing, with its counts', async () => {
    const response = await request(app).get('/api/categories?scope=all');

    expect(response.status).toBe(403);
    expect(categoriesRepository.listAll).not.toHaveBeenCalled();
  });

  it('can still read the plain listing, which every form needs', async () => {
    const response = await request(app).get('/api/categories').expect(200);

    // Refusing this would break filing a request for everybody.
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].requestCount).toBeUndefined();
  });

  it('is refused before the body is validated', async () => {
    // Nonsense in three ways. A handler that validated first would answer 422
    // and describe the payload to somebody who may not send one.
    const response = await request(app)
      .post('/api/categories')
      .send({ name: '', slug: 'Not A Slug', nonsense: true });

    expect(response.status).toBe(403);
    expect(response.body.error.details).toBeUndefined();
  });
});

describe('a regular user, refused at every status mutation', () => {
  it('cannot create one', async () => {
    const response = await request(app)
      .post('/api/statuses')
      .send({ name: 'Blocked', slug: 'blocked' });

    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe('Only an admin can manage statuses.');
    nothingWritten();
  });

  it('cannot rename one', async () => {
    const response = await request(app).patch('/api/statuses/1').send({ name: 'Triage' });

    expect(response.status).toBe(403);
    nothingWritten();
  });

  it('cannot reorder them', async () => {
    const response = await request(app).put('/api/statuses/order').send({ ids: [5, 1] });

    expect(response.status).toBe(403);
    nothingWritten();
  });

  it('cannot move the default', async () => {
    const response = await request(app).put('/api/statuses/5/default');

    expect(response.status).toBe(403);
    nothingWritten();
  });

  it('cannot read the managed listing', async () => {
    const response = await request(app).get('/api/statuses?scope=all');

    expect(response.status).toBe(403);
    expect(statusesRepository.listAll).not.toHaveBeenCalled();
  });
});

describe('what the interface is told it may do', () => {
  it('tells a regular user it may manage nothing', async () => {
    const response = await request(app).get('/api/capabilities').expect(200);

    expect(response.body.data).toEqual({
      canManageCategories: false,
      canManageStatuses: false,
    });
  });

  it('tells an admin it may manage both', async () => {
    usersRepository.findByEmail.mockResolvedValue(ADMIN);

    const response = await request(app).get('/api/capabilities').expect(200);

    expect(response.body.data).toEqual({
      canManageCategories: true,
      canManageStatuses: true,
    });
  });

  it('never says who the caller is', async () => {
    usersRepository.findByEmail.mockResolvedValue(ADMIN);

    const response = await request(app).get('/api/capabilities').expect(200);
    const body = JSON.stringify(response.body);

    // The browser is told what it may DO. Not its id, its name, its email or
    // its role — none of which it has ever needed and none of which it gets.
    expect(body).not.toContain('admin@feedbackhub.local');
    expect(body).not.toContain('Robin Alvarez');
    expect(body).not.toContain('"role"');
  });
});
