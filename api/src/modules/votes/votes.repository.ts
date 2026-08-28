import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool } from '../../db/pool.js';

/**
 * The only file containing vote SQL.
 *
 * There is no count column to keep up to date here — casting a vote inserts a
 * row and withdrawing one deletes it. Totals are counted where they are read.
 */

/**
 * What happened when a vote was cast.
 *
 * Three outcomes and not two, because `affectedRows === 0` means two different
 * things and one of them was being reported as the other — see below.
 */
export type CastOutcome = 'cast' | 'already-voted' | 'request-missing';

/**
 * INSERT IGNORE rather than a SELECT-then-INSERT: the primary key is the
 * constraint, and checking first would leave a window in which two concurrent
 * requests both see "no vote" and both try to insert. Letting the database
 * refuse the duplicate is the only version without a race.
 *
 * WHAT IGNORE ALSO SWALLOWS
 * It downgrades the foreign key violation as well. If the request is deleted
 * between the service reading its author and this statement running — the
 * window §16 calls Z-12 — the insert affects no rows for a completely different
 * reason, and reading that as "already voted" tells somebody they have voted on
 * a request that no longer exists.
 *
 * So a zero is not interpreted, it is asked about. One extra query, only on the
 * path that was already unusual, and it distinguishes the two by looking at
 * what is actually there.
 */
export async function cast(requestId: number, userId: number): Promise<CastOutcome> {
  const [result] = await pool.execute<ResultSetHeader>(
    'INSERT IGNORE INTO votes (request_id, user_id) VALUES (:requestId, :userId)',
    { requestId, userId },
  );

  if (result.affectedRows === 1) return 'cast';

  const [rows] = await pool.execute<(RowDataPacket & { voted: number; present: number })[]>(
    `SELECT
       EXISTS(SELECT 1 FROM votes WHERE request_id = :requestId AND user_id = :userId) AS voted,
       EXISTS(SELECT 1 FROM feedback_requests WHERE id = :requestId)                   AS present`,
    { requestId, userId },
  );

  if (Number(rows[0]?.present ?? 0) === 0) return 'request-missing';
  return Number(rows[0]?.voted ?? 0) === 1 ? 'already-voted' : 'request-missing';
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
