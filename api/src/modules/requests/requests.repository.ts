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
  pinned_at: Date | null;
  pinned_by: number | null;
  pinned_by_display_name: string | null;
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
  comment_count: number;
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
const COUNTS_CTE = `
  WITH vote_counts AS (
    SELECT request_id, COUNT(*) AS votes
    FROM votes
    GROUP BY request_id
  ),
  comment_counts AS (
    -- Hidden comments are not counted: the number is what a reader can open,
    -- not how many rows the table happens to keep for the audit trail.
    SELECT request_id, COUNT(*) AS comments
    FROM comments
    WHERE deleted_at IS NULL
    GROUP BY request_id
  )
`;

const JOINS = `
  FROM feedback_requests r
  JOIN categories c ON c.id = r.category_id
  JOIN statuses   s ON s.id = r.status_id
  JOIN users      u ON u.id = r.author_id
  LEFT JOIN users pinner ON pinner.id = r.pinned_by
  LEFT JOIN vote_counts vc ON vc.request_id = r.id
  LEFT JOIN comment_counts cc ON cc.request_id = r.id
`;

const COMMON_COLUMNS = `
  r.id,
  r.title,
  r.pinned_at,
  r.pinned_by,
  pinner.display_name AS pinned_by_display_name,
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
  COALESCE(vc.votes, 0) AS vote_count,
  COALESCE(cc.comments, 0) AS comment_count
`;

const EXCERPT_COLUMNS = `
  SUBSTRING(r.description, 1, :excerptLength) AS excerpt,
  CHAR_LENGTH(r.description) > :excerptLength AS excerpt_truncated
`;

/** Whether the viewer has voted. One index lookup per row on idx_votes_user. */
const HAS_VOTED = `
  EXISTS (
    SELECT 1 FROM votes mine
    WHERE mine.request_id = r.id AND mine.user_id = :viewerId
  ) AS has_voted
`;

/**
 * The board is split in two, so neither query needs to sort by pinned state.
 *
 * Pinned requests live in their own panel and are excluded from the list
 * below it — a request appears in exactly one place. The previous approach,
 * ordering pinned-first inside one list, put them at the top of page 1 only and
 * quietly shifted everything else along; splitting removes that.
 *
 * The list orders by vote count, the priority signal, then newest, then id. The
 * last two keep the ordering total: most of the board sits on zero votes, so
 * rows tie constantly and would otherwise be free to swap between pages while
 * somebody is paging through.
 *
 * No index can serve the vote_count key — the count is derived, so every row
 * must be aggregated before any can be ordered. Measured, not assumed; the plan
 * is in notes/ai-log.md.
 */
const LIST_ORDER = 'ORDER BY vote_count DESC, r.created_at DESC, r.id DESC';

/** Most recently pinned first: an admin expects what they just pinned on top. */
const PINNED_ORDER = 'ORDER BY r.pinned_at DESC, r.id DESC';

