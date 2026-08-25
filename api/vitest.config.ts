import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',

    /**
     * The application validates its environment at import time and exits if it
     * is wrong, so the test process has to supply one. These values are never
     * connected to: the route-level tests replace every repository, so the pool
     * is created and never queried. Tests do not need a running database.
     *
     * THE IDENTITY SECTION
     * This build verifies tokens, so the issuer and audience have to be here or
     * the boot guard refuses to start. They are also the single declaration of
     * what the test realm is called: src/auth/tokens.test-support.ts mints
     * against these same two values rather than repeating them, so a token that
     * claims one issuer while the application insists on another is not a state
     * this configuration can get into.
     *
     * There is no DEV_CURRENT_USER_EMAIL. Setting it alongside a real identity
     * provider is itself a boot failure — see assertIdentityIsSafeFor.
     */
    env: {
      NODE_ENV: 'development',
      API_PORT: '3000',
      DB_HOST: '127.0.0.1',
      DB_PORT: '3307',
      DB_NAME: 'feedbackhub_test_unused',
      DB_USER: 'test',
      DB_PASSWORD: 'test',
      OIDC_ISSUER_URL: 'http://localhost:8080/realms/feedbackhub',
      OIDC_AUDIENCE: 'feedbackhub-api',
      OIDC_CLIENT_ID: 'feedbackhub-web',
    },
  },
});
