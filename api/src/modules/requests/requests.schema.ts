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
  createdAt: string;
  updatedAt: string;
}

/** The full resource, returned when a single request is created or fetched. */
export interface FeedbackRequestDetail extends Omit<FeedbackRequestListItem, 'excerpt' | 'excerptTruncated'> {
  description: string;
}
