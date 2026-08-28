import type { Actor } from '../../auth/actor.js';
import {
  ConflictError,
  MisconfigurationError,
  NotFoundError,
  ValidationError,
} from '../../http/errors.js';
import { authorize } from '../../policy/index.js';
import { commentPolicy } from '../../policy/comments.policy.js';
import * as requestsRepository from '../requests/requests.repository.js';
import * as commentsRepository from './comments.repository.js';
import type { CommentRecord } from './comments.repository.js';
import type {
  CommentDto,
  CommentThreadDto,
  CreateCommentBody,
  DeletionReason,
  EditCommentBody,
} from './comments.schema.js';
import { globalValue } from '../settings/settings.service.js';
import { isAdmin } from '../../policy/index.js';

/**
 * Why a comment shows as removed.
 *
 * Author-versus-moderator is derived, because `deletedBy === authorId` is a
 * fact about the data. Hidden-with-parent is not derivable and is recorded: a
 * reply hidden because its parent went carries the parent-remover's id, which
 * does not match the reply author's, and would otherwise read as moderation.
 */
function reasonFor(comment: CommentRecord): DeletionReason | null {
  if (!comment.isDeleted) return null;
  if (comment.hiddenWithParent) return 'with-parent';
  return comment.deletedBy === comment.authorId ? 'author' : 'moderator';
}

function toDto(actor: Actor, comment: CommentRecord, canReply: boolean): CommentDto {
  const subject = { authorId: comment.authorId, isDeleted: comment.isDeleted };

  return {
    id: comment.id,
    parentId: comment.parentId,
    // Removed words do not leave the server. The row is kept for the trail, not
    // for the reader.
    author: comment.isDeleted
      ? null
      : { id: comment.authorId, displayName: comment.authorDisplayName },
    body: comment.isDeleted ? null : comment.body,
    createdAt: comment.createdAt.toISOString(),
    editedAt: comment.editedAt ? comment.editedAt.toISOString() : null,
    isDeleted: comment.isDeleted,
    deletedReason: reasonFor(comment),
    canEdit: commentPolicy.editContent(actor, subject).allowed,
    canDelete: commentPolicy.delete(actor, subject).allowed,
    // A reply cannot be replied to, and a removed comment cannot be answered.
    canReply: canReply && !comment.isDeleted,
    isPending: comment.approvedAt === null && !comment.isDeleted,
    canApprove:
      comment.approvedAt === null &&
      !comment.isDeleted &&
      commentPolicy.approve(actor).allowed,
    replies: [],
  };
}

async function requireRequest(requestId: number): Promise<void> {
  if (!(await requestsRepository.exists(requestId))) {
    throw new NotFoundError('That request does not exist.');
  }
}

/**
 * The whole thread, two levels, assembled from one query.
 *
 * A removed top-level comment is still returned: its replies need something to
 * hang from. A removed reply is returned too, as a tombstone — the only replies
 * that vanish entirely are the ones their own author removed, which are gone
 * from the table.
 */
export async function listForRequest(
  actor: Actor,
  requestId: number,
): Promise<CommentThreadDto> {
  authorize(commentPolicy.list(actor));
  await requireRequest(requestId);

  const gateIsUp = await globalValue('comments.requireApproval');

  const records = await commentsRepository.listForRequest(requestId, {
    id: actor.id,
    seesPending: isAdmin(actor) || !gateIsUp,
  });

  const roots = new Map<number, CommentDto>();
  const orphanedReplies: CommentDto[] = [];

  for (const record of records) {
    if (record.parentId === null) {
      roots.set(record.id, toDto(actor, record, true));
    }
  }

  for (const record of records) {
    if (record.parentId === null) continue;

    const parent = roots.get(record.parentId);
    const dto = toDto(actor, record, false);

    if (parent) {
      parent.replies.push(dto);
    } else {
      // Cannot happen: the composite foreign key guarantees a reply's parent is
      // on the same request, and the query fetched every row of it. Kept so a
      // future schema change surfaces as a visible reply rather than a silently
      // dropped one.
      orphanedReplies.push(dto);
    }
  }

  return {
    comments: [...roots.values(), ...orphanedReplies],
    awaitsApproval: gateIsUp,
  };
}

/**
 * How many comments are waiting, for the one place that says so.
 *
 * There is deliberately no endpoint that LISTS them. A queue of comments taken
 * out of the discussions they belong to is not something anybody can judge:
 * "that is not what I meant" is fine or not entirely depending on what it
 * answers. The count is the discovery path; the thread is where the decision is
 * made.
 */
export async function countPending(actor: Actor): Promise<number> {
  authorize(commentPolicy.approve(actor));
  return commentsRepository.countPending();
}

/**
 * Lets one comment through.
 *
 * A comment that was already approved is a 409 and not a silent success: two
 * admins working the queue at once should be told that one of them was second,
 * rather than both being told they did it.
 */
