import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../db/pool.js';

/**
 * The only file containing comment SQL.
 *
 * Nothing here decides anything: deletion is two different operations and which
 * one applies is the service's judgement, not this module's.
 */

/* --------------------------------------------------------------------------
 *                          WHO MAY SEE WHICH COMMENT
 *
 * Written once, here, and used by every query that has an opinion about it --
 * including the count in the requests repository, which imports it rather than
 * spelling it out again.
 *
 * That is not tidiness. The pending decision that parked comment moderation
 * said this condition would need to hold in more than one place and would be
 * easier to write once than to retrofit, and the failure it was pointing at is
 * specific: a badge that promises three comments above a thread that shows one.
 * Two copies of this rule disagree the first time either is edited.
 *
 * Three ways a waiting comment is still visible:
 *
 *   approved_at IS NOT NULL   it has cleared publication -- either an admin let
 *                             it through, or the gate was open when it was
 *                             written and it was stamped on the way in
 *   author_id = :viewerId     your own words never disappear on you. Somebody
 *                             who cannot see what they just posted assumes it
 *                             failed and posts it again
 *   :seesPending = 1          the gate is open now, or the viewer is an admin.
 *                             The first half is what stops comments written
 *                             during a moderated spell being stranded forever
 *                             when moderation is switched off
 *
 * Requires :viewerId and :seesPending to be bound by whatever query uses it.
 * ------------------------------------------------------------------------ */
export const APPROVED_FOR_VIEWER = `(
  c.approved_at IS NOT NULL
  OR c.author_id = :viewerId
  OR :seesPending = 1
)`;

/**
 * The same rule plus "not removed" -- what a reader can actually open, which is
 * what a count is claiming to be.
 *
 * The thread deliberately does NOT use this one: a removed comment is still
 * returned there as a tombstone, because its replies need something to hang
 * from. A count of tombstones would be a different and less useful number.
 */
export const VISIBLE_COMMENT = `c.deleted_at IS NULL AND ${APPROVED_FOR_VIEWER}`;

/** One row of the moderation queue, with the request it is answering. */
export interface PendingComment {
  id: number;
  requestId: number;
  requestTitle: string;
  parentId: number | null;
  author: { id: number; displayName: string };
  body: string;
  createdAt: Date;
}

interface PendingRow extends RowDataPacket {
  id: number;
  request_id: number;
  request_title: string;
  parent_id: number | null;
  author_id: number;
  author_display_name: string;
  body: string;
  created_at: Date;
}

interface CommentRow extends RowDataPacket {
  id: number;
  request_id: number;
  parent_id: number | null;
  author_id: number;
  author_display_name: string;
  body: string;
  created_at: Date;
  edited_at: Date | null;
  approved_at: Date | null;
  deleted_at: Date | null;
  deleted_by: number | null;
  hidden_with_parent: number;
}

export interface CommentRecord {
  id: number;
  requestId: number;
  parentId: number | null;
  authorId: number;
  authorDisplayName: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  /** Null while it is waiting for an admin. */
  approvedAt: Date | null;
  isDeleted: boolean;
  deletedBy: number | null;
  hiddenWithParent: boolean;
}

function toRecord(row: CommentRow): CommentRecord {
  return {
    id: row.id,
    requestId: row.request_id,
    parentId: row.parent_id,
    authorId: row.author_id,
    authorDisplayName: row.author_display_name,
    body: row.body,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    approvedAt: row.approved_at,
    isDeleted: row.deleted_at !== null,
    deletedBy: row.deleted_by,
    hiddenWithParent: row.hidden_with_parent === 1,
  };
}

const SELECT_COMMENT = `
  SELECT
    c.id, c.request_id, c.parent_id, c.author_id, u.display_name AS author_display_name,
    c.body, c.created_at, c.edited_at, c.approved_at,
    c.deleted_at, c.deleted_by, c.hidden_with_parent
  FROM comments c
  JOIN users u ON u.id = c.author_id
`;

/**
 * A whole thread in one query, oldest first, roots and replies together.
 *
 * Assembling the two levels is the service's job — a second query per comment
 * would be one round trip per root, which is the classic way to make a comment
 * section slow.
 */
export async function listForRequest(
  requestId: number,
  viewer: { id: number; seesPending: boolean },
): Promise<CommentRecord[]> {
  const [rows] = await pool.query<CommentRow[]>(
    `${SELECT_COMMENT}
     WHERE c.request_id = :requestId AND ${APPROVED_FOR_VIEWER}
     ORDER BY COALESCE(c.parent_id, c.id), c.parent_id IS NOT NULL, c.created_at, c.id`,
    { requestId, viewerId: viewer.id, seesPending: viewer.seesPending ? 1 : 0 },
  );
  return rows.map(toRecord);
}

/**
 * Everything still waiting, oldest first, across every request.
 *
 * The queue an admin works through. It carries the request's title because a
 * comment out of its thread is unjudgeable -- "that is not what I meant" is
 * either fine or not depending entirely on what it is answering.
 */
