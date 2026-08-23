import type { Actor } from '../auth/actor.js';
import { allow, deny, isAdmin, type Decision } from './index.js';

/**
 * The minimum a rule needs to know about a feedback request. Deliberately not
 * the full row: a policy that only sees authorship cannot accidentally start
 * depending on a status or a category.
 */
export interface RequestSubject {
  authorId: number;
}

const isAuthor = (actor: Actor, request: RequestSubject): boolean =>
  actor.id === request.authorId;

export const requestPolicy = {
  /**
   * Filtering the board down to what is waiting for moderation — admin only.
   *
   * Refused rather than ignored. A filter that quietly did nothing would tell a
   * regular user that no requests have comments waiting, which is a different
   * and wrong answer to a question they were not allowed to ask.
   */
  filterPending(actor: Actor): Decision {
    return isAdmin(actor)
      ? allow()
      : deny('Only an admin can filter the board by comments waiting for approval.');
  },

  /** Create — any authenticated user. */
  create(_actor: Actor): Decision {
    return allow();
  },

  /** Read — any authenticated user. The board is internal and fully visible. */
  list(_actor: Actor): Decision {
    return allow();
  },

  read(_actor: Actor): Decision {
    return allow();
  },

  /**
   * Edit title, description, category — the author only.
   *
   * Admins are excluded on purpose. Moderation means deleting a request or
   * changing its status; it does not mean rewriting what somebody wrote under
   * their own name.
   */
  editContent(actor: Actor, request: RequestSubject): Decision {
    return isAuthor(actor, request)
      ? allow()
      : deny('Only the author can edit this request.');
  },

  /** Delete — the author, or an admin acting as a moderator. */
  delete(actor: Actor, request: RequestSubject): Decision {
    if (isAuthor(actor, request) || isAdmin(actor)) {
      return allow();
    }
    return deny('Only the author or an admin can delete this request.');
  },

  /** Change status — admin only. This is triage, not authorship. */
  changeStatus(actor: Actor): Decision {
    return isAdmin(actor) ? allow() : deny('Only an admin can change a request status.');
  },

  /** Pin or unpin — admin only. */
  setPinned(actor: Actor): Decision {
    return isAdmin(actor) ? allow() : deny('Only an admin can pin or unpin a request.');
  },
} as const;
