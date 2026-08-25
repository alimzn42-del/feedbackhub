import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import { env } from '../config/env.js';

/* ════════════════════════════════════════════════════════════════════════════
 *                       WHERE THE SIGNING KEYS COME FROM
 *
 * One module, one job: hand the verifier a public key for the `kid` in a
 * token's header. It is the ONLY part of authentication that talks to the
 * network, and it is deliberately the only part of authentication the test
 * suite replaces.
 *
 * That line is where it is on purpose. Everything downstream of this — the
 * signature check, the issuer, the audience, the expiry, and which key in the
 * set matches the token — runs for real under test, against a key pair the
 * tests generate for themselves. What the tests do not exercise is `fetch`,
 * which is not the part anybody doubts.
 *
 * WHY NOT A REQUEST TO KEYCLOAK PER TOKEN
 * Verification is a local operation: the key set is public, and a signature
 * either checks out against it or does not. Asking the provider to validate
 * every call would put an outage in front of every request and a round trip
 * inside every one that survived.
 *
 * createRemoteJWKSet is what does the caching. It fetches once, serves from
 * memory afterwards, and refetches when a token arrives with a `kid` it has not
 * seen — with a cooldown, so a stream of tokens signed by an unknown key cannot
 * turn into a stream of requests to the provider. Key rotation therefore heals
 * itself without a restart, and does not need a timer here.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Keycloak publishes its keys at a fixed path below the realm, and the realm
 * URL is the issuer. Deriving it means there is no second variable that can
 * disagree with OIDC_ISSUER_URL — the failure where an API verifies against one
 * realm's keys while insisting on another realm's `iss` cannot be configured.
 */
function certificateUrl(issuer: string): URL {
  return new URL(`${issuer.replace(/\/+$/, '')}/protocol/openid-connect/certs`);
}

let cached: JWTVerifyGetKey | null = null;

/**
 * The key set, created once per process.
 *
 * Lazy rather than created at import: nothing should reach out to the provider
 * because a module was loaded, and the first token is the first moment this is
 * genuinely needed.
 */
export function verificationKeys(): JWTVerifyGetKey {
  cached ??= createRemoteJWKSet(certificateUrl(env.OIDC_ISSUER_URL as string), {
    // A provider that is slow is a provider that is down, as far as a request
    // holding a connection open is concerned.
    timeoutDuration: 5_000,
    // How long an unrecognised `kid` may trigger a refetch. Below this, an
    // unknown key is simply rejected from what is already in memory.
    cooldownDuration: 30_000,
    // Refresh at least this often even when every `kid` is familiar, so a
    // retired key stops being accepted without waiting for a restart.
    cacheMaxAge: 600_000,
  });

  return cached;
}
