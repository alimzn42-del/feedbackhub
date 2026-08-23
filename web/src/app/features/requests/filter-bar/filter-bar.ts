import { Component, DestroyRef, computed, inject, input, linkedSignal, output } from '@angular/core';
import { SORT_OPTIONS, type SortOption, type TaxonomyRef } from '../../../core/api/api.types';
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_MIN,
  isFiltered,
  toggleValue,
  type BoardFilters,
} from '../data/board-filters';

/** The label shown against each ordering. The values are the API's. */
const SORT_LABELS: Record<SortOption, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  votes: 'Most voted',
};

/** The default leads, so the list reads in the order somebody meets it. */
const SORT_ORDER: readonly SortOption[] = ['newest', 'votes', 'oldest'];

/**
 * The board's filter and sort controls.
 *
 * Presentational, like the pinned panel: it renders the state it is given and
 * emits the state it is asked for. It performs no navigation and holds no
 * filter state of its own, because the filters live in the URL and the list
 * component owns that.
 *
 * The one exception is the search box, which searches as it is typed in. It
 * waits for a pause rather than firing per keystroke, and the list replaces the
 * history entry rather than pushing one, so neither the network nor the Back
 * button pays for every letter on the way to a word.
 */
@Component({
  selector: 'app-filter-bar',
  imports: [],
  templateUrl: './filter-bar.html',
  styleUrl: './filter-bar.scss',
})
export class FilterBar {
  readonly filters = input.required<BoardFilters>();

  /** The options an admin curates. Empty while they are still loading. */
  readonly statuses = input<TaxonomyRef[]>([]);
  readonly categories = input<TaxonomyRef[]>([]);

  /**
   * Whether anything is currently narrowing the board.
   *
   * Derived rather than passed in: an input for this could disagree with the
   * filters rendered beside it, and it is the same one-line answer the list
   * works out for its own empty state.
   */
  protected readonly filtered = computed(() => isFiltered(this.filters()));

  /** How many requests the current filters matched. Null while unknown. */
  readonly matchCount = input<number | null>(null);

  /** A complete replacement for the current state. The parent navigates. */
  readonly changed = output<BoardFilters>();

  protected readonly sortOptions = SORT_ORDER.map((value) => ({
    value,
    label: SORT_LABELS[value],
  }));

  private readonly destroyRef = inject(DestroyRef);

  /**
   * The term this box last asked for.
   *
   * A plain field, not a signal, on purpose: it is read inside the computation
   * below and must NOT make it re-run. It exists only to tell "the URL caught
   * up with what I sent" apart from "the URL changed underneath me".
   */
  private sentTerm: string | null = null;

  /** The pending debounce, if typing has not settled yet. */
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * The search box while it is being typed in.
   *
   * A linkedSignal rather than a plain one: it is writable, so typing works,
   * and it re-seeds itself when the URL's search term changes. That is what
   * makes Back, a shared link and Clear all leave the box showing what is
   * actually being searched for instead of a stale draft — without an effect
   * watching the input to put it right afterwards.
   *
   * The guard matters now that the box searches as it types: the navigation it
   * triggers changes the source, and re-seeding on that would overwrite
   * anything typed in the moment between asking and the URL arriving.
   */
  protected readonly searchText = linkedSignal<string, string>({
    source: () => this.filters().q,
    computation: (term, previous) =>
      previous !== undefined && term === this.sentTerm ? previous.value : term,
  });

  constructor() {
    // A pending search must not fire into a component that is gone.
    this.destroyRef.onDestroy(() => this.cancelPending());
  }

  protected onSearchInput(value: string): void {
    this.searchText.set(value);

    // Restarted on every keystroke, so the search happens once typing pauses
    // rather than once per letter.
    this.cancelPending();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.commitSearch();
    }, SEARCH_DEBOUNCE_MS);
  }

  private cancelPending(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * The term the box would search for right now, or null if there is nothing
   * to do: unchanged, or too short for the server to accept.
   */
  private pendingSearch(): string | null {
    const term = this.searchText().trim();

    if (term === this.filters().q) return null;
    // Clearing the box is always valid — it removes the filter.
    if (term.length > 0 && term.length < SEARCH_MIN) return null;

    return term;
  }

  private commitSearch(): void {
    const term = this.pendingSearch();
    if (term === null) return;

    this.emit({ q: term });
  }

  /**
   * Enter, or the button, searches now instead of waiting out the debounce.
   *
   * Bound to (submit), not (ngSubmit). ngSubmit is an output of NgForm and
   * FormGroupDirective. On a bare form there is nothing raising it, so binding
   * it registers a listener for an event that never comes and the browser
   * submits natively — which reloads the page and loses everything. This form
   * has neither directive on purpose.
   */
  protected onSearchSubmit(event: Event): void {
    event.preventDefault();
    this.cancelPending();
    this.commitSearch();
  }

  protected onStatusToggle(slug: string): void {
    this.emit({ statuses: toggleValue(this.filters().statuses, slug) });
  }

  protected onCategoryToggle(slug: string): void {
    this.emit({ categories: toggleValue(this.filters().categories, slug) });
  }

  protected onMineToggle(checked: boolean): void {
    this.emit({ mine: checked });
  }

  protected onSortChange(value: string): void {
    // The select only ever holds these three, but the value arrives as a string
    // and the server refuses anything else, so it is narrowed here rather than
    // asserted.
    const sort = SORT_OPTIONS.find((option) => option === value);
    if (sort) {
      this.emit({ sort });
    }
  }

  protected clear(): void {
    this.emit({ statuses: [], categories: [], mine: false, q: '' });
  }

  protected isStatusSelected(slug: string): boolean {
    return this.filters().statuses.includes(slug);
  }

  protected isCategorySelected(slug: string): boolean {
    return this.filters().categories.includes(slug);
  }

  /**
   * Emits the whole state, not the change.
   *
   * The parent turns this straight into a URL, and a URL is absolute: it says
   * what the board is showing, not what changed about it.
   */
  private emit(patch: Partial<BoardFilters>): void {
    // Anything else changing flushes a search still waiting out its debounce,
    // so a term that has been typed is not silently dropped by ticking a box a
    // moment later.
    const pending = patch.q === undefined ? this.pendingSearch() : null;
    this.cancelPending();

    const next = { ...this.filters(), ...(pending === null ? {} : { q: pending }), ...patch };

    // Recorded before the change goes out, so the URL arriving back is
    // recognised as this box's own doing rather than an external change.
    this.sentTerm = next.q;

    this.changed.emit(next);
  }
}
