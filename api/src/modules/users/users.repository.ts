import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { pool, withTransaction } from '../../db/pool.js';
import type { Actor, Role } from '../../auth/actor.js';

interface UserRow extends RowDataPacket {
  id: number;
  external_id: string | null;
  email: string;
  display_name: string;
  role: Role;
}

function toActor(row: UserRow): Actor {
  return {
    id: row.id,
    externalId: row.external_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
  };
}

const SELECT_USER = `
  SELECT id, external_id, email, display_name, role
  FROM users
`;

/**
 * A departed account is not findable.
 *
 * `deleted_at IS NULL` here rather than at the seam, because there is no
 * question this repository could be asked where the answer "yes, that account,
 * the one that was anonymised" is the right one. The placeholder email an
 * anonymised row carries would not match anybody's real address anyway; this
 * makes it a rule rather than a consequence of how the placeholder is spelled.
 */
export async function findByEmail(email: string): Promise<Actor | null> {
  const [rows] = await pool.execute<UserRow[]>(
    `${SELECT_USER} WHERE email = :email AND deleted_at IS NULL LIMIT 1`,
    { email },
  );
  const row = rows[0];
  return row ? toActor(row) : null;
}

/**
 * The lookup authentication runs on every request.
 *
 * `external_id` is the provider's `sub`. Matching on it rather than on the
 * email is the whole reason the column exists: an address can change upstream,
 * be reassigned, or be claimed at a second provider, and none of those is the
 * same event as a different person. A returning user is the same row because
 * the subject says so.
 *
 * `deleted_at IS NULL` for the same reason as findByEmail — and anonymisation
 * clears external_id anyway, so a departed account cannot be matched even by a
 * token that was minted before they left.
 */
export async function findByExternalId(externalId: string): Promise<Actor | null> {
  const [rows] = await pool.execute<UserRow[]>(
    `${SELECT_USER} WHERE external_id = :externalId AND deleted_at IS NULL LIMIT 1`,
    { externalId },
  );
  const row = rows[0];
  return row ? toActor(row) : null;
}

export async function findById(id: number): Promise<Actor | null> {
  const [rows] = await pool.execute<UserRow[]>(
    `${SELECT_USER} WHERE id = :id AND deleted_at IS NULL LIMIT 1`,
    { id },
  );
  const row = rows[0];
  return row ? toActor(row) : null;
}

/**
 * Copies an address the provider has moved on to.
 *
 * The email is the provider's field, not the person's: nothing in this
 * application lets somebody type a new one, and the account screen edits only
 * the display name. So when a token arrives carrying a different address for a
 * subject we already know, the local copy is stale and this is how it stops
 * being stale.
 *
 * It is an UPDATE by id and never a way to find a row. Matching happens on
 * external_id, always — an address that changed upstream updates the account it
 * belongs to and can never re-point the token at a different one.
 */
export async function updateEmail(id: number, email: string): Promise<void> {
  await pool.execute('UPDATE users SET email = :email WHERE id = :id', { id, email });
}

export async function updateDisplayName(id: number, displayName: string): Promise<void> {
  await pool.execute('UPDATE users SET display_name = :displayName WHERE id = :id', {
    id,
    displayName,
  });
}

/**
 * How many admins are left besides this one.
 *
 * Asked before an admin is allowed to leave. An installation with no admin
 * cannot appoint one — there is no user administration in this application yet,
 * so the only recovery would be an UPDATE against the database by hand, which
 * is the dead end every other rule here exists to avoid.
 */
export async function countOtherAdmins(excludingId: number): Promise<number> {
  const [rows] = await pool.execute<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(*) AS total FROM users
     WHERE role = 'admin' AND deleted_at IS NULL AND id <> :excludingId`,
    { excludingId },
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Creating a local account for somebody the identity provider has vouched for.
 *
 * The role is not a parameter. Everybody arrives as a user, and there is no
 * path in this application by which a caller's own request decides otherwise —
 * promotion is user administration's business, and does not exist yet.
 */
export async function insert(input: {
  email: string;
  displayName: string;
  externalId: string | null;
}): Promise<Actor> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT INTO users (email, display_name, external_id)
     VALUES (:email, :displayName, :externalId)`,
    input,
  );

  return {
    id: result.insertId,
    externalId: input.externalId,
    email: input.email,
    displayName: input.displayName,
    role: 'user',
  };
}

