import type { RowDataPacket } from 'mysql2';
import { pool, withTransaction } from '../../db/pool.js';

/**
 * The only file that knows settings are stored in two tables, or in JSON, or at
 * all.
 *
 * Everything above this reads a key and gets a value. That is the second half
 * of the storage promise the design makes — the first being that adding a
 * setting needs no migration, and this one being that nothing at a call site
 * has to know what shape it landed in.
 */

interface SettingRow extends RowDataPacket {
  setting_key: string;
  value: unknown;
}

/**
 * A stored value, still untrusted.
 *
 * `unknown` and not the setting's type: this came out of a JSON column that an
 * older build of the registry may have written under different rules. The
 * resolver validates every row against the current definition and treats a
 * failure as an absence, so a value that no longer parses falls back rather
 * than reaching a call site as the wrong type.
 */
export type StoredSettings = ReadonlyMap<string, unknown>;

function toMap(rows: SettingRow[]): StoredSettings {
  // mysql2 parses a JSON column for us, so row.value is already the boolean,
  // number, string or array that was written — not the text of it.
  return new Map(rows.map((row) => [row.setting_key, row.value]));
}

export async function readGlobal(): Promise<StoredSettings> {
  const [rows] = await pool.query<SettingRow[]>('SELECT setting_key, value FROM app_settings');
  return toMap(rows);
}

export async function readForUser(userId: number): Promise<StoredSettings> {
  const [rows] = await pool.execute<SettingRow[]>(
    'SELECT setting_key, value FROM user_settings WHERE user_id = :userId',
    { userId },
  );
  return toMap(rows);
}

/**
 * One change: a new value, or RESET to mean "remove whatever is stored".
 *
 * Reset is not the same as writing the default. A row holding the fallback
 * value says somebody chose it and it happens to match; no row says nobody has
 * chosen. The client is shown that difference and offers a reset from it, so
 * the two must not collapse into each other.
 */
export const RESET = Symbol('reset');

export type SettingChange = { value: unknown } | typeof RESET;

/**
 * Applies a set of changes to one level, all of them or none.
 *
 * A whole set rather than one key at a time, because some of these settings
 * constrain each other: restricting registration to a list of domains and
 * naming the domains is one decision, and an admin who sent it as two requests
 * could leave the board admitting nobody in between. The service checks the
 * combination; this makes the combination land as one write.
 *
 * Still one statement per key inside the transaction — never a document — so
 * two admins changing different settings at the same time do not overwrite each
 * other. That is the property the table shape was chosen for.
 */
export async function applyGlobal(
  changes: ReadonlyMap<string, SettingChange>,
  actorId: number,
): Promise<void> {
  if (changes.size === 0) return;

  await withTransaction(async (connection) => {
    for (const [key, change] of changes) {
      if (change === RESET) {
        await connection.execute('DELETE FROM app_settings WHERE setting_key = :key', { key });
        continue;
      }

      await connection.execute(
        `INSERT INTO app_settings (setting_key, value, updated_by)
         VALUES (:key, CAST(:value AS JSON), :actorId)
         ON DUPLICATE KEY UPDATE value = CAST(:value AS JSON), updated_by = :actorId`,
        { key, value: JSON.stringify(change.value), actorId },
      );
    }
  });
}

export async function applyForUser(
  userId: number,
  changes: ReadonlyMap<string, SettingChange>,
): Promise<void> {
  if (changes.size === 0) return;

  await withTransaction(async (connection) => {
    for (const [key, change] of changes) {
      if (change === RESET) {
        await connection.execute(
          'DELETE FROM user_settings WHERE user_id = :userId AND setting_key = :key',
          { userId, key },
        );
        continue;
      }

      await connection.execute(
        `INSERT INTO user_settings (user_id, setting_key, value)
         VALUES (:userId, :key, CAST(:value AS JSON))
         ON DUPLICATE KEY UPDATE value = CAST(:value AS JSON)`,
        { userId, key, value: JSON.stringify(change.value) },
      );
    }
  });
}

/**
 * Everything one person has ever set, removed in one statement.
 *
 * Called when an account is anonymised. These rows are the only thing in the
 * schema that is purely personal — the requests, comments and votes stay
 * because other people are in them, and a colour scheme has nobody else in it.
 */
export async function clearAllForUser(userId: number): Promise<void> {
  await pool.execute('DELETE FROM user_settings WHERE user_id = :userId', { userId });
}
