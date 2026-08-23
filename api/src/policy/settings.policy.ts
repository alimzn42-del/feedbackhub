import type { Actor } from '../auth/actor.js';
import { allow, deny, isAdmin, isSelf, type Decision } from './index.js';
import type { SettingVisibility } from '../modules/settings/settings.registry.js';

export const settingPolicy = {
  /**
   * Whether this caller may see a setting at all.
   *
   * The only rule in this module that gates a READ of a value rather than a
   * write of one. Everywhere else on this board a field is sent and the action
   * behind it refused; here an administrative setting is absent from the
   * payload entirely, because how the installation is run — who may register,
   * how often anybody may post — is not a fact every account is owed.
   *
   * It is not the guarantee that they cannot learn it, and it does not try to
   * be: a setting whose effect is visible is visible. What it stops is the
   * application handing over its own configuration unasked.
   */
  read(actor: Actor, visibility: SettingVisibility): Decision {
    if (visibility === 'everyone') return allow();

    return isAdmin(actor) ? allow() : deny('Only an admin can see the application settings.');
  },

  /** Reading the whole administrative document, for the screen that edits it. */
  readGlobal(actor: Actor): Decision {
    return isAdmin(actor) ? allow() : deny('Only an admin can see the application settings.');
  },

  writeGlobal(actor: Actor): Decision {
    return isAdmin(actor) ? allow() : deny('Only an admin can change the application settings.');
  },

  /**
   * Preferences are the person's own, and an admin is not an exception.
   *
   * This is the same shape as editContent on a request: an admin moderates,
   * an admin does not rewrite. There is no administrative reason to choose
   * somebody else's colour scheme, and the day there is a reason to act on
   * another account it will be user administration, with its own audit trail —
   * not a settings write that leaves no record of who made it.
   */
  writeUser(actor: Actor, targetUserId: number): Decision {
    return isSelf(actor, targetUserId)
      ? allow()
      : deny('You can only change your own preferences.');
  },

  /**
   * Deleting an account, which anonymises it.
   *
   * Your own, and nobody else's — for now by the same reasoning as above: there
   * is no user administration in this application, so there is no audited path
   * by which one person removes another. The refusal that matters more is the
   * one the service adds on top of this: the last admin cannot leave, because
   * an installation with no admin cannot appoint one.
   */
  deleteAccount(actor: Actor, targetUserId: number): Decision {
    return isSelf(actor, targetUserId) ? allow() : deny('You can only delete your own account.');
  },
} as const;
