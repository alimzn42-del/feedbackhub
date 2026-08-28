import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { closePool } from '../../src/db/pool.js';
import { closeAdminConnection, one, resetToFresh, seededIds, sql } from './database.js';
import { ADMIN, DANA, NEWCOMER, SAM, bearerFor, mintToken, signedIn } from './harness.js';

/* ════════════════════════════════════════════════════════════════════════════
 *                       §17 — THE PROBES, AS FAILING TESTS
 *
 * Every row here is one the plan predicts will fail, written the way the plan
 * says to write it: asserting what SHOULD be true, so that a red test is the
 * finding rather than a note in a document saying a finding is likely.
 *
 * They are together in one file on purpose. A probe that has been fixed becomes
 * a regression test and moves to the file for its section; what is left in here
 * is the list of things that are still wrong, and it should be readable as
 * exactly that.
 *
 * The concurrency probes (§16) live in concurrency.itest.ts — they need a
 * different kind of set-up and they are slower.
 * ══════════════════════════════════════════════════════════════════════════ */

const app = createApp();

let ids: Record<string, number>;

beforeEach(async () => {
  await resetToFresh();
  ids = await seededIds();
});

afterAll(async () => {
  await closePool();
  await closeAdminConnection();
});

/** A request filed by whoever the bearer names, returning its id. */
async function fileRequest(bearer: string, overrides: Record<string, unknown> = {}) {
  const categoryId = await one<number>("SELECT id FROM categories WHERE slug = 'bug'");
  const response = await signedIn(request(app), bearer)
    .post('/api/requests')
    .send({
      title: 'A request to hang a probe from',
      description: 'Twenty characters at the very least, so the create schema is satisfied.',
      categoryId,
      ...overrides,
    });
  return response;
}

async function setGlobal(setting: Record<string, unknown>) {
  const response = await signedIn(request(app), await bearerFor(ADMIN))
    .patch('/api/settings')
    .send(setting);
  expect(response.status).toBe(200);
}

describe('P-08 — the provider moves an address onto one another row already holds', () => {
  /**
   * dana signs in with sam's address. reconcile() calls updateEmail with no
   * duplicate handling, so ER_DUP_ENTRY on uq_users_email reaches the error
   * middleware as an unrecognised error.
   *
   * What should happen is what provision() already does for the same collision
   * on a first arrival: a 409 that names the problem. A person whose address
   * was changed at the provider cannot act on "something went wrong", and the
   * operator reading the log cannot tell it from a genuine fault.
   */
  it('answers 409 naming the collision, not 500', async () => {
    const response = await signedIn(
      request(app),
      `Bearer ${await mintToken({
        subject: DANA.sub,
        email: SAM.email,
        displayName: DANA.displayName,
      })}`,
    ).get('/api/bootstrap');

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONFLICT');
    expect(response.body.error.message).toMatch(/email address/i);
  });

  it('leaves both rows exactly as they were', async () => {
    await signedIn(
      request(app),
      `Bearer ${await mintToken({ subject: DANA.sub, email: SAM.email })}`,
    ).get('/api/bootstrap');

    expect(await one('SELECT email FROM users WHERE id = :id', { id: ids[DANA.email] })).toBe(
      DANA.email,
    );
    expect(await one('SELECT email FROM users WHERE id = :id', { id: ids[SAM.email] })).toBe(
      SAM.email,
    );
  });
});

describe('P-14 — a still-valid token for an account that has just been deleted', () => {
  /**
   * Anonymising clears external_id and moves the address to a placeholder, so
   * the very next request carrying the same (still valid, up to 300s) token
   * matches nothing, finds the address free, and is provisioned a NEW account.
   *
   * The person who pressed Delete is signed in again as a stranger with their
   * own name on it, and the board now holds two rows for them: one anonymised,
   * one fresh. SCOPE says a returning person gets a new account. It does not
   * say the same session should, and E-14 shows the web app doing exactly this
   * to itself within a second of the 204.
   */
  it('does not provision a second account for the subject that just left', async () => {
    const bearer = await bearerFor(SAM);
    const before = await one<number>('SELECT COUNT(*) FROM users');

    const deleted = await signedIn(request(app), bearer).delete(`/api/users/${ids[SAM.email]}`);
    expect(deleted.status).toBe(204);

    // The same token, the same second, the way a client that kept it would.
    const after = await signedIn(request(app), bearer).get('/api/bootstrap');

    // 401 so the browser's interceptor signs out, rather than a new account.
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('UNAUTHENTICATED');
    expect(await one('SELECT COUNT(*) FROM users')).toBe(before);
  });

  it('leaves exactly one row for the person who left', async () => {
    const bearer = await bearerFor(SAM);
    await signedIn(request(app), bearer).delete(`/api/users/${ids[SAM.email]}`);
    await signedIn(request(app), bearer).get('/api/bootstrap');

    const rows = await sql<{ id: number; email: string; external_id: string | null }>(
      'SELECT id, email, external_id FROM users WHERE external_id = :sub OR id = :id',
      { sub: SAM.sub, id: ids[SAM.email] },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.external_id).toBeNull();
  });
});

