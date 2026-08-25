import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../auth/actor.js';
import { signedIn } from '../../auth/tokens.test-support.js';

/* ════════════════════════════════════════════════════════════════════════════
 * Settings: resolution, and who may see or change what.
 *
 * Two claims, and they fail in different ways.
 *
 * RESOLUTION is arithmetic over three layers, and getting it wrong is quiet:
 * a preference that does not take effect, or a "reset" control offered against
 * a value nobody ever set. Tested directly, because nothing about it shows up
 * as an error.
 *
 * AUTHORIZATION is the one place on this board where a field is WITHHELD rather
 * than refused on write, so both halves are asserted: the 403 on the way in,
 * and the absence from the payload on the way out.
 * ══════════════════════════════════════════════════════════════════════════ */

const usersRepository = vi.hoisted(() => ({
  findByEmail: vi.fn(),
  findByExternalId: vi.fn(),
  updateEmail: vi.fn(),
  findById: vi.fn(),
  insert: vi.fn(),
  updateDisplayName: vi.fn(),
  countOtherAdmins: vi.fn(),
  anonymise: vi.fn(),
}));

const settingsRepository = vi.hoisted(() => ({
  readGlobal: vi.fn(),
  readForUser: vi.fn(),
  applyGlobal: vi.fn(),
  applyForUser: vi.fn(),
  clearAllForUser: vi.fn(),
  RESET: Symbol('reset'),
}));

const categoriesRepository = vi.hoisted(() => ({ listActive: vi.fn() }));
const statusesRepository = vi.hoisted(() => ({ listActive: vi.fn() }));

vi.mock('../users/users.repository.js', () => usersRepository);
vi.mock('./settings.repository.js', () => settingsRepository);
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
const settingsService = await import('./settings.service.js');

const REGULAR_USER: Actor = {
  id: 2,
  externalId: null,
  email: 'dana@feedbackhub.local',
  displayName: 'Dana Okafor',
  role: 'user',
};

const ADMIN: Actor = { ...REGULAR_USER, id: 1, displayName: 'Robin Alvarez', role: 'admin' };

const app = createApp();

beforeEach(() => {
  vi.clearAllMocks();
  usersRepository.findByExternalId.mockResolvedValue(REGULAR_USER);
  settingsRepository.readGlobal.mockResolvedValue(new Map());
  settingsRepository.readForUser.mockResolvedValue(new Map());
  categoriesRepository.listActive.mockResolvedValue([{ id: 2, name: 'Feature', slug: 'feature' }]);
  statusesRepository.listActive.mockResolvedValue([{ id: 1, name: 'New', slug: 'new' }]);
});

/** Nothing reached either table. */
function nothingWritten(): void {
  expect(settingsRepository.applyGlobal).not.toHaveBeenCalled();
  expect(settingsRepository.applyForUser).not.toHaveBeenCalled();
}

