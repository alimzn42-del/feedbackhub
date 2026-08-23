import { Component, computed, input, output, signal } from '@angular/core';
import type { CategoryAdminRow, StatusAdminRow } from '../../../core/api/api.types';

/** Either taxonomy. The optional fields are what makes them different. */
export type TaxonomyRow = Partial<CategoryAdminRow> & Partial<StatusAdminRow> & {
  id: number;
  name: string;
  slug: string;
  sortOrder: number;
  requestCount: number;
};

export interface RenameIntent {
  id: number;
  name: string;
}

export interface CreateIntent {
  name: string;
  slug: string;
}

/**
 * One taxonomy, rendered and managed. Used twice: once for categories, once for
 * statuses.
 *
 * Presentational, like the pinned panel and the filter bar — it renders what it
 * is given and emits intent. Which actions exist is decided by the inputs
 * below rather than by the component sniffing at its rows, because the
 * difference between the two taxonomies is a decision and not a shape:
 * categories are retired and statuses are not, statuses have a default and
 * categories do not.
 */
@Component({
  selector: 'app-taxonomy-table',
  imports: [],
  templateUrl: './taxonomy-table.html',
  styleUrl: './taxonomy-table.scss',
})
export class TaxonomyTable {
  readonly heading = input.required<string>();

  /** Singular, for the wording of messages and labels: "category", "status". */
  readonly noun = input.required<string>();

  readonly rows = input.required<TaxonomyRow[]>();

  /** Categories can be retired; statuses cannot. */
  readonly retirable = input(false);

  /** Statuses have a default; categories do not. */
  readonly hasDefault = input(false);

  /** The id of the row with an action in flight, so only it shows as busy. */
  readonly pendingId = input<number | null>(null);

  /** Set while a create or reorder is in flight, which belongs to no one row. */
  readonly busy = input(false);

  /** Field errors from the server, by field name, for the add form. */
  readonly issues = input<Record<string, string>>({});

  readonly created = output<CreateIntent>();
  readonly renamed = output<RenameIntent>();
  readonly reordered = output<number[]>();
  readonly retired = output<TaxonomyRow>();
  readonly restored = output<TaxonomyRow>();
  readonly defaulted = output<TaxonomyRow>();

  /* ── Adding ────────────────────────────────────────────────────────────── */

  protected readonly newName = signal('');
  protected readonly newSlug = signal('');

  /** Whether the slug box has been typed in, so suggesting stops interfering. */
  private readonly slugEdited = signal(false);

  /**
   * A slug suggested from the name, until somebody types one.
   *
   * A suggestion, not a derivation: the slug is permanent and the name is not,
   * so the two must be free to differ from the first moment. Deriving it
   * silently would mean a rename later leaves a slug nobody chose deliberately.
   */
  protected readonly slugValue = computed(() =>
    this.slugEdited() ? this.newSlug() : toSlug(this.newName()),
  );

  protected onNameInput(value: string): void {
    this.newName.set(value);
  }

  protected onSlugInput(value: string): void {
    this.slugEdited.set(true);
    this.newSlug.set(value);
  }

  protected submitNew(event: Event): void {
    // (submit), not (ngSubmit): there is no NgForm or [formGroup] on this form,
    // so ngSubmit is an event nothing raises and the browser would submit
    // natively and reload the page.
    event.preventDefault();

    const name = this.newName().trim();
    const slug = this.slugValue().trim();

    if (name === '' || slug === '' || this.busy()) return;

    this.created.emit({ name, slug });
  }

  /** Called by the parent once the server has accepted the new row. */
  clearNew(): void {
    this.newName.set('');
    this.newSlug.set('');
    this.slugEdited.set(false);
  }

  /* ── Renaming ──────────────────────────────────────────────────────────── */

  protected readonly editingId = signal<number | null>(null);
  protected readonly editName = signal('');

  protected startRename(row: TaxonomyRow): void {
    this.editingId.set(row.id);
    this.editName.set(row.name);
  }

  protected cancelRename(): void {
    this.editingId.set(null);
  }

  protected submitRename(event: Event, row: TaxonomyRow): void {
    event.preventDefault();

    const name = this.editName().trim();
    if (name === '' || name === row.name) {
      this.editingId.set(null);
      return;
    }

    this.renamed.emit({ id: row.id, name });
  }

  /** Called by the parent once the rename has landed. */
  doneRenaming(): void {
    this.editingId.set(null);
  }

  /* ── Reordering ────────────────────────────────────────────────────────── */

  /**
   * Move by button, one step at a time.
   *
   * Buttons rather than drag and drop, and not as a fallback: this is the
   * interface. A drag-only implementation is unusable by keyboard, unusable by
   * anybody who cannot hold a pointer steady, and hostile on a phone. Two
   * buttons are none of those things, and they are also easier to test.
   *
   * The whole order goes to the server, not the one row that moved.
   */
  protected moveUp(index: number): void {
    if (index <= 0) return;
    this.reordered.emit(swap(this.rows().map((row) => row.id), index, index - 1));
  }

  protected moveDown(index: number): void {
    if (index >= this.rows().length - 1) return;
    this.reordered.emit(swap(this.rows().map((row) => row.id), index, index + 1));
  }

  protected isPending(row: TaxonomyRow): boolean {
    return this.pendingId() === row.id;
  }

  protected isRetired(row: TaxonomyRow): boolean {
    return row.archivedAt != null;
  }

  /** Written out so a screen reader hears a sentence rather than an icon. */
  protected usageLabel(row: TaxonomyRow): string {
    if (row.requestCount === 0) return `No requests use ${row.name}.`;
    return `${row.requestCount} ${row.requestCount === 1 ? 'request uses' : 'requests use'} ${row.name}.`;
  }
}

/** The same shape the server insists on: lowercase words joined by hyphens. */
function toSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function swap(ids: number[], from: number, to: number): number[] {
  const next = [...ids];
  const moved = next[from]!;
  next[from] = next[to]!;
  next[to] = moved;
  return next;
}
