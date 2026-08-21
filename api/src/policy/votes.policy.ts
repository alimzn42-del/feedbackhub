import type { Actor } from '../auth/actor.js';
import { allow, deny, type Decision } from './index.js';

/**
 * The minimum a vote rule needs to know about the request being voted on.
 */
export interface VoteSubject {
  authorId: number;
}

export const votePolicy = {
  /**
   * Cast a vote — any authenticated user, except on your own request.
   *
   * The vote count is the priority signal that replaces the same suggestion
   * arriving five times by email. An author voting for their own request adds a
   * point of noise to that signal and tells nobody anything: they filed it, so
   * of course they want it. Every request would start at one.
   *
   * Note what is NOT a rule here: *whose* vote gets cast. That is not checked,
   * because it cannot be violated — the user id comes from the identity seam and
   * neither the URL nor the payload has anywhere to put a different one. The
   * "vote for yourself only" rule from the brief is structural, the same way
   * authorship is.
   */
  cast(actor: Actor, request: VoteSubject): Decision {
    if (request.authorId === actor.id) {
      return deny('You cannot vote on your own request.');
    }
    return allow();
  },

  /**
   * Withdraw a vote — always allowed, because the only vote reachable through
   * the API is the caller's own. There is no route that names somebody else's
   * vote, so there is nothing here to refuse.
   */
  withdraw(_actor: Actor): Decision {
    return allow();
  },
} as const;