describe('resolution', () => {
  it('answers from the registry, flagged as a default, when nobody has set anything', async () => {
    const effective = await settingsService.effectiveFor(REGULAR_USER);

    expect(effective['board.defaultSort']).toEqual({
      value: 'newest',
      source: 'default',
      editable: true,
    });
  });

  it('answers with the global value, flagged as global, when only an admin has set it', async () => {
    settingsRepository.readGlobal.mockResolvedValue(new Map([['board.defaultSort', 'votes']]));

    const effective = await settingsService.effectiveFor(REGULAR_USER);

    expect(effective['board.defaultSort']).toMatchObject({ value: 'votes', source: 'global' });
  });

  /**
   * The case the brief singles out: a value that exists at both levels, and the
   * nearer one wins.
   */
  it('answers with the override, flagged as the user’s, when they have one', async () => {
    settingsRepository.readGlobal.mockResolvedValue(new Map([['board.defaultSort', 'votes']]));
    settingsRepository.readForUser.mockResolvedValue(new Map([['board.defaultSort', 'oldest']]));

    const effective = await settingsService.effectiveFor(REGULAR_USER);

    expect(effective['board.defaultSort']).toMatchObject({ value: 'oldest', source: 'user' });
  });

  /**
   * An explicit choice that happens to match the layer underneath is still an
   * explicit choice.
   *
   * If these collapsed, the screen would offer "reset to default" against a
   * value with nothing to reset, and stop offering it against one that has.
   */
  it('does not mistake an override that equals the default for the default', async () => {
    settingsRepository.readForUser.mockResolvedValue(new Map([['board.defaultSort', 'newest']]));

    const effective = await settingsService.effectiveFor(REGULAR_USER);

    expect(effective['board.defaultSort']).toMatchObject({ value: 'newest', source: 'user' });
  });

  /**
   * A stored value the current registry no longer accepts falls through instead
   * of being served.
   *
   * The column is JSON and a row may have been written by an older build under
   * rules this one has since tightened. Serving it would push a value the
   * application does not believe in out to every caller.
   */
  it('falls back rather than serving a stored value that no longer validates', async () => {
    settingsRepository.readForUser.mockResolvedValue(
      new Map([['board.defaultSort', 'by-phase-of-moon']]),
    );

    const effective = await settingsService.effectiveFor(REGULAR_USER);

    expect(effective['board.defaultSort']).toMatchObject({ value: 'newest', source: 'default' });
  });
});

describe('the application settings are refused at the route', () => {
  it('403s a regular user reading them', async () => {
    const response = await signedIn(request(app)).get('/api/settings');

    expect(response.status).toBe(403);
  });

  it('403s a regular user writing them, and writes nothing', async () => {
    const response = await signedIn(request(app))
      .patch('/api/settings')
      .send({ 'submissions.perUserPerDay': 5000 });

    expect(response.status).toBe(403);
    nothingWritten();
  });

  /**
   * Withheld, not merely uneditable — the distinction this slice turns on.
   */
  it('leaves them out of a regular user’s effective settings entirely', async () => {
    const effective = await settingsService.effectiveFor(REGULAR_USER);

    expect(Object.keys(effective)).not.toContain('submissions.perUserPerDay');
    expect(Object.keys(effective)).not.toContain('comments.requireApproval');
    expect(Object.keys(effective)).toContain('board.defaultSort');
  });

  it('lets an admin read and write them', async () => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);

    await signedIn(request(app)).get('/api/settings').expect(200);

    await signedIn(request(app))
      .patch('/api/settings')
      .send({ 'submissions.perUserPerDay': 5 })
      .expect(200);

    expect(settingsRepository.applyGlobal).toHaveBeenCalled();
  });
});

describe('preferences belong to the person they are about', () => {
  it('403s writing somebody else’s, and writes nothing', async () => {
    const response = await signedIn(request(app))
      .patch(`/api/users/${ADMIN.id}/settings`)
      .send({ 'profile.theme': 'dark' });

    expect(response.status).toBe(403);
    nothingWritten();
  });

  it('403s reading somebody else’s', async () => {
    const response = await signedIn(request(app)).get(`/api/users/${ADMIN.id}/settings`);

    expect(response.status).toBe(403);
  });

  /** An admin is not an exception. Moderating is not rewriting. */
  it('403s an admin writing another person’s, and writes nothing', async () => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);

    const response = await signedIn(request(app))
      .patch(`/api/users/${REGULAR_USER.id}/settings`)
      .send({ 'profile.theme': 'dark' });

    expect(response.status).toBe(403);
    nothingWritten();
  });

  it('lets somebody write their own', async () => {
    await signedIn(request(app))
      .patch(`/api/users/${REGULAR_USER.id}/settings`)
      .send({ 'profile.theme': 'dark' })
      .expect(200);

    expect(settingsRepository.applyForUser).toHaveBeenCalledWith(
      REGULAR_USER.id,
      new Map([['profile.theme', { value: 'dark' }]]),
    );
  });
});

