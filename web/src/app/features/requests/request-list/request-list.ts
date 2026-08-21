import { Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { RequestsApi } from '../data/requests.api';
import { toApiError } from '../../../core/api/api-error';
import type { FeedbackRequestListItem, Paginated } from '../../../core/api/api.types';

const DEFAULT_PAGE_SIZE = 20;

@Component({
  selector: 'app-request-list',
  imports: [RouterLink, DatePipe],
  templateUrl: './request-list.html',
  styleUrl: './request-list.scss',
})
export class RequestList {
  private readonly api = inject(RequestsApi);

  /**
   * Bound from the URL by withComponentInputBinding. List state lives in query
   * parameters so a view can be shared and survives a refresh; these inputs are
   * the only source of it.
   */
  readonly page = input(1, { transform: numberAttribute });
  readonly pageSize = input(DEFAULT_PAGE_SIZE, { transform: numberAttribute });

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
   * Refetches whenever the URL-derived signals change — no manual subscription
   * and no chance of the list disagreeing with the address bar.
   */
  protected readonly requests = httpResource<Paginated<FeedbackRequestListItem>>(() => ({
    url: this.api.requestsUrl,
    params: { page: this.currentPage(), pageSize: this.currentPageSize() },
  }));

  protected readonly items = computed(() => this.requests.value()?.data ?? []);
  protected readonly meta = computed(() => this.requests.value()?.page ?? null);

  protected readonly error = computed(() => {
    const failure = this.requests.error();
    return failure ? toApiError(failure) : null;
  });

  /** Distinguishes "nothing has been filed yet" from "still loading". */
  protected readonly isEmpty = computed(
    () => this.requests.hasValue() && this.items().length === 0 && (this.meta()?.total ?? 0) === 0,
  );

  /** A page number past the end — a stale link rather than an empty board. */
  protected readonly isPastEnd = computed(() => {
    const meta = this.meta();
    return meta !== null && meta.total > 0 && this.items().length === 0;
  });

  protected readonly hasPrevious = computed(() => this.currentPage() > 1);

  protected readonly hasNext = computed(() => {
    const meta = this.meta();
    return meta !== null && this.currentPage() < meta.totalPages;
  });

  protected queryFor(page: number): Record<string, number> {
    const query: Record<string, number> = { page };
    if (this.currentPageSize() !== DEFAULT_PAGE_SIZE) {
      query['pageSize'] = this.currentPageSize();
    }
    return query;
  }

  protected retry(): void {
    this.requests.reload();
  }

  protected readonly skeletonRows = [0, 1, 2, 3];

  /* ── Voting ────────────────────────────────────────────────────────────── */

  /** Ids with a vote in flight, so a card cannot be double-submitted. */
  private readonly pending = signal<ReadonlySet<number>>(new Set());

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

  private applyVote(id: number, hasVoted: boolean, voteCount: number): void {
    this.requests.update((page) =>
      page
        ? {
            ...page,
            data: page.data.map((row) => (row.id === id ? { ...row, hasVoted, voteCount } : row)),
          }
        : page,
    );
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
}
