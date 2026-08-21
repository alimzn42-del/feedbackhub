/**
 * Thin wrapper around postgrator. This file wires postgrator to a mysql2
 * connection and translates two CLI verbs; the versioning table, ordering and
 * checksum validation are postgrator's, not ours.
 *
 *   npm run migrate            -- apply everything outstanding
 *   npm run migrate -- 2       -- migrate to version 2 in either direction
 *   npm run migrate:down       -- undo the most recently applied migration
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Postgrator from 'postgrator';
import { connectForScripts } from './connect.mjs';

const migrationDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'db',
  'migrations',
);

const [, , verb = 'up', explicitTarget] = process.argv;

const connection = await connectForScripts();

try {
  const postgrator = new Postgrator({
    // Forward slashes: postgrator matches this with a glob, which does not accept
    // Windows path separators.
    migrationPattern: `${migrationDirectory.replaceAll(path.sep, '/')}/*.sql`,
    driver: 'mysql',
    database: process.env.DB_NAME,
    schemaTable: 'schema_migrations',
    validateChecksums: true,
    execQuery: async (query) => {
      const [rows, fields] = await connection.query(query);
      return { rows, fields };
    },
  });

  postgrator.on('validation-started', (m) => console.log(`  verifying  ${m.filename}`));
  postgrator.on('migration-started', (m) => console.log(`  applying   ${m.filename}`));

  const current = await postgrator.getDatabaseVersion();
  console.log(`schema version: ${current}`);

  let target;
  if (explicitTarget !== undefined) {
    target = explicitTarget;
  } else if (verb === 'down') {
    if (current === 0) {
      console.log('nothing to undo');
      process.exit(0);
    }
    target = String(current - 1);
  }

  const applied = await postgrator.migrate(target);

  if (applied.length === 0) {
    console.log('already up to date');
  } else {
    console.log(`schema version: ${await postgrator.getDatabaseVersion()}`);
  }
} catch (error) {
  // A checksum failure means an already-applied migration file was edited.
  // Say so plainly rather than letting postgrator's message stand alone.
  console.error(`\nmigration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await connection.end();
}
