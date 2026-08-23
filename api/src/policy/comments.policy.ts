import type { Actor } from '../auth/actor.js';
import { allow, deny, isAdmin, type Decision } from './index.js';

/**
 * The minimum a comment rule needs to know. Deliberately not the whole row: a
 * policy that only sees authorship and deletion cannot start depending on the
 * body or the timestamps.
 */
export interface CommentSubject {
  authorId: number;
  isDeleted: boolean;
}

const isAuthor = (actor: Actor, comment: CommentSubject): boolean =>
  actor.id === comment.authorId;

export const commentPolicy = {
  /** Read — any authenticated user. The board is internal and fully visible. */
  list(_actor: Actor): Decision {
    return allow();
  },

  /** Write — any authenticated user, on any request. */
  create(_actor: Actor): Decision {
    return allow();
  },

  /**
   * Letting a waiting comment through — admin only.
   *
   * Note what this rule is NOT. It does not let an admin edit the comment, and
   * there is no "approve with changes": an admin decides whether words are
   * published, never what the words are. That is the same line delete and
   * editContent already draw, and approval is the third place it has to hold.
   *
   * Rejecting is not a separate rule either — it is `delete`, which an admin
   * already has, and which records who did it. A rejection that left no trace
   * would be the one moderation act on this board that nobody could audit.
   */
  approve(actor: Actor): Decision {
    return isAdmin(actor) ? allow() : deny('Only an admin can approve comments.');
  },

  /**
   * Edit — the author only, and never an admin on somebody else's words.
   *
   * Same rule as a feedback request, for the same reason: moderation means
   * removing a comment, not rewriting it under its author's name. This is the
   * rule most likely to be "fixed" by mistake later, so the test says so.
   */
  editContent(actor: Actor, comment: CommentSubject): Decision {
    if (!isAuthor(actor, comment)) {
      return deny('Only the author can edit this comment.');
    }
    if (comment.isDeleted) {
      return deny('This comment has been removed and cannot be edited.');
    }
    return allow();
  },

  /**
   * Delete — the author, or an admin acting as a moderator.
   *
   * *What* deletion means depends on who is asking and whether anything has
   * been said in reply; that is the service's job, not this one's. The rule
   * here is only who may ask.
   */
  delete(actor: Actor, comment: CommentSubject): Decision {
    if (comment.isDeleted) {
      return deny('This comment has already been removed.');
    }
    if (isAuthor(actor, comment) || isAdmin(actor)) {
      return allow();
    }
    return deny('Only the author or an admin can delete this comment.');
  },
} as const;
