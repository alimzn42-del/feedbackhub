import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { closePool } from '../../src/db/pool.js';
import * as commentsRepository from '../../src/modules/comments/comments.repository.js';
import { closeAdminConnection, one, resetToFresh, seededIds, sql } from './database.js';
import { ADMIN, DANA, SAM, bearerFor, mintToken, signedIn } from './harness.js';

/* ════════════════════════════════════════════════════════════════════════════
 *                    §16 — WINDOWS BETWEEN A READ AND A WRITE
 *
 * Each row here is a place the code reads something, decides, and then writes,
 * with nothing holding the world still in between. Some of those windows are
 * closed by the database — a primary key, a unique key on a generated column, a
 * conditional UPDATE whose affectedRows decides — and the rows for those are
 * here to prove they stay closed. The rest are open, and the tests say what
 * should have been true.
 *
 * TWO WAYS TO OPEN A WINDOW, AND WHY BOTH ARE HERE
 *
 * Where the race reproduces on its own, it is fired on its own: N real requests
 * through the real app, at once, and the table read afterwards. Nothing is
 * stubbed and the result is the behaviour.
 *
 * Where it needs a wider window than a fast machine gives it, one repository
 * call is wrapped so that it does exactly what it does today and then waits for
 * the test before returning. That is not a different code path — the value it
 * returns is the value it read — it is the same path with the interleaving made
 * deterministic, which is the only way a race becomes a test that can be run
 * twice. Every such stub is named in the test that installs it.
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

/** A promise the test opens by hand. */
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

async function categoryId(slug = 'bug') {
  return (await one<number>('SELECT id FROM categories WHERE slug = :slug', { slug })) as number;
}

async function fileRequestAs(bearer: string, title = 'A request to race against') {
  const response = await signedIn(request(app), bearer)
    .post('/api/requests')
    .send({
      title,
      description: 'Twenty characters at the very least, so the create schema is satisfied.',
      categoryId: await categoryId(),
    });
  expect(response.status).toBe(201);
  return response.body.data.id as number;
}

async function setGlobal(setting: Record<string, unknown>) {
  const response = await signedIn(request(app), await bearerFor(ADMIN))
    .patch('/api/settings')
    .send(setting);
  expect(response.status).toBe(200);
}

/**
 * A second admin who can actually sign in.
 *
 * The demo board has one, and it has no external_id — nobody in that data can
 * present a token. Promoting sam is the smallest thing that makes "two admins"
 * a state this suite can act as both halves of.
 */
async function promoteSamToAdmin() {
  await sql("UPDATE users SET role = 'admin' WHERE email = :email", { email: SAM.email });
}

describe('Z-01 ⚠ — the last two admins leave at the same instant', () => {
  /**
   * deleteAccount counts the OTHER admins, then anonymises. The count is not in
   * the transaction that writes and nothing is locked, so both callers can read
   * "one other admin remains" and both proceed.
   *
   * The 409 exists precisely to stop a board reaching zero admins, because
   * nothing in this application can appoint one. Under contention it does not.
   */
  it('leaves at least one admin standing', async () => {
    await promoteSamToAdmin();

    const responses = await Promise.all([
      signedIn(request(app), await bearerFor(ADMIN)).delete(`/api/users/${ids[ADMIN.email]}`),
      signedIn(request(app), await bearerFor(SAM)).delete(`/api/users/${ids[SAM.email]}`),
    ]);

    const remaining = await one<number>(
      "SELECT COUNT(*) FROM users WHERE role = 'admin' AND deleted_at IS NULL",
    );

    expect(responses.map((r) => r.status).sort()).toEqual([204, 409]);
    expect(remaining).toBeGreaterThanOrEqual(1);
  });
});

