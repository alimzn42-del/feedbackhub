import type { RowDataPacket } from 'mysql2';
import { pool } from '../../db/pool.js';

/**
 * The status a new request receives. Returns null when no default is set, which
 * the database permits — the unique key on statuses guarantees at most one
 * default, never at least one. Callers must handle the absence explicitly.
 */
export async function findDefaultId(): Promise<number | null> {
  const [rows] = await pool.query<(RowDataPacket & { id: number })[]>(
    'SELECT id FROM statuses WHERE is_default = 1 AND archived_at IS NULL LIMIT 1',
  );
  return rows[0]?.id ?? null;
}
