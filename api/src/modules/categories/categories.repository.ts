import type { RowDataPacket } from 'mysql2';
import { pool } from '../../db/pool.js';

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
