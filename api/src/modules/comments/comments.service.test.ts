import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../auth/actor.js';

/**
 * The deletion matrix, which is the whole of this feature's judgement.
 *
 * Whether a comment is removed or merely hidden depends on who is asking and
 * whether anybody has replied. Getting that wrong destroys other people's words
 * or leaves a moderator's decision untraceable, and neither shows up as a
 * crash — so it is tested directly rather than inferred from the endpoints.
 */
const commentsRepository = vi.hoisted(() => ({
  listForRequest: vi.fn(),
  findById: vi.fn(),
  insert: vi.fn(),
  updateBody: vi.fn(),
  countReplies: vi.fn(),
  approve: vi.fn(),
  listPending: vi.fn(),
  countPending: vi.fn(),
  hardDelete: vi.fn(),
  softDelete: vi.fn(),
  softDeleteReplies: vi.fn(),
}));
const requestsRepository = vi.hoisted(() => ({ exists: vi.fn() }));

/**
 * The moderation gate, stubbed shut by default.
 *
 * Every test below predates the setting and describes behaviour that has
 * nothing to do with it, so they run in the state the application ships in:
 * approval off. The tests that care turn it on explicitly.
 */
const settings = vi.hoisted(() => ({ globalValue: vi.fn() }));

vi.mock('./comments.repository.js', () => commentsRepository);
vi.mock('../requests/requests.repository.js', () => requestsRepository);
vi.mock('../settings/settings.service.js', () => settings);

const service = await import('./comments.service.js');
const { ConflictError, ForbiddenError, NotFoundError, ValidationError } = await import(
  '../../http/errors.js'
);

const DANA: Actor = {
  id: 2,
  externalId: null,
  email: 'dana@feedbackhub.local',
  displayName: 'Dana Okafor',
  role: 'user',
};

const SAM: Actor = { ...DANA, id: 3, displayName: 'Sam Lindqvist' };

const ADMIN: Actor = { ...DANA, id: 1, displayName: 'Robin Alvarez', role: 'admin' };

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    requestId: 7,
    parentId: null,
    authorId: DANA.id,
    authorDisplayName: DANA.displayName,
    body: 'A comment',
    createdAt: new Date('2026-08-21T09:00:00.000Z'),
    editedAt: null,
    approvedAt: new Date('2026-08-21T09:00:00.000Z'),
    isDeleted: false,
    deletedBy: null,
    hiddenWithParent: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  settings.globalValue.mockResolvedValue(false);
  requestsRepository.exists.mockResolvedValue(true);
  commentsRepository.findById.mockResolvedValue(record());
  commentsRepository.countReplies.mockResolvedValue(0);
});