/**
 * Anonymisation, which is what deleting an account means here.
 *
 * Every field that identifies the person is cleared in one statement, and their
 * preferences — the only rows in this schema that are purely theirs — go with
 * it in the same transaction. Everything else they wrote stays exactly where it
 * is, pointing at a row that no longer says who it was.
 *
 * The email placeholder is built from the id rather than emptied: the column is
 * NOT NULL UNIQUE, so every departed account would otherwise collide on the
 * same empty string. `.invalid` is the reserved TLD that can never resolve, so
 * the address is unroutable by construction rather than by choosing a domain
 * nobody happens to own.
 *
 * The display name becomes a placeholder too, and the row still says
 * deleted_at — a person may legitimately be called "Deleted user", and a screen
 * has to be able to tell them apart from an account that is gone.
 */
/**
 * What the guard is shown before anything is written. See below.
 */
export interface AnonymiseContext {
  role: Role;
  otherAdmins: number;
}

/**
 * @param guard Runs inside the transaction, with the admin rows locked, and may
 * throw to refuse. The rule and its message stay in the service; the locking
 * and the SQL stay here.
 *
 * WHY THE GUARD IS A PARAMETER RATHER THAN A CHECK BEFOREHAND
 *
 * "You are the only admin, so you cannot leave" was a count, then a write, with
 * nothing in between holding the answer still. Two admins pressing Delete at
 * the same moment both read "one other admin remains", both proceed, and the
 * board ends with none — the exact dead end the refusal exists to prevent, and
 * one nothing in this application can recover from, because nothing here can
 * appoint an admin.
 *
 * SELECT … FOR UPDATE over the admin rows makes the second transaction wait for
 * the first to commit, so it counts what is true afterwards rather than what was
 * true before. The count therefore has to happen inside this transaction, and
 * the decision has to be able to run there too.
 */
export async function anonymise(
  id: number,
  guard?: (context: AnonymiseContext) => void,
  subjectHash?: string | null,
): Promise<void> {
  await withTransaction(async (connection) => {
    if (guard) {
      /**
       * The admin set and the row being removed, locked by ONE statement in id
       * order.
       *
       * Two statements — the target first, then the admins — deadlock: two
       * admins leaving at the same instant each hold their own row and each
       * wait for the other's. MySQL picks a victim and rolls it back, which
       * arrives as a 500 for somebody who should have been told they are the
       * last admin. One ordered statement gives every caller the same lock
       * order, so they queue instead of colliding.
       */
      const [locked] = await connection.execute<UserRow[]>(
        `${SELECT_USER}
         WHERE (role = 'admin' OR id = :id) AND deleted_at IS NULL
         ORDER BY id
         FOR UPDATE`,
        { id },
      );

      guard({
        role: locked.find((row) => row.id === id)?.role ?? 'user',
        otherAdmins: locked.filter((row) => row.role === 'admin' && row.id !== id).length,
      });
    }

    await connection.execute('DELETE FROM user_settings WHERE user_id = :id', { id });

    await connection.execute(
      `UPDATE users
       SET external_id          = NULL,
           email                = CONCAT('deleted-', id, '@removed.invalid'),
           display_name         = 'Deleted user',
           deleted_at           = CURRENT_TIMESTAMP(3),
           deleted_subject_hash = :subjectHash
       WHERE id = :id AND deleted_at IS NULL`,
      { id, subjectHash: subjectHash ?? null },
    );
  });
}

/**
 * Whether this provider subject left too recently to be given a new account.
 *
 * The window is the access-token lifetime, because that is exactly how long a
 * token minted before the deletion can still be presented — see
 * 013.do.deleted_subject_grace.sql for what happens without this.
 *
 * A person genuinely returning inside the window is refused and told to sign in
 * again, which costs them one redirect. The alternative costs them a duplicate
 * account they did not ask for and cannot merge.
 */
export async function departedRecently(
  subjectHash: string,
  withinSeconds: number,
): Promise<boolean> {
  const [rows] = await pool.execute<(RowDataPacket & { recent: number })[]>(
    `SELECT EXISTS(
       SELECT 1 FROM users
       WHERE deleted_subject_hash = :subjectHash
         AND deleted_at > NOW(3) - INTERVAL :withinSeconds SECOND
     ) AS recent`,
    { subjectHash, withinSeconds },
  );
  return Number(rows[0]?.recent ?? 0) === 1;
}
