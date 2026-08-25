import type { Actor } from './actor.js';
import { isDuplicateEntry } from '../db/errors.js';
import { ConflictError, ForbiddenError } from '../http/errors.js';
import { globalValue } from '../modules/settings/settings.service.js';
import * as usersRepository from '../modules/users/users.repository.js';

/**
 * Whether this application will give somebody an account, and the account
 * itself if it will.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE CHECK IS HERE AND NOT IN THE IDENTITY PROVIDER
 *
 * Authenticating and being admitted are two different decisions, and only one
 * of them is Keycloak's. When it lands, a person will be able to present a
 * perfectly valid token — the provider is satisfied that they are who they say
 * — and still be refused an account here, because this board decided who it
 * lets in. Putting the rule in the provider would move a product decision into
 * infrastructure and make it invisible to the screen that is supposed to
 * configure it.
 *
 * So this is the seam's second half. `resolveCurrentUser` answers "who is
 * calling"; this answers "and do they get to be here", and it is the only
 * place that does.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface ProvisionRequest {
  email: string;

  /** From the identity provider's `sub`, once there is one. */
  externalId: string | null;

  /** What the provider says they are called, if it says anything. */
  displayName?: string | undefined;
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

/**
 * A name to show until they change it, taken from the address.
 *
 * Not the whole email: the local part is what people write on a name badge and
 * the domain is not theirs. They can set a real one on the settings screen.
 */
function nameFromEmail(email: string): string {
  const local = email.slice(0, email.lastIndexOf('@'));
  return local.length > 0 ? local : email;
}

/**
 * Applies the registration policy. Refuses by naming the rule, not the value —
 * telling a stranger which domains are admitted would answer a question about
 * the installation that they have not been let into.
 */
export async function assertMayRegister(email: string): Promise<void> {
  const policy = await globalValue('registration.policy');

  if (policy === 'open') return;

  const allowed = await globalValue('registration.allowedDomains');

  if (!allowed.includes(domainOf(email))) {
    throw new ForbiddenError(
      'This board is not open for registration. Ask an admin to add your email domain.',
    );
  }
}

/**
 * Admits somebody, or refuses them.
 *
 * Everybody arrives as an ordinary user. Nothing a caller sends decides their
 * role, and the first admin is the one the seed creates — an application where
 * registering could make you an admin has no authorization model at all.
 */
export async function provision(input: ProvisionRequest): Promise<Actor> {
  await assertMayRegister(input.email);

  try {
    return await usersRepository.insert({
      email: input.email,
      displayName: input.displayName?.trim() || nameFromEmail(input.email),
      externalId: input.externalId,
    });
  } catch (error) {
    /**
     * An account already holds this address, under a different subject.
     *
     * This is the shape of the failure that the pinned identities in the realm
     * import exist to prevent: a local row whose external_id does not match the
     * token, so matching misses and provisioning tries to create a second
     * account for the same person. It is also what a social login would produce
     * if the realm were configured to create a fresh account rather than link
     * to the existing one on a verified address.
     *
     * A 409 naming the collision rather than the driver's ER_DUP_ENTRY reaching
     * the error handler as an opaque 500 — because the person hitting this can
     * do nothing about it and the operator reading the log needs to know which
     * of those two things went wrong.
     */
    if (isDuplicateEntry(error, 'uq_users_email')) {
      throw new ConflictError(
        'An account on this board already uses that email address under a different ' +
          'sign-in. Ask an admin to link them.',
      );
    }

    throw error;
  }
}
