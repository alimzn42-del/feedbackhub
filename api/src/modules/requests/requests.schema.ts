import { z } from 'zod';
import { paginationQuerySchema } from '../../http/pagination.js';

/**
 * The API contract for feedback requests: what may be sent in, and what is sent
 * back. Messages are written for a person reading them next to a form field.
 */
export const TITLE_MIN = 5;
export const TITLE_MAX = 160;
export const DESCRIPTION_MIN = 20;
export const DESCRIPTION_MAX = 5000;
export const EXCERPT_LENGTH = 240;

/**
 * Pinning is unlimited by decision, so the pinned endpoint is capped instead.
 * The response reports the true total, so the panel can say when it is not
 * showing everything rather than silently truncating.
 */
export const MAX_PINNED_RETURNED = 100;

export const createRequestBodySchema = z
  .object({
    title: z
      .string({ error: 'A title is required.' })
      .trim()
      .min(TITLE_MIN, { error: `The title must be at least ${TITLE_MIN} characters.` })
      .max(TITLE_MAX, { error: `The title cannot be longer than ${TITLE_MAX} characters.` }),

    description: z
      .string({ error: 'A description is required.' })
      .trim()
      .min(DESCRIPTION_MIN, {
        error: `Describe the request in at least ${DESCRIPTION_MIN} characters so others can judge it.`,
      })
      .max(DESCRIPTION_MAX, {
        error: `The description cannot be longer than ${DESCRIPTION_MAX} characters.`,
      }),

    categoryId: z.coerce
      .number({ error: 'Choose a category.' })
      .int({ error: 'Choose a category.' })
      .positive({ error: 'Choose a category.' }),
  })
  // Unknown keys are rejected rather than ignored. Status and author are not the
  // client's to set, and silently dropping them would hide the attempt.
  .strict();

export type CreateRequestBody = z.infer<typeof createRequestBodySchema>;

/**
 * Filters arrive in the next slice. Pagination is here now because list state
 * belongs in the URL from the first screen that has a list.
 */
export const listRequestsQuerySchema = paginationQuerySchema.strict();

export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>;

/* ── Response shapes ─────────────────────────────────────────────────────── */

export interface TaxonomyRef {
  id: number;
  name: string;
  slug: string;
}

export interface AuthorRef {
  id: number;
  displayName: string;
}

/**
 * The list item carries an excerpt rather than the full description. Twenty full
 * descriptions is up to 100KB of text the card never renders, and truncating in
 * the browser would mean sending it anyway.
 */
export interface FeedbackRequestListItem {
  id: number;
  title: string;
  excerpt: string;
  excerptTruncated: boolean;
  category: TaxonomyRef;
  status: TaxonomyRef;
  author: AuthorRef;
  isPinned: boolean;

  /** When it was pinned, and by which admin. Null on anything unpinned. */
  pinnedAt: string | null;
  pinnedBy: AuthorRef | null;

  /** Whether the caller may pin or unpin. Admins only. */
  canPin: boolean;

  /** Counted from the vote rows on every read. Never stored. */
  voteCount: number;

  /** Whether the caller has voted, so the control can render its state. */
  hasVoted: boolean;

  /**
   * Whether the caller may vote on this one. Computed by the policy module per
   * row, so the browser never has to know the rule — or the caller identity it
   * would need to apply it.
   */
  canVote: boolean;

  createdAt: string;
  updatedAt: string;
}

/** The full resource, returned when a single request is created or fetched. */
export interface FeedbackRequestDetail extends Omit<FeedbackRequestListItem, 'excerpt' | 'excerptTruncated'> {
  description: string;
}

/** Shared by every route that names a request in its path. */
export const requestIdParamsSchema = z.object({
  id: z.coerce
    .number({ error: 'The request id must be a number.' })
    .int({ error: 'The request id must be a whole number.' })
    .positive({ error: 'The request id must be a positive number.' }),
});
