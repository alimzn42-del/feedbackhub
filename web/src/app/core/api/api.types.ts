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
 * The navigation has to decide whether to offer the admin screens and there is
 * no row to hang the answer on, so it is asked for once, inside the bootstrap
 * payload. Same rule as canVote, same guarantee: none. The endpoints refuse on
 * their own.
 */
export interface Capabilities {
  canManageCategories: boolean;
  canManageStatuses: boolean;
  canManageSettings: boolean;
}

/** Which layer an effective setting came from. */
export type SettingSource = 'user' | 'global' | 'default';

/**
 * A setting as the server resolved it.
 *
 * `source` is not decoration. "Using the default" and an explicit choice that
 * happens to match render differently, and only one of them has anything to
 * reset — so the client is told which it got rather than comparing the value
 * with a default it would have to hold its own copy of.
 */
export interface ResolvedSetting<T = unknown> {
  value: T;
  source: SettingSource;
  editable: boolean;
}

/**
 * The controls a settings screen can draw, mirroring SettingControl in the
 * API's registry. The kind travels with the setting, so a new setting appears
 * on its screen without a second edit here.
 */
export type SettingControl =
  | { kind: 'toggle' }
  | { kind: 'number'; min: number; max: number }
  | { kind: 'choice'; options: { value: string; label: string }[] }
  | { kind: 'slugs'; source: 'categories' | 'statuses' }
  | { kind: 'lines'; placeholder: string };

/** The same, plus everything needed to render and label its control. */
export interface SettingDescriptor<T = unknown> extends ResolvedSetting<T> {
  key: string;
  label: string;
  description: string;
  control: SettingControl;
}

/**
 * The person, as the application knows them.
 *
 * Note what is not here: their role. The browser learns WHO it is, because it
 * edits this on the settings screen and writes it back to an address that names
 * the account — and it is still never told WHAT it is. Every permission arrives
 * as an answer the server worked out.
 */
export interface Profile {
  id: number;
  email: string;
  displayName: string;
}

/**
 * Everything the shell needs before it can draw anything, in one response.
 *
 * Each piece earns its place by being needed for the FIRST paint. Anything that
 * can be fetched when a screen opens is fetched then — the settings documents,
 * the admin taxonomy listing, and everything request-shaped.
 */
export interface Bootstrap {
  user: Profile;
  capabilities: Capabilities;

  /**
   * Only the settings that decide what the first paint looks like: the colour
   * scheme, the language, and the ordering and filters the board opens on.
   * Which those are is declared on the server, next to each setting.
   */
  settings: Record<string, ResolvedSetting>;

  taxonomy: {
    categories: TaxonomyRef[];
    statuses: TaxonomyRef[];
  };
}

export type ThemeChoice = 'light' | 'dark' | 'system';
export type LanguageChoice = 'en' | 'fr' | 'de';

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

  /**
   * Waiting for an admin, and visible to its author until it is let through.
   *
   * This is how the moderation setting reaches somebody who is not allowed to
   * read it: as a fact about their own comment. Almost always false.
   */
  isPending: boolean;

  /** Populated on top-level comments only. */
  replies: Comment[];
}

/**
 * The thread, plus the one thing the composer above it has to know.
 *
 * `awaitsApproval` is the moderation setting's consequence, not the setting —
 * "a comment you post now will wait" — which somebody has to be told before
 * they write it, or the button is lying about what it does.
 */
export interface CommentThread {
  data: Comment[];
  awaitsApproval: boolean;
}

/** One row of the moderation queue, with the request it is answering. */
export interface PendingComment {
  id: number;
  requestId: number;
  requestTitle: string;
  parentId: number | null;
  author: AuthorRef;
  body: string;
  createdAt: string;
}

export interface CreateComment {
  body: string;
  parentId?: number;
}
