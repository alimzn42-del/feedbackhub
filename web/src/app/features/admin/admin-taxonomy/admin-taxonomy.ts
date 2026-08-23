import { Component, computed, inject, signal, viewChildren } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import type { Observable } from 'rxjs';
import { TaxonomyApi } from '../data/taxonomy.api';
import {
  TaxonomyTable,
  type CreateIntent,
  type RenameIntent,
  type TaxonomyRow,
} from '../taxonomy-table/taxonomy-table';
import { ConfirmDialog } from '../../../shared/confirm-dialog/confirm-dialog';
import { toApiError, type ApiError } from '../../../core/api/api-error';
import type { CategoryAdminRow, StatusAdminRow, Wrapped } from '../../../core/api/api.types';
import { Translate } from '../../../core/i18n/translate';

/** Which taxonomy an error or a pending action belongs to. */
type Which = 'categories' | 'statuses';

/**
 * The admin screen: two tables, one for each taxonomy an admin curates.
 *
 * It owns the data and the calls; the tables render and emit intent. Refused at
 * the route before it is hidden here — a regular user who types the URL gets
 * the same 403 the endpoints give, rendered rather than swallowed.
 */
@Component({
  selector: 'app-admin-taxonomy',
  imports: [RouterLink, TaxonomyTable, ConfirmDialog],
  templateUrl: './admin-taxonomy.html',
  styleUrl: './admin-taxonomy.scss',
})
export class AdminTaxonomy {
  /** The message catalogue, in the language this person chose. */
  protected readonly t = inject(Translate).t;

  private readonly api = inject(TaxonomyApi);

  private readonly tables = viewChildren(TaxonomyTable);

  protected readonly categories = httpResource<Wrapped<CategoryAdminRow[]>>(() => ({
    url: this.api.categoriesUrl,
    params: this.api.managedScope,
  }));

  protected readonly statuses = httpResource<Wrapped<StatusAdminRow[]>>(() => ({
    url: this.api.statusesUrl,
    params: this.api.managedScope,
  }));

  protected readonly categoryRows = computed<TaxonomyRow[]>(() =>
    this.categories.hasValue() ? (this.categories.value()?.data ?? []) : [],
  );

  protected readonly statusRows = computed<TaxonomyRow[]>(() =>
    this.statuses.hasValue() ? (this.statuses.value()?.data ?? []) : [],
  );

  /**
   * The load failure, whichever of the two failed.
   *
   * A 403 here is the ordinary case rather than an error: somebody who is not
   * an admin has arrived at the URL, and the screen says so plainly instead of
   * rendering two empty tables.
   */
  protected readonly loadFailure = computed<ApiError | null>(() => {
    const failure = this.categories.error() ?? this.statuses.error();
    return failure ? toApiError(failure) : null;
  });

  protected readonly refused = computed(() => this.loadFailure()?.status === 403);

  protected readonly isLoading = computed(
    () => this.categories.isLoading() || this.statuses.isLoading(),
  );

  /* ── Action state ──────────────────────────────────────────────────────── */

  protected readonly pendingId = signal<number | null>(null);
  protected readonly busy = signal<Which | null>(null);
  protected readonly failure = signal<ApiError | null>(null);

  /** Field errors from the last failed call, by field, for the add forms. */
  private readonly issues = signal<Record<string, string>>({});

  /**
   * Which table the current issues belong to.
   *
   * Without it, a duplicate category name would show against the status form
   * too — both tables render the same component and would both be handed the
   * same errors.
   */
  private readonly issueOwner = signal<Which | null>(null);

  private issuesFor(which: Which): Record<string, string> {
    return this.issueOwner() === which ? this.issues() : {};
  }

  protected readonly categoryIssues = computed(() => this.issuesFor('categories'));
  protected readonly statusIssues = computed(() => this.issuesFor('statuses'));

  protected isBusy(which: Which): boolean {
    return this.busy() === which;
  }

  /**
   * What went wrong, in words that match what happened.
   *
   * A 403 means the answer will not change by trying again; a dropped
   * connection means it might; a 422 has already been attached to the field
   * that caused it and does not need repeating here.
   */
  protected readonly failureMessage = computed<string | null>(() => {
    const error = this.failure();
    if (!error) return null;
    if (error.status === 422 && Object.keys(this.issues()).length > 0) return null;
    return error.message;
  });

