import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../db/pool.js';

/**
 * The only file containing comment SQL.
 *
 * Nothing here decides anything: deletion is two different operations and which
 * one applies is the service's judgement, not this module's.
 */

interface CommentRow extends RowDataPacket {
  id: number;
  request_id: number;
  parent_id: number | null;
  author_id: number;
  author_display_name: string;
  body: string;
  created_at: Date;
  edited_at: Date | null;
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
    isDeleted: row.deleted_at !== null,
    deletedBy: row.deleted_by,
    hiddenWithParent: row.hidden_with_parent === 1,
  };
}

const SELECT_COMMENT = `
  SELECT
    c.id, c.request_id, c.parent_id, c.author_id, u.display_name AS author_display_name,
    c.body, c.created_at, c.edited_at, c.deleted_at, c.deleted_by, c.hidden_with_parent
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
export async function listForRequest(requestId: number): Promise<CommentRecord[]> {
  const [rows] = await pool.execute<CommentRow[]>(
    `${SELECT_COMMENT}
     WHERE c.request_id = :requestId
     ORDER BY COALESCE(c.parent_id, c.id), c.parent_id IS NOT NULL, c.created_at, c.id`,
    { requestId },
  );
  return rows.map(toRecord);
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
};

export async function insert(input: InsertCommentInput): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO comments (request_id, parent_id, author_id, body)
     VALUES (:requestId, :parentId, :authorId, :body)`,
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
