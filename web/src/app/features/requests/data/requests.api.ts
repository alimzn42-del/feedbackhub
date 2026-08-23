import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api/api-base-url';
import { NO_FILTERS, toQueryParams, type BoardFilters } from './board-filters';
import type {
  SortOption,
  CreateFeedbackRequest,
  FeedbackRequestDetail,
  FeedbackRequestListItem,
  Paginated,
  PinnedResult,
  TaxonomyRef,
  UpdateFeedbackRequest,
  VoteState,
  Wrapped,
} from '../../../core/api/api.types';

/** Pinning is a sub-resource of the request it applies to. */
const pinUrl = (base: string, id: number) => base + '/' + id + '/pin';

@Injectable({ providedIn: 'root' })
export class RequestsApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  readonly requestsUrl = `${this.baseUrl}/requests`;
  detailUrl(id: number): string {
    return this.requestsUrl + '/' + id;
  }

  readonly pinnedUrl = `${this.baseUrl}/requests/pinned`;
  readonly categoriesUrl = `${this.baseUrl}/categories`;

  /**
   * The statuses a request can be filtered by. A separate endpoint for the same
   * reason categories has one: it is a taxonomy an admin curates, and a
   * hardcoded list in the browser would silently drift from it.
   */
  readonly statusesUrl = `${this.baseUrl}/statuses`;

  /**
   * The shelf takes the ordering and nothing else. Filters are refused there,
   * which is honest: a filtered board has no shelf to filter.
   */
  pinned(sort?: SortOption): Observable<PinnedResult> {
    return this.http.get<PinnedResult>(this.pinnedUrl, {
      params: sort === undefined ? new HttpParams() : new HttpParams().set('sort', sort),
    });
  }

  /**
   * Paging, filtering and sorting are all sent to the server, never applied
   * here. The list component reads them from the URL and passes them straight
   * through, using the same serialisation its own links are built from.
   */
  listParams(page: number, pageSize: number, filters: BoardFilters = NO_FILTERS): HttpParams {
    const params = toQueryParams(filters, page, pageSize);

    // page and pageSize are always sent, even at their defaults: this is the
    // request, not the address bar, and being explicit costs nothing here.
    return Object.entries(params).reduce(
      (carry, [key, value]) => carry.set(key, value),
      new HttpParams().set('page', page).set('pageSize', pageSize),
    );
  }

  create(body: CreateFeedbackRequest): Observable<Wrapped<FeedbackRequestDetail>> {
    return this.http.post<Wrapped<FeedbackRequestDetail>>(this.requestsUrl, body);
  }

  list(
    page: number,
    pageSize: number,
    filters: BoardFilters = NO_FILTERS,
  ): Observable<Paginated<FeedbackRequestListItem>> {
    return this.http.get<Paginated<FeedbackRequestListItem>>(this.requestsUrl, {
      params: this.listParams(page, pageSize, filters),
    });
  }

  /**
   * The author's own edit. PATCH, because the status, the pinning and the
   * authorship are all part of the resource and none of them is sent here.
   */
  update(
    requestId: number,
    body: UpdateFeedbackRequest,
  ): Observable<Wrapped<FeedbackRequestDetail>> {
    return this.http.patch<Wrapped<FeedbackRequestDetail>>(this.detailUrl(requestId), body);
  }

  /** Takes the votes and the comments with it, by the schema's cascades. */
  remove(requestId: number): Observable<void> {
    return this.http.delete<void>(this.detailUrl(requestId));
  }

  /**
   * Triage, admin only. A sub-resource like pinning, so the verb carries the
   * intent and the rule sits on one route.
   */
  changeStatus(requestId: number, statusId: number): Observable<Wrapped<FeedbackRequestDetail>> {
    return this.http.put<Wrapped<FeedbackRequestDetail>>(`${this.detailUrl(requestId)}/status`, {
      statusId,
    });
  }

  categories(): Observable<Wrapped<TaxonomyRef[]>> {
    return this.http.get<Wrapped<TaxonomyRef[]>>(this.categoriesUrl);
  }

  statuses(): Observable<Wrapped<TaxonomyRef[]>> {
    return this.http.get<Wrapped<TaxonomyRef[]>>(this.statusesUrl);
  }

  /**
   * The vote is always the caller's own — there is nothing to send. Which verb
   * gets used is decided by the caller's current state, so a duplicate vote is
   * never sent in normal use.
   */
  castVote(requestId: number): Observable<Wrapped<VoteState>> {
    return this.http.post<Wrapped<VoteState>>(`${this.requestsUrl}/${requestId}/vote`, {});
  }

  withdrawVote(requestId: number): Observable<Wrapped<VoteState>> {
    return this.http.delete<Wrapped<VoteState>>(`${this.requestsUrl}/${requestId}/vote`);
  }

  pin(requestId: number): Observable<Wrapped<FeedbackRequestListItem>> {
    return this.http.put<Wrapped<FeedbackRequestListItem>>(pinUrl(this.requestsUrl, requestId), {});
  }

  unpin(requestId: number): Observable<Wrapped<FeedbackRequestListItem>> {
    return this.http.delete<Wrapped<FeedbackRequestListItem>>(pinUrl(this.requestsUrl, requestId));
  }
}