describe('what a write refuses', () => {
  beforeEach(() => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);
  });

  it('refuses a setting at the wrong level by name, rather than dropping it', async () => {
    const response = await signedIn(request(app))
      .patch('/api/settings')
      .send({ 'profile.theme': 'dark' });

    expect(response.status).toBe(422);
    expect(response.body.error.details[0]).toMatchObject({
      field: 'profile.theme',
      code: 'WRONG_LEVEL',
    });
    nothingWritten();
  });

  it('refuses a key that is not a setting', async () => {
    const response = await signedIn(request(app))
      .patch('/api/settings')
      .send({ 'board.colour': 'blue' });

    expect(response.status).toBe(422);
    expect(response.body.error.details[0]).toMatchObject({ code: 'UNKNOWN_SETTING' });
    nothingWritten();
  });

  it('refuses a value the setting does not accept', async () => {
    const response = await signedIn(request(app))
      .patch('/api/settings')
      .send({ 'submissions.perUserPerDay': 0 });

    expect(response.status).toBe(422);
    nothingWritten();
  });

  /**
   * The invariant neither registration key can hold alone: restricting to a
   * list of domains and leaving the list empty admits nobody, which is a closed
   * board wearing the clothes of a restricted one.
   */
  it('refuses restricting registration to an empty list of domains', async () => {
    const response = await signedIn(request(app))
      .patch('/api/settings')
      .send({ 'registration.policy': 'domains' });

    expect(response.status).toBe(422);
    expect(response.body.error.details[0]).toMatchObject({
      field: 'registration.allowedDomains',
    });
    nothingWritten();
  });

  it('accepts the policy and the domains together, in one write', async () => {
    await signedIn(request(app))
      .patch('/api/settings')
      .send({
        'registration.policy': 'domains',
        'registration.allowedDomains': ['feedbackhub.local'],
      })
      .expect(200);

    expect(settingsRepository.applyGlobal).toHaveBeenCalledTimes(1);
  });

  /**
   * A default filter naming a category that does not exist would land the
   * person on a 422 every time they opened the board — the board refuses a
   * filter value that names nothing, deliberately. Caught once, here.
   */
  it('refuses a default filter that names nothing', async () => {
    const response = await signedIn(request(app))
      .patch(`/api/users/${ADMIN.id}/settings`)
      .send({ 'board.defaultCategories': ['does-not-exist'] });

    expect(response.status).toBe(422);
    expect(response.body.error.details[0]).toMatchObject({ code: 'UNKNOWN' });
    nothingWritten();
  });

  it('accepts a default filter that names a real category', async () => {
    await signedIn(request(app))
      .patch(`/api/users/${ADMIN.id}/settings`)
      .send({ 'board.defaultCategories': ['feature'] })
      .expect(200);

    expect(settingsRepository.applyForUser).toHaveBeenCalled();
  });

  /** null is reset, and reset is not the same as writing the default. */
  it('treats null as a removal rather than a value', async () => {
    await signedIn(request(app))
      .patch(`/api/users/${ADMIN.id}/settings`)
      .send({ 'profile.theme': null })
      .expect(200);

    const [, changes] = settingsRepository.applyForUser.mock.calls[0] as [
      number,
      Map<string, unknown>,
    ];

    expect(changes.get('profile.theme')).toBe(settingsRepository.RESET);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * A screen resolves at the level it WRITES.
 *
 * Three settings live at both levels, so the same controls appear on the
 * administrative screen and on each person's own. What must never happen is the
 * administrative screen showing somebody's personal value: it writes the
 * installation's, and displaying one while saving the other is how an admin
 * "changes" a setting that already looked changed.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('the level a screen resolves at', () => {
  beforeEach(() => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);
  });

  it('never shows a personal value on the application settings', async () => {
    // The admin has chosen an ordering for themselves. Nothing is set globally.
    settingsRepository.readForUser.mockResolvedValue(new Map([['board.defaultSort', 'votes']]));

    const response = await signedIn(request(app)).get('/api/settings').expect(200);
    const sort = response.body.data.find((row: { key: string }) => row.key === 'board.defaultSort');

    expect(sort).toMatchObject({ value: 'newest', source: 'default' });
    expect(sort.source).not.toBe('user');
  });

  it('shows the global value on the application settings when one is set', async () => {
    settingsRepository.readGlobal.mockResolvedValue(new Map([['board.defaultSort', 'oldest']]));
    settingsRepository.readForUser.mockResolvedValue(new Map([['board.defaultSort', 'votes']]));

    const response = await signedIn(request(app)).get('/api/settings').expect(200);
    const sort = response.body.data.find((row: { key: string }) => row.key === 'board.defaultSort');

    expect(sort).toMatchObject({ value: 'oldest', source: 'global' });
  });

  /**
   * The account screen keeps all three layers, because there the effective
   * value IS what the person gets — and being told it came from the board
   * rather than from them is the useful half of the answer.
   */
  it('does keep the personal value on the account screen', async () => {
    settingsRepository.readGlobal.mockResolvedValue(new Map([['board.defaultSort', 'oldest']]));
    settingsRepository.readForUser.mockResolvedValue(new Map([['board.defaultSort', 'votes']]));

    const response = await signedIn(request(app))
      .get(`/api/users/${ADMIN.id}/settings`)
      .expect(200);
    const sort = response.body.data.find((row: { key: string }) => row.key === 'board.defaultSort');

    expect(sort).toMatchObject({ value: 'votes', source: 'user' });
  });

  it('tells the account screen when it is following the board rather than a choice', async () => {
    settingsRepository.readGlobal.mockResolvedValue(new Map([['board.defaultSort', 'oldest']]));

    const response = await signedIn(request(app))
      .get(`/api/users/${ADMIN.id}/settings`)
      .expect(200);
    const sort = response.body.data.find((row: { key: string }) => row.key === 'board.defaultSort');

    expect(sort).toMatchObject({ value: 'oldest', source: 'global' });
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The settings screens speak the reader's language.
 *
 * Their labels live in the registry rather than in the web app's catalogue,
 * because the promise this registry makes is that adding a setting is one edit
 * in one file. That promise is only kept if the label comes with it.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('the language a settings document comes back in', () => {
  it('answers in English by default', async () => {
    const response = await signedIn(request(app))
      .get(`/api/users/${REGULAR_USER.id}/settings`)
      .expect(200);
    const theme = response.body.data.find((row: { key: string }) => row.key === 'profile.theme');

    expect(theme.label).toBe('Colour scheme');
  });

  it('answers in French for somebody who chose French', async () => {
    settingsRepository.readForUser.mockResolvedValue(new Map([['profile.language', 'fr']]));

    const response = await signedIn(request(app))
      .get(`/api/users/${REGULAR_USER.id}/settings`)
      .expect(200);
    const theme = response.body.data.find((row: { key: string }) => row.key === 'profile.theme');

    expect(theme.label).toBe('Thème de couleurs');
    expect(theme.description).toContain('Système');
  });

  /**
   * Which language an admin READS in is a fact about them, not about the level
   * they are editing — so the administrative document follows their preference
   * even though its values ignore their personal rows.
   */
  it('follows the admin’s own language on the application settings', async () => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);
    settingsRepository.readForUser.mockResolvedValue(new Map([['profile.language', 'fr']]));

    const response = await signedIn(request(app)).get('/api/settings').expect(200);
    const limit = response.body.data.find(
      (row: { key: string }) => row.key === 'submissions.perUserPerDay',
    );

    expect(limit.label).toBe('Demandes qu’une personne peut déposer par jour');
  });

  /** Only languages that are actually translated are offered. */
  it('refuses a language this application does not speak', async () => {
    const response = await signedIn(request(app))
      .patch(`/api/users/${REGULAR_USER.id}/settings`)
      .send({ 'profile.language': 'de' });

    expect(response.status).toBe(422);
    nothingWritten();
  });
});
