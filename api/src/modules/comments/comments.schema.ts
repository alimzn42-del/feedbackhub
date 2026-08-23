import { z } from 'zod';

export const BODY_MIN = 1;
export const BODY_MAX = 5000;

const body = z
  .string({ error: 'Write something first.' })
  .trim()
  .min(BODY_MIN, { error: 'Write something first.' })
  .max(BODY_MAX, { error: `A comment cannot be longer than ${BODY_MAX} characters.` });

export const createCommentBodySchema = z
  .object({
    body,
    /**
     * Omitted for a top-level comment; the comment being answered otherwise.
     * Threads are one level deep, so this must name a top-level comment — the
     * service checks that, because the database could not (see 007.do).
     */
    parentId: z.coerce
      .number({ error: 'That is not a comment id.' })
      .int({ error: 'That is not a comment id.' })
      .positive({ error: 'That is not a comment id.' })
      .optional(),
  })
  .strict();

export type CreateCommentBody = z.infer<typeof createCommentBodySchema>;

export const editCommentBodySchema = z.object({ body }).strict();

export type EditCommentBody = z.infer<typeof editCommentBodySchema>;

export const commentIdParamsSchema = z.object({
  id: z.coerce
    .number({ error: 'The comment id must be a number.' })
    .int({ error: 'The comment id must be a whole number.' })
    .positive({ error: 'The comment id must be a positive number.' }),
});

/* ── Response shapes ─────────────────────────────────────────────────────── */

export interface CommentAuthor {
  id: number;
  displayName: string;
}

/** Why a comment is showing as removed. Null when it is not. */
export type DeletionReason = 'author' | 'moderator' | 'with-parent';

/**
 * The thread, plus the one thing the composer above it has to know.
 *
 * `awaitsApproval` is not the setting. The setting is administrative and
 * withheld; this is its consequence for this caller on this screen — "a comment
 * you post now will wait" — which they have to be told before they write it, or
 * the interface is lying about what the button does.
 */
export interface CommentThreadDto {
  comments: CommentDto[];
  awaitsApproval: boolean;
}

export interface CommentDto {
  id: number;
  parentId: number | null;

  /**
   * Both null once removed. The row is retained for the audit trail, but the
   * words are not the reader's to see any more — so they do not leave the
   * server rather than being hidden by the browser.
   */
  author: CommentAuthor | null;
  body: string | null;

  createdAt: string;
  /** Set only when the text changed, never by a deletion. */
  editedAt: string | null;

  isDeleted: boolean;
  deletedReason: DeletionReason | null;

  /**
   * Waiting for an admin, and visible to its author (and to admins) until it is
   * let through.
   *
   * This is how the moderation setting reaches somebody who is not allowed to
   * read the setting: as a fact about their own comment, from the endpoint that
   * owns it. Almost always false — it can only be true while the gate is up.
   */
  isPending: boolean;

  /** Decided per row by the policy module, so the browser never guesses. */
  canEdit: boolean;
  canDelete: boolean;
  canReply: boolean;

  /**
   * Whether this caller may let this comment through.
   *
   * Only ever true on a comment that is actually waiting, and only for somebody
   * who may approve — so the thread can offer the control beside the words it
   * is about, without being told who is reading. Rejecting is `canDelete`,
   * which an admin already has: a rejected comment is a removed one, and it
   * records who removed it.
   */
  canApprove: boolean;

  /** Populated on top-level comments only; a reply cannot be replied to. */
  replies: CommentDto[];
}