  /* ── Confirmation ──────────────────────────────────────────────────────── */

  protected readonly retiring = signal<TaxonomyRow | null>(null);

  protected readonly retireBody = computed(() => {
    const row = this.retiring();
    if (!row) return '';

    const usage =
      row.requestCount === 0
        ? this.t('taxonomy.retireUnused')
        : row.requestCount === 1
          ? this.t('taxonomy.retireUsedOne')
          : this.t('taxonomy.retireUsed', { count: row.requestCount });

    return this.t('taxonomy.retireBody', { name: row.name, usage });
  });

  protected askRetire(row: TaxonomyRow): void {
    this.failure.set(null);
    this.retiring.set(row);
  }

  protected cancelRetire(): void {
    this.retiring.set(null);
  }

  protected confirmRetire(): void {
    const row = this.retiring();
    if (!row) return;

    this.run('categories', row.id, this.api.archiveCategory(row.id), () => {
      this.retiring.set(null);
      this.categories.reload();
    });
  }

  /* ── Categories ────────────────────────────────────────────────────────── */

  protected createCategory(intent: CreateIntent): void {
    this.run('categories', null, this.api.createCategory(intent.name, intent.slug), () => {
      this.clearForms();
      this.categories.reload();
    });
  }

  protected renameCategory(intent: RenameIntent): void {
    this.run('categories', intent.id, this.api.renameCategory(intent.id, intent.name), () => {
      this.doneRenaming();
      this.categories.reload();
    });
  }

  protected reorderCategories(ids: number[]): void {
    this.run('categories', null, this.api.reorderCategories(ids), () => this.categories.reload());
  }

  protected restoreCategory(row: TaxonomyRow): void {
    this.run('categories', row.id, this.api.restoreCategory(row.id), () =>
      this.categories.reload(),
    );
  }

  /* ── Statuses ──────────────────────────────────────────────────────────── */

  protected createStatus(intent: CreateIntent): void {
    this.run('statuses', null, this.api.createStatus(intent.name, intent.slug), () => {
      this.clearForms();
      this.statuses.reload();
    });
  }

  protected renameStatus(intent: RenameIntent): void {
    this.run('statuses', intent.id, this.api.renameStatus(intent.id, intent.name), () => {
      this.doneRenaming();
      this.statuses.reload();
    });
  }

  protected reorderStatuses(ids: number[]): void {
    this.run('statuses', null, this.api.reorderStatuses(ids), () => this.statuses.reload());
  }

  /**
   * Moving the default reloads rather than patching from the response: two rows
   * changed, and the one that lost it is not the one that was clicked.
   */
  protected setDefaultStatus(row: TaxonomyRow): void {
    this.run('statuses', row.id, this.api.setDefaultStatus(row.id), () => this.statuses.reload());
  }

  /* ── Shared plumbing ───────────────────────────────────────────────────── */

  /**
   * One call, one place that knows what pending, success and failure mean.
   *
   * Every mutation on this screen goes through here, so none of them can
   * accidentally leave a spinner running or a stale field error on screen.
   */
  private run<T>(
    which: Which,
    rowId: number | null,
    call: Observable<T>,
    onSuccess: () => void,
  ): void {
    if (this.busy() !== null || this.pendingId() !== null) return;

    this.failure.set(null);
    this.issues.set({});
    this.issueOwner.set(null);
    this.busy.set(which);
    this.pendingId.set(rowId);

    call.subscribe({
      next: () => {
        this.busy.set(null);
        this.pendingId.set(null);
        onSuccess();
      },
      error: (raw: unknown) => {
        this.busy.set(null);
        this.pendingId.set(null);

        const error = toApiError(raw);
        this.failure.set(error);
        this.issueOwner.set(which);

        // Field errors land on the field that caused them. A duplicate name is
        // the common one, and it belongs against the input rather than in a
        // banner that does not say which box is wrong.
        this.issues.set(
          Object.fromEntries(error.details.map((issue) => [issue.field, issue.message])),
        );
      },
    });
  }

  private clearForms(): void {
    for (const table of this.tables()) {
      table.clearNew();
    }
  }

  private doneRenaming(): void {
    for (const table of this.tables()) {
      table.doneRenaming();
    }
  }

  protected retry(): void {
    this.categories.reload();
    this.statuses.reload();
  }
}