export async function listPending(limit: number): Promise<PendingComment[]> {
  const [rows] = await pool.query<PendingRow[]>(
    `SELECT
       c.id, c.request_id, c.parent_id, c.author_id, u.display_name AS author_display_name,
       c.body, c.created_at, r.title AS request_title
     FROM comments c
     JOIN users u ON u.id = c.author_id
     JOIN feedback_requests r ON r.id = c.request_id
     WHERE c.approved_at IS NULL AND c.deleted_at IS NULL
     ORDER BY c.created_at, c.id
     LIMIT :limit`,
    { limit },
  );

  return rows.map((row) => ({
    id: row.id,
    requestId: row.request_id,
    requestTitle: row.request_title,
    parentId: row.parent_id,
    author: { id: row.author_id, displayName: row.author_display_name },
    body: row.body,
    createdAt: row.created_at,
  }));
}

/**
 * Lets a waiting comment through.
 *
 * `approved_at IS NULL` in the WHERE, so approving twice is not a second
 * approval with a later timestamp -- and so the service can tell "there was
 * nothing to approve" from "done". This codebase has already been caught once
 * by affectedRows counting rows CHANGED rather than matched; here the two
 * answers are made to differ on purpose.
 */
export async function approve(id: number): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE comments SET approved_at = CURRENT_TIMESTAMP(3)
     WHERE id = :id AND approved_at IS NULL AND deleted_at IS NULL`,
    { id },
  );
  return result.affectedRows === 1;
}

export async function countPending(): Promise<number> {
  const [rows] = await pool.query<(RowDataPacket & { total: number })[]>(
    'SELECT COUNT(*) AS total FROM comments WHERE approved_at IS NULL AND deleted_at IS NULL',
  );
  return Number(rows[0]?.total ?? 0);
}

export async function findById(id: number): Promise<CommentRecord | null> {
  const [rows] = await pool.execute<CommentRow[]>(`${SELECT_COMMENT} WHERE c.id = :id LIMIT 1`, {
    id,
  });
  const row = rows[0];
  return row ? toRecord(row) : null;
}

// A type alias rather than an interface: mysql2 named parameters require an
// index signature, which an interface does not provide.
export type InsertCommentInput = {
  requestId: number;
  parentId: number | null;
  authorId: number;
  body: string;

  /**
   * 1 when the moderation gate is open, and the comment is stamped as having
   * cleared publication on the way in.
   *
   * This is what stops switching moderation ON from hiding the entire history
   * of the board: everything written while it was off already carries an
   * approval, so the gate only ever applies to what comes after it.
   */
  approved: number;
};

export async function insert(input: InsertCommentInput): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO comments (request_id, parent_id, author_id, body, approved_at)
     VALUES (:requestId, :parentId, :authorId, :body,
             CASE WHEN :approved = 1 THEN CURRENT_TIMESTAMP(3) ELSE NULL END)`,
    input,
  );
  return result.insertId;
}

/** Sets edited_at, which updated_at cannot stand in for — it also moves on deletion. */
export async function updateBody(id: number, body: string): Promise<void> {
  await pool.execute(
    'UPDATE comments SET body = :body, edited_at = CURRENT_TIMESTAMP(3) WHERE id = :id',
    { id, body },
  );
}

/**
 * Any reply rows at all, including ones already hidden.
 *
 * Deliberately not "visible replies": hard-deleting a comment cascades, so a
 * comment whose replies were previously moderated would take an admin's record
 * of that moderation with it.
 */
export async function countReplies(id: number): Promise<number> {
  const [rows] = await pool.execute<(RowDataPacket & { total: number })[]>(
    'SELECT COUNT(*) AS total FROM comments WHERE parent_id = :id',
    { id },
  );
  return Number(rows[0]?.total ?? 0);
}

/** The row goes. Only ever used where nothing is attached to it. */
export async function hardDelete(id: number): Promise<void> {
  await pool.execute('DELETE FROM comments WHERE id = :id', { id });
}

/** The row stays, hidden, recording who hid it. */
export async function softDelete(id: number, actorId: number): Promise<void> {
  await pool.execute(
    `UPDATE comments
     SET deleted_at = CURRENT_TIMESTAMP(3), deleted_by = :actorId
     WHERE id = :id AND deleted_at IS NULL`,
    { id, actorId },
  );
}

/**
 * Hides the replies under a comment that has just been hidden.
 *
 * `deleted_at IS NULL` matters: a reply an admin removed earlier keeps that
 * record rather than being restamped with whoever removed the parent.
 */
export async function softDeleteReplies(parentId: number, actorId: number): Promise<void> {
  await pool.execute(
    `UPDATE comments
     SET deleted_at = CURRENT_TIMESTAMP(3), deleted_by = :actorId, hidden_with_parent = 1
     WHERE parent_id = :parentId AND deleted_at IS NULL`,
    { parentId, actorId },
  );
}
