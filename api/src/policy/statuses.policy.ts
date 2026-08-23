import type { Actor } from '../auth/actor.js';
import { allow, deny, isAdmin, type Decision } from './index.js';

export const statusPolicy = {
  /**
   * Read — any authenticated user. Anyone who can see the board can see the
   * statuses it can be filtered by; the chips already name them on every card.
   */
  list(_actor: Actor): Decision {
    return allow();
  },

  /**
   * Create, rename, reorder and set the default — admin only.
   *
   * There is no retire here, and that is not an oversight. A category is a
   * label a request keeps regardless; a status is a position in a workflow that
   * requests are currently sitting in, and retiring one would strand them
   * somewhere that no longer exists.
   */
  manage(actor: Actor): Decision {
    return isAdmin(actor) ? allow() : deny('Only an admin can manage statuses.');
  },

  listAll(actor: Actor): Decision {
    return isAdmin(actor) ? allow() : deny('Only an admin can see the managed statuses.');
  },
} as const;
