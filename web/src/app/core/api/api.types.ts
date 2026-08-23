/** Shapes returned by the API, mirroring the schema modules under api/src/modules. */

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Every collection endpoint returns this envelope. */
export interface Paginated<T> {
  data: T[];
  page: PageMeta;
}

/** Bounded, non-paginated collections (taxonomy) and single resources. */
export interface Wrapped<T> {
  data: T;
}

export interface TaxonomyRef {
  id: number;
  name: string;
  slug: string;
}

/**
 * The orderings the board offers, mirroring SORT_OPTIONS in the API's request
 * schema. A value outside this list is refused by the server rather than
 * quietly ignored, so the two lists have to agree.
 */
export const SORT_OPTIONS = ['votes', 'newest', 'oldest'] as const;

export type SortOption = (typeof SORT_OPTIONS)[number];

/**
 * A taxonomy row as the admin screen sees it: what a selector shows, plus what
 * a decision about it needs.
 */
export interface TaxonomyAdminRow extends TaxonomyRef {
  sortOrder: number;

  /**
   * How many requests carry this row. Shown so retiring is informed rather than
   * a guess — it never blocks the action.
   */
  requestCount: number;
}

export interface CategoryAdminRow extends TaxonomyAdminRow {
  /** When it was retired, or null while it is still offered. */
  archivedAt: string | null;
}

export interface StatusAdminRow extends TaxonomyAdminRow {
  /** The status a new request receives. Exactly one row has it. */
  isDefault: boolean;
}

/**
 * What the caller may do that is not attached to a row.
 *
 * The navigation has to decide whether to offer the admin screen and there is
 * no row to hang the answer on, so it is asked for once. Same rule as canVote,
 * same guarantee: none. The endpoints refuse on their own.
 */
export interface Capabilities {
  canManageCategories: boolean;
  canManageStatuses: boolean;
}

export interface AuthorRef {
  id: number;
  displayName: string;
}

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

  /** Whether the signed-in user may pin or unpin. Admins only. */
  canPin: boolean;

  /**
   * What the signed-in user may do to this request. Decided per row by the
   * server, exactly like canVote — the browser is never told who it is, and
   * hiding a control it is told to hide is a courtesy, never the guarantee.
   * The server refuses regardless.
   */
  canEdit: boolean;
  canDelete: boolean;
  canChangeStatus: boolean;

  /** Counted from the vote rows on every read. Never stored. */
  voteCount: number;

  /** Whether the signed-in user has voted on this one. */
  hasVoted: boolean;

  /** Visible comments, counted on read. Never stored. */
  commentCount: number;

  /**
   * Whether the signed-in user may vote on this one. Decided by the server, so
   * the browser never reimplements the rule (and never needs to be told who it
   * is in order to apply it).
   */
  canVote: boolean;
  createdAt: string;
  updatedAt: string;

  /**
   * When the author last edited the text, or null if they never did.
   *
   * Its own field rather than comparing updatedAt with createdAt: pinning and
   * status changes move updatedAt too, and neither of those is somebody
   * rewriting their own words.
   */
  editedAt: string | null;
}

export interface FeedbackRequestDetail {
  id: number;
  title: string;
  description: string;
  category: TaxonomyRef;
  status: TaxonomyRef;
  author: AuthorRef;
  isPinned: boolean;

  /** When it was pinned, and by which admin. Null on anything unpinned. */
  pinnedAt: string | null;
  pinnedBy: AuthorRef | null;

  /** Whether the signed-in user may pin or unpin. Admins only. */
  canPin: boolean;

  /**
   * What the signed-in user may do to this request. Decided per row by the
   * server, exactly like canVote — the browser is never told who it is, and
   * hiding a control it is told to hide is a courtesy, never the guarantee.
   * The server refuses regardless.
   */
  canEdit: boolean;
  canDelete: boolean;
  canChangeStatus: boolean;

  /** Counted from the vote rows on every read. Never stored. */
  voteCount: number;

  /** Whether the signed-in user has voted on this one. */
  hasVoted: boolean;

  /** Visible comments, counted on read. Never stored. */
  commentCount: number;

  /**
   * Whether the signed-in user may vote on this one. Decided by the server, so
   * the browser never reimplements the rule (and never needs to be told who it
   * is in order to apply it).
   */
  canVote: boolean;
  createdAt: string;
  updatedAt: string;

  /**
   * When the author last edited the text, or null if they never did.
   *
   * Its own field rather than comparing updatedAt with createdAt: pinning and
   * status changes move updatedAt too, and neither of those is somebody
   * rewriting their own words.
   */
  editedAt: string | null;
}

export interface CreateFeedbackRequest {
  title: string;
  description: string;
  categoryId: number;
}

/** Editing takes the same three fields under the same rules. */
export type UpdateFeedbackRequest = CreateFeedbackRequest;

/** Returned by both vote endpoints, so a card can update without a refetch. */
export interface VoteState {
  requestId: number;
  voteCount: number;
  hasVoted: boolean;

  /** Visible comments, counted on read. Never stored. */
  commentCount: number;
}

/** The pinned shelf: not paginated, but capped, so the total is separate. */
export interface PinnedResult {
  data: FeedbackRequestListItem[];
  total: number;
}

/** Why a comment shows as removed. Null when it is not. */
export type DeletionReason = 'author' | 'moderator' | 'with-parent';

export interface Comment {
  id: number;
  parentId: number | null;

  /** Both null once removed: the words do not leave the server. */
  author: AuthorRef | null;
  body: string | null;

  createdAt: string;
  editedAt: string | null;

  isDeleted: boolean;
  deletedReason: DeletionReason | null;

  canEdit: boolean;
  canDelete: boolean;
  canReply: boolean;

  /** Populated on top-level comments only. */
  replies: Comment[];
}

export interface CreateComment {
  body: string;
  parentId?: number;
}
