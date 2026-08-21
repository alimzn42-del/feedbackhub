import type { Actor } from '../auth/actor.js';
import { allow, type Decision } from './index.js';

export const categoryPolicy = {
  /**
   * Read — any authenticated user. Anyone filing a request has to be able to
   * see the categories they can file it under.
   *
   * The admin-only management rules join this object in the slice that adds the
   * endpoints for them; a rule with nothing asking it is a rule nobody checks.
   */
  list(_actor: Actor): Decision {
    return allow();
  },
} as const;