describe('Z-02 ⚠ — one person files ten requests at once, under a limit of one', () => {
  /**
   * assertNotRateLimited counts, then create() inserts. Ten callers can all
   * read `filed: 0`.
   *
   * DECISIONS chose service-level enforcement knowingly. Over-by-N under
   * concurrency is a consequence of that choice which is not written down
   * anywhere, and "as many as this board allows" is a sentence the board should
   * be able to keep.
   */
  it('accepts one and refuses the other nine', async () => {
    await setGlobal({ 'submissions.perUserPerDay': 1 });

    const bearer = await bearerFor(DANA);
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        signedIn(request(app), bearer)
          .post('/api/requests')
          .send({
            title: `Filed all at once, number ${i}`,
            description: 'Twenty characters at the very least, so the schema is satisfied here.',
            categoryId: 1,
          }),
      ),
    );

    const created = responses.filter((r) => r.status === 201).length;
    const refused = responses.filter((r) => r.status === 429).length;

    expect(created).toBe(1);
    expect(refused).toBe(9);
    expect(await one('SELECT COUNT(*) FROM feedback_requests')).toBe(1);
  });
});

describe('Z-03 ⚠ — a comment is deleted while a reply to it is being written', () => {
  /**
   * remove() counts replies, then hard-deletes when the count is zero and the
   * caller is the author. fk_comments_parent is ON DELETE CASCADE, so a reply
   * that lands in that window is destroyed by somebody else changing their mind
   * about their own comment.
   *
   * The window is widened by making countReplies return the number it really
   * read and then wait. Nothing else about the path changes.
   */
  /**
   * NO STUB, AND THAT IS THE POINT OF THE FIX.
   *
   * While this window was open, the probe needed one: the read and the write
   * were two statements and the test had to stop the world between them to see
   * anything. They are one locked transaction now, so there is nothing left to
   * hold open — the only honest test is to fire both callers for real and
   * assert the invariant on whichever order the database picks.
   *
   * Repeated, because a single pair may serialise the harmless way. What is
   * asserted never depends on which way it went: a reply that was accepted is
   * still there, and a reply that was refused was refused for the right reason.
   */
  it('never destroys a reply that was accepted', async () => {
    const requestId = await fileRequestAs(await bearerFor(DANA));
    const dana = await bearerFor(DANA);
    const sam = await bearerFor(SAM);

    for (let attempt = 0; attempt < 8; attempt++) {
      const parent = await signedIn(request(app), dana)
        .post(`/api/requests/${requestId}/comments`)
        .send({ body: `A comment that is about to be deleted (${attempt}).` });
      const parentId = parent.body.data.id as number;

      const [reply, removal] = await Promise.all([
        signedIn(request(app), sam)
          .post(`/api/requests/${requestId}/comments`)
          .send({ body: 'A reply racing the delete.', parentId })
          .then((r) => r),
        signedIn(request(app), dana)
          .delete(`/api/comments/${parentId}`)
          .then((r) => r),
      ]);

      expect(removal.status).toBe(200);

      if (reply.status === 201) {
        // Accepted. It must still exist, and if the parent went soft it must
        // have been hidden with it rather than left live under a tombstone.
        const row = await sql<{ deleted_at: Date | null; hidden_with_parent: number }>(
          'SELECT deleted_at, hidden_with_parent FROM comments WHERE id = :id',
          { id: reply.body.data.id },
        );

        expect(row).toHaveLength(1);
        expect(removal.body.data.kind).toBe('soft');
        if (row[0]!.deleted_at !== null) expect(row[0]!.hidden_with_parent).toBe(1);
      } else {
        expect(reply.status).toBe(422);
        expect(reply.body.error.details[0].code).toBe('GONE');
      }
    }
  });
});

