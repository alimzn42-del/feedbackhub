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
 * Editing takes the same three fields under the same rules — the form is the
 * same form, and a value that was never valid to file should not become valid
 * to save.
 *
 * All three are required rather than individually optional. The only caller
 * sends the whole form, and per-field optionality would add three combinations
 * nothing exercises. A rule nobody asks is a rule nobody checks.
 *
 * Status and pinning are absent on purpose: they are not the author's to set
 * here, and .strict() refuses them by name rather than ignoring the attempt.
 */
export const updateRequestBodySchema = createRequestBodySchema;

export type UpdateRequestBody = z.infer<typeof updateRequestBodySchema>;

/**
 * Triage, not authorship. The status is named by id because it is chosen from a
 * list the server just sent; a slug would be a second identifier for the same
 * row with nothing asking for it.
 */
export const changeStatusBodySchema = z
  .object({
    statusId: z.coerce
      .number({ error: 'Choose a status.' })
      .int({ error: 'Choose a status.' })
      .positive({ error: 'Choose a status.' }),
  })
  .strict();

export type ChangeStatusBody = z.infer<typeof changeStatusBodySchema>;

/* ── Filtering and sorting ─────────────────────────────────────── */

/**
 * The orderings a caller may ask for.
 *
 * Each is a total order in the repository. Ties that are free to swap between
 * pages are the one bug pagination cannot survive.
 */
export const SORT_OPTIONS = ['votes', 'newest', 'oldest'] as const;

export type SortOption = (typeof SORT_OPTIONS)[number];

/** What the board opens on: the most recently filed first. */
export const DEFAULT_SORT: SortOption = 'newest';

/**
 * The shelf's own default: most recently pinned first, which is what makes
 * something an admin just pinned visible in the three the panel shows
 * collapsed. It follows the board's ordering only when one was asked for
 * explicitly — which is why `sort` below has no schema default. A default here
 * would answer "was one asked for?" with "yes, always", and the shelf could
 * never tell the two apart.
 */

/**
 * A search shorter than two characters matches most of the board, so it costs a
 * full scan to tell the user nothing. The ceiling is not a defence — the value
 * is parameterised either way — it just refuses a URL nobody typed on purpose.
 */
export const SEARCH_MIN = 2;
export const SEARCH_MAX = 100;

/** More filter values than the taxonomy holds is a malformed URL, not a filter. */
export const MAX_FILTER_VALUES = 20;

/** What the taxonomy actually mints: lowercase words joined by single hyphens. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Accepts both shapes a browser and a hand-written URL produce:
 * `?status=planned,done` and `?status=planned&status=done`. They mean the same
 * thing, so both arrive here as the same array.
 *
 * Empty means absent: `?status=` is a filter bar that was cleared, not a
 * request for the requests whose status is the empty string.
 *
 * Non-string entries are passed through untouched so the schema below can
 * reject them by name rather than coercing something unintended into a filter.
 */
function toSlugList(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  const entries = (Array.isArray(value) ? value : [value]).flatMap((entry) =>
    typeof entry === 'string' ? entry.split(',') : [entry],
  );

  const cleaned = entries
    .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : entry))
    .filter((entry) => entry !== '');

  // Deduplicated: repeating a slug cannot change which rows match, and an IN
  // list is not the place to find that out.
  const unique = [...new Set(cleaned)];

  return unique.length === 0 ? undefined : unique;
}

function slugListSchema(noun: string) {
  return z.preprocess(
    toSlugList,
    z
      .array(
        z.string().regex(SLUG_PATTERN, {
          error: `Each ${noun} must be a slug, like "in-progress".`,
        }),
      )
      .max(MAX_FILTER_VALUES, {
        error: `You cannot filter by more than ${MAX_FILTER_VALUES} ${noun}s at once.`,
      })
      .optional(),
  );
}

/**
 * `?mine` is a switch, and a URL carries strings. Anything that is not one of
 * the four spellings below is left alone to be refused by name — silently
 * reading `?mine=yes` as false would hide the board from somebody who asked to
 * see their own requests.
 */
