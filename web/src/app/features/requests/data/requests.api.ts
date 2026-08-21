import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api/api-base-url';
import type {
  CreateFeedbackRequest,
  FeedbackRequestDetail,
  FeedbackRequestListItem,
  Paginated,
  PinnedResult,
  TaxonomyRef,
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
   * Paging is sent to the server, never applied here. The list component reads
   * page and pageSize from the URL and passes them straight through.
   */
  listParams(page: number, pageSize: number): HttpParams {
    return new HttpParams().set('page', page).set('pageSize', pageSize);
  }

  create(body: CreateFeedbackRequest): Observable<Wrapped<FeedbackRequestDetail>> {
    return this.http.post<Wrapped<FeedbackRequestDetail>>(this.requestsUrl, body);
  }

  list(page: number, pageSize: number): Observable<Paginated<FeedbackRequestListItem>> {
    return this.http.get<Paginated<FeedbackRequestListItem>>(this.requestsUrl, {
      params: this.listParams(page, pageSize),
    });
  }

  categories(): Observable<Wrapped<TaxonomyRef[]>> {
    return this.http.get<Wrapped<TaxonomyRef[]>>(this.categoriesUrl);
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
    return this.http.put<Wrapped<FeedbackRequestListItem>>(
      pinUrl(this.requestsUrl, requestId),
      {},
    );
  }

  unpin(requestId: number): Observable<Wrapped<FeedbackRequestListItem>> {
    return this.http.delete<Wrapped<FeedbackRequestListItem>>(
      pinUrl(this.requestsUrl, requestId),
    );
  }
}
