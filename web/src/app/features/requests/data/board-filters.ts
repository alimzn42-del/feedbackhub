import { SORT_OPTIONS, type SortOption } from '../../../core/api/api.types';

/**
 * The board's list state, and the one place that knows how it is spelled in a
 * URL.
 *
 * List state lives in query parameters, so the same serialisation has to serve
 * three callers: the links the pager builds, the navigation a filter change
 * performs, and the request the list sends. They are the same function here
 * rather than three that are nearly alike, because the failure when they drift
 * is a page that shows one thing and links to another.
 */
export interface BoardFilters {
  /** Status slugs. Empty is no filter — there is no "all" value to get wrong. */
  readonly statuses: readonly string[];
  readonly categories: readonly string[];
  /** Only the signed-in user's own requests. */
  readonly mine: boolean;

  /**
   * Only requests carrying a comment waiting for approval. Admin only, and the
   * server refuses it for anybody else rather than ignoring it.
   */
  readonly pending: boolean;
  /** Free text. Empty is no filter. */
  readonly q: string;
  readonly sort: SortOption;
}

/** Mirrors the server's default: the board opens on what was filed most recently. */
export const DEFAULT_SORT: SortOption = 'newest';

/** Mirrors the server's DEFAULT_PAGE_SIZE. */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Mirrors the server's SEARCH_MIN. A one-character search is refused with a
 * 422, so the box holds at one character rather than sending a request that
 * can only come back as an error while somebody is still typing.
 */
export const SEARCH_MIN = 2;

/** How long the box waits for typing to stop before it searches. */
export const SEARCH_DEBOUNCE_MS = 300;

export const NO_FILTERS: BoardFilters = {
  statuses: [],
  categories: [],
  mine: false,
  pending: false,
  q: '',
  sort: DEFAULT_SORT,
};

/**
 * Reads a slug list out of the URL.
 *
 * Both shapes the router can hand over are accepted — `?status=a,b` and
 * `?status=a&status=b` — because both are things a person can send. A
 * hand-edited URL can carry anything, so the value is cleaned rather than
 * trusted; the server validates independently and is the authority.
 */
export function parseSlugs(value: string | readonly string[] | undefined | null): string[] {
  if (value === undefined || value === null) return [];

  const entries = (Array.isArray(value) ? value : [value as string]).flatMap((entry) =>
    String(entry).split(','),
  );

  return [...new Set(entries.map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
}

/** Anything that is not an ordering the board has falls back to the default. */
export function parseSort(value: string | undefined | null): SortOption {
  return SORT_OPTIONS.includes(value as SortOption) ? (value as SortOption) : DEFAULT_SORT;
}

export function parseFlag(value: string | undefined | null): boolean {
  return value === 'true' || value === '1';
}

/**
 * Whether anything is narrowing the board.
 *
 * Sort is deliberately excluded: reordering the board does not hide anything
 * from it, so an empty result while sorted by newest still means "nothing has
 * been filed", not "nothing matched".
 */
export function isFiltered(filters: BoardFilters): boolean {
  return (
    filters.statuses.length > 0 ||
    filters.categories.length > 0 ||
    filters.mine ||
    filters.pending ||
    filters.q.length > 0
  );
}

/**
 * The query parameters for a given piece of list state.
 *
 * Defaults are omitted rather than spelled out. `/requests` and
 * `/requests?page=1&sort=votes` are the same board, and only one of them is a
 * link worth sharing. It also keeps the API's strict query schema happy: every
 * key here is one it knows.
 */
export function toQueryParams(
  filters: BoardFilters,
  page: number,
  pageSize: number,
): Record<string, string | number> {
  const params: Record<string, string | number> = {};

  if (page > 1) params['page'] = page;
  if (pageSize !== DEFAULT_PAGE_SIZE) params['pageSize'] = pageSize;
  if (filters.statuses.length > 0) params['status'] = filters.statuses.join(',');
  if (filters.categories.length > 0) params['category'] = filters.categories.join(',');
  if (filters.mine) params['mine'] = 'true';
  if (filters.pending) params['pending'] = 'true';
  if (filters.q.length > 0) params['q'] = filters.q;
  if (filters.sort !== DEFAULT_SORT) params['sort'] = filters.sort;

  return params;
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Whether the only difference between two states is the search term.
 *
 * The list uses this to decide whether a navigation replaces the current
 * history entry or pushes a new one. Typing produces one navigation per pause,
 * and Back should leave the board rather than walk backwards through every
 * prefix somebody typed on the way to the word they wanted.
 */
export function isOnlySearchChange(current: BoardFilters, next: BoardFilters): boolean {
  return (
    next.q !== current.q &&
    next.sort === current.sort &&
    next.mine === current.mine &&
    next.pending === current.pending &&
    sameValues(next.statuses, current.statuses) &&
    sameValues(next.categories, current.categories)
  );
}

/**
 * The ordering to send with a request, or undefined when none was asked for.
 *
 * The distinction is not cosmetic: the shelf orders itself by when things were
 * pinned unless the board is on an explicit ordering, in which case it follows.
 * An ordering equal to the default is treated as none, which keeps the URL
 * canonical — `/requests` and the default view are the same link, however the
 * reader arrived at it.
 */
export function explicitSort(filters: BoardFilters): SortOption | undefined {
  return filters.sort === DEFAULT_SORT ? undefined : filters.sort;
}

/** Adds or removes one value from a filter, preserving the order of the rest. */
export function toggleValue(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}