describe('C-25 / C-26 / C-27 — the gate releases in the read and never in a write', () => {
  /**
   * A comment written while approval is required is stored with approved_at
   * NULL. Turning approval off makes it readable, because visibility asks the
   * gate — but nothing ever stamps the row.
   *
   * Three consequences, and they are the three rows:
   *   C-25 it still reports isPending / canApprove to an admin, on a comment
   *        everybody can already read;
   *   C-26 turning the gate back on hides it again, which DECISIONS explicitly
   *        says will not happen ("comments written from then on, and nothing
   *        already on screen");
   *   C-27 ?pending=true lists the request as waiting when nothing is.
   */
  async function aCommentWrittenUnderTheGate() {
    await setGlobal({ 'comments.requireApproval': true });

    const filed = await fileRequest(await bearerFor(SAM));
    const requestId = filed.body.data.id;

    const comment = await signedIn(request(app), await bearerFor(DANA))
      .post(`/api/requests/${requestId}/comments`)
      .send({ body: 'Written while the gate was up.' });

    expect(comment.status).toBe(201);
    expect(comment.body.data.isPending).toBe(true);

    await setGlobal({ 'comments.requireApproval': false });

    return { requestId, commentId: comment.body.data.id as number };
  }

  it('C-25: a released comment is not still reported as waiting', async () => {
    const { requestId } = await aCommentWrittenUnderTheGate();

    const thread = await signedIn(request(app), await bearerFor(ADMIN)).get(
      `/api/requests/${requestId}/comments`,
    );

    expect(thread.status).toBe(200);
    expect(thread.body.data[0].isPending).toBe(false);
    expect(thread.body.data[0].canApprove).toBe(false);
  });

  it('C-26: turning the gate back on does not hide what was already on screen', async () => {
    const { requestId } = await aCommentWrittenUnderTheGate();

    // sam is the request's author and not the comment's; with the gate down he
    // can read it. Putting the gate back up must not take it away again.
    const before = await signedIn(request(app), await bearerFor(SAM)).get(
      `/api/requests/${requestId}/comments`,
    );
    expect(before.body.data).toHaveLength(1);

    await setGlobal({ 'comments.requireApproval': true });

    const after = await signedIn(request(app), await bearerFor(SAM)).get(
      `/api/requests/${requestId}/comments`,
    );
    expect(after.body.data).toHaveLength(1);
  });

  it('C-27: nothing is listed as waiting once the gate is down', async () => {
    await aCommentWrittenUnderTheGate();

    const pending = await signedIn(request(app), await bearerFor(ADMIN)).get(
      '/api/requests?pending=true',
    );

    expect(pending.status).toBe(200);
    expect(pending.body.data).toHaveLength(0);
  });
});

describe('H-02 — a body larger than the parser accepts', () => {
  /**
   * express.json({ limit: '256kb' }) rejects with a PayloadTooLargeError, whose
   * `type` is 'entity.too.large'. It is not a SyntaxError, so isJsonParseFailure
   * does not recognise it; it is not an AppError, so it falls to the unknown
   * branch and is answered as a 500.
   *
   * A client that sent too much is not a server fault, and the envelope is
   * meant to be the one shape every failure arrives in.
   */
  it('answers 413 in the envelope', async () => {
    const response = await signedIn(request(app), await bearerFor(DANA))
      .post('/api/requests')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ title: 'x'.repeat(300 * 1024), description: 'y', categoryId: 1 }));

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(response.body.error.requestId).toBeTruthy();
  });
});

