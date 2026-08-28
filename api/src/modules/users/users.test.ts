import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../auth/actor.js';
import { signedIn } from '../../auth/tokens.test-support.js';

/* ════════════════════════════════════════════════════════════════════════════
 * Leaving, and being told to wait.
 *
 * Account deletion is irreversible and takes other people's screens with it if
 * it is got wrong — so what it does NOT touch is asserted as carefully as what
 * it does.
 *
 * The submission limit is the other half: a refusal that has to be useful. A
 * bare "no" is not something an interface can say anything with, so the number
 * of seconds is part of the contract and is tested as one.
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
  departedRecently: vi.fn(),
}));

const settingsRepository = vi.hoisted(() => ({
  readGlobal: vi.fn(),
  readForUser: vi.fn(),
  applyGlobal: vi.fn(),
  applyForUser: vi.fn(),
  clearAllForUser: vi.fn(),
  RESET: Symbol('reset'),
}));

const requestsRepository = vi.hoisted(() => ({
  insert: vi.fn(),
  insertUnderAuthorLimit: vi.fn(),
  countRecentByAuthor: vi.fn(),
  findCategoryId: vi.fn(),
  findById: vi.fn(),
}));

const categoriesRepository = vi.hoisted(() => ({ listActive: vi.fn(), findActiveId: vi.fn() }));
const statusesRepository = vi.hoisted(() => ({ listActive: vi.fn(), findDefaultId: vi.fn() }));

vi.mock('./users.repository.js', () => usersRepository);
vi.mock('../settings/settings.repository.js', () => settingsRepository);
vi.mock('../requests/requests.repository.js', () => requestsRepository);
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

const ADMIN: Actor = { ...REGULAR_USER, id: 1, displayName: 'Robin Alvarez', role: 'admin' };

const app = createApp();

/**
 * Stands in for the locked read the real repository does.
 *
 * The last-admin refusal is decided inside anonymise's own transaction now, in
 * a guard the repository calls with what it found while holding the admin rows
 * — because counting outside and writing inside was a window two departing
 * admins could both fit through, leaving the board with none.
 *
 * A mock that ignored the guard would leave that rule untested here. So this
 * mock plays the part: it calls the guard with the state the test declares, and
 * refuses in exactly the way the database would.
 */
function anonymisationSees(role: 'admin' | 'user', otherAdmins: number) {
  usersRepository.anonymise.mockImplementation(
    async (_id: number, guard?: (context: { role: string; otherAdmins: number }) => void) => {
      guard?.({ role, otherAdmins });
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  usersRepository.findByExternalId.mockResolvedValue(REGULAR_USER);
  usersRepository.findById.mockResolvedValue(REGULAR_USER);
  usersRepository.countOtherAdmins.mockResolvedValue(3);
  usersRepository.departedRecently.mockResolvedValue(false);
  anonymisationSees('user', 3);

  /**
   * The same arrangement as anonymise: the limit is now counted inside the
   * insert's transaction, with the author's row locked, so the mocked write has
   * to run the guard or the refusal would be untested here.
   *
   * It is shown whatever countRecentByAuthor is set to, which is what the
   * locked count would have found.
   */
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
  settingsRepository.readGlobal.mockResolvedValue(new Map());
  settingsRepository.readForUser.mockResolvedValue(new Map());
  requestsRepository.countRecentByAuthor.mockResolvedValue({ filed: 0, oldestInWindow: null });
  categoriesRepository.findActiveId.mockResolvedValue(2);
  statusesRepository.findDefaultId.mockResolvedValue(1);
});

describe('deleting an account', () => {
  it('anonymises rather than deleting, and says nothing back', async () => {
    await signedIn(request(app)).delete(`/api/users/${REGULAR_USER.id}`).expect(204);

    // The third argument is the departing subject's fingerprint, kept so that
    // the token they are still holding cannot be provisioned a fresh account.
    // This fixture has no external_id, so there is nothing to remember.
    expect(usersRepository.anonymise).toHaveBeenCalledWith(
      REGULAR_USER.id,
      expect.any(Function),
      null,
    );
  });

  it('403s deleting somebody else, and anonymises nobody', async () => {
    const response = await signedIn(request(app)).delete(`/api/users/${ADMIN.id}`);

    expect(response.status).toBe(403);
    expect(usersRepository.anonymise).not.toHaveBeenCalled();
  });

  /** An admin is not an exception here either. */
  it('403s an admin deleting another person’s account', async () => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);
    usersRepository.findById.mockResolvedValue(REGULAR_USER);

    const response = await signedIn(request(app)).delete(`/api/users/${REGULAR_USER.id}`);

    expect(response.status).toBe(403);
    expect(usersRepository.anonymise).not.toHaveBeenCalled();
  });

  /**
   * The dead end this refusal exists to prevent: nothing in this application
   * promotes anybody, so a board that reaches zero admins can never have one
   * again without an UPDATE by hand.
   *
   * A 409 rather than a 403 — they are allowed to do this, and the state of the
   * world is what stands in the way.
   */
  it('refuses the last admin, with 409, and anonymises nobody', async () => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);
    usersRepository.findById.mockResolvedValue(ADMIN);
    anonymisationSees('admin', 0);

    const response = await signedIn(request(app)).delete(`/api/users/${ADMIN.id}`);

    expect(response.status).toBe(409);
  });

  it('lets an admin go while another one remains', async () => {
    usersRepository.findByExternalId.mockResolvedValue(ADMIN);
    usersRepository.findById.mockResolvedValue(ADMIN);
    anonymisationSees('admin', 1);

    await signedIn(request(app)).delete(`/api/users/${ADMIN.id}`).expect(204);

    expect(usersRepository.anonymise).toHaveBeenCalledWith(ADMIN.id, expect.any(Function), null);
  });
});

