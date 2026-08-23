import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../db/pool.js';
import { VISIBLE_COMMENT } from '../comments/comments.repository.js';
import {
  EXCERPT_LENGTH,
  type FeedbackRequestDetail,
  type FeedbackRequestListItem,
  type RequestPermissionFlags,
  type SortOption,
} from './requests.schema.js';

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
  edited_at: Date | null;
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
    --
    -- Neither are comments still waiting for approval, by the same rule and
    -- with the same consequence if it is got wrong — a badge promising three
    -- comments above a thread showing one. The condition is not written out
    -- here: it is VISIBLE_COMMENT, imported from the comments repository, so
    -- the count and the thread cannot come to disagree about what a reader can
    -- see. They are the two places the pending decision warned would drift.
    SELECT request_id, COUNT(*) AS comments
    FROM comments c
    WHERE ${VISIBLE_COMMENT}
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
  r.edited_at,
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
 * The default board is split in two; a filtered board is not.
 *
 * With no filter applied, pinned requests live in their own panel and are
 * excluded from the list below it — a request appears in exactly one place. The
 * approach before that, ordering pinned-first inside one list, put them at the
 * top of page 1 only and quietly shifted everything else along.
 *
 * Once anything is filtered the shelf collapses into the results, because a
 * shelf that ignores the filter beside it contradicts what the screen says it
 * is showing. Pinned rows then sort first within the matches and carry their
 * badge, so the pin is still visible, and the total counts them because there
 * is only one set left to count.
 *
 * The default orders by vote count, the priority signal, then newest, then id.
 * The last two keep the ordering total: most of the board sits on zero votes, so
 * rows tie constantly and would otherwise be free to swap between pages while
 * somebody is paging through. The date orderings break their own ties on id for
 * the same reason — several requests filed in the same millisecond is a seed
 * script, not a hypothetical.
 *
 * No index can serve the vote_count key — the count is derived, so every row
 * must be aggregated before any can be ordered. Measured, not assumed; the plan
 * is in notes/ai-log.md. The two date orderings are what idx_requests_feed was
 * kept for.
 *
 * These are the only strings that ever reach ORDER BY. The caller passes a
 * SortOption, which the query schema has already narrowed to one of three
 * literals, and the value is looked up here rather than interpolated.
 */
const SORT_KEYS: Record<SortOption, string> = {
  votes: 'vote_count DESC, r.created_at DESC, r.id DESC',
  newest: 'r.created_at DESC, r.id DESC',
  oldest: 'r.created_at ASC, r.id ASC',
};

/**
 * Pinned rows first, then the ordering that was asked for within each group.
 *
 * Only used when pinned requests are in the result set at all — that is, when
 * the board is filtered and the shelf has collapsed into the results. On the
 * default board the WHERE clause has already excluded them, so the prefix would
 * be a sort key over a column with one value.
 */
const PINNED_FIRST = '(r.pinned_at IS NOT NULL) DESC';

function orderBy(sort: SortOption, includePinned: boolean): string {
  return `ORDER BY ${includePinned ? `${PINNED_FIRST}, ` : ''}${SORT_KEYS[sort]}`;
}

/**
 * The shelf's own ordering: most recently pinned first, so what an admin just
 * pinned is in the three the panel shows before it is expanded.
 *
 * Used when no ordering was asked for. When one was, the shelf follows it — it
 * is a group within the board rather than a separate view, and a board sorted
 * oldest-first with a shelf on top sorted by something else is two answers to
 * one question.
 */
const PINNED_ORDER = 'ORDER BY r.pinned_at DESC, r.id DESC';

function pinnedOrderBy(sort: SortOption | undefined): string {
  return sort === undefined ? PINNED_ORDER : `ORDER BY ${SORT_KEYS[sort]}`;
}

function toListItem(row: ListRow): Omit<FeedbackRequestListItem, RequestPermissionFlags> {
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
    editedAt: row.edited_at ? row.edited_at.toISOString() : null,
  };
}

function toDetail(row: DetailRow): Omit<FeedbackRequestDetail, RequestPermissionFlags> {
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
    editedAt: row.edited_at ? row.edited_at.toISOString() : null,
  };
}

export type ListItemRow = Omit<FeedbackRequestListItem, RequestPermissionFlags>;

export interface ListPage {
  items: ListItemRow[];
  total: number;
}

/**
 * What the caller is asking to narrow the board to. Every field is optional and
 * an absent one is not a filter — there is no "all" sentinel to get wrong.
 */
export interface ListFilters {
  /** Status ids, already resolved from the slugs in the URL. */
  statusIds?: readonly number[] | undefined;
  /** Category ids, likewise. */
  categoryIds?: readonly number[] | undefined;
  /** Restricts to one author. The "mine" filter resolves to the caller's id. */
  authorId?: number | undefined;
  /** Free text, matched against title and description. */
  search?: string | undefined;
}

