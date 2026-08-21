import type { RequestHandler } from 'express';
import type { Request } from 'express';
import type { Actor } from './actor.js';
import { IDENTITY_MODE } from './identity-mode.js';
import { env } from '../config/env.js';
import { UnauthenticatedError, MisconfigurationError } from '../http/errors.js';
import { findByEmail } from '../modules/users/users.repository.js';

/* ════════════════════════════════════════════════════════════════════════════
 *                              THE IDENTITY SEAM
 *
 * This function is the entire surface between "who is calling" and the rest of
 * the application. Authentication is deferred (decision 2); authorization is
 * not. Every endpoint enforces permissions from this slice onward, against an
 * identity this function invents.
 *
 * Today:  the seeded user named by DEV_CURRENT_USER_EMAIL, for every request.
 * Later:  verify the bearer token, then look the user up by
 *         external_id = the token's `sub`.
 *
 * The signature does not change when that happens. Nothing outside this file
 * may read a header, cookie or token to establish identity, and nothing outside
 * this file may decide what an identity is allowed to do — that is the policy
 * module's job.
 *
 * The lock: IDENTITY_MODE below is asserted at boot in src/config/env.ts, and
 * the process refuses to start if this development implementation is still
 * compiled in under NODE_ENV=production.
 * ══════════════════════════════════════════════════════════════════════════ */
export async function resolveCurrentUser(_req: Request): Promise<Actor | null> {
  if (IDENTITY_MODE !== 'development-seam') {
    throw new MisconfigurationError(
      'No identity provider is wired up for this build.',
    );
  }

  // Validated at boot: this is present whenever the development seam is active.
  const email = env.DEV_CURRENT_USER_EMAIL as string;

  // Read on every request rather than cached, so changing a user's role in the
  // database takes effect immediately instead of at the next restart. This is a
  // single indexed lookup; it becomes worth caching when there is a token to
  // cache against.
  const actor = await findByEmail(email);

  if (!actor) {
    throw new MisconfigurationError(
      `DEV_CURRENT_USER_EMAIL is set to "${email}" but no such user exists. ` +
        'Run `npm run seed`, or set it to one of the seeded users.',
    );
  }

  return actor;
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