function toListItem(row: ListRow): Omit<FeedbackRequestListItem, 'canVote' | 'canPin'> {
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    excerptTruncated: row.excerpt_truncated === 1,
    category: { id: row.category_id, name: row.category_name, slug: row.category_slug },
    status: { id: row.status_id, name: row.status_name, slug: row.status_slug },
    author: { id: row.author_id, displayName: row.author_display_name },
    isPinned: row.pinned_at !== null,
    pinnedAt: row.pinned_at ? row.pinned_at.toISOString() : null,
    // Rows pinned before this column existed have a time but no actor. Reported
    // as null rather than attributed to somebody who did not do it.
    pinnedBy:
      row.pinned_by !== null && row.pinned_by_display_name !== null
        ? { id: row.pinned_by, displayName: row.pinned_by_display_name }
        : null,
    voteCount: Number(row.vote_count),
    commentCount: Number(row.comment_count),
    hasVoted: row.has_voted === 1,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toDetail(row: DetailRow): Omit<FeedbackRequestDetail, 'canVote' | 'canPin'> {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: { id: row.category_id, name: row.category_name, slug: row.category_slug },
    status: { id: row.status_id, name: row.status_name, slug: row.status_slug },
    author: { id: row.author_id, displayName: row.author_display_name },
    isPinned: row.pinned_at !== null,
    pinnedAt: row.pinned_at ? row.pinned_at.toISOString() : null,
    pinnedBy:
      row.pinned_by !== null && row.pinned_by_display_name !== null
        ? { id: row.pinned_by, displayName: row.pinned_by_display_name }
        : null,
    voteCount: Number(row.vote_count),
    commentCount: Number(row.comment_count),
    hasVoted: row.has_voted === 1,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export type ListItemRow = Omit<FeedbackRequestListItem, 'canVote' | 'canPin'>;

export interface ListPage {
  items: ListItemRow[];
  total: number;
}

export interface ListParams {
  limit: number;
  offset: number;
  /** Whose "have I voted" flag to compute. */
  viewerId: number;
}

/**
 * The unpinned board, paginated.
 *
 * One round trip for both the page and the total: COUNT(*) OVER () is evaluated
 * before LIMIT is applied, so it reports the size of the whole result set rather
 * than of the page. SQL_CALC_FOUND_ROWS is deprecated in MySQL 8.
 */
export async function list({ limit, offset, viewerId }: ListParams): Promise<ListPage> {
  const [rows] = await pool.query<ListRow[]>(
    `
    ${COUNTS_CTE}
    SELECT
      ${COMMON_COLUMNS},
      ${EXCERPT_COLUMNS},
      ${HAS_VOTED},
      COUNT(*) OVER () AS total_count
    ${JOINS}
    WHERE r.pinned_at IS NULL
    ${LIST_ORDER}
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

/** Counts the same set the list pages over — unpinned only. */
export async function count(): Promise<number> {
  const [rows] = await pool.query<(RowDataPacket & { total: number })[]>(
    'SELECT COUNT(*) AS total FROM feedback_requests WHERE pinned_at IS NULL',
  );
  return Number(rows[0]?.total ?? 0);
}

export interface PinnedPage {
  items: ListItemRow[];
  /** Every pinned request, including any beyond the cap below. */
  total: number;
}

/**
 * The pinned panel. Not paginated — the panel shows a few and expands to scroll
 * the rest — but capped, because pinning is unlimited by decision and an
 * unbounded response is one careless afternoon away. `total` reports the real
 * figure so the UI can say when it is not showing everything.
 */
export async function listPinned(viewerId: number, limit: number): Promise<PinnedPage> {
  const [rows] = await pool.query<ListRow[]>(
    `
    ${COUNTS_CTE}
    SELECT
      ${COMMON_COLUMNS},
      ${EXCERPT_COLUMNS},
      ${HAS_VOTED},
      COUNT(*) OVER () AS total_count
    ${JOINS}
    WHERE r.pinned_at IS NOT NULL
    ${PINNED_ORDER}
    LIMIT :limit
    `,
    { excerptLength: EXCERPT_LENGTH, viewerId, limit },
  );

  const first = rows[0];

  if (!first) {
    return { items: [], total: 0 };
  }

  return { items: rows.map(toListItem), total: Number(first.total_count) };
}

export async function findById(
  id: number,
  viewerId: number,
): Promise<Omit<FeedbackRequestDetail, 'canVote' | 'canPin'> | null> {
  const [rows] = await pool.query<DetailRow[]>(
    `
    ${COUNTS_CTE}
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

/** One row in list shape, for returning a request the caller just changed. */
export async function findListItemById(
  id: number,
  viewerId: number,
): Promise<ListItemRow | null> {
  const [rows] = await pool.query<ListRow[]>(
    `
    ${COUNTS_CTE}
    SELECT ${COMMON_COLUMNS}, ${EXCERPT_COLUMNS}, ${HAS_VOTED}
    ${JOINS}
    WHERE r.id = :id
    LIMIT 1
    `,
    { excerptLength: EXCERPT_LENGTH, id, viewerId },
  );
  const row = rows[0];
  return row ? toListItem(row) : null;
}

export async function exists(id: number): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM feedback_requests WHERE id = :id LIMIT 1',
    { id },
  );
  return rows.length === 1;
}

/** The author id alone, for policy decisions that do not need the whole row. */
export async function findAuthorId(id: number): Promise<number | null> {
  const [rows] = await pool.execute<(RowDataPacket & { author_id: number })[]>(
    'SELECT author_id FROM feedback_requests WHERE id = :id LIMIT 1',
    { id },
  );
  return rows[0]?.author_id ?? null;
}

/**
 * Pinning records who and when, not merely that. Re-pinning something already
 * pinned refreshes both, which is what makes the panel's "most recent first"
 * order mean something.
 */
export async function pin(id: number, actorId: number): Promise<void> {
  const [result] = await pool.execute<ResultSetHeader>(
    `
    UPDATE feedback_requests
    SET pinned_at = CURRENT_TIMESTAMP(3), pinned_by = :actorId
    WHERE id = :id
    `,
    { id, actorId },
  );
  void result;
}

export async function unpin(id: number): Promise<void> {
  const [result] = await pool.execute<ResultSetHeader>(
    'UPDATE feedback_requests SET pinned_at = NULL, pinned_by = NULL WHERE id = :id',
    { id },
  );
  void result;
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