export interface ListParams extends ListFilters {
  limit: number;
  offset: number;
  /** Whose "have I voted" flag to compute. */
  viewerId: number;

  /**
   * Whether comments still awaiting approval count for this viewer — the gate
   * is open, or they are an admin. Their own always do.
   */
  seesPendingComments: boolean;
  sort: SortOption;

  /**
   * Whether pinned requests belong in this result set.
   *
   * False for the default board, where they are a separate collection with
   * their own endpoint. True once anything is filtered, where they are ranked
   * first among the matches instead. The caller decides, because the rule is
   * about what the screen is showing and not about SQL.
   */
  includePinned: boolean;
}

/** What the driver accepts as a named parameter here. Not `unknown`: a value it
 *  cannot bind should fail to compile rather than at the database. */
type QueryParams = Record<string, string | number | number[]>;

/**
 * Escapes the LIKE metacharacters so a search for "100%" is a search for the
 * text and not for everything.
 *
 * The value is a bound parameter either way, so this is not what stops
 * injection — it stops a user's punctuation being read as a wildcard.
 */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Assembles the WHERE clause and the parameters it needs together, so a
 * condition can never be added without its value.
 *
 * Excluding pinned requests is not a filter the caller asks for: it follows
 * from whether the shelf is on screen. On the default board they are a separate
 * collection with their own endpoint and a request appears in exactly one
 * place; on a filtered board the shelf is gone and they belong in the results.
 *
 * Filtering happens on the request table's own foreign keys rather than on the
 * joined taxonomy's slug, so idx_requests_status, idx_requests_category and
 * idx_requests_author can serve it.
 */
function buildWhere(
  filters: ListFilters,
  includePinned: boolean,
): { clause: string; params: QueryParams } {
  const conditions = includePinned ? [] : ['r.pinned_at IS NULL'];
  const params: QueryParams = {};

  // Length is checked before each clause is added: an empty array would render
  // as IN (), which is a syntax error rather than a filter matching nothing.
  if (filters.statusIds && filters.statusIds.length > 0) {
    conditions.push('r.status_id IN (:statusIds)');
    params['statusIds'] = [...filters.statusIds];
  }

  if (filters.categoryIds && filters.categoryIds.length > 0) {
    conditions.push('r.category_id IN (:categoryIds)');
    params['categoryIds'] = [...filters.categoryIds];
  }

  if (filters.authorId !== undefined) {
    conditions.push('r.author_id = :authorId');
    params['authorId'] = filters.authorId;
  }

  if (filters.search !== undefined) {
    // Leading wildcard, so no index serves this and it is a scan of the matching
    // set. Accepted at this size for the same reason the vote-count sort is: an
    // internal board is thousands of rows. FULLTEXT is the escape hatch, and it
    // changes what "matching" means — words, not substrings — so it is a
    // decision to take on purpose rather than a swap.
    conditions.push('(r.title LIKE :search OR r.description LIKE :search)');
    params['search'] = `%${escapeLike(filters.search)}%`;
  }

  // A filtered board with no filters left to add — possible only when pinned
  // rows are included — has nothing to narrow, and WHERE with no condition is a
  // syntax error.
  const clause = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;

  return { clause, params };
}

/**
 * The unpinned board, paginated.
 *
 * One round trip for both the page and the total: COUNT(*) OVER () is evaluated
 * before LIMIT is applied, so it reports the size of the whole result set rather
 * than of the page. SQL_CALC_FOUND_ROWS is deprecated in MySQL 8.
 */
export async function list({
  limit,
  offset,
  viewerId,
  seesPendingComments,
  sort,
  includePinned,
  ...filters
}: ListParams): Promise<ListPage> {
  const { clause, params } = buildWhere(filters, includePinned);

  const [rows] = await pool.query<ListRow[]>(
    `
    ${COUNTS_CTE}
    SELECT
      ${COMMON_COLUMNS},
      ${EXCERPT_COLUMNS},
      ${HAS_VOTED},
      COUNT(*) OVER () AS total_count
    ${JOINS}
    ${clause}
    ${orderBy(sort, includePinned)}
    LIMIT :limit OFFSET :offset
    `,
    {
      ...params,
      excerptLength: EXCERPT_LENGTH,
      viewerId,
      seesPending: seesPendingComments ? 1 : 0,
      limit,
      offset,
    },
  );

  const first = rows[0];

  if (!first) {
    // A page past the end returns no rows, and a window function over no rows
    // reports nothing — so the total has to be asked for separately. This is the
    // only case where it costs a second query, and it must count the same
    // filtered set, or a filter with one page reports "page 3 of 1".
    return { items: [], total: await count(filters, includePinned) };
  }

  return { items: rows.map(toListItem), total: Number(first.total_count) };
}