describe('Z-04 ⚠ — a reply is written while an admin hides its parent', () => {
  /**
   * create() checks the parent is present, not a reply, and not removed — then
   * inserts. softDeleteReplies has already run by the time the insert lands, so
   * the new reply hangs, visible, from a tombstone, and nothing ever revisits
   * it.
   *
   * The window is widened on the parent lookup, and only on the first call:
   * create() reads the row again after inserting.
   */
  it('never leaves a live reply under a removed parent', async () => {
    const requestId = await fileRequestAs(await bearerFor(DANA));

    const parent = await signedIn(request(app), await bearerFor(DANA))
      .post(`/api/requests/${requestId}/comments`)
      .send({ body: 'A comment an admin is about to remove.' });
    const parentId = parent.body.data.id as number;

    const held = gate();
    const reached = gate();
    const original = commentsRepository.findById;
    let armed = true;
    const spy = vi.spyOn(commentsRepository, 'findById').mockImplementation(async (id: number) => {
      const record = await original(id);
      if (armed) {
        armed = false;
        reached.open();
        await held.promise;
      }
      return record;
    });

    try {
      const replying = signedIn(request(app), await bearerFor(SAM))
        .post(`/api/requests/${requestId}/comments`)
        .send({ body: 'A reply written while the parent was going.', parentId })
        .then((r) => r);

      // The reply has read the parent and checked it; nothing else is in flight,
      // so this is the create path and not the delete's own lookup.
      await reached.promise;

      const removed = await signedIn(request(app), await bearerFor(ADMIN)).delete(
        `/api/comments/${parentId}`,
      );
      expect(removed.status).toBe(200);
      expect(removed.body.data.kind).toBe('soft');

      held.open();
      const reply = await replying;

      if (reply.status === 201) {
        const hidden = await one<number>(
          'SELECT hidden_with_parent FROM comments WHERE id = :id',
          { id: reply.body.data.id },
        );
        expect(hidden).toBe(1);
      } else {
        expect(reply.status).toBe(422);
        expect(reply.body.error.details[0].code).toBe('GONE');
      }
    } finally {
      spy.mockRestore();
    }
  });
});

