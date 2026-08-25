import { describe, expect, it } from 'vitest';
import { certificateUrl } from './jwks.js';

/* ════════════════════════════════════════════════════════════════════════════
 * Where the public keys are fetched from.
 *
 * Small, and worth having: this is the one place where the realm's ADDRESS and
 * the realm's IDENTITY are allowed to differ, and getting it wrong in either
 * direction is quiet. Too permissive and the verifier trusts a key set from
 * somewhere the issuer check never sees; too rigid and the API cannot reach
 * Keycloak from inside a container network at all.
 * ══════════════════════════════════════════════════════════════════════════ */
describe('the JWKS URL', () => {
  it('is the realm plus the path Keycloak publishes keys at', () => {
    expect(certificateUrl('http://localhost:8080/realms/feedbackhub').toString()).toBe(
      'http://localhost:8080/realms/feedbackhub/protocol/openid-connect/certs',
    );
  });

  /**
   * A trailing slash on a URL in an environment file is not a typo anybody
   * notices, and the resulting `//protocol` is a 404 from Keycloak — which
   * surfaces as "this token could not be verified" and sends somebody looking
   * at the token.
   */
  it('does not double the separator when the realm URL ends in a slash', () => {
    expect(certificateUrl('http://localhost:8080/realms/feedbackhub///').toString()).toBe(
      'http://localhost:8080/realms/feedbackhub/protocol/openid-connect/certs',
    );
  });

  /**
   * The container case this exists for: the browser reaches Keycloak at
   * localhost and mints tokens saying so, while the API reaches the same server
   * by its service name. Fetching from the issuer string would resolve
   * `localhost` inside the API's own container.
   */
  it('is built from whichever base it is given, identity or address', () => {
    expect(certificateUrl('http://keycloak:8080/realms/feedbackhub').toString()).toBe(
      'http://keycloak:8080/realms/feedbackhub/protocol/openid-connect/certs',
    );
  });
});
