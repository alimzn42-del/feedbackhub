import { z } from 'zod';
import { IDENTITY_MODE } from '../auth/identity-mode.js';

/**
 * The shape of the environment, and the guards that run over it at boot.
 *
 * Nothing here reads process.env or has any other side effect — ./env.ts is the
 * only module that does, and it is the only module permitted to. A missing or
 * malformed variable stops the process with a message naming it, rather than
 * surfacing as an undefined three layers down.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().max(65535).default(3000),
  WEB_ORIGIN: z.url().default('http://localhost:4200'),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().max(65535).default(3306),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().max(1000).default(10),

  /**
   * Development-only. Selects which seeded user every request runs as.
   * Required while IDENTITY_MODE is the development seam, and forbidden in
   * production — see assertIdentityIsSafeFor below.
   */
  DEV_CURRENT_USER_EMAIL: z.email().optional(),

  /**
   * The realm's IDENTITY: the exact string every token carries as `iss`, and
   * the only value this API compares that claim against.
   *
   * It is the URL a browser reaches Keycloak at, because that is the host
   * Keycloak mints tokens under. Locally:
   * http://localhost:8080/realms/feedbackhub
   */
  OIDC_ISSUER_URL: z.url().optional(),

  /**
   * The realm's ADDRESS, when it differs from its identity.
   *
   * These are two different things and containers are where that stops being
   * pedantry. In a compose network the browser reaches Keycloak at
   * `http://localhost:8080` and the API reaches the same server at
   * `http://keycloak:8080`; the token says `localhost` either way, because the
   * browser is what asked for it. An API that fetched the key set from the
   * issuer string would be resolving `localhost` inside its own container and
   * finding nothing.
   *
   * So: `iss` is checked against OIDC_ISSUER_URL, always. The keys are fetched
   * from here when it is set, and from the issuer when it is not — which keeps
   * the single-value case a single value, and cannot silently point the
   * verifier at a different realm, because the realm a token claims to be from
   * is still the only thing `iss` is compared to.
   */
  OIDC_INTERNAL_URL: z.url().optional(),

  /**
   * What this API is called in a token's `aud`. A token minted for a different
   * client is a valid token and is not valid *here*, which is the whole reason
   * this is checked separately from the signature.
   */
  OIDC_AUDIENCE: z.string().min(1).optional(),

  /**
   * The public client the browser authenticates as. The API never uses it; it
   * is here so the web application can be told where to sign in without a
   * build-time configuration file of its own — see modules/auth.
   */
  OIDC_CLIENT_ID: z.string().min(1).optional(),

  /**
   * Optional clock leeway, in seconds, for `exp` and `nbf`. Zero by default:
   * the API and the provider are the same machine in development and should be
   * time-synchronised in a deployment, and a generous default here is an
   * expired token being accepted without anybody choosing that.
   */
  OIDC_CLOCK_TOLERANCE_SECONDS: z.coerce.number().int().min(0).max(300).default(0),
});

export type Env = z.infer<typeof EnvSchema>;

export class EnvironmentError extends Error {
  override readonly name = 'EnvironmentError';
}

/**
 * The structural lock on the development identity seam.
 *
 * The seam accepts an unauthenticated request and hands it a fully privileged
 * identity chosen by an environment variable. That is exactly right in
 * development and is a total authentication bypass anywhere else, so reaching a
 * production environment with it compiled in must be impossible, not merely
 * discouraged. This is a hard boot failure, not a warning that scrolls past.
 *
 * Exported separately from the loader so it can be tested without the test
 * having to tear down the process.
 */
export function assertIdentityIsSafeFor(env: Env, identityMode = IDENTITY_MODE): void {
  if (identityMode === 'development-seam') {
    if (env.NODE_ENV === 'production') {
      throw new EnvironmentError(
        'Refusing to start: the development identity seam is compiled into this build ' +
          'while NODE_ENV=production. The seam authenticates nobody and grants the ' +
          'identity named by DEV_CURRENT_USER_EMAIL to every caller. Switch ' +
          'IDENTITY_MODE in src/auth/identity-mode.ts to a real provider before ' +
          'deploying.',
      );
    }

    if (!env.DEV_CURRENT_USER_EMAIL) {
      throw new EnvironmentError(
        'DEV_CURRENT_USER_EMAIL is required while the development identity seam is ' +
          'in use: without it no request has an identity. Set it to one of the seeded ' +
          'users, for example admin@feedbackhub.local.',
      );
    }
  }

  if (identityMode !== 'development-seam' && env.DEV_CURRENT_USER_EMAIL) {
    throw new EnvironmentError(
      'DEV_CURRENT_USER_EMAIL is set but this build uses a real identity provider. ' +
        'Remove it so nobody mistakes it for something that still has an effect.',
    );
  }

  /**
   * The other direction, and the one that matters once the seam is not the
   * default: a build that verifies tokens and has not been told which issuer to
   * trust, which audience is its own, or where to send people to sign in.
   *
   * Every one of those failures is silent if it is allowed through. An absent
   * issuer would be a verifier that trusts a key set it fetched from nowhere;
   * an absent audience would accept a token minted for a different client,
   * which is precisely the check this application went out of its way to make.
   * They are named individually because "OIDC is misconfigured" sends an
   * operator looking through three variables to find the empty one.
   */
  if (identityMode === 'keycloak') {
    const missing = [
      env.OIDC_ISSUER_URL ? null : 'OIDC_ISSUER_URL',
      env.OIDC_AUDIENCE ? null : 'OIDC_AUDIENCE',
      env.OIDC_CLIENT_ID ? null : 'OIDC_CLIENT_ID',
    ].filter((name): name is string => name !== null);

    if (missing.length > 0) {
      throw new EnvironmentError(
        `Refusing to start: this build verifies tokens against an identity provider and ` +
          `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. ` +
          'Copy the identity section of .env.example, or run `npm run auth:up` to bring ' +
          'Keycloak up with the realm this repository imports.',
      );
    }
  }
}

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = EnvSchema.safeParse(source);

  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new EnvironmentError(`Invalid environment configuration:\n${lines.join('\n')}`);
  }

  assertIdentityIsSafeFor(result.data);
  return result.data;
}