describe('R-10 — editing a request whose category has since been retired', () => {
  /**
   * The author wants to fix a typo in the title. The edit schema requires all
   * three fields, so the form sends the categoryId it already has — and
   * findActiveId excludes archived rows, so the write is refused on a field the
   * author did not touch and the form cannot even display.
   *
   * Product gap rather than a defect: the decision is whether a retired
   * category may be kept on a request that already carries it. This asserts the
   * answer "yes, keeping what you already have is not choosing it".
   */
  it('lets the author keep a retired category they already had', async () => {
    const categoryId = await one<number>("SELECT id FROM categories WHERE slug = 'question'");
    const filed = await fileRequest(await bearerFor(DANA), { categoryId });
    expect(filed.status).toBe(201);

    const archived = await signedIn(request(app), await bearerFor(ADMIN)).put(
      `/api/categories/${categoryId}/archive`,
    );
    expect(archived.status).toBe(200);

    const edited = await signedIn(request(app), await bearerFor(DANA))
      .patch(`/api/requests/${filed.body.data.id}`)
      .send({
        title: 'A request to hang a probe from, spelled correctly',
        description: 'Twenty characters at the very least, so the create schema is satisfied.',
        categoryId,
      });

    expect(edited.status).toBe(200);
  });

  it('still refuses a MOVE onto a retired category', async () => {
    const bugId = await one<number>("SELECT id FROM categories WHERE slug = 'bug'");
    const questionId = await one<number>("SELECT id FROM categories WHERE slug = 'question'");
    const filed = await fileRequest(await bearerFor(DANA), { categoryId: bugId });

    await signedIn(request(app), await bearerFor(ADMIN)).put(
      `/api/categories/${questionId}/archive`,
    );

    const edited = await signedIn(request(app), await bearerFor(DANA))
      .patch(`/api/requests/${filed.body.data.id}`)
      .send({
        title: 'Moving onto a retired category',
        description: 'Twenty characters at the very least, so the create schema is satisfied.',
        categoryId: questionId,
      });

    expect(edited.status).toBe(422);
    expect(edited.body.error.details[0].field).toBe('categoryId');
  });
});

describe('Z-09 — a newcomer whose first two requests arrive together', () => {
  /**
   * Both miss on external_id, both provision, and the second hits uq_users_email
   * — where the ConflictError branch cannot tell "the same subject, raced"
   * from "a different subject, collided". A first sign-in is answered with a
   * message about linking accounts.
   *
   * Written here rather than in concurrency.itest.ts because it needs no
   * widened window: two real requests in flight is enough.
   */
  it('creates one row and answers both callers as that person', async () => {
    const bearer = await bearerFor(NEWCOMER);

    const [first, second] = await Promise.all([
      signedIn(request(app), bearer).get('/api/bootstrap'),
      signedIn(request(app), bearer).get('/api/bootstrap'),
    ]);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await one('SELECT COUNT(*) FROM users WHERE external_id = :sub', { sub: NEWCOMER.sub }))
      .toBe(1);
    expect(first.body.data.user.id).toBe(second.body.data.user.id);
  });
});

describe('Z-12 — voting on a request that has just been deleted', () => {
  /**
   * votes.service.cast reads the author id, then INSERT IGNOREs. Between the
   * two the request can go, and the FK violation the insert would have raised
   * is downgraded to a warning by IGNORE — affectedRows is 0, which the service
   * reads as "already voted".
   *
   * The window is widened deterministically rather than by timing: the vote is
   * cast against an id that no longer exists while findAuthorId is made to
   * answer as it did a moment earlier. That is precisely the state the race
   * produces, and it does not depend on how fast the machine is.
   */
  it('answers 404, not 409, when the row is gone by the time the vote lands', async () => {
    const filed = await fileRequest(await bearerFor(SAM));
    const requestId = filed.body.data.id as number;

    await sql('DELETE FROM feedback_requests WHERE id = :id', { id: requestId });

    const requestsRepository = await import('../../src/modules/requests/requests.repository.js');
    const spy = vi.spyOn(requestsRepository, 'findAuthorId').mockResolvedValue(ids[SAM.email]!);

    try {
      const response = await signedIn(request(app), await bearerFor(DANA)).post(
        `/api/requests/${requestId}/vote`,
      );

      expect(response.status).toBe(404);
      expect(response.body.error.message).not.toMatch(/already voted/i);
    } finally {
      spy.mockRestore();
    }
  });
});
