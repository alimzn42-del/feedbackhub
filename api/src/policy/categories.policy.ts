import type { Actor } from '../auth/actor.js';
import { allow, deny, isAdmin, type Decision } from './index.js';

export const categoryPolicy = {
  /**
   * Read — any authenticated user. Anyone filing a request has to be able to
   * see the categories they can file it under.
   */
  list(_actor: Actor): Decision {
    return allow();
  },

  /**
   * Create, rename, reorder, retire and restore — admin only, and one rule for
   * all of them.
   *
   * Not split into five: they are the same decision made in the same place by
   * the same people, and five identical rules would be five places to get it
   * wrong. The moment one of them differs — say, retiring needs a second pair
   * of eyes — it earns its own rule and its own name.
   */
  manage(actor: Actor): Decision {
    return isAdmin(actor) ? allow() : deny('Only an admin can manage categories.');
  },

  /**
   * Reading the managed listing: the display order, the retirement state and
   * the usage count. Same rule as changing them, because the counts describe
   * the board's shape and are nobody else's business.
   */
  listAll(actor: Actor): Decision {
    return isAdmin(actor) ? allow() : deny('Only an admin can see the managed categories.');
  },
} as const;
