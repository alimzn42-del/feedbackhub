import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api/api-base-url';
import type { Comment, CreateComment, Wrapped } from '../../../core/api/api.types';

/**
 * Listing and creating hang off the request a comment belongs to; editing and
 * deleting name the comment directly, because by then it has an identity of
 * its own.
 */
@Injectable({ providedIn: 'root' })
export class CommentsApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  threadUrl(requestId: number): string {
    return `${this.baseUrl}/requests/${requestId}/comments`;
  }

  private commentUrl(commentId: number): string {
    return `${this.baseUrl}/comments/${commentId}`;
  }

  create(requestId: number, body: CreateComment): Observable<Wrapped<Comment>> {
    return this.http.post<Wrapped<Comment>>(this.threadUrl(requestId), body);
  }

  edit(commentId: number, body: string): Observable<Wrapped<Comment>> {
    return this.http.patch<Wrapped<Comment>>(this.commentUrl(commentId), { body });
  }

  /**
   * The server decides whether this removes the row or leaves a tombstone —
   * that depends on who is asking and whether anybody has replied, which is not
   * the browser's judgement to make. The thread is reloaded afterwards rather
   * than patched, because either outcome changes its shape.
   */
  remove(commentId: number): Observable<Wrapped<{ kind: 'hard' | 'soft' }>> {
    return this.http.delete<Wrapped<{ kind: 'hard' | 'soft' }>>(this.commentUrl(commentId));
  }
}
