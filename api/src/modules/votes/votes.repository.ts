import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../db/pool.js';

/**
 * The only file containing vote SQL.
 *
 * There is no count column to keep up to date here — casting a vote inserts a
 * row and withdrawing one deletes it. Totals are counted where they are read.
 */

/**
 * Returns false when the vote already existed, so the caller can answer 409
 * rather than pretending it did something.
 *
 * INSERT IGNORE rather than a SELECT-then-INSERT: the primary key is the
 * constraint, and checking first would leave a window in which two concurrent
 * requests both see "no vote" and both try to insert. Letting the database
 * refuse the duplicate is the only version without a race.
 */
export async function cast(requestId: number, userId: number): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>(
    'INSERT IGNORE INTO votes (request_id, user_id) VALUES (:requestId, :userId)',
    { requestId, userId },
  );
  return result.affectedRows === 1;
}

/** Returns false when there was no vote to withdraw. */
export async function withdraw(requestId: number, userId: number): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>(
    'DELETE FROM votes WHERE request_id = :requestId AND user_id = :userId',
    { requestId, userId },
  );
  return result.affectedRows === 1;
}

export interface VoteState {
  requestId: number;
  voteCount: number;
  hasVoted: boolean;
}

/**
 * The state of one request's votes after a change, so the client can update a
 * card without refetching the whole board.
 */
export async function readState(requestId: number, userId: number): Promise<VoteState> {
  const [rows] = await pool.execute<(RowDataPacket & { vote_count: number; has_voted: number })[]>(
    `
    SELECT
      COUNT(*)                                     AS vote_count,
      COALESCE(SUM(user_id = :userId), 0)          AS has_voted
    FROM votes
    WHERE request_id = :requestId
    `,
    { requestId, userId },
  );

  const row = rows[0];

  return {
    requestId,
    voteCount: Number(row?.vote_count ?? 0),
    hasVoted: Number(row?.has_voted ?? 0) > 0,
  };
}
