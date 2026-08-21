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

  /** Counted from the vote rows on every read. Never stored. */
  voteCount: number;

  /** Whether the signed-in user has voted on this one. */
  hasVoted: boolean;

  /**
   * Whether the signed-in user may vote on this one. Decided by the server, so
   * the browser never reimplements the rule (and never needs to be told who it
   * is in order to apply it).
   */
  canVote: boolean;
  createdAt: string;
  updatedAt: string;
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

  /** Counted from the vote rows on every read. Never stored. */
  voteCount: number;

  /** Whether the signed-in user has voted on this one. */
  hasVoted: boolean;

  /**
   * Whether the signed-in user may vote on this one. Decided by the server, so
   * the browser never reimplements the rule (and never needs to be told who it
   * is in order to apply it).
   */
  canVote: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFeedbackRequest {
  title: string;
  description: string;
  categoryId: number;
}

/** Returned by both vote endpoints, so a card can update without a refetch. */
export interface VoteState {
  requestId: number;
  voteCount: number;
  hasVoted: boolean;
}

/** The pinned shelf: not paginated, but capped, so the total is separate. */
export interface PinnedResult {
  data: FeedbackRequestListItem[];
  total: number;
}
