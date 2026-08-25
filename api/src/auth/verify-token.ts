import { errors as joseErrors, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../config/env.js';
import {
  ProviderUnavailableError,
  UnauthenticatedError,
  type AppError,
  type UnauthenticatedReason,
} from '../http/errors.js';
import { verificationKeys } from './jwks.js';

/* ════════════════════════════════════════════════════════════════════════════
 *                            WHAT A TOKEN HAS TO PROVE
 *
 * Four things, and none of them is optional:
 *
 *   signature   it was minted by a key the provider published
 *   issuer      by THIS realm, and not another one that also runs Keycloak
 *   audience    for THIS API, and not for some other client of the same realm
 *   expiry      recently enough to still mean anything
 *
 * The audience check is the one that is easiest to leave out and the one most
 * worth having. A token issued to a different client of the same realm carries
 * a perfect signature from an issuer this API trusts. Without `audience` it
 * would be accepted here, which would make every other client of that realm a
 * way in.
 *
 * The algorithm list is closed for the same reason. `alg: none` and an HMAC
 * signed with the public key are both attacks that only work against a verifier
 * that lets the token choose how it will be checked.
 * ══════════════════════════════════════════════════════════════════════════ */

/** What the provider vouched for. Not an Actor: nothing here decides a role. */
export interface VerifiedIdentity {
  /** The `sub` claim. Stable for the lifetime of the account, and opaque. */
  subject: string;
  email: string;
  /** Whether the provider says the address has been proven. */
  emailVerified: boolean;
  /** What the provider calls them, if it says anything at all. */
  displayName: string | undefined;
}

interface KeycloakClaims extends JWTPayload {
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  preferred_username?: unknown;
}

/**
 * The Authorization header, reduced to the credential.
 *
 * Case-insensitive on the scheme because RFC 7235 says it is, and a client that
 * sends `bearer` is not wrong. An empty credential is missing rather than
 * malformed: there is nothing there to have been malformed.
 */
export function bearerTokenFrom(header: string | undefined): string | null {
  if (!header) return null;

  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== 'bearer') return null;

  const credential = rest.join(' ');
  return credential.length > 0 ? credential : null;
}

/**
 * Turns a verification failure into a refusal that says which failure it was.
 *
 * jose reports claim failures through one error type carrying the name of the
 * claim, so the issuer and audience cases are separated here rather than by
 * catching different classes.
 */
function refusalFor(error: unknown): AppError {
  /**
   * Not a verification failure at all — the key set could not be fetched. A
   * network error from `fetch` arrives here as a plain TypeError, so this is
   * checked first, by what the error is NOT: anything jose did not raise came
   * from trying to reach the provider.
   *
   * It is a 503 and never a 401. See ProviderUnavailableError for why.
   */
  if (!(error instanceof joseErrors.JOSEError)) {
    return new ProviderUnavailableError();
  }

  if (error instanceof joseErrors.JWTExpired) {
    return new UnauthenticatedError('Your session has expired. Sign in again.', 'token.expired');
  }

  if (error instanceof joseErrors.JWTClaimValidationFailed) {
    const claim: UnauthenticatedReason =
      error.claim === 'iss'
        ? 'token.issuer'
        : error.claim === 'aud'
          ? 'token.audience'
          : error.claim === 'nbf'
            ? 'token.not-yet-valid'
            : 'token.unusable';

    return new UnauthenticatedError('This token is not valid for this application.', claim);
  }

  if (error instanceof joseErrors.JWSSignatureVerificationFailed) {
    return new UnauthenticatedError('This token could not be verified.', 'token.signature');
  }

  // No key in the set matches the token's `kid`, or the key set could not be
  // read. Both mean the same thing to the caller and different things to an
  // operator, so they are one message and two reasons.
  if (error instanceof joseErrors.JWKSNoMatchingKey) {
    return new UnauthenticatedError('This token could not be verified.', 'token.signature');
  }

  if (
    error instanceof joseErrors.JWKSTimeout ||
    error instanceof joseErrors.JWKSMultipleMatchingKeys ||
    error instanceof joseErrors.JWKSInvalid
  ) {
    return new ProviderUnavailableError();
  }

  if (
    error instanceof joseErrors.JWSInvalid ||
    error instanceof joseErrors.JWTInvalid ||
    error instanceof joseErrors.JOSEAlgNotAllowed
  ) {
    return new UnauthenticatedError('This token could not be read.', 'token.malformed');
  }

  // Anything else from the verifier is still a failure to establish identity,
  // and is still not the caller's business. It is distinguishable in the log by
  // being the only reason that does not name what was wrong.
  return new UnauthenticatedError('This token could not be verified.', 'token.malformed');
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Verifies a bearer token and reports who the provider says is calling.
 *
 * This function does not touch the database and does not decide anything about
 * permissions. It answers exactly one question — is this a genuine token from
 * our realm, and whose — and the seam does the rest.
 */
export async function verifyAccessToken(token: string): Promise<VerifiedIdentity> {
  let claims: KeycloakClaims;

  try {
    const verified = await jwtVerify<KeycloakClaims>(token, verificationKeys(), {
      issuer: env.OIDC_ISSUER_URL as string,
      audience: env.OIDC_AUDIENCE as string,
      algorithms: ['RS256'],
      clockTolerance: env.OIDC_CLOCK_TOLERANCE_SECONDS,
    });
    claims = verified.payload;
  } catch (error) {
    throw refusalFor(error);
  }

  const subject = stringClaim(claims.sub);
  const email = stringClaim(claims.email);

  /**
   * A token that verifies and carries nobody.
   *
   * `sub` is what an account is matched on, and an email is what the
   * registration policy is applied to — this application cannot admit somebody
   * it cannot name. A service account token would land here, which is correct:
   * there is no machine caller in this API.
   */
  if (!subject || !email) {
    throw new UnauthenticatedError(
      'This token does not identify a person this board can admit.',
      'token.unusable',
    );
  }

  return {
    subject,
    email: email.toLowerCase(),
    emailVerified: claims.email_verified === true,
    displayName: stringClaim(claims.name) ?? stringClaim(claims.preferred_username),
  };
}
