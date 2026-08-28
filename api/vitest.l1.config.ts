import { defineConfig } from 'vitest/config';

/* ════════════════════════════════════════════════════════════════════════════
 *                        LAYER 1: THE API, ON A REAL MYSQL
 *
 * A second vitest project, run by `npm run test:l1`, and deliberately not part
 * of `npm test`. The default suite must stay runnable on a laptop with nothing
 * started; this one needs a database and says so by failing to connect.
 *
 * WHAT IS DIFFERENT FROM vitest.config.ts
 *   - the repositories are NOT replaced. The SQL runs.
 *   - DB_* point at the compose MySQL, and at a database of this suite's own
 *     (feedbackhub_l1) so a test that truncates cannot take the development
 *     board with it.
 *   - OIDC_INTERNAL_URL points at the key set test/l1/global-setup.ts serves,
 *     so verification runs through the real createRemoteJWKSet. OIDC_ISSUER_URL
 *     is unchanged and is still the only thing `iss` is compared against.
 *
 * fileParallelism is off because there is one database and the plan's
 * preconditions ("Fresh", "Demo") are whole-database states. Within a file the
 * tests run in order and reset what they need.
 * ══════════════════════════════════════════════════════════════════════════ */

const jwksPort = process.env.L1_JWKS_PORT ?? '8099';

/**
 * One declaration of the environment, applied twice.
 *
 * `test.env` reaches the workers. globalSetup runs in the main process and does
 * not see it, and it needs the same database and the same JWKS port — so the
 * values are also written onto process.env here, where the config module is
 * evaluated. Two copies of "which database" is how a suite ends up migrating
 * one and testing another.
 */
const environment = {
  NODE_ENV: 'development',
  API_PORT: '3000',
  WEB_ORIGIN: 'http://localhost:4200',

  DB_HOST: process.env.L1_DB_HOST ?? '127.0.0.1',
  DB_PORT: process.env.L1_DB_PORT ?? '3307',
  DB_NAME: process.env.L1_DB_NAME ?? 'feedbackhub_l1',
  DB_USER: process.env.L1_DB_USER ?? 'feedbackhub',
  DB_PASSWORD: process.env.L1_DB_PASSWORD ?? 'feedbackhub',
  DB_CONNECTION_LIMIT: '20',

  OIDC_ISSUER_URL: 'http://localhost:8080/realms/feedbackhub',
  OIDC_INTERNAL_URL: `http://127.0.0.1:${jwksPort}/realms/feedbackhub`,
  OIDC_AUDIENCE: 'feedbackhub-api',
  OIDC_CLIENT_ID: 'feedbackhub-web',
};

Object.assign(process.env, environment);

export default defineConfig({
  test: {
    include: ['test/l1/**/*.itest.ts'],
    environment: 'node',
    globalSetup: ['test/l1/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: environment,
  },
});
