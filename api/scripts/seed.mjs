/**
 * Applies every file in src/db/seeds in filename order. Seed files are written
 * to be idempotent, so this is safe to re-run against an existing database.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectForScripts } from './connect.mjs';

const seedDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'db',
  'seeds',
);

const files = (await readdir(seedDirectory)).filter((f) => f.endsWith('.sql')).sort();
const connection = await connectForScripts();

try {
  for (const file of files) {
    const sql = await readFile(path.join(seedDirectory, file), 'utf8');
    await connection.query(sql);
    console.log(`  seeded  ${file}`);
  }
  console.log(`${files.length} seed file(s) applied`);
} catch (error) {
  console.error(`\nseeding failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await connection.end();
}
