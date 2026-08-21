// Importing the configuration first is deliberate: its boot guards run on
// import and stop the process before anything opens a connection.
import { env } from './config/env.js';
import { createApp } from './app.js';
import { assertDatabaseReachable, closePool } from './db/pool.js';
import { IDENTITY_MODE } from './auth/identity-mode.js';

async function main(): Promise<void> {
  try {
    await assertDatabaseReachable();
  } catch (error) {
    console.error(
      `\nCannot reach MySQL at ${env.DB_HOST}:${env.DB_PORT}. ` +
        'Start it with `npm run db:up` from the repository root.\n',
    );
    console.error(error);
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(env.API_PORT, () => {
    console.log(`FeedbackHub API listening on http://localhost:${env.API_PORT}`);
    console.log(`  environment: ${env.NODE_ENV}`);
    console.log(`  identity:    ${IDENTITY_MODE} (${env.DEV_CURRENT_USER_EMAIL ?? 'n/a'})`);
  });

  const shutdown = (signal: string) => {
    console.log(`\n${signal} received, shutting down`);
    server.close(() => {
      void closePool().finally(() => process.exit(0));
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void main();
