import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/api/api-base-url';
import type {
  CategoryAdminRow,
  StatusAdminRow,
  Wrapped,
} from '../../../core/api/api.types';

/**
 * The management half of the two taxonomy endpoints.
 *
 * Same URLs the rest of the app reads, asked with `scope=all` — the managed
 * representation carries the display order, the retirement state and the usage
 * counts, and the server refuses it to anybody who cannot act on them.
 */
@Injectable({ providedIn: 'root' })
export class TaxonomyApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  readonly categoriesUrl = `${this.baseUrl}/categories`;
  readonly statusesUrl = `${this.baseUrl}/statuses`;

  /**
   * The scope the admin screen asks for. Sent as a parameter rather than baked
   * into the URL string: it is a parameter, and the client should be able to
   * see it as one.
   */
  readonly managedScope = { scope: 'all' } as const;

  /* ── Categories ────────────────────────────────────────────────────────── */

  createCategory(name: string, slug: string): Observable<Wrapped<CategoryAdminRow>> {
    return this.http.post<Wrapped<CategoryAdminRow>>(this.categoriesUrl, { name, slug });
  }

  /** The name only. A slug is set once, because links depend on it. */
  renameCategory(id: number, name: string): Observable<Wrapped<CategoryAdminRow>> {
    return this.http.patch<Wrapped<CategoryAdminRow>>(`${this.categoriesUrl}/${id}`, { name });
  }

  /** The whole order, so it cannot half-apply. */
  reorderCategories(ids: readonly number[]): Observable<Wrapped<CategoryAdminRow[]>> {
    return this.http.put<Wrapped<CategoryAdminRow[]>>(`${this.categoriesUrl}/order`, {
      ids: [...ids],
    });
  }

  /** Retire: the row stays and stops being offered. */
  archiveCategory(id: number): Observable<Wrapped<CategoryAdminRow>> {
    return this.http.put<Wrapped<CategoryAdminRow>>(`${this.categoriesUrl}/${id}/archive`, {});
  }

  restoreCategory(id: number): Observable<Wrapped<CategoryAdminRow>> {
    return this.http.delete<Wrapped<CategoryAdminRow>>(`${this.categoriesUrl}/${id}/archive`);
  }

  /* ── Statuses ──────────────────────────────────────────────────────────── */

  createStatus(name: string, slug: string): Observable<Wrapped<StatusAdminRow>> {
    return this.http.post<Wrapped<StatusAdminRow>>(this.statusesUrl, { name, slug });
  }

  renameStatus(id: number, name: string): Observable<Wrapped<StatusAdminRow>> {
    return this.http.patch<Wrapped<StatusAdminRow>>(`${this.statusesUrl}/${id}`, { name });
  }

  reorderStatuses(ids: readonly number[]): Observable<Wrapped<StatusAdminRow[]>> {
    return this.http.put<Wrapped<StatusAdminRow[]>>(`${this.statusesUrl}/order`, { ids: [...ids] });
  }

  /**
   * Answers with the whole list, because two rows change: the status that
   * gained the default and the one that lost it. There is no call that clears a
   * default without naming its replacement.
   */
  setDefaultStatus(id: number): Observable<Wrapped<StatusAdminRow[]>> {
    return this.http.put<Wrapped<StatusAdminRow[]>>(`${this.statusesUrl}/${id}/default`, {});
  }
}
