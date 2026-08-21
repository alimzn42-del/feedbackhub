import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

/**
 * The single connection pool.
 *
 * Importing this module creates it, and it imports the configuration module,
 * so the boot guards in src/config/env.ts have already run and failed the
 * process before a socket is ever opened.
 */
export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,

  waitForConnections: true,
  connectionLimit: env.DB_CONNECTION_LIMIT,
  queueLimit: 0,
  enableKeepAlive: true,

  // DATETIME(3) columns hold UTC; this makes the driver read them back as UTC
  // instants rather than reinterpreting them in the host's local zone.
  timezone: 'Z',

  // Off deliberately. Nothing the application sends should ever contain two
  // statements, so if a payload somehow reaches the driver as SQL it cannot be
  // chained. The migration and seed scripts enable it on their own connection.
  multipleStatements: false,

  charset: 'utf8mb4_0900_ai_ci',
  namedPlaceholders: true,
  supportBigNumbers: true,
  dateStrings: false,
});

/** Fails fast at startup rather than on the first user request. */
export async function assertDatabaseReachable(): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.query('SELECT 1');
  } finally {
    connection.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
