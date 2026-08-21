import { Component, computed, inject, input, numberAttribute } from '@angular/core';
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

  protected trackById(_index: number, item: FeedbackRequestListItem): number {
    return item.id;
  }
}
