import { describe, expect, it } from 'vitest';
import { assertIdentityIsSafeFor, EnvironmentError, parseEnv } from './env.schema.js';

const validEnv = {
  NODE_ENV: 'development',
  DB_HOST: '127.0.0.1',
  DB_PORT: '3307',
  DB_NAME: 'feedbackhub',
  DB_USER: 'feedbackhub',
  DB_PASSWORD: 'feedbackhub',
  DEV_CURRENT_USER_EMAIL: 'admin@feedbackhub.local',
} satisfies NodeJS.ProcessEnv;

describe('environment configuration', () => {
  it('coerces and defaults the values the application reads', () => {
    const env = parseEnv(validEnv);

    expect(env.DB_PORT).toBe(3307);
    expect(env.API_PORT).toBe(3000);
    expect(env.DB_CONNECTION_LIMIT).toBe(10);
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
      expect(() =>
        assertIdentityIsSafeFor(
          parseEnv({ ...validEnv, NODE_ENV: 'development' }),
          'development-seam',
        ),
      ).not.toThrow();

      expect(() =>
        assertIdentityIsSafeFor(
          { ...parseEnv(validEnv), NODE_ENV: 'production' },
          'development-seam',
        ),
      ).toThrow(EnvironmentError);
    });

    it('requires an impersonated user while the seam is in use', () => {
      const { DEV_CURRENT_USER_EMAIL: _omitted, ...withoutUser } = validEnv;

      expect(() => parseEnv(withoutUser)).toThrow(/DEV_CURRENT_USER_EMAIL/);
    });

    it('rejects a leftover impersonation setting once a real provider is wired up', () => {
      expect(() => assertIdentityIsSafeFor(parseEnv(validEnv), 'keycloak')).toThrow(
        EnvironmentError,
      );
    });
  });
});