export async function approve(actor: Actor, id: number): Promise<CommentDto> {
  authorize(commentPolicy.approve(actor));

  const comment = await load(id);

  if (comment.isDeleted) {
    throw new ConflictError('That comment has been removed, so there is nothing to approve.');
  }

  const approved = await commentsRepository.approve(id);

  if (!approved) {
    throw new ConflictError('That comment has already been approved.');
  }

  const updated = await load(id);

  return toDto(actor, updated, updated.parentId === null);
}

export async function create(
  actor: Actor,
  requestId: number,
  input: CreateCommentBody,
): Promise<CommentDto> {
  authorize(commentPolicy.create(actor));
  await requireRequest(requestId);

  let parentId: number | null = null;

  if (input.parentId !== undefined) {
    const parent = await commentsRepository.findById(input.parentId);

    if (!parent || parent.requestId !== requestId) {
      throw new ValidationError('The submitted values are not valid.', [
        {
          field: 'parentId',
          code: 'NOT_FOUND',
          message: 'That comment is not on this request.',
        },
      ]);
    }

    // The depth limit the database could not hold. Enforced here because
    // expressing it as a constraint costs the cascade — see 007.do.comments.sql.
    if (parent.parentId !== null) {
      throw new ValidationError('The submitted values are not valid.', [
        {
          field: 'parentId',
          code: 'TOO_DEEP',
          message: 'You can reply to a comment, but not to a reply.',
        },
      ]);
    }

    if (parent.isDeleted) {
      throw new ValidationError('The submitted values are not valid.', [
        {
          field: 'parentId',
          code: 'GONE',
          message: 'That comment has been removed, so it cannot be replied to.',
        },
      ]);
    }

    parentId = parent.id;
  }

  const id = await commentsRepository.insert({
    requestId,
    parentId,
    // Authorship comes from the identity seam, never from the payload.
    authorId: actor.id,
    body: input.body,
    // Stamped as published on the way in whenever the gate is open, so turning
    // moderation on later does not retroactively hide everything ever written.
    approved: (await globalValue('comments.requireApproval')) ? 0 : 1,
  });

  if (id === null) {
    // The parent was live when it was checked a moment ago and is not now. The
    // same answer as if it had been removed before the reply was written —
    // which, from the reader's point of view, it was.
    throw new ValidationError('The submitted values are not valid.', [
      {
        field: 'parentId',
        code: 'GONE',
        message: 'That comment has been removed, so it cannot be replied to.',
      },
    ]);
  }

  const created = await commentsRepository.findById(id);

  if (!created) {
    throw new MisconfigurationError('The comment was saved but could not be read back.');
  }

  return toDto(actor, created, created.parentId === null);
}

async function load(id: number): Promise<CommentRecord> {
  const comment = await commentsRepository.findById(id);

  if (!comment) {
    throw new NotFoundError('That comment does not exist.');
  }

  return comment;
}

export async function edit(
  actor: Actor,
  id: number,
  input: EditCommentBody,
): Promise<CommentDto> {
  const comment = await load(id);

  authorize(
    commentPolicy.editContent(actor, {
      authorId: comment.authorId,
      isDeleted: comment.isDeleted,
    }),
  );

  await commentsRepository.updateBody(id, input.body);

  const updated = await load(id);
  return toDto(actor, updated, updated.parentId === null);
}

export interface DeleteOutcome {
  /** 'hard' when the row is gone; 'soft' when it remains as a tombstone. */
  kind: 'hard' | 'soft';
  repliesHidden: number;
}

/**
 * Deletion is two operations, and which one applies depends on who is asking
 * and whether anybody has replied.
 *
 *   author, no replies   -> the row goes. Nothing is attached, nothing is lost.
 *   author, has replies  -> hidden. Hard deleting would cascade, destroying
 *                           other people's replies because the person above
 *                           them changed their mind.
 *   admin, any           -> hidden, always. A moderator removing somebody
 *                           else's words is the case the audit trail exists
 *                           for.
 *
 * A reply can never have replies, so an author removing their own reply is
 * always the first case and an admin removing one is always the third.
 *
 * "Has replies" counts every reply row, including already-hidden ones — see
 * the repository.
 */
export async function remove(actor: Actor, id: number): Promise<DeleteOutcome> {
  const comment = await load(id);

  authorize(
    commentPolicy.delete(actor, {
      authorId: comment.authorId,
      isDeleted: comment.isDeleted,
    }),
  );

  /**
   * Who is asking is decided here; whether anything is attached is decided
   * under a lock, in the repository.
   *
   * The count and the delete used to be two statements, and a reply arriving
   * between them was accepted and then destroyed by the parent's cascade. The
   * rule is unchanged — an author with nothing attached gets the row removed,
   * everybody else gets a tombstone — but "nothing attached" is now read and
   * acted on without letting go.
   */
  return commentsRepository.removeWithReplies(id, actor.id, comment.authorId === actor.id);
}
