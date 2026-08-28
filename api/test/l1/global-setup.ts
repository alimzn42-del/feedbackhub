import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import Postgrator from 'postgrator';
import { exportJWK, generateKeyPair } from 'jose';
import type { TestProject } from 'vitest/node';

/* ════════════════════════════════════════════════════════════════════════════
 *                     THE L1 HARNESS: A REAL DATABASE, ONCE
 *
 * The 473 tests of the existing suite replace every repository, so the SQL in
 * this repository has never run under test. Layer 1 of notes/test-plan.md is
 * the same application — the real Express app, the real middleware chain, the
 * real services — with the repositories left alone and a real MySQL underneath.
 *
 * This file is what makes that possible, and it runs exactly once per `vitest`
 * invocation rather than once per file:
 *
 *   1. creates a database of its own (feedbackhub_l1) so that nothing here can
 *      touch the development board the compose stack is serving,
 *   2. migrates it 0 -> head with the same postgrator wiring scripts/migrate.mjs
 *      uses, so a migration that only works when applied by hand fails here,
 *   3. loads the baseline seed,
 *   4. publishes a JWKS over HTTP on 127.0.0.1 and hands the private key to the
 *      workers.
 *
 * WHY A REAL HTTP KEY SET RATHER THAN THE L0 STUB
 * The plan says "the JWKS stub from tokens.test-support.ts stays", and this is
 * that promise kept a level more strictly. L0 replaces src/auth/jwks.ts with a
 * local key set, so createRemoteJWKSet — the caching, the cooldown, the refetch
 * on an unknown `kid` — is the one part of verification no test runs. Serving
 * the same keys over a socket removes the last vi.mock from the authentication
 * path: nothing about identity is replaced at L1 except which host the key set
 * is fetched from, which is what OIDC_INTERNAL_URL is for and is a thing the
 * deployment does anyway.
 *
 * `iss` is still compared against OIDC_ISSUER_URL and only that, so these
 * tokens are checked exactly as a Keycloak token would be.
 * ══════════════════════════════════════════════════════════════════════════ */

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.join(here, '..', '..');
const migrationDirectory = path.join(apiRoot, 'src', 'db', 'migrations');
const seedDirectory = path.join(apiRoot, 'src', 'db', 'seeds');

/** The key the published set contains. */
export const L1_KID = 'feedbackhub-l1-key';

export function rootConnectionOptions() {
  return {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3307),
    user: process.env.L1_DB_ROOT_USER ?? 'root',
    password: process.env.L1_DB_ROOT_PASSWORD ?? 'root',
    multipleStatements: true,
    namedPlaceholders: true,
    timezone: 'Z' as const,
  };
}

/**
 * Creates the L1 database and gives the application's own user rights over it.
 *
 * The application connects as the same unprivileged user it uses everywhere
 * else — a test that passes because it ran as root would be testing a grant
 * this deployment does not make. Only the harness itself uses root, and only
 * for the things a schema owner does: creating the database, and the handful of
 * rows a test writes by SQL to reach a state no route can produce.
 */
async function createDatabase(databaseName: string, appUser: string): Promise<void> {
  const connection = await mysql.createConnection(rootConnectionOptions());
  try {
    await connection.query(
      'CREATE DATABASE IF NOT EXISTS `' +
        databaseName +
        '` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci',
    );
    if (appUser !== rootConnectionOptions().user) {
      await connection.query(
        'GRANT ALL PRIVILEGES ON `' + databaseName + "`.* TO '" + appUser + "'@'%'",
      );
      await connection.query('FLUSH PRIVILEGES');
    }
  } finally {
    await connection.end();
  }
}

/**
 * 0 -> head, through postgrator, with checksum validation on.
 *
 * Deliberately not a schema dump: D-01 in the plan asks whether the migrations
 * can build the schema from nothing, and the only way to keep asking that is to
 * make every L1 run do it.
 */
export async function migrateToHead(databaseName: string): Promise<number> {
  const connection = await mysql.createConnection({
    ...rootConnectionOptions(),
    database: databaseName,
  });

  try {
    const postgrator = new Postgrator({
      migrationPattern: `${migrationDirectory.replaceAll(path.sep, '/')}/*.sql`,
      driver: 'mysql',
      database: databaseName,
      schemaTable: 'schema_migrations',
      validateChecksums: true,
      execQuery: async (query: string) => {
        const [rows, fields] = await connection.query(query);
        return { rows, fields } as never;
      },
    });

    await postgrator.migrate();
    return Number(await postgrator.getDatabaseVersion());
  } finally {
    await connection.end();
  }
}

/** The baseline seed, read the way scripts/seed.mjs reads it. */
export async function readSeedSql(): Promise<string[]> {
  const files = (await readdir(seedDirectory)).filter((f) => f.endsWith('.sql')).sort();
  return Promise.all(files.map((f) => readFile(path.join(seedDirectory, f), 'utf8')));
}

async function applySeed(databaseName: string): Promise<void> {
  const connection = await mysql.createConnection({
    ...rootConnectionOptions(),
    database: databaseName,
  });
  try {
    for (const sql of await readSeedSql()) {
      await connection.query(sql);
    }
  } finally {
    await connection.end();
  }
}

/**
 * The key set, served the way Keycloak serves it.
 *
 * Any path under the realm answers, because what the API asks for is
 * OIDC_INTERNAL_URL + /protocol/openid-connect/certs and the point of this
 * server is to be reachable rather than to be a faithful realm.
 */
function startJwksServer(port: number, jwk: Record<string, unknown>): Promise<Server> {
  const body = JSON.stringify({ keys: [jwk] });

  const server = createServer((req, res) => {
    if (req.url?.endsWith('/protocol/openid-connect/certs')) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"not found"}');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

export default async function setup(project: TestProject) {
  const databaseName = process.env.DB_NAME ?? 'feedbackhub_l1';
  const appUser = process.env.DB_USER ?? 'feedbackhub';
  const jwksPort = Number(new URL(process.env.OIDC_INTERNAL_URL as string).port);

  await createDatabase(databaseName, appUser);
  const schemaVersion = await migrateToHead(databaseName);
  await applySeed(databaseName);

  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const publicJwk = { ...(await exportJWK(publicKey)), kid: L1_KID, alg: 'RS256', use: 'sig' };
  const privateJwk = await exportJWK(privateKey);

  const server = await startJwksServer(jwksPort, publicJwk);

  // Workers are separate processes; the key crosses to them through here rather
  // than being generated twice and quietly failing to match.
  project.provide('l1', { databaseName, schemaVersion, kid: L1_KID, privateJwk, publicJwk });

  return async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    l1: {
      databaseName: string;
      schemaVersion: number;
      kid: string;
      privateJwk: Record<string, unknown>;
      publicJwk: Record<string, unknown>;
    };
  }
}
