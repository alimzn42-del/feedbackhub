import { Component, computed, effect, inject, input, numberAttribute, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { RequestsApi } from '../data/requests.api';
import { AppConfig } from '../../../core/config/app-config';
import { Translate } from '../../../core/i18n/translate';
import { toApiError } from '../../../core/api/api-error';
import type {
  FeedbackRequestListItem,
  Paginated,
  PinnedResult,
  TaxonomyRef,
  Wrapped,
} from '../../../core/api/api.types';
import {
  DEFAULT_PAGE_SIZE,
  NO_FILTERS,
  explicitSort,
  isFiltered,
  isOnlySearchChange,
  parseFlag,
  parseSlugs,
  parseSort,
  toQueryParams,
  type BoardFilters,
} from '../data/board-filters';
import { FilterBar } from '../filter-bar/filter-bar';
import { PinnedPanel } from '../pinned-panel/pinned-panel';

@Component({
  selector: 'app-request-list',
  imports: [RouterLink, DatePipe, PinnedPanel, FilterBar],
  templateUrl: './request-list.html',
  styleUrl: './request-list.scss',
})
export class RequestList {
  /** The message catalogue, in the language this person chose. */
  protected readonly t = inject(Translate).t;

  /** The three numbers the pager summary interpolates, in one place. */
  protected summaryParams(page: { page: number; pageSize: number; total: number }) {
    return { from: this.rangeStart(), to: this.rangeEnd(), total: page.total };
  }

  /**
   * The locale dates are written in. Passed to the pipe rather than provided
   * as LOCALE_ID, which is fixed before the person's preference has arrived.
   */
  protected readonly locale = inject(AppConfig).language;

  private readonly api = inject(RequestsApi);
  private readonly router = inject(Router);
  private readonly config = inject(AppConfig);

  /**
   * Bound from the URL by withComponentInputBinding. List state lives in query
   * parameters so a view can be shared and survives a refresh; these inputs are
   * the only source of it.
   */
  readonly page = input(1, { transform: numberAttribute });
  readonly pageSize = input(DEFAULT_PAGE_SIZE, { transform: numberAttribute });

  /**
   * The filters, bound from the same place for the same reason. A repeated
   * parameter arrives as an array and a comma-separated one as a string, so
   * both shapes are accepted and normalised below.
   */
  readonly status = input<string | string[]>();
  readonly category = input<string | string[]>();
  readonly mine = input<string>();
  readonly q = input<string>();
  readonly sort = input<string>();

  /**
   * A hand-edited URL can carry anything. Out-of-range values are corrected here
   * so the screen still renders; the server validates independently and is the
   * authority on what it will serve.
   */
  protected readonly currentPage = computed(() => {
    const value = this.page();
    return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
  });

  protected readonly currentPageSize = computed(() => {
    const value = this.pageSize();
    return Number.isFinite(value) && value >= 1 && value <= 100
      ? Math.floor(value)
      : DEFAULT_PAGE_SIZE;
  });

  /**
   * The whole of the list state, in one value.
   *
   * A hand-edited URL can carry anything, so these are cleaned rather than
   * trusted. The server validates independently and is the authority: a status
   * slug that names nothing comes back as a 422 and is rendered as the error
   * state, which is the correct answer to a link that no longer resolves.
   */
  protected readonly filters = computed<BoardFilters>(() => ({
    statuses: parseSlugs(this.status()),
    categories: parseSlugs(this.category()),
    mine: parseFlag(this.mine()),
    q: (this.q() ?? '').trim(),
    sort: parseSort(this.sort()),
  }));

  /** Whether anything is narrowing the board. Sort is not a narrowing. */
  protected readonly filtered = computed(() => isFiltered(this.filters()));

  /**
   * Refetches whenever the URL-derived signals change — no manual subscription
   * and no chance of the list disagreeing with the address bar.
   *
   * Filtering, sorting and paging all go to the server. Nothing is narrowed or
   * reordered in the browser: it holds one page and cannot see the rest.
   */
  protected readonly requests = httpResource<Paginated<FeedbackRequestListItem>>(() => ({
    url: this.api.requestsUrl,
    params: {
      ...toQueryParams(this.filters(), this.currentPage(), this.currentPageSize()),
      // Always sent, even at their defaults. This is the request, not the
      // address bar, and the URL is where brevity is worth something.
      page: this.currentPage(),
      pageSize: this.currentPageSize(),
    },
  }));

  /**
   * The filter options, from the bootstrap payload rather than from two
   * requests of this screen's own.
   *
   * They used to be fetched here, and again by the create form, the edit form
   * and the detail page — six requests for two bounded lists that every screen
   * needs. They arrive once now, before anything is drawn, which is also why
   * the filter bar can render its chips on the first frame instead of after
   * them.
   */
  protected readonly statusChoices = this.config.statuses;
  protected readonly categoryChoices = this.config.categories;

  /**
   * Whether the address carries no list state at all.
   *
   * Not "the filters are empty" — that is a board somebody has actively
   * cleared, and it must stay cleared. This is the narrower question: did they
   * arrive at /requests with nothing after it.
   */
  /**
   * Whether the address narrows the board.
   *
   * Sorting is not filtering — the same distinction the pinned shelf already
   * draws, and `isFiltered` with it. Somebody who arrived on `?sort=oldest` has
   * asked for an ORDER and has not asked to see fewer requests, so their
   * default filters still apply.
   */
  private readonly addressNarrows = computed(
    () =>
      this.status() !== undefined ||
      this.category() !== undefined ||
      this.mine() !== undefined ||
      this.q() !== undefined,
  );

  /**
   * One attempt per arrival, and this is the whole of what "arrival" means.
   *
   * Angular destroys and rebuilds this component when you come to the board
   * from another screen, and REUSES it while you stay — paging, filtering,
   * clearing. So a flag on the instance separates "I have just got here" from
   * "I am working on the board", which is the distinction the rule below needs
   * and the URL cannot express.
   */
  private applied = false;

  /**
   * A saved preference decides where you LAND; the URL still says where you
   * are.
   *
   * This is how the board's default ordering and filters coexist with the rule
   * that list state lives in query parameters. Arriving fills in the parts of
   * the address you did not ask for, and spells them out, so the view is
   * shareable, survives a refresh, and means the same thing to somebody whose
   * defaults are different.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * WHY THIS IS NOT "ONLY ON A BARE ADDRESS", WHICH IS WHAT IT WAS
   *
   * Because the redirect makes the address non-bare, and then never fires
   * again. Somebody whose default ORDERING is `oldest` lands on
   * `/requests?sort=oldest`; every later arrival at that address — a Back, a
   * bookmark, a reload — carried a `sort`, so the board was no longer "bare",
   * so a default STATUS chosen afterwards could never take effect. The setting
   * saved, the payload carried it, and the board ignored it. Reported, exactly
   * so, as choosing a status default and nothing happening.
   *
   * The two questions are separate and are now asked separately: did you ask
   * for an ordering, and did you ask to narrow the board. Whichever you did not
   * ask for, your preference answers.
   * ─────────────────────────────────────────────────────────────────────────
   *
   * It cannot re-narrow a board somebody deliberately cleared, because clearing
   * happens while they are already here and this has run once by then. And it
   * cannot loop: the navigation it performs answers both questions, so a second
   * run would have nothing left to fill in.
   */
  private readonly applyDefaults = effect(() => {
    if (this.applied || !this.config.isReady()) return;

    // Marked before navigating, not after: the navigation re-runs this effect
    // through the rebound inputs, and a second pass would fight the first.
    this.applied = true;

    const current = this.filters();
    const narrowed = this.addressNarrows();

    const wanted: BoardFilters = {
      statuses: narrowed ? current.statuses : this.config.defaultStatuses(),
      categories: narrowed ? current.categories : this.config.defaultCategories(),
      mine: current.mine,
      q: current.q,
      sort: this.sort() === undefined ? this.config.defaultSort() : current.sort,
    };

    const params = toQueryParams(wanted, this.currentPage(), this.currentPageSize());
    const now = toQueryParams(current, this.currentPage(), this.currentPageSize());

    // Nothing to fill in: they asked for everything, or their preferences are
    // what the board would have shown anyway.
    if (JSON.stringify(params) === JSON.stringify(now)) return;

    void this.router.navigate(['/requests'], { queryParams: params, replaceUrl: true });
  });

  /** What the filter bar reports as matched. Null while the count is unknown. */
  protected readonly matchCount = computed(() => this.meta()?.total ?? null);

  /**
   * The pinned shelf, on the default board only.
   *
   * A separate request because it is a different collection with different
   * rules: not paginated, ordered by when it was pinned, and excluded from the
   * list below so nothing appears twice.
   *
   * Once anything is filtered there is no shelf, and the pinned requests that
   * match are in the results instead — so this returns undefined and no
   * request is made at all. Fetching a shelf in order to hide it would ask the
   * server for something the screen has no place to put.
   */
  protected readonly pinned = httpResource<PinnedResult>(() => {
    if (this.filtered()) return undefined;

    const sort = explicitSort(this.filters());

    // Sent only when an ordering was actually chosen. Absent means the shelf
    // uses its own order — most recently pinned first — which is what keeps
    // something just pinned inside the three the panel shows collapsed.
    const params: Record<string, string> = sort === undefined ? {} : { sort };

    return { url: this.api.pinnedUrl, params };
  });

  /**
   * Every one of these is guarded by hasValue().
   *
   * Reading value() while a resource is in its error state THROWS. That was
   * survivable while these were only read inside a branch the error state
   * skipped; the filter bar changed it, because the bar renders above the list
   * and reads the total whatever the list is doing. A derived signal that can
   * throw depending on where it is read from is a trap, so none of them can.
   */
  protected readonly pinnedItems = computed(() =>
    this.pinned.hasValue() ? (this.pinned.value()?.data ?? []) : [],
  );

  protected readonly pinnedTotal = computed(() =>
    this.pinned.hasValue() ? (this.pinned.value()?.total ?? 0) : 0,
  );

  protected readonly items = computed(() =>
    this.requests.hasValue() ? (this.requests.value()?.data ?? []) : [],
  );

  protected readonly meta = computed(() =>
    this.requests.hasValue() ? (this.requests.value()?.page ?? null) : null,
  );

  protected readonly error = computed(() => {
    const failure = this.requests.error();
    return failure ? toApiError(failure) : null;
  });

  /**
   * Whether the board is loading with nothing to show yet.
   *
   * Only this state gets skeletons. A refetch that already has rows keeps them
   * on screen and marks them stale instead, because the search refetches on
   * every pause in typing and replacing the list with skeletons each time makes
   * a working board look like it is thrashing.
   */
  protected readonly isFirstLoad = computed(
    () => this.requests.isLoading() && this.items().length === 0,
  );

  /** Rows that are still on screen while a newer answer is on its way. */
  protected readonly isStale = computed(() => this.requests.isLoading() && this.items().length > 0);

  /** A loaded, genuinely empty result. What it means depends on the filters. */
  private readonly loadedEmpty = computed(
    () => this.requests.hasValue() && this.items().length === 0 && (this.meta()?.total ?? 0) === 0,
  );

  /** Distinguishes "nothing has been filed yet" from "still loading". */
  protected readonly isEmpty = computed(() => this.loadedEmpty() && !this.filtered());

  /**
   * The same empty result, with filters applied, which is a different thing to
   * say and needs a different offer: an unfiltered board that says "be the
   * first to file one" when eleven requests are one click away is wrong.
   */
  protected readonly hasNoMatches = computed(() => this.loadedEmpty() && this.filtered());

  /** A page number past the end — a stale link rather than an empty board. */
  protected readonly isPastEnd = computed(() => {
    const meta = this.meta();
    return meta !== null && meta.total > 0 && this.items().length === 0;
  });

  /**
   * Which rows of the whole collection this page is showing.
   *
   * Derived from the page metadata rather than counted locally, and clamped by
   * the rows actually returned — the last page is rarely full, so
   * page * pageSize would overstate it.
   */
  protected readonly rangeStart = computed(() => {
    const meta = this.meta();
    if (!meta || this.items().length === 0) return 0;
    return (meta.page - 1) * meta.pageSize + 1;
  });

  protected readonly rangeEnd = computed(() => {
    if (this.items().length === 0) return 0;
    return this.rangeStart() + this.items().length - 1;
  });

  protected readonly hasPrevious = computed(() => this.currentPage() > 1);

  protected readonly hasNext = computed(() => {
    const meta = this.meta();
    return meta !== null && this.currentPage() < meta.totalPages;
  });

  /**
   * The query parameters for another page of the CURRENT view. Built from the
   * same function the filter bar's navigation uses, so a pager link can never
   * quietly drop the filters the list is showing.
   */
  protected queryFor(page: number): Record<string, string | number> {
    return toQueryParams(this.filters(), page, this.currentPageSize());
  }

  /**
   * Applies a new set of filters by navigating, because the URL is the state.
   *
   * Always back to page 1: page 4 of an unfiltered board is rarely page 4 of a
   * filtered one, and staying put would land the reader past the end, where an
   * empty page reads as "nothing matched".
   */
  protected applyFilters(next: BoardFilters): void {
    void this.router.navigate(['/requests'], {
      queryParams: toQueryParams(next, 1, this.currentPageSize()),
      // Typing produces a navigation per pause. Those replace each other, so
      // Back leaves the board instead of walking backwards through every
      // prefix on the way to the word somebody wanted. Ticking a box or
      // changing the order is a deliberate step and keeps its entry.
      replaceUrl: isOnlySearchChange(this.filters(), next),
    });
  }

  /** Back to the whole board, keeping the ordering the reader chose. */
  protected clearFilters(): void {
    this.applyFilters({ ...NO_FILTERS, sort: this.filters().sort });
  }

  protected retry(): void {
    this.requests.reload();
  }

  protected readonly skeletonRows = [0, 1, 2, 3];

  /* ── Voting ────────────────────────────────────────────────────────────── */

  /** Ids with a vote in flight, so a card cannot be double-submitted. */
  protected readonly pending = signal<ReadonlySet<number>>(new Set<number>());

  protected readonly voteFailure = signal<string | null>(null);

  protected isVoting(id: number): boolean {
    return this.pending().has(id);
  }

  /**
   * One control, two verbs. Clicking when you have not voted casts; clicking
   * again withdraws — so the API never receives a duplicate vote in normal use.
   *
   * The count moves immediately and rolls back if the server refuses. The
   * server's response is then applied verbatim rather than trusted to match the
   * guess, which is what keeps a second tab or a stale page from drifting.
   *
   * Note what deliberately does NOT happen: the board does not re-sort under
   * the pointer. The order is by vote count, so a vote can change a card's
   * position — moving it out from under the cursor mid-click would be hostile.
   * The new order arrives on the next load.
   */
  protected toggleVote(item: FeedbackRequestListItem): void {
    if (!item.canVote || this.isVoting(item.id)) {
      return;
    }

    const wasVoted = item.hasVoted;
    const previousCount = item.voteCount;

    this.voteFailure.set(null);
    this.setPending(item.id, true);
    this.applyVote(item.id, !wasVoted, wasVoted ? previousCount - 1 : previousCount + 1);

    const call = wasVoted ? this.api.withdrawVote(item.id) : this.api.castVote(item.id);

    call.subscribe({
      next: ({ data }) => {
        this.applyVote(item.id, data.hasVoted, data.voteCount);
        this.setPending(item.id, false);
      },
      error: (failure: unknown) => {
        this.applyVote(item.id, wasVoted, previousCount);
        this.setPending(item.id, false);
        this.voteFailure.set(toApiError(failure).message);
      },
    });
  }

  /**
   * Applies a vote to whichever collection holds the row.
   *
   * A request lives in the list OR on the pinned shelf, never both, and the
   * vote control appears in both places. Updating only the list meant voting
   * from the shelf called the API and then changed nothing on screen: the
   * optimistic update and the reconciliation both looked in the wrong
   * collection and silently found no match.
   */
  private applyVote(id: number, hasVoted: boolean, voteCount: number): void {
    const patch = (row: FeedbackRequestListItem) =>
      row.id === id ? { ...row, hasVoted, voteCount } : row;

    this.requests.update((page) => (page ? { ...page, data: page.data.map(patch) } : page));
    this.pinned.update((shelf) => (shelf ? { ...shelf, data: shelf.data.map(patch) } : shelf));
  }

  private setPending(id: number, active: boolean): void {
    this.pending.update((current) => {
      const next = new Set(current);
      if (active) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  /** Written out rather than templated, so a screen reader hears a sentence. */
  protected voteLabel(item: FeedbackRequestListItem): string {
    if (!item.canVote) {
      return `You cannot vote on your own request. ${item.voteCount} ${
        item.voteCount === 1 ? 'vote' : 'votes'
      }.`;
    }

    const action = item.hasVoted ? 'Remove your vote from' : 'Vote for';
    return `${action} "${item.title}". ${item.voteCount} ${
      item.voteCount === 1 ? 'vote' : 'votes'
    } so far.`;
  }

  /* ── Pinning ───────────────────────────────────────────────────────────── */

  /**
   * Not optimistic, unlike voting. Pinning moves a request between two
   * collections, so guessing means rendering it in both or in neither until the
   * server answers. The row is disabled while the call is in flight and both
   * collections refetch together once it lands.
   */
  protected togglePin(item: FeedbackRequestListItem): void {
    if (!item.canPin || this.isVoting(item.id)) {
      return;
    }

    this.voteFailure.set(null);
    this.setPending(item.id, true);

    const call = item.isPinned ? this.api.unpin(item.id) : this.api.pin(item.id);

    call.subscribe({
      next: () => {
        this.setPending(item.id, false);
        // On the default board, pinning moves a row between the two collections,
        // so both are refetched. Reloaded rather than version-stamped: the query
        // schema rejects unknown parameters, and a cache-busting value in the
        // URL would be one.
        //
        // On a filtered board there is one collection and the row stays in it,
        // reordered to the front. The shelf is not being fetched at all there,
        // so there is nothing to reload.
        this.requests.reload();
        if (!this.filtered()) {
          this.pinned.reload();
        }
      },
      error: (failure: unknown) => {
        this.setPending(item.id, false);
        this.voteFailure.set(toApiError(failure).message);
      },
    });
  }
}
