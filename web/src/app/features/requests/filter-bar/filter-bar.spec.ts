import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilterBar } from './filter-bar';
import { NO_FILTERS, SEARCH_DEBOUNCE_MS, type BoardFilters } from '../data/board-filters';
import type { TaxonomyRef } from '../../../core/api/api.types';

/* ════════════════════════════════════════════════════════════════════════════
 * The filter bar.
 *
 * Every test here goes through the DOM — a real click, a real change, a real
 * submit — and not through the handler. Twelve passing tests once missed a
 * completely dead submit button on this project because each of them called the
 * method directly; anything a user touches gets touched here too.
 * ══════════════════════════════════════════════════════════════════════════ */

const STATUSES: TaxonomyRef[] = [
  { id: 1, name: 'New', slug: 'new' },
  { id: 3, name: 'Planned', slug: 'planned' },
  { id: 5, name: 'Done', slug: 'done' },
];

const CATEGORIES: TaxonomyRef[] = [
  { id: 2, name: 'Feature', slug: 'feature' },
  { id: 4, name: 'Bug', slug: 'bug' },
];

describe('FilterBar', () => {
  let emitted: BoardFilters[];

  beforeEach(() => {
    TestBed.configureTestingModule({});
    emitted = [];
    // The search debounces, so time is controlled here rather than waited on.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function render(filters: Partial<BoardFilters> = {}) {
    const fixture = TestBed.createComponent(FilterBar);
    fixture.componentRef.setInput('filters', { ...NO_FILTERS, ...filters });
    fixture.componentRef.setInput('statuses', STATUSES);
    fixture.componentRef.setInput('categories', CATEGORIES);
    fixture.componentInstance.changed.subscribe((value) => emitted.push(value));
    fixture.detectChanges();
    return fixture;
  }

  /** Types into the real search box, one value at a time, as a person would. */
  function type(fixture: ReturnType<typeof render>, value: string): HTMLInputElement {
    const input = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    return input;
  }

  /** Waits out the debounce. */
  function settle(): void {
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  }

  /** The checkbox whose visible label is `label`. */
  function checkbox(fixture: ReturnType<typeof render>, label: string): HTMLInputElement {
    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('label.toggle'),
    ) as HTMLLabelElement[];

    const match = labels.find((element) => element.textContent?.trim() === label);
    expect(match, `no toggle labelled "${label}"`).toBeDefined();

    return match!.querySelector('input') as HTMLInputElement;
  }

  it('offers the statuses and categories it is given, by name', () => {
    const fixture = render();
    const text = fixture.nativeElement.textContent;

    // The names come from the server. A hardcoded list would drift the moment
    // an admin renamed one.
    for (const option of [...STATUSES, ...CATEGORIES]) {
      expect(text).toContain(option.name);
    }
  });

  it('adds a status to the filter when its checkbox is clicked', () => {
    const fixture = render();

    checkbox(fixture, 'Planned').click();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.statuses).toEqual(['planned']);
  });

  it('keeps the filters it was already given when another is added', () => {
    const fixture = render({ statuses: ['planned'] });

    checkbox(fixture, 'Done').click();

    // Several values per filter: choosing Done does not mean un-choosing Planned.
    expect(emitted[0]!.statuses).toEqual(['planned', 'done']);
  });

  it('removes a status that is already on', () => {
    const fixture = render({ statuses: ['planned', 'done'] });

    checkbox(fixture, 'Planned').click();

    expect(emitted[0]!.statuses).toEqual(['done']);
  });

  it('shows which filters are on, so the state is visible and not only in the URL', () => {
    const fixture = render({ statuses: ['done'], mine: true });

    expect(checkbox(fixture, 'Done').checked).toBe(true);
    expect(checkbox(fixture, 'New').checked).toBe(false);
    expect(checkbox(fixture, 'Only my requests').checked).toBe(true);
  });

  it('filters to the caller’s own requests when "Only my requests" is ticked', () => {
    const fixture = render();

    checkbox(fixture, 'Only my requests').click();

    expect(emitted[0]!.mine).toBe(true);
  });

  it('emits the whole state, not just the part that changed', () => {
    const fixture = render({ statuses: ['done'], mine: true,
      pending: false, q: 'dark', sort: 'newest' });

    checkbox(fixture, 'Bug').click();

    // The parent turns this straight into a URL, and a URL is absolute.
    expect(emitted[0]).toEqual({
      statuses: ['done'],
      categories: ['bug'],
      mine: true,
      pending: false,
      q: 'dark',
      sort: 'newest',
    });
  });

  it('changes the ordering when the select changes', () => {
    const fixture = render();
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;

    select.value = 'oldest';
    select.dispatchEvent(new Event('change'));

    expect(emitted[0]!.sort).toBe('oldest');
  });

  it('searches as it is typed in, once typing pauses', () => {
    const fixture = render();

    type(fixture, 'dark mode');
    // Nothing has gone out yet: the term is still being typed.
    expect(emitted).toHaveLength(0);

    settle();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.q).toBe('dark mode');
  });

  it('searches once for a word, not once per letter', () => {
    const fixture = render();

    for (const prefix of ['d', 'da', 'dar', 'dark']) {
      type(fixture, prefix);
      // Each keystroke restarts the wait, so the prefixes never go out.
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 50);
    }

    settle();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.q).toBe('dark');
  });

  it('does not search for a single character, which the server refuses', () => {
    const fixture = render();

    type(fixture, 'd');
    settle();

    // A one-character term can only come back as a 422 while somebody is still
    // typing, so the box holds rather than asking.
    expect(emitted).toHaveLength(0);
  });

  it('clears the search when the box is emptied', () => {
    const fixture = render({ q: 'dark' });

    type(fixture, '');
    settle();

    // Emptying is always valid: it removes the filter rather than searching.
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.q).toBe('');
  });

  it('searches straight away on submit, without waiting out the pause', () => {
    const fixture = render();
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;

    type(fixture, 'dark mode');

    const submit = new Event('submit', { cancelable: true, bubbles: true });
    form.dispatchEvent(submit);

    expect(emitted[0]!.q).toBe('dark mode');
    // The bug this project has already paid for once: a form that submits
    // natively reloads the page and loses everything. The default must be
    // prevented, and (submit) is the event that exists on a bare form —
    // (ngSubmit) is an output of NgForm, which is not here.
    expect(submit.defaultPrevented).toBe(true);

    // And the pending debounce was cancelled, not left to fire a second time.
    settle();
    expect(emitted).toHaveLength(1);
  });

  it('searches when the button is clicked, not only on Enter', () => {
    const fixture = render();

    type(fixture, 'reporting');
    (fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement).click();

    expect(emitted[0]!.q).toBe('reporting');
  });

  it('trims the term, so a stray space is not part of the search', () => {
    const fixture = render();

    type(fixture, '  dark  ');
    settle();

    expect(emitted[0]!.q).toBe('dark');
  });

  it('does not search again for a term it is already showing', () => {
    const fixture = render({ q: 'dark' });

    // Typing a letter and deleting it again leaves the box where it started.
    type(fixture, 'darkk');
    type(fixture, 'dark');
    settle();

    expect(emitted).toHaveLength(0);
  });

  it('keeps what is being typed when the URL catches up with what it sent', () => {
    const fixture = render();

    type(fixture, 'dark');
    settle();

    const input = type(fixture, 'darker');

    // The navigation the first search triggered lands now. It must not replace
    // the letters typed since.
    fixture.componentRef.setInput('filters', { ...NO_FILTERS, q: 'dark' });
    fixture.detectChanges();

    expect(input.value).toBe('darker');
  });

  it('shows the term that is actually being searched for when it arrives from the URL', () => {
    const fixture = render({ q: 'dark mode' });
    const input = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;

    expect(input.value).toBe('dark mode');
  });

  it('re-seeds the box when the URL changes under it, rather than keeping a stale draft', () => {
    const fixture = render({ q: 'dark' });
    const input = type(fixture, 'half typed');

    // What Back, or a shared link, or Clear all does to this component. It is
    // not this box's own search coming back, so the box follows it.
    fixture.componentRef.setInput('filters', { ...NO_FILTERS, q: 'reporting' });
    fixture.detectChanges();

    expect(input.value).toBe('reporting');
  });

  it('takes a search still waiting out its pause along with another filter', () => {
    const fixture = render();

    const input = type(fixture, 'dark mode');
    checkbox(fixture, 'Done').click();
    fixture.detectChanges();

    // Ticking a box a moment after typing must not silently drop the term.
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ q: 'dark mode', statuses: ['done'] });
    expect(input.value).toBe('dark mode');

    // And it went once, not once now and once when the pause expires.
    settle();
    expect(emitted).toHaveLength(1);
  });

  it('offers nothing to clear until something is filtered', () => {
    const fixture = render();

    expect(fixture.nativeElement.textContent).not.toContain('Clear all filters');
  });

  it('clears every filter at once, and keeps the ordering', () => {
    const fixture = render({ statuses: ['done'], mine: true,
      pending: false, q: 'dark', sort: 'oldest' });

    const clear = Array.from(fixture.nativeElement.querySelectorAll('button')).find((button) =>
      (button as HTMLButtonElement).textContent?.includes('Clear all filters'),
    ) as HTMLButtonElement;

    clear.click();

    // Sorting is not filtering: clearing what is hidden should not also undo
    // the order the reader chose.
    expect(emitted[0]).toEqual({ ...NO_FILTERS, sort: 'oldest' });
  });

  it('says where the pinned requests went, since the shelf has just vanished', () => {
    const fixture = render({ statuses: ['done'] });

    // The shelf is gone from a filtered board and its contents are in the
    // results. Without saying so, the reader has watched a panel disappear.
    expect(fixture.nativeElement.textContent).toContain(
      'Pinned requests that match are listed first',
    );
  });
});
