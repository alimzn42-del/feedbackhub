import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool, withTransaction } from '../../db/pool.js';
import type { CategoryAdminRow } from '../taxonomy/taxonomy.schema.js';

export interface CategoryRef {
  id: number;
  name: string;
  slug: string;
}

interface CategoryRow extends RowDataPacket, CategoryRef {}

/**
 * Archived categories are excluded: they still exist so that older requests keep
 * a valid reference, but they are not offered for new ones.
 */
export async function listActive(): Promise<CategoryRef[]> {
  const [rows] = await pool.query<CategoryRow[]>(
    `SELECT id, name, slug
     FROM categories
     WHERE archived_at IS NULL
     ORDER BY sort_order, name`,
  );
  return rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug }));
}

export async function findActiveId(id: number): Promise<number | null> {
  const [rows] = await pool.execute<(RowDataPacket & { id: number })[]>(
    'SELECT id FROM categories WHERE id = :id AND archived_at IS NULL LIMIT 1',
    { id },
  );
  return rows[0]?.id ?? null;
}

/**
 * Resolves filter slugs to the ids the list query filters on.
 *
 * Archived categories are deliberately INCLUDED. A slug in a URL is a link
 * somebody saved; archiving a category must not turn that link into an error
 * while requests still carry it. Archiving removes a category from the choices
 * offered for a new request, not from the ones already chosen.
 *
 * The slug comes back with the id so the caller can tell which of the slugs it
 * asked about did not come back, and name that one in the error.
 */
export async function findIdsBySlugs(slugs: readonly string[]): Promise<CategoryRef[]> {
  if (slugs.length === 0) {
    return [];
  }

  // pool.query, not pool.execute: the driver expands an array into a value list
  // for a plain query, and a prepared statement takes one placeholder per value.
  const [rows] = await pool.query<CategoryRow[]>(
    'SELECT id, name, slug FROM categories WHERE slug IN (:slugs)',
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
  archived_at: Date | null;
  request_count: number;
}

/**
 * Every category, retired ones included, with how many requests carry each.
 *
 * The count is aggregated here rather than fetched per row: one query with a
 * LEFT JOIN, so a category nothing uses still appears with a zero rather than
 * dropping out of the list it is supposed to be managed from.
 */
export async function listAll(): Promise<CategoryAdminRow[]> {
  const [rows] = await pool.query<AdminRow[]>(
    `
    SELECT c.id, c.name, c.slug, c.sort_order, c.archived_at,
           COUNT(r.id) AS request_count
    FROM categories c
    LEFT JOIN feedback_requests r ON r.category_id = c.id
    GROUP BY c.id, c.name, c.slug, c.sort_order, c.archived_at
    ORDER BY c.sort_order, c.name
    `,
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    sortOrder: row.sort_order,
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
    requestCount: Number(row.request_count),
  }));
}

export async function findById(id: number): Promise<CategoryRef | null> {
  const [rows] = await pool.execute<(RowDataPacket & CategoryRef)[]>(
    'SELECT id, name, slug FROM categories WHERE id = :id LIMIT 1',
    { id },
  );
  const row = rows[0];
  return row ? { id: row.id, name: row.name, slug: row.slug } : null;
}

/**
 * New categories land at the end of the list. Nothing else moves, so adding one
 * cannot reshuffle an order somebody arranged deliberately.
 *
 * Uniqueness is left to the database: the unique keys on name and slug refuse
 * the write, and the caller turns that refusal into a message naming the field.
 * Checking first would leave a window where two requests both see "no such
 * name" and both proceed.
 */
export async function insert(name: string, slug: string): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `
    INSERT INTO categories (name, slug, sort_order)
    VALUES (:name, :slug, (SELECT next_order FROM (
      SELECT COALESCE(MAX(sort_order) + 1, 0) AS next_order FROM categories
    ) AS tail))
    `,
    { name, slug },
  );
  return result.insertId;
}

/** The name only. There is no endpoint that changes a slug. */
export async function rename(id: number, name: string): Promise<void> {
  const [result] = await pool.execute<ResultSetHeader>(
    'UPDATE categories SET name = :name WHERE id = :id',
    { id, name },
  );
  void result;
}

/**
 * Writes the whole order in one transaction, position by index.
 *
 * Per-row updates would be several requests that can half-succeed and leave the
 * list in an order nobody chose. There is no unique key on sort_order, so no
 * intermediate state can collide on the way through.
 */
export async function setOrder(ids: readonly number[]): Promise<void> {
  await withTransaction(async (connection) => {
    for (const [index, id] of ids.entries()) {
      await connection.execute('UPDATE categories SET sort_order = :order WHERE id = :id', {
        order: index,
        id,
      });
    }
  });
}

/** Every id currently in the table, for checking a reorder covers all of them. */
export async function allIds(): Promise<number[]> {
  const [rows] = await pool.query<(RowDataPacket & { id: number })[]>(
    'SELECT id FROM categories ORDER BY sort_order, name',
  );
  return rows.map((row) => row.id);
}

/**
 * Retiring, which is not deleting.
 *
 * The row stays exactly where it is: requests already carrying this category go
 * on rendering it. What changes is that it stops being offered — listActive()
 * excludes it, so it leaves the create form, the edit form and the filter bar.
 */
export async function archive(id: number): Promise<void> {
  const [result] = await pool.execute<ResultSetHeader>(
    'UPDATE categories SET archived_at = CURRENT_TIMESTAMP(3) WHERE id = :id',
    { id },
  );
  void result;
}

export async function restore(id: number): Promise<void> {
  const [result] = await pool.execute<ResultSetHeader>(
    'UPDATE categories SET archived_at = NULL WHERE id = :id',
    { id },
  );
  void result;
}