describe('Z-05 / V-05..V-07 / Z-07 / Z-10 — the windows the database closes', () => {
  /* These are expected to hold. They are here so that a change which quietly
     replaces a conditional UPDATE with a read-then-write is noticed. */

  it('Z-05: two admins approving one comment produce exactly one 200', async () => {
    await promoteSamToAdmin();
    await setGlobal({ 'comments.requireApproval': true });

    const requestId = await fileRequestAs(await bearerFor(ADMIN));
    const comment = await signedIn(request(app), await bearerFor(DANA))
      .post(`/api/requests/${requestId}/comments`)
      .send({ body: 'A comment two admins will reach for at once.' });
    const commentId = comment.body.data.id as number;

    const responses = await Promise.all([
      signedIn(request(app), await bearerFor(ADMIN)).put(`/api/comments/${commentId}/approval`),
      signedIn(request(app), await bearerFor(SAM)).put(`/api/comments/${commentId}/approval`),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('V-05: fifty people voting on one request produce fifty rows', async () => {
    const requestId = await fileRequestAs(await bearerFor(SAM));

    const voters = Array.from({ length: 50 }, (_, i) => ({
      sub: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      email: `voter${i}@feedbackhub.local`,
    }));

    await sql(
      'INSERT INTO users (email, display_name, role, external_id) VALUES ' +
        voters.map((_, i) => `(:e${i}, :n${i}, 'user', :x${i})`).join(', '),
      Object.fromEntries(
        voters.flatMap((v, i) => [
          [`e${i}`, v.email],
          [`n${i}`, `Voter ${i}`],
          [`x${i}`, v.sub],
        ]),
      ),
    );

    const bearers = await Promise.all(
      voters.map((v) => mintToken({ subject: v.sub, email: v.email, displayName: 'Voter' })),
    );

    const responses = await Promise.all(
      bearers.map((token) =>
        signedIn(request(app), `Bearer ${token}`).post(`/api/requests/${requestId}/vote`),
      ),
    );

    expect(responses.every((r) => r.status === 201)).toBe(true);
    expect(await one('SELECT COUNT(*) FROM votes WHERE request_id = :id', { id: requestId })).toBe(
      50,
    );
  });

  it('V-06: one person voting ten times produces one row and nine conflicts', async () => {
    const requestId = await fileRequestAs(await bearerFor(SAM));
    const bearer = await bearerFor(DANA);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        signedIn(request(app), bearer).post(`/api/requests/${requestId}/vote`),
      ),
    );

    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(9);
    expect(await one('SELECT COUNT(*) FROM votes WHERE request_id = :id', { id: requestId })).toBe(
      1,
    );
  });

  it('V-07: five casts and five withdrawals interleaved end consistent', async () => {
    const requestId = await fileRequestAs(await bearerFor(SAM));
    const bearer = await bearerFor(DANA);

    const calls = Array.from({ length: 10 }, (_, i) =>
      i % 2 === 0
        ? signedIn(request(app), bearer).post(`/api/requests/${requestId}/vote`)
        : signedIn(request(app), bearer).delete(`/api/requests/${requestId}/vote`),
    );

    const responses = await Promise.all(calls);
    expect(responses.every((r) => r.status === 200 || r.status === 201 || r.status === 409)).toBe(true);

    const rows = await one<number>('SELECT COUNT(*) FROM votes WHERE request_id = :id', {
      id: requestId,
    });
    const state = await signedIn(request(app), bearer).get(`/api/requests/${requestId}`);

    expect(rows === 0 || rows === 1).toBe(true);
    expect(state.body.data.hasVoted).toBe(rows === 1);
  });

  it('X-12 / Z-07: twenty concurrent default swaps leave exactly one default', async () => {
    const statuses = await sql<{ id: number }>('SELECT id FROM statuses ORDER BY id');
    const bearer = await bearerFor(ADMIN);

    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        const status = statuses[i % statuses.length];
        return signedIn(request(app), bearer).put(`/api/statuses/${status!.id}/default`);
      }),
    );

    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(await one('SELECT COUNT(*) FROM statuses WHERE is_default = 1')).toBe(1);
  });

  it('S-15: two admins writing different keys both land', async () => {
    await promoteSamToAdmin();

    const [a, b] = await Promise.all([
      signedIn(request(app), await bearerFor(ADMIN))
        .patch('/api/settings')
        .send({ 'board.defaultSort': 'votes' }),
      signedIn(request(app), await bearerFor(SAM))
        .patch('/api/settings')
        .send({ 'submissions.perUserPerDay': 7 }),
    ]);

    expect([a!.status, b!.status]).toEqual([200, 200]);
    expect(await one('SELECT COUNT(*) FROM app_settings')).toBe(2);
  });

  it('S-16 / Z-10: two admins writing the same key leave one value and no 500', async () => {
    await promoteSamToAdmin();

    const responses = await Promise.all([
      signedIn(request(app), await bearerFor(ADMIN))
        .patch('/api/settings')
        .send({ 'board.defaultSort': 'votes' }),
      signedIn(request(app), await bearerFor(SAM))
        .patch('/api/settings')
        .send({ 'board.defaultSort': 'oldest' }),
    ]);

    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(
      await one("SELECT COUNT(*) FROM app_settings WHERE setting_key = 'board.defaultSort'"),
    ).toBe(1);
    expect(
      await one("SELECT updated_by FROM app_settings WHERE setting_key = 'board.defaultSort'"),
    ).toBeTruthy();
  });

  it('Z-08: a category created during a reorder still sits last, with no tie', async () => {
    const bearer = await bearerFor(ADMIN);
    const existing = await sql<{ id: number }>('SELECT id FROM categories ORDER BY sort_order');
    const reversed = existing.map((r) => r.id).reverse();

    const [reorder, created] = await Promise.all([
      signedIn(request(app), bearer).put('/api/categories/order').send({ ids: reversed }),
      signedIn(request(app), bearer).post('/api/categories').send({ name: 'Docs', slug: 'docs' }),
    ]);

    expect(reorder.status).toBe(200);
    expect(created.status).toBe(201);

    const orders = await sql<{ slug: string; sort_order: number }>(
      'SELECT slug, sort_order FROM categories ORDER BY sort_order, name',
    );
    const docs = orders.find((r) => r.slug === 'docs');

    expect(docs).toBeDefined();
    expect(docs!.sort_order).toBe(Math.max(...orders.map((r) => r.sort_order)));
  });
});