function toFlag(value: unknown): unknown {
  if (value === undefined || value === '') return undefined;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return value;
}

/** A cleared search box is an absent filter, not a search for nothing. */
function toSearch(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Every piece of list state is a query parameter, so a filtered view is a link.
 * Unknown parameters are still rejected: a typo in a filter name would
 * otherwise return the unfiltered board and look like it worked.
 */
export const listRequestsQuerySchema = paginationQuerySchema
  .extend({
    /** Category slugs. Resolved to ids by the service, which rejects unknown ones. */
    category: slugListSchema('category'),

    /** Status slugs, same treatment. */
    status: slugListSchema('status'),

    /**
     * The caller's own requests. A flag rather than an author parameter: "mine"
     * is answered from the identity seam, and the browser is never told who it
     * is, so it could not name an author id even if it wanted to.
     */
    mine: z.preprocess(
      toFlag,
      z
        .boolean({ error: 'The "mine" filter must be true or false.' })
        .optional(),
    ),

    /** Free text, matched against title and description. */
    q: z.preprocess(
      toSearch,
      z
        .string({ error: 'The search term must be text.' })
        .min(SEARCH_MIN, { error: `Search for at least ${SEARCH_MIN} characters.` })
        .max(SEARCH_MAX, { error: `A search term cannot be longer than ${SEARCH_MAX} characters.` })
        .optional(),
    ),

    sort: z
      .enum(SORT_OPTIONS, {
        error: `Sort must be one of: ${SORT_OPTIONS.join(', ')}.`,
      })
      .optional(),
  })
  .strict();

export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>;

/**
 * Whether anything is narrowing the board.
 *
 * Sorting is deliberately not counted. Reordering the board hides nothing from
 * it, so the pinned shelf still makes sense beside it; filtering does hide
 * things, which is when the shelf collapses into the results. The browser
 * applies the same rule to decide whether to render the shelf, and the two have
 * to agree — a shelf on screen while the list also contains the pinned rows
 * would show them twice.
 */
/**
 * The shelf is not paginated and takes no filters, but it does take the
 * ordering — it is a group within the same board, not a separate view.
 */
export const listPinnedQuerySchema = z
  .object({
    sort: z
      .enum(SORT_OPTIONS, {
        error: `Sort must be one of: ${SORT_OPTIONS.join(', ')}.`,
      })
      .optional(),
  })
  .strict();

export type ListPinnedQuery = z.infer<typeof listPinnedQuerySchema>;

export function isFiltered(query: ListRequestsQuery): boolean {
  return (
    (query.category?.length ?? 0) > 0 ||
    (query.status?.length ?? 0) > 0 ||
    query.mine === true ||
    query.q !== undefined
  );
}

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

  /**
   * Whether the caller may edit the text, delete the request, or move it
   * between statuses. Decided per row by the policy module, exactly like
   * canVote: the browser is never told who the caller is, so it cannot work
   * any of these out, and a second copy of the rules could only disagree with
   * the first.
   */
  canEdit: boolean;
  canDelete: boolean;
  canChangeStatus: boolean;

  /** Counted from the vote rows on every read. Never stored. */
  voteCount: number;

  /** Visible comments, counted on read. Never stored. */
  commentCount: number;

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

  /**
   * When the text was last edited by its author, or null if it never was.
   *
   * Its own column rather than updated_at <> created_at: pinning and status
   * changes move updated_at too, and an admin pinning something must not make
   * it read as edited by the person who wrote it.
   */
  editedAt: string | null;
}

/**
 * The answers the policy module attaches per row.
 *
 * Named, because the repository builds every row without them and the service
 * adds them: an `Omit` listing them one by one silently goes stale the next
 * time a permission is added, and the compiler only notices at the far end.
 */
export type RequestPermissionFlags =
  | 'canVote'
  | 'canPin'
  | 'canEdit'
  | 'canDelete'
  | 'canChangeStatus';

/** A row as the repository builds it: everything except the permission answers. */
export type FeedbackRequestListRow = Omit<FeedbackRequestListItem, RequestPermissionFlags>;

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
