import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import mysql, { type RowDataPacket } from 'mysql2/promise';

/* ════════════════════════════════════════════════════════════════════════════
 *                    THE PRIVILEGED CONNECTION, AND THE RESETS
 *
 * Two things live here, and they are separate on purpose.
 *
 * `sql` is the harness's own connection, as root. Nothing the application does
 * goes through it. It exists because a large part of the plan is stated in
 * terms of what is in the table afterwards — "deleted_at set, external_id NULL,
 * the reply hidden_with_parent" — and asserting on the DTO instead would be
 * asserting that the serialiser agrees with itself.
 *
 * It is also how a test reaches a state no route produces: an archived status,
 * a settings row holding invalid JSON, a request back-dated past the rate-limit
 * window, a taxonomy with no default. Every such write is marked in the test
 * that does it, because a set-up written in SQL is a set-up that will not
 * notice if the route that would normally produce it stops working.
 *
 * `resetToFresh` and `resetToDemo` are the two preconditions the plan names.
 * Fresh truncates and re-seeds rather than re-migrating: the migration is
 * proven once per run by global-setup.ts, and doing it per test would put a
 * minute of DDL in front of a suite that has to stay runnable.
 * ══════════════════════════════════════════════════════════════════════════ */

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.join(here, '..', '..');
const seedDirectory = path.join(apiRoot, 'src', 'db', 'seeds');
const run = promisify(execFile);

let admin: mysql.Connection | null = null;

async function connection(): Promise<mysql.Connection> {
  admin ??= await mysql.createConnection({
    host: process.env.DB_HOST as string,
    port: Number(process.env.DB_PORT),
    user: process.env.L1_DB_ROOT_USER ?? 'root',
    password: process.env.L1_DB_ROOT_PASSWORD ?? 'root',
    database: process.env.DB_NAME as string,
    multipleStatements: true,
    namedPlaceholders: true,
    timezone: 'Z',
    supportBigNumbers: true,
  });
  return admin;
}

/** A query as the schema owner. Returns rows; use it for reads and set-up alike. */
export async function sql<T = RowDataPacket>(
  query: string,
  values?: Record<string, unknown> | unknown[],
): Promise<T[]> {
  const c = await connection();
  // mysql2's overloads do not describe the named-placeholder object form, which
  // this connection is opened with; the cast is to the call signature, not to
  // the result, which is still checked by the caller's type argument.
  const [rows] = await c.query(query, values as never);
  return rows as T[];
}

/** The single scalar of a single row — the shape most assertions here want. */
export async function one<T = unknown>(
  query: string,
  values?: Record<string, unknown> | unknown[],
): Promise<T | undefined> {
  const rows = await sql<Record<string, T>>(query, values);
  const first = rows[0];
  if (first === undefined) return undefined;
  return Object.values(first)[0];
}

export async function closeAdminConnection(): Promise<void> {
  await admin?.end();
  admin = null;
}

/**
 * Every table the application owns, children first.
 *
 * Read from the schema rather than listed, so a migration that adds a table
 * cannot leave rows behind in it between tests — a stale row in a table this
 * list forgot is the kind of failure that shows up three files later as
 * something else.
 */
async function applicationTables(): Promise<string[]> {
  const rows = await sql<{ TABLE_NAME: string }>(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> 'schema_migrations'`,
  );
  return rows.map((r) => r.TABLE_NAME);
}

/**
 * Fresh: three people, four categories, six statuses, no settings, no content.
 *
 * TRUNCATE rather than DELETE so AUTO_INCREMENT restarts — several rows in the
 * plan are written in terms of "id 2" being dana, and a suite whose ids drift
 * upward as it runs cannot say that.
 */
export async function resetToFresh(): Promise<void> {
  const tables = await applicationTables();
  const c = await connection();

  await c.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const table of tables) {
      await c.query('TRUNCATE TABLE `' + table + '`');
    }
  } finally {
    await c.query('SET FOREIGN_KEY_CHECKS = 1');
  }

  const files = (await readdir(seedDirectory)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    await c.query(await readFile(path.join(seedDirectory, file), 'utf8'));
  }
}

/**
 * Demo: Fresh, then the demo board — seven people including a second admin,
 * fourteen requests, votes, threads with tombstones.
 *
 * The real script, in a child process, rather than a copy of its intent here.
 * It is the artefact `npm run demo` runs, and a test that quietly reimplemented
 * it would stop noticing when the two disagreed.
 */
export async function resetToDemo(): Promise<void> {
  await resetToFresh();
  await run(process.execPath, [path.join(apiRoot, 'scripts', 'demo-data.mjs')], {
    cwd: apiRoot,
    env: process.env,
  });
}

/** Ids of the three seeded people, by email, after a reset. */
export async function seededIds(): Promise<Record<string, number>> {
  const rows = await sql<{ email: string; id: number }>('SELECT id, email FROM users');
  return Object.fromEntries(rows.map((r) => [r.email, r.id]));
}
