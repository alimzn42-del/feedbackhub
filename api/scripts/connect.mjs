import mysql from 'mysql2/promise';

/**
 * Connection helper shared by the migration and seed scripts.
 *
 * These scripts run outside the application, so they read the environment
 * directly rather than importing src/config/env.ts — the app's config module
 * validates application concerns (ports, the identity seam) that are not
 * relevant here, and TypeScript is not on the path for standalone scripts.
 */
export function readDatabaseEnv() {
  const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing database environment variables: ${missing.join(', ')}.\n` +
        'Copy .env.example to .env at the repository root and try again.',
    );
  }

  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  };
}

/**
 * `multipleStatements` is enabled here and nowhere else. Migration and seed
 * files legitimately contain several statements; the application pool keeps it
 * off so that a SQL injection, if one ever slipped through, cannot be chained
 * into a second statement.
 */
export async function connectForScripts() {
  return mysql.createConnection({
    ...readDatabaseEnv(),
    multipleStatements: true,
    timezone: 'Z',
  });
}
