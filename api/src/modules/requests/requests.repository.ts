import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../db/pool.js';
import { EXCERPT_LENGTH, type FeedbackRequestDetail, type FeedbackRequestListItem } from './requests.schema.js';

/**
 * The only file in the requests module containing SQL. Services orchestrate,
 * controllers translate HTTP; queries live here and nowhere else.
 */

interface BaseRow {
  id: number;
  title: string;
  is_pinned: number;
  created_at: Date;
  updated_at: Date;
  category_id: number;
  category_name: string;
  category_slug: string;
  status_id: number;
  status_name: string;
  status_slug: string;
  author_id: number;
  author_display_name: string;
}

interface ListRow extends BaseRow, RowDataPacket {
  excerpt: string;
  excerpt_truncated: number;
  total_count: number;
}

interface DetailRow extends BaseRow, RowDataPacket {
  description: string;
}

const JOINS = `
  FROM feedback_requests r
  JOIN categories c ON c.id = r.category_id
  JOIN statuses   s ON s.id = r.status_id
  JOIN users      u ON u.id = r.author_id
`;

const COMMON_COLUMNS = `
  r.id,
  r.title,
  r.is_pinned,
  r.created_at,
  r.updated_at,
  c.id   AS category_id,
  c.name AS category_name,
  c.slug AS category_slug,
  s.id   AS status_id,
  s.name AS status_name,
  s.slug AS status_slug,
  u.id            AS author_id,
  u.display_name  AS author_display_name
`;

/**
 * The default sort, in one place. Pinned first, then newest first, with `id` as
 * the tiebreaker that makes it a total order — two rows sharing a millisecond
 * must not be free to swap between pages. Backed by idx_requests_feed.
 */
const DEFAULT_ORDER = 'ORDER BY r.is_pinned DESC, r.created_at DESC, r.id DESC';

function toListItem(row: ListRow): FeedbackRequestListItem {
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    excerptTruncated: row.excerpt_truncated === 1,
    category: { id: row.category_id, name: row.category_name, slug: row.category_slug },
    status: { id: row.status_id, name: row.status_name, slug: row.status_slug },
    author: { id: row.author_id, displayName: row.author_display_name },
    isPinned: row.is_pinned === 1,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toDetail(row: DetailRow): FeedbackRequestDetail {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: { id: row.category_id, name: row.category_name, slug: row.category_slug },
    status: { id: row.status_id, name: row.status_name, slug: row.status_slug },
    author: { id: row.author_id, displayName: row.author_display_name },
    isPinned: row.is_pinned === 1,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface ListPage {
  items: FeedbackRequestListItem[];
  total: number;
}

/**
 * One round trip for both the page and the total: COUNT(*) OVER () is evaluated
 * before LIMIT is applied, so it reports the size of the whole result set rather
 * than of the page. SQL_CALC_FOUND_ROWS is deprecated in MySQL 8 and this
 * replaces it.
 */
export async function list(limit: number, offset: number): Promise<ListPage> {
  const [rows] = await pool.query<ListRow[]>(
    `
    SELECT
      ${COMMON_COLUMNS},
      SUBSTRING(r.description, 1, ?)      AS excerpt,
      CHAR_LENGTH(r.description) > ?      AS excerpt_truncated,
      COUNT(*) OVER ()                    AS total_count
    ${JOINS}
    ${DEFAULT_ORDER}
    LIMIT ? OFFSET ?
    `,
    [EXCERPT_LENGTH, EXCERPT_LENGTH, limit, offset],
  );

  const first = rows[0];

  if (!first) {
    // A page past the end returns no rows, and a window function over no rows
    // reports nothing — so the total has to be asked for separately. This is the
    // only case where it costs a second query.
    return { items: [], total: await count() };
  }

  return { items: rows.map(toListItem), total: Number(first.total_count) };
}

export async function count(): Promise<number> {
  const [rows] = await pool.query<(RowDataPacket & { total: number })[]>(
    'SELECT COUNT(*) AS total FROM feedback_requests',
  );
  return Number(rows[0]?.total ?? 0);
}

export async function findById(id: number): Promise<FeedbackRequestDetail | null> {
  const [rows] = await pool.execute<DetailRow[]>(
    `SELECT ${COMMON_COLUMNS}, r.description ${JOINS} WHERE r.id = :id LIMIT 1`,
    { id },
  );
  const row = rows[0];
  return row ? toDetail(row) : null;
}

export type InsertRequestInput = {
  title: string;
  description: string;
  categoryId: number;
  statusId: number;
  authorId: number;
}

export async function insert(input: InsertRequestInput): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `
    INSERT INTO feedback_requests (title, description, category_id, status_id, author_id)
    VALUES (:title, :description, :categoryId, :statusId, :authorId)
    `,
    input,
  );
  return result.insertId;
}