describe('deleting a comment', () => {
  it('removes the row when the author deletes their own with no replies', async () => {
    commentsRepository.countReplies.mockResolvedValue(0);

    const outcome = await service.remove(DANA, 10);

    expect(outcome).toEqual({ kind: 'hard', repliesHidden: 0 });
    expect(commentsRepository.hardDelete).toHaveBeenCalledWith(10);
    expect(commentsRepository.softDelete).not.toHaveBeenCalled();
  });

  it('hides rather than removes when the author deletes their own WITH replies', async () => {
    // Hard deleting would cascade and destroy replies written by other people
    // because the person above them changed their mind.
    commentsRepository.countReplies.mockResolvedValue(2);

    const outcome = await service.remove(DANA, 10);

    expect(outcome).toEqual({ kind: 'soft', repliesHidden: 2 });
    expect(commentsRepository.hardDelete).not.toHaveBeenCalled();
    expect(commentsRepository.softDelete).toHaveBeenCalledWith(10, DANA.id);
    expect(commentsRepository.softDeleteReplies).toHaveBeenCalledWith(10, DANA.id);
  });

  it('always hides when an admin moderates somebody else, even with no replies', async () => {
    commentsRepository.countReplies.mockResolvedValue(0);

    const outcome = await service.remove(ADMIN, 10);

    expect(outcome.kind).toBe('soft');
    expect(commentsRepository.hardDelete).not.toHaveBeenCalled();
    expect(commentsRepository.softDelete).toHaveBeenCalledWith(10, ADMIN.id);
    // Nothing to hide underneath it.
    expect(commentsRepository.softDeleteReplies).not.toHaveBeenCalled();
  });

  it('hides the replies too when an admin moderates a comment that has them', async () => {
    commentsRepository.countReplies.mockResolvedValue(3);

    await service.remove(ADMIN, 10);

    expect(commentsRepository.softDeleteReplies).toHaveBeenCalledWith(10, ADMIN.id);
  });

  it('treats an admin deleting their OWN comment as an author, not a moderator', async () => {
    commentsRepository.findById.mockResolvedValue(record({ authorId: ADMIN.id }));
    commentsRepository.countReplies.mockResolvedValue(0);

    const outcome = await service.remove(ADMIN, 10);

    expect(outcome.kind).toBe('hard');
  });

  it('refuses a bystander', async () => {
    await expect(service.remove(SAM, 10)).rejects.toBeInstanceOf(ForbiddenError);
    expect(commentsRepository.hardDelete).not.toHaveBeenCalled();
    expect(commentsRepository.softDelete).not.toHaveBeenCalled();
  });

  it('refuses to delete something already removed', async () => {
    commentsRepository.findById.mockResolvedValue(
      record({ isDeleted: true, deletedBy: ADMIN.id }),
    );

    await expect(service.remove(DANA, 10)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('404s for a comment that is not there', async () => {
    commentsRepository.findById.mockResolvedValue(null);

    await expect(service.remove(DANA, 10)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('replying', () => {
  it('refuses a reply to a reply — the rule the database could not hold', async () => {
    commentsRepository.findById.mockResolvedValue(record({ id: 11, parentId: 10 }));

    await expect(
      service.create(SAM, 7, { body: 'nested too far', parentId: 11 }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(commentsRepository.insert).not.toHaveBeenCalled();
  });

  it('refuses a reply to a comment on a different request', async () => {
    commentsRepository.findById.mockResolvedValue(record({ requestId: 999 }));

    await expect(
      service.create(SAM, 7, { body: 'wrong thread', parentId: 10 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a reply to a removed comment', async () => {
    commentsRepository.findById.mockResolvedValue(record({ isDeleted: true, deletedBy: 1 }));

    await expect(
      service.create(SAM, 7, { body: 'answering a ghost', parentId: 10 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('takes the author from the identity seam, never the payload', async () => {
    commentsRepository.insert.mockResolvedValue(42);
    commentsRepository.findById
      .mockResolvedValueOnce(record())
      .mockResolvedValueOnce(record({ id: 42, parentId: 10, authorId: SAM.id }));

    await service.create(SAM, 7, { body: 'a reply', parentId: 10 });

    expect(commentsRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ authorId: SAM.id, parentId: 10, requestId: 7 }),
    );
  });
});

describe('editing', () => {
  it('refuses an admin editing somebody else, deliberately', async () => {
    // Moderation is removing a comment, not rewriting it under its author's
    // name. This is the rule most likely to be "fixed" by mistake later.
    await expect(service.edit(ADMIN, 10, { body: 'reworded' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(commentsRepository.updateBody).not.toHaveBeenCalled();
  });

  it('allows the author', async () => {
    commentsRepository.findById.mockResolvedValue(record());

    await service.edit(DANA, 10, { body: 'reworded' });

    expect(commentsRepository.updateBody).toHaveBeenCalledWith(10, 'reworded');
  });

  it('refuses editing a removed comment', async () => {
    commentsRepository.findById.mockResolvedValue(record({ isDeleted: true, deletedBy: DANA.id }));

    await expect(service.edit(DANA, 10, { body: 'reworded' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe('reading a thread', () => {
  it('nests replies under their parent and tells the three removal reasons apart', async () => {
    commentsRepository.listForRequest.mockResolvedValue([
      record({ id: 1, authorId: DANA.id }),
      record({ id: 2, parentId: 1, authorId: SAM.id, isDeleted: true, deletedBy: SAM.id }),
      record({
        id: 3,
        parentId: 1,
        authorId: SAM.id,
        isDeleted: true,
        deletedBy: ADMIN.id,
      }),
      record({
        id: 4,
        parentId: 1,
        authorId: SAM.id,
        isDeleted: true,
        deletedBy: DANA.id,
        hiddenWithParent: true,
      }),
    ]);

    const { comments } = await service.listForRequest(SAM, 7);

    expect(comments).toHaveLength(1);
    expect(comments[0]?.replies.map((r) => r.deletedReason)).toEqual([
      'author',
      'moderator',
      'with-parent',
    ]);
  });

  it('withholds the words of a removed comment rather than hiding them in the browser', async () => {
    commentsRepository.listForRequest.mockResolvedValue([
      record({ id: 1, isDeleted: true, deletedBy: ADMIN.id }),
    ]);

    const [comment] = (await service.listForRequest(SAM, 7)).comments;

    expect(comment?.body).toBeNull();
    expect(comment?.author).toBeNull();
    expect(comment?.isDeleted).toBe(true);
  });

  it('never offers a reply control on a reply, or on a removed comment', async () => {
    commentsRepository.listForRequest.mockResolvedValue([
      record({ id: 1 }),
      record({ id: 2, parentId: 1 }),
      record({ id: 3, isDeleted: true, deletedBy: ADMIN.id }),
    ]);

    const { comments } = await service.listForRequest(SAM, 7);

    expect(comments[0]?.canReply).toBe(true);
    expect(comments[0]?.replies[0]?.canReply).toBe(false);
    expect(comments[1]?.canReply).toBe(false);
  });

  it('404s for a request that does not exist', async () => {
    requestsRepository.exists.mockResolvedValue(false);

    await expect(service.listForRequest(SAM, 7)).rejects.toBeInstanceOf(NotFoundError);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The moderation gate.
 *
 * The setting is administrative and withheld; what is tested here is its
 * consequence, which is the only part anybody outside the admin screen ever
 * sees. Two directions matter and they are not symmetric:
 *
 *   switching it ON  must not touch anything already written
 *   switching it OFF must release whatever is waiting
 *
 * Both are properties of how a comment is stamped and how it is read, so both
 * are testable without a database.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('comment approval', () => {
  it('stamps a new comment as published while the gate is open', async () => {
    settings.globalValue.mockResolvedValue(false);
    commentsRepository.insert.mockResolvedValue(11);

    await service.create(DANA, 7, { body: 'A comment worth reading' });

    expect(commentsRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ approved: 1 }),
    );
  });

  /**
   * The half that stops switching moderation on from hiding the whole board:
   * everything written while it was off already carries an approval, so the
   * gate only ever applies to what comes after it.
   */
  it('leaves a new comment unstamped while the gate is up', async () => {
    settings.globalValue.mockResolvedValue(true);
    commentsRepository.insert.mockResolvedValue(11);

    await service.create(DANA, 7, { body: 'A comment worth reading' });

    expect(commentsRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ approved: 0 }),
    );
  });

  it('tells the composer that a comment posted now will wait', async () => {
    settings.globalValue.mockResolvedValue(true);
    commentsRepository.listForRequest.mockResolvedValue([]);

    const thread = await service.listForRequest(DANA, 7);

    expect(thread.awaitsApproval).toBe(true);
  });

  it('marks a waiting comment as pending, and a published one as not', async () => {
    settings.globalValue.mockResolvedValue(true);
    commentsRepository.listForRequest.mockResolvedValue([
      record({ id: 1, approvedAt: null }),
      record({ id: 2, approvedAt: new Date('2026-08-21T09:00:00.000Z') }),
    ]);

    const { comments } = await service.listForRequest(DANA, 7);

    expect(comments.map((c) => c.isPending)).toEqual([true, false]);
  });

  /**
   * An admin reads the thread with the pending ones in it, because judging them
   * out of context is not judging them at all. Everybody else reads it without
   * — except for their own, which the SQL keeps visible to its author.
   */
  it('shows an admin what is waiting, and a regular user what is not', async () => {
    settings.globalValue.mockResolvedValue(true);
    commentsRepository.listForRequest.mockResolvedValue([]);

    await service.listForRequest(ADMIN, 7);
    expect(commentsRepository.listForRequest).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({ seesPending: true }),
    );

    await service.listForRequest(DANA, 7);
    expect(commentsRepository.listForRequest).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({ seesPending: false }),
    );
  });

  /** With the gate open there is nothing waiting on anybody's judgement. */
  it('shows everybody everything once the gate is open', async () => {
    settings.globalValue.mockResolvedValue(false);
    commentsRepository.listForRequest.mockResolvedValue([]);

    await service.listForRequest(DANA, 7);

    expect(commentsRepository.listForRequest).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({ seesPending: true }),
    );
  });

  it('refuses to let a regular user approve anything', async () => {
    await expect(service.approve(DANA, 1)).rejects.toBeInstanceOf(ForbiddenError);
    expect(commentsRepository.approve).not.toHaveBeenCalled();
  });

  it('lets an admin approve, and reports a second approval as a conflict', async () => {
    commentsRepository.findById.mockResolvedValue(record({ id: 1, approvedAt: null }));
    commentsRepository.approve.mockResolvedValue(true);

    await service.approve(ADMIN, 1);
    expect(commentsRepository.approve).toHaveBeenCalledWith(1);

    commentsRepository.approve.mockResolvedValue(false);
    await expect(service.approve(ADMIN, 1)).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses to approve a comment that has been removed', async () => {
    commentsRepository.findById.mockResolvedValue(
      record({ id: 1, approvedAt: null, isDeleted: true, deletedBy: ADMIN.id }),
    );

    await expect(service.approve(ADMIN, 1)).rejects.toBeInstanceOf(ConflictError);
    expect(commentsRepository.approve).not.toHaveBeenCalled();
  });

  /* ── The control travels with the comment it is about ─────────────────── */

  it('offers approval on a waiting comment, to somebody who may approve', async () => {
    settings.globalValue.mockResolvedValue(true);
    commentsRepository.listForRequest.mockResolvedValue([record({ id: 1, approvedAt: null })]);

    const { comments } = await service.listForRequest(ADMIN, 7);

    expect(comments[0]).toMatchObject({ isPending: true, canApprove: true });
  });

  /**
   * Its author sees that it is waiting and cannot wave it through. The flag is
   * how the thread offers the control without being told who is reading.
   */
  it('does not offer approval to the person who wrote it', async () => {
    settings.globalValue.mockResolvedValue(true);
    commentsRepository.listForRequest.mockResolvedValue([
      record({ id: 1, authorId: DANA.id, approvedAt: null }),
    ]);

    const { comments } = await service.listForRequest(DANA, 7);

    expect(comments[0]).toMatchObject({ isPending: true, canApprove: false });
  });

  it('offers approval on nothing once it has been approved', async () => {
    settings.globalValue.mockResolvedValue(true);
    commentsRepository.listForRequest.mockResolvedValue([record({ id: 1 })]);

    const { comments } = await service.listForRequest(ADMIN, 7);

    expect(comments[0]).toMatchObject({ isPending: false, canApprove: false });
  });

  /** Rejecting is deleting, which an admin already has and which leaves a trail. */
  it('offers deletion alongside it, which is what rejecting is', async () => {
    settings.globalValue.mockResolvedValue(true);
    commentsRepository.listForRequest.mockResolvedValue([record({ id: 1, approvedAt: null })]);

    const { comments } = await service.listForRequest(ADMIN, 7);

    expect(comments[0]?.canDelete).toBe(true);
  });
});
