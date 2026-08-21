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
     */
    env: {
      NODE_ENV: 'development',
      API_PORT: '3000',
      DB_HOST: '127.0.0.1',
      DB_PORT: '3307',
      DB_NAME: 'feedbackhub_test_unused',
      DB_USER: 'test',
      DB_PASSWORD: 'test',
      DEV_CURRENT_USER_EMAIL: 'admin@feedbackhub.local',
    },
  },
});
