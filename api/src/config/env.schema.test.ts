import { describe, expect, it } from 'vitest';
import { assertIdentityIsSafeFor, EnvironmentError, parseEnv, type Env } from './env.schema.js';

/**
 * The environment as this build actually wants it: a real identity provider,
 * and no leftover impersonation.
 *
 * parseEnv asserts against the IDENTITY_MODE that is compiled in, so this is
 * also the only shape that parses at all. Every seam case below therefore says
 * 'development-seam' explicitly rather than relying on what the constant
 * happens to be — which is the point of the mode being a parameter.
 */
const validEnv = {
  NODE_ENV: 'development',
  DB_HOST: '127.0.0.1',
  DB_PORT: '3307',
  DB_NAME: 'feedbackhub',
  DB_USER: 'feedbackhub',
  DB_PASSWORD: 'feedbackhub',
  OIDC_ISSUER_URL: 'http://localhost:8080/realms/feedbackhub',
  OIDC_AUDIENCE: 'feedbackhub-api',
  OIDC_CLIENT_ID: 'feedbackhub-web',
} satisfies NodeJS.ProcessEnv;

/** A parsed environment with the identity half rearranged, without reparsing. */
function envWith(overrides: Partial<Env>): Env {
  return { ...parseEnv(validEnv), ...overrides };
}

/** What the machine looks like when somebody is running without a container. */
const seamEnv = (): Env =>
  envWith({
    DEV_CURRENT_USER_EMAIL: 'admin@feedbackhub.local',
    OIDC_ISSUER_URL: undefined,
    OIDC_AUDIENCE: undefined,
    OIDC_CLIENT_ID: undefined,
  });

describe('environment configuration', () => {
  it('coerces and defaults the values the application reads', () => {
    const env = parseEnv(validEnv);

    expect(env.DB_PORT).toBe(3307);
    expect(env.API_PORT).toBe(3000);
    expect(env.DB_CONNECTION_LIMIT).toBe(10);
    // Zero by default: a generous clock allowance is an expired token being
    // accepted without anybody having chosen that.
    expect(env.OIDC_CLOCK_TOLERANCE_SECONDS).toBe(0);
  });

  it('names the variable that is missing', () => {
    const { DB_HOST: _omitted, ...withoutHost } = validEnv;

    expect(() => parseEnv(withoutHost)).toThrow(/DB_HOST/);
  });

  describe('the development identity seam', () => {
    it('refuses to start in production while the seam is compiled in', () => {
      // The seam authenticates nobody and hands every caller the identity named
      // by an environment variable. Reaching production with it must be a boot
      // failure, not a log line somebody scrolls past.
      expect(() => assertIdentityIsSafeFor(seamEnv(), 'development-seam')).not.toThrow();

      expect(() =>
        assertIdentityIsSafeFor({ ...seamEnv(), NODE_ENV: 'production' }, 'development-seam'),
      ).toThrow(EnvironmentError);
    });

    it('requires an impersonated user while the seam is in use', () => {
      expect(() =>
        assertIdentityIsSafeFor(
          { ...seamEnv(), DEV_CURRENT_USER_EMAIL: undefined },
          'development-seam',
        ),
      ).toThrow(/DEV_CURRENT_USER_EMAIL/);
    });

    it('rejects a leftover impersonation setting once a real provider is wired up', () => {
      expect(() =>
        assertIdentityIsSafeFor(
          envWith({ DEV_CURRENT_USER_EMAIL: 'admin@feedbackhub.local' }),
          'keycloak',
        ),
      ).toThrow(EnvironmentError);
    });
  });

  /* ══════════════════════════════════════════════════════════════════════════
   * The other direction, and the one that matters now that verifying a token is
   * the default. Each of these is a silent failure if it is allowed through: an
   * absent issuer is a verifier trusting a key set from nowhere, and an absent
   * audience accepts tokens minted for a different client of the same realm.
   * ════════════════════════════════════════════════════════════════════════ */
  describe('a build that verifies tokens', () => {
    it('starts when it has been told which realm to trust', () => {
      expect(() => assertIdentityIsSafeFor(parseEnv(validEnv), 'keycloak')).not.toThrow();
    });

    it.each([
      ['OIDC_ISSUER_URL', { OIDC_ISSUER_URL: undefined }],
      ['OIDC_AUDIENCE', { OIDC_AUDIENCE: undefined }],
      ['OIDC_CLIENT_ID', { OIDC_CLIENT_ID: undefined }],
    ])('refuses to start with no %s, and says which one', (name, missing) => {
      expect(() => assertIdentityIsSafeFor(envWith(missing), 'keycloak')).toThrow(new RegExp(name));
    });

    it('names every missing variable at once, rather than one per restart', () => {
      const nothingConfigured = envWith({
        OIDC_ISSUER_URL: undefined,
        OIDC_AUDIENCE: undefined,
        OIDC_CLIENT_ID: undefined,
      });

      expect(() => assertIdentityIsSafeFor(nothingConfigured, 'keycloak')).toThrow(
        /OIDC_ISSUER_URL, OIDC_AUDIENCE, OIDC_CLIENT_ID/,
      );
    });
  });
});