/** Counts exactly the set the list pages over — same filters, same pinned rule. */
export async function count(filters: ListFilters = {}, includePinned = false): Promise<number> {
  const { clause, params } = buildWhere(filters, includePinned);

  const [rows] = await pool.query<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(*) AS total FROM feedback_requests r ${clause}`,
    params,
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
export async function listPinned(
  viewerId: number,
  seesPendingComments: boolean,
  limit: number,
  sort?: SortOption,
): Promise<PinnedPage> {
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
    ${pinnedOrderBy(sort)}
    LIMIT :limit
    `,
    { excerptLength: EXCERPT_LENGTH, viewerId, seesPending: seesPendingComments ? 1 : 0, limit },
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
  seesPendingComments: boolean,
): Promise<Omit<FeedbackRequestDetail, RequestPermissionFlags> | null> {
  const [rows] = await pool.query<DetailRow[]>(
    `
    ${COUNTS_CTE}
    SELECT ${COMMON_COLUMNS}, r.description, ${HAS_VOTED}
    ${JOINS}
    WHERE r.id = :id
    LIMIT 1
    `,
    { id, viewerId, seesPending: seesPendingComments ? 1 : 0 },
  );
  const row = rows[0];
  return row ? toDetail(row) : null;
}

/** One row in list shape, for returning a request the caller just changed. */
export async function findListItemById(
  id: number,
  viewerId: number,
  seesPendingComments: boolean,
): Promise<ListItemRow | null> {
  const [rows] = await pool.query<ListRow[]>(
    `
    ${COUNTS_CTE}
    SELECT ${COMMON_COLUMNS}, ${EXCERPT_COLUMNS}, ${HAS_VOTED}
    ${JOINS}
    WHERE r.id = :id
    LIMIT 1
    `,
    { excerptLength: EXCERPT_LENGTH, id, viewerId, seesPending: seesPendingComments ? 1 : 0 },
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

export interface UpdateContentInput {
  title: string;
  description: string;
  categoryId: number;
}

/**
 * The author's own edit. Stamps edited_at, which is what the "edited" marker
 * reads — updated_at moves for pinning and status changes too, and neither of
 * those is somebody rewriting their own words.
 *
 * No affectedRows check: it counts rows CHANGED, not matched, so saving a form
 * without altering a character reports zero and would read as "no such
 * request". Existence is established before this is called.
 */
export async function updateContent(id: number, input: UpdateContentInput): Promise<void> {
  const [result] = await pool.execute<ResultSetHeader>(
    `
    UPDATE feedback_requests
    SET title = :title,
        description = :description,
        category_id = :categoryId,
        edited_at = CURRENT_TIMESTAMP(3)
    WHERE id = :id
    `,
    { ...input, id },
  );
  void result;
}

/**
 * Triage. Deliberately does not touch edited_at: moving a request to Done is
 * not the author editing it, and the marker says who changed the words.
 */
export async function updateStatus(id: number, statusId: number): Promise<void> {
  const [result] = await pool.execute<ResultSetHeader>(
    'UPDATE feedback_requests SET status_id = :statusId WHERE id = :id',
    { id, statusId },
  );
  void result;
}

/**
 * Deletes the request and, through the schema, everything that only existed
 * because of it: its votes and its comments both cascade.
 *
 * The author_id foreign key is ON DELETE RESTRICT, which is about deleting
 * USERS, not requests — nothing here can trip it.
 */
export async function remove(id: number): Promise<void> {
  const [result] = await pool.execute<ResultSetHeader>(
    'DELETE FROM feedback_requests WHERE id = :id',
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

/**
 * How many requests this person has filed in the last rolling day, and when the
 * oldest of them leaves that window.
 *
 * A rolling window rather than a calendar day, so the limit does not reset at a
 * moment somebody has to guess — and so the answer to "when may I post again"
 * is a real timestamp rather than midnight in a timezone the server picked.
 *
 * `oldest_in_window` is what makes that answer possible: a slot comes back when
 * the earliest submission still inside the window ages out of it, which is
 * exactly 24 hours after it was created.
 *
 * Deleted requests do not count, because they are not rows any more — deleting
 * a request removes it outright. That is a real hole in the limit as a defence
 * (file the maximum, delete them, file more) and it is left open on purpose:
 * this limit exists to stop one person filling the board, and a request that
 * has been deleted is not on the board. Closing it would mean recording
 * submissions somewhere deletion cannot reach, which is an audit table this
 * application does not have a second use for yet.
 */
export async function countRecentByAuthor(
  authorId: number,
  windowHours: number,
): Promise<{ filed: number; oldestInWindow: Date | null }> {
  const [rows] = await pool.execute<(RowDataPacket & { filed: number; oldest: Date | null })[]>(
    `SELECT COUNT(*) AS filed, MIN(created_at) AS oldest
     FROM feedback_requests
     WHERE author_id = :authorId
       AND created_at > NOW(3) - INTERVAL :windowHours HOUR`,
    { authorId, windowHours },
  );

  const row = rows[0];

  return {
    filed: Number(row?.filed ?? 0),
    oldestInWindow: row?.oldest ?? null,
  };
}
