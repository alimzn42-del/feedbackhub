import type { RequestHandler } from 'express';
import { env } from '../../config/env.js';
import { IDENTITY_MODE } from '../../auth/identity-mode.js';

/* ════════════════════════════════════════════════════════════════════════════
 *                       WHERE TO GO AND GET AN IDENTITY
 *
 * The one endpoint under /api that is not behind attachCurrentUser, and the
 * only one there will ever be.
 *
 * WHY THIS IS NOT PART OF /api/bootstrap
 * Bootstrap answers "who am I, and how is this board configured for me". Every
 * word of that presupposes an identity, and it is authenticated for exactly
 * that reason. This answers "where do I go to become somebody", which by
 * definition cannot be. They are not two ways of asking one question — one of
 * them is the question you ask before you are able to ask the other.
 *
 * WHY IT IS AN ENDPOINT AND NOT A BUILD-TIME FILE IN THE WEB APP
 * The realm, the client id and the port are already configuration this API
 * holds, and they have to agree with what it verifies against. A second copy
 * compiled into the browser bundle is a second place to change them and a way
 * for the client to be sending people to a realm the API does not trust. The
 * web application ships with no knowledge of any of it, in the same way it
 * ships with no knowledge of what an admin may do.
 *
 * WHAT IT DOES NOT CONTAIN
 * No secret, because the browser is a public client and there is nothing to
 * keep. Everything here is published by the realm's own discovery document to
 * anybody who asks; this is a convenience, not a disclosure.
 * ══════════════════════════════════════════════════════════════════════════ */
export const getAuthConfig: RequestHandler = (_req, res) => {
  /**
   * Honest about the development seam.
   *
   * When the seam is the compiled-in mode there is nowhere to send anybody: the
   * API is inventing an identity for every caller. Saying so lets the web
   * application skip the whole sign-in flow rather than redirect the browser to
   * a realm that is not running, and it means a developer who has flipped the
   * constant sees a board rather than a broken redirect.
   */
  if (IDENTITY_MODE !== 'keycloak') {
    res.status(200).json({ data: { mode: IDENTITY_MODE } });
    return;
  }

  res.status(200).json({
    data: {
      mode: 'keycloak',
      issuer: env.OIDC_ISSUER_URL,
      clientId: env.OIDC_CLIENT_ID,
    },
  });
};