describe('changing a display name', () => {
  it('403s changing somebody else’s, and writes nothing', async () => {
    const response = await signedIn(request(app))
      .patch(`/api/users/${ADMIN.id}`)
      .send({ displayName: 'Not mine to set' });

    expect(response.status).toBe(403);
    expect(usersRepository.updateDisplayName).not.toHaveBeenCalled();
  });

  it('refuses an empty one', async () => {
    const response = await signedIn(request(app))
      .patch(`/api/users/${REGULAR_USER.id}`)
      .send({ displayName: '   ' });

    expect(response.status).toBe(422);
    expect(usersRepository.updateDisplayName).not.toHaveBeenCalled();
  });

  /**
   * The role is not settable here, and the refusal is by name rather than a
   * silent drop — a payload that looks accepted and is ignored is the shape
   * privilege escalation hides in.
   */
  it('refuses a role in the payload rather than ignoring it', async () => {
    const response = await signedIn(request(app))
      .patch(`/api/users/${REGULAR_USER.id}`)
      .send({ displayName: 'Dana Okafor', role: 'admin' });

    expect(response.status).toBe(422);
    expect(usersRepository.updateDisplayName).not.toHaveBeenCalled();
  });
});

describe('the submission limit', () => {
  const VALID_BODY = {
    title: 'Dark mode for the board',
    description: 'Reading the board in the evening is harsh and a dark theme would help.',
    categoryId: 2,
  };

  it('lets a submission through while the caller is under the limit', async () => {
    requestsRepository.countRecentByAuthor.mockResolvedValue({ filed: 3, oldestInWindow: null });

    const response = await signedIn(request(app)).post('/api/requests').send(VALID_BODY);

    // What matters here is that the limiter did not refuse and the write was
    // reached. Reading the request back afterwards is the create path's own
    // business and is covered where that path is tested.
    expect(response.status).not.toBe(429);
    expect(requestsRepository.insertUnderAuthorLimit).toHaveBeenCalled();
  });

  /**
   * The refusal has to be useful. "How long until I may post again" is the
   * whole point of it being a 429 with a number rather than a 403 with a
   * sentence.
   */
  it('refuses with 429 and says how long, in the body and the header', async () => {
    const twentyThreeHoursAgo = new Date(Date.now() - 23 * 60 * 60 * 1000);
    requestsRepository.countRecentByAuthor.mockResolvedValue({
      filed: 20,
      oldestInWindow: twentyThreeHoursAgo,
    });

    const response = await signedIn(request(app)).post('/api/requests').send(VALID_BODY);

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe('RATE_LIMITED');

    // An hour, give or take the time this test took to run.
    expect(response.body.error.retryAfterSeconds).toBeGreaterThan(3500);
    expect(response.body.error.retryAfterSeconds).toBeLessThanOrEqual(3600);
    expect(response.headers['retry-after']).toBe(String(response.body.error.retryAfterSeconds));

    expect(requestsRepository.insert).not.toHaveBeenCalled();
  });

  /** The limit is a setting, so lowering it takes effect on the next submission. */
  it('follows the configured limit rather than a constant', async () => {
    settingsRepository.readGlobal.mockResolvedValue(new Map([['submissions.perUserPerDay', 2]]));
    requestsRepository.countRecentByAuthor.mockResolvedValue({
      filed: 2,
      oldestInWindow: new Date(),
    });

    const response = await signedIn(request(app)).post('/api/requests').send(VALID_BODY);

    expect(response.status).toBe(429);
    expect(requestsRepository.insert).not.toHaveBeenCalled();
  });

  /**
   * Counted per person, not per board: somebody else's submissions are not
   * anybody's limit.
   */
  it('counts the caller’s own submissions', async () => {
    requestsRepository.countRecentByAuthor.mockResolvedValue({
      filed: 20,
      oldestInWindow: new Date(),
    });

    await signedIn(request(app)).post('/api/requests').send(VALID_BODY);

    expect(requestsRepository.countRecentByAuthor).toHaveBeenCalledWith(REGULAR_USER.id, 24);
  });
});
