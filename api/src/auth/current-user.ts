import type { RequestHandler } from 'express';
import type { Request } from 'express';
import type { Actor } from './actor.js';
import { IDENTITY_MODE } from './identity-mode.js';
import { env } from '../config/env.js';
import { UnauthenticatedError, MisconfigurationError } from '../http/errors.js';
import { findByEmail, findByExternalId, updateEmail } from '../modules/users/users.repository.js';
import { provision } from './provision.js';
import { bearerTokenFrom, verifyAccessToken, type VerifiedIdentity } from './verify-token.js';

/* ════════════════════════════════════════════════════════════════════════════
 *                              THE IDENTITY SEAM
 *
 * This function is the entire surface between "who is calling" and the rest of
 * the application. Everything above it — every handler, every service, every
 * policy function — was written against an Actor and against nothing else, and
 * none of it moved when authentication arrived. That was the point of building
 * this as a seam instead of leaving a hole.
 *
 * Nothing outside this file may read a header, cookie or token to establish
 * identity, and nothing outside this file may decide what an identity is
 * allowed to do — that is the policy module's job.
 *
 * TWO MODES, ONE OF THEM FORBIDDEN IN PRODUCTION
 *
 *   keycloak          verify the bearer token, then look the user up by
 *                     external_id = the token's `sub`. The default, and what a
 *                     reviewer runs.
 *
 *   development-seam  every request is the seeded user named by
 *                     DEV_CURRENT_USER_EMAIL. Retained so the board can be run
 *                     without a container — and asserted against at boot, in
 *                     src/config/env.schema.ts, so a build carrying it cannot
 *                     start under NODE_ENV=production.
 *
 * Both branches end in the same place: an Actor read from the local users
 * table, or provisioned through the same single call in ./provision.ts. The
 * role comes from that row in both, and from a token claim in neither.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * A returning user, whose provider says something different from what we stored.
 *
 * Only the email is reconciled, and it is reconciled in one direction. The
 * display name is NOT: it is copied from the token once, at provisioning, and
 * belongs to the person from then on — the account screen exists to change it,
 * and overwriting their choice on every request would make that screen a
 * control that appears to work and silently does nothing.
 *
 * The email is the opposite: nothing in this application edits it, so a
 * difference can only mean the provider moved and the local copy is stale.
 */
async function reconcile(actor: Actor, identity: VerifiedIdentity): Promise<Actor> {
  if (actor.email === identity.email) return actor;

  /**
   * An unverified address does not get to overwrite a verified one. This is the
   * same rule the realm applies when it links a social identity to an existing
   * account, asserted a second time here, because "the provider is configured
   * correctly" is not something an API should have to assume about the thing
   * whose word it is taking.
   */
  if (!identity.emailVerified) return actor;

  await updateEmail(actor.id, identity.email);
  return { ...actor, email: identity.email };
}

/** The real thing: a verified token, and the local row it names. */
async function resolveFromToken(req: Request): Promise<Actor> {
  const token = bearerTokenFrom(req.get('authorization'));

  if (!token) {
    throw new UnauthenticatedError('This request carries no access token.', 'token.missing');
  }

  // Signature, issuer, audience and expiry. Throws an UnauthenticatedError
  // carrying which of them failed; see http/errors.ts.
  const identity = await verifyAccessToken(token);

  const existing = await findByExternalId(identity.subject);

  if (existing) {
    return reconcile(existing, identity);
  }

  /**
   * First arrival. Authenticating and being admitted are different decisions
   * and this is the boundary between them: the token is genuine, and whether
   * this board gives the person an account is the registration policy's call,
   * made in provision() and nowhere else.
   *
   * An unverified address is never provisioned. Without that, an installation
   * restricted to a domain could be entered by registering that address at a
   * provider which does not check it.
   */
  if (!identity.emailVerified) {
    throw new UnauthenticatedError(
      'Your email address has not been verified with your identity provider.',
      'token.unusable',
    );
  }

  return provision({
    email: identity.email,
    externalId: identity.subject,
    displayName: identity.displayName,
  });
}

/** The development stand-in. Authenticates nobody; see the boot guard. */
async function resolveFromDevelopmentSeam(): Promise<Actor | null> {
  // Validated at boot: this is present whenever the development seam is active.
  const email = env.DEV_CURRENT_USER_EMAIL as string;

  const actor = await findByEmail(email);

  if (actor) {
    return actor;
  }

  /**
   * Nobody by that name yet — which is exactly the moment the registration
   * policy is for, and deliberately the SAME call the real provider makes.
   * Point DEV_CURRENT_USER_EMAIL at an address nobody has used and an open
   * board admits you while a restricted one refuses by name.
   */
  return provision({ email, externalId: null });
}

export async function resolveCurrentUser(req: Request): Promise<Actor | null> {
  if (IDENTITY_MODE === 'keycloak') {
    return resolveFromToken(req);
  }

  if (IDENTITY_MODE === 'development-seam') {
    return resolveFromDevelopmentSeam();
  }

  throw new MisconfigurationError('No identity provider is wired up for this build.');
}
/* ═══════════════════════════ END OF THE SEAM ════════════════════════════ */

/**
 * Establishes req.actor for everything mounted behind it. Routes that need an
 * identity sit behind this middleware and therefore never null-check it.
 */
export const attachCurrentUser: RequestHandler = (req, _res, next) => {
  resolveCurrentUser(req)
    .then((actor) => {
      if (!actor) {
        throw new UnauthenticatedError();
      }
      req.actor = actor;
      next();
    })
    .catch(next);
};
