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
  vote_count: number;
  has_voted: number;
}

interface ListRow extends BaseRow, RowDataPacket {
  excerpt: string;
  excerpt_truncated: number;
  total_count: number;
}

interface DetailRow extends BaseRow, RowDataPacket {
  description: string;
}

/**
 * Counted, never stored. This aggregates the vote rows once per query rather
 * than reading a counter column that could disagree with them.
 */
const VOTE_COUNTS_CTE = `
  WITH vote_counts AS (
    SELECT request_id, COUNT(*) AS votes
    FROM votes
    GROUP BY request_id
  )
`;

const JOINS = `
  FROM feedback_requests r
  JOIN categories c ON c.id = r.category_id
  JOIN statuses   s ON s.id = r.status_id
  JOIN users      u ON u.id = r.author_id
  LEFT JOIN vote_counts vc ON vc.request_id = r.id
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
  u.display_name  AS author_display_name,
  COALESCE(vc.votes, 0) AS vote_count
`;

/** Whether the viewer has voted. One index lookup per row on idx_votes_user. */
const HAS_VOTED = `
  EXISTS (
    SELECT 1 FROM votes mine
    WHERE mine.request_id = r.id AND mine.user_id = :viewerId
  ) AS has_voted
`;

/**
 * The default order, in one place.
 *
 * Pinned first, absolutely — admin curation outranks the crowd and is not
 * something a vote can push down. Then vote count, the priority signal the
 * board exists to surface. Then newest, then id.
 *
 * The last two are not decoration. Requests tie on vote count constantly — most
 * of the board sits on zero — and without a total order two rows on equal votes
 * are free to swap between page 1 and page 2 while somebody is paging through.
 *
 * No index can serve the vote_count key: the count is derived, so MySQL has to
 * aggregate every row before it can order any of them. That is the accepted
 * cost of not storing a counter. The measured plan is recorded in
 * notes/ai-log.md.
 */
const DEFAULT_ORDER = `
  ORDER BY r.is_pinned DESC, vote_count DESC, r.created_at DESC, r.id DESC
`;

function toListItem(row: ListRow): Omit<FeedbackRequestListItem, 'canVote'> {
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    excerptTruncated: row.excerpt_truncated === 1,
    category: { id: row.category_id, name: row.category_name, slug: row.category_slug },
    status: { id: row.status_id, name: row.status_name, slug: row.status_slug },
    author: { id: row.author_id, displayName: row.author_display_name },
    isPinned: row.is_pinned === 1,
    voteCount: Number(row.vote_count),
    hasVoted: row.has_voted === 1,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toDetail(row: DetailRow): Omit<FeedbackRequestDetail, 'canVote'> {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: { id: row.category_id, name: row.category_name, slug: row.category_slug },
    status: { id: row.status_id, name: row.status_name, slug: row.status_slug },
    author: { id: row.author_id, displayName: row.author_display_name },
    isPinned: row.is_pinned === 1,
    voteCount: Number(row.vote_count),
    hasVoted: row.has_voted === 1,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface ListPage {
  items: Omit<FeedbackRequestListItem, 'canVote'>[];
  total: number;
}

export interface ListParams {
  limit: number;
  offset: number;
  /** Whose "have I voted" flag to compute. */
  viewerId: number;
}

/**
 * One round trip for both the page and the total: COUNT(*) OVER () is evaluated
 * before LIMIT is applied, so it reports the size of the whole result set rather
 * than of the page. SQL_CALC_FOUND_ROWS is deprecated in MySQL 8 and this
 * replaces it.
 */
export async function list({ limit, offset, viewerId }: ListParams): Promise<ListPage> {
  const [rows] = await pool.query<ListRow[]>(
    `
    ${VOTE_COUNTS_CTE}
    SELECT
      ${COMMON_COLUMNS},
      SUBSTRING(r.description, 1, :excerptLength) AS excerpt,
      CHAR_LENGTH(r.description) > :excerptLength AS excerpt_truncated,
      ${HAS_VOTED},
      COUNT(*) OVER () AS total_count
    ${JOINS}
    ${DEFAULT_ORDER}
    LIMIT :limit OFFSET :offset
    `,
    { excerptLength: EXCERPT_LENGTH, viewerId, limit, offset },
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

export async function findById(
  id: number,
  viewerId: number,
): Promise<Omit<FeedbackRequestDetail, 'canVote'> | null> {
  const [rows] = await pool.query<DetailRow[]>(
    `
    ${VOTE_COUNTS_CTE}
    SELECT ${COMMON_COLUMNS}, r.description, ${HAS_VOTED}
    ${JOINS}
    WHERE r.id = :id
    LIMIT 1
    `,
    { id, viewerId },
  );
  const row = rows[0];
  return row ? toDetail(row) : null;
}

/** The author id alone, for policy decisions that do not need the whole row. */
export async function findAuthorId(id: number): Promise<number | null> {
  const [rows] = await pool.execute<(RowDataPacket & { author_id: number })[]>(
    'SELECT author_id FROM feedback_requests WHERE id = :id LIMIT 1',
    { id },
  );
  return rows[0]?.author_id ?? null;
}

export type InsertRequestInput = {
  title: string;
  description: string;
  categoryId: number;
  statusId: number;
  authorId: number;
};

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
