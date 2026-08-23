import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool, withTransaction } from '../../db/pool.js';
import type { StatusAdminRow } from '../taxonomy/taxonomy.schema.js';

export interface StatusRef {
  id: number;
  name: string;
  slug: string;
}

interface StatusRow extends RowDataPacket, StatusRef {}

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

/**
 * One status, if it exists and is still offered. Archived statuses are excluded:
 * existing requests keep pointing at them, but nothing may be MOVED to one.
 */
export async function findActiveId(id: number): Promise<number | null> {
  const [rows] = await pool.execute<(RowDataPacket & { id: number })[]>(
    'SELECT id FROM statuses WHERE id = :id AND archived_at IS NULL LIMIT 1',
    { id },
  );
  return rows[0]?.id ?? null;
}

/**
 * The statuses offered as filter options. Archived ones are excluded for the
 * same reason as archived categories: they still exist so older requests keep a
 * valid reference, but they are not put in front of anyone as a choice.
 */
export async function listActive(): Promise<StatusRef[]> {
  const [rows] = await pool.query<StatusRow[]>(
    `SELECT id, name, slug
     FROM statuses
     WHERE archived_at IS NULL
     ORDER BY sort_order, name`,
  );
  return rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug }));
}

/**
 * Resolves filter slugs to the ids the list query filters on.
 *
 * Archived statuses are deliberately INCLUDED here. A slug in a URL is a link
 * somebody saved; archiving a status must not turn that link into an error when
 * the requests carrying it are still on the board. Archiving removes a status
 * from the choices offered, not from the ones already chosen.
 *
 * The slug is returned alongside the id so the caller can tell which of the
 * slugs it asked about did not come back, and name it in the error.
 */
export async function findIdsBySlugs(slugs: readonly string[]): Promise<StatusRef[]> {
  if (slugs.length === 0) {
    return [];
  }

  // pool.query, not pool.execute: the driver expands an array into a value list
  // for a plain query, and a prepared statement takes one placeholder per value.
  const [rows] = await pool.query<StatusRow[]>(
    'SELECT id, name, slug FROM statuses WHERE slug IN (:slugs)',
    // Spread rather than passed through: the driver's parameter type is a
    // mutable array, and the caller's is readonly on purpose.
    { slugs: [...slugs] },
  );
  return rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug }));
}

/* ── Management ──────────────────────────────────────────────────────────── */

interface AdminRow extends RowDataPacket {
  id: number;
  name: string;
  slug: string;
  sort_order: number;
  is_default: number;
  request_count: number;
}

/**
 * Every status, with how many requests are sitting in each.
 *
 * There is no archived state to report, because statuses are not retired: a
 * status is a position in a workflow, and retiring one would strand the
 * requests currently in it with nowhere to be.
 */
export async function listAll(): Promise<StatusAdminRow[]> {
  const [rows] = await pool.query<AdminRow[]>(
    `
    SELECT s.id, s.name, s.slug, s.sort_order, s.is_default,
           COUNT(r.id) AS request_count
    FROM statuses s
    LEFT JOIN feedback_requests r ON r.status_id = s.id
    GROUP BY s.id, s.name, s.slug, s.sort_order, s.is_default
    ORDER BY s.sort_order, s.name
    `,
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    sortOrder: row.sort_order,
    isDefault: row.is_default === 1,
    requestCount: Number(row.request_count),
  }));
}

export async function findById(id: number): Promise<StatusRef | null> {
  const [rows] = await pool.execute<(RowDataPacket & StatusRef)[]>(
    'SELECT id, name, slug FROM statuses WHERE id = :id LIMIT 1',
    { id },
  );
  const row = rows[0];
  return row ? { id: row.id, name: row.name, slug: row.slug } : null;
}

export async function countAll(): Promise<number> {
  const [rows] = await pool.query<(RowDataPacket & { total: number })[]>(
    'SELECT COUNT(*) AS total FROM statuses',
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * New statuses land at the end of the workflow, which is where a new stage
 * almost always belongs, and where it can be moved from.
 *
 * `isDefault` exists for one case: the first status in an empty table. The
 * database enforces at most one default and cannot enforce at least one, so
 * creating the only status without one would leave the table in the state that
 * makes request creation fail.
 */
export async function insert(name: string, slug: string, isDefault: boolean): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `
    INSERT INTO statuses (name, slug, sort_order, is_default)
    VALUES (:name, :slug, (SELECT next_order FROM (
      SELECT COALESCE(MAX(sort_order) + 1, 0) AS next_order FROM statuses
    ) AS tail), :isDefault)
    `,
    { name, slug, isDefault: isDefault ? 1 : 0 },
  );
  return result.insertId;
}

export async function rename(id: number, name: string): Promise<void> {
  const [result] = await pool.execute<ResultSetHeader>(
    'UPDATE statuses SET name = :name WHERE id = :id',
    { id, name },
  );
  void result;
}

export async function setOrder(ids: readonly number[]): Promise<void> {
  await withTransaction(async (connection) => {
    for (const [index, id] of ids.entries()) {
      await connection.execute('UPDATE statuses SET sort_order = :order WHERE id = :id', {
        order: index,
        id,
      });
    }
  });
}

export async function allIds(): Promise<number[]> {
  const [rows] = await pool.query<(RowDataPacket & { id: number })[]>(
    'SELECT id FROM statuses ORDER BY sort_order, name',
  );
  return rows.map((row) => row.id);
}

/**
 * Moves the default, in one transaction, clearing before setting.
 *
 * The order is forced by the schema, not chosen: a generated column plus a
 * unique key allow at most one row with is_default = 1, so setting the new one
 * first would collide with the old one and fail. Clearing first means there is
 * an instant with no default at all, which is exactly why this is a transaction
 * and not two statements — nothing else can observe it, and a failure between
 * them rolls back rather than leaving a table that cannot accept a new request.
 */
export async function setDefault(id: number): Promise<void> {
  await withTransaction(async (connection) => {
    await connection.execute('UPDATE statuses SET is_default = 0 WHERE is_default = 1');
    await connection.execute('UPDATE statuses SET is_default = 1 WHERE id = :id', { id });
  });
}
