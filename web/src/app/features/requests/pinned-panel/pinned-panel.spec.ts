import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { provideRouter } from '@angular/router';
import { PinnedPanel } from './pinned-panel';
import type { FeedbackRequestListItem } from '../../../core/api/api.types';

function pinnedItem(id: number, overrides: Partial<FeedbackRequestListItem> = {}) {
  return {
    id,
    title: `Pinned request ${id}`,
    excerpt: 'excerpt',
    excerptTruncated: false,
    category: { id: 2, name: 'Feature', slug: 'feature' },
    status: { id: 1, name: 'New', slug: 'new' },
    author: { id: 99, displayName: 'Sam Lindqvist' },
    isPinned: true,
    pinnedAt: '2026-08-21T09:00:00.000Z',
    pinnedBy: { id: 1, displayName: 'Robin Alvarez' },
    canPin: false,
    voteCount: id,
    hasVoted: false,
    commentCount: 0,
    canVote: true,
    canEdit: false,
    canDelete: false,
    canChangeStatus: false,
    editedAt: null,
    createdAt: '2026-08-21T05:00:00.000Z',
    updatedAt: '2026-08-21T05:00:00.000Z',
    ...overrides,
  } satisfies FeedbackRequestListItem;
}

function render(items: FeedbackRequestListItem[], total = items.length) {
  const fixture = TestBed.createComponent(PinnedPanel);
  fixture.componentRef.setInput('items', items);
  fixture.componentRef.setInput('total', total);
  fixture.detectChanges();
  return fixture;
}

const rows = (fixture: { nativeElement: HTMLElement }) =>
  fixture.nativeElement.querySelectorAll('.pinned__item');

const toggle = (fixture: { nativeElement: HTMLElement }) =>
  fixture.nativeElement.querySelector('.pinned__toggle') as HTMLButtonElement | null;

describe('PinnedPanel', () => {
  // The panel links to each request, so RouterLink needs an ActivatedRoute.
  // Configured for every test, not only the ones that go through render().
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', children: [] }])],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('renders nothing at all when nothing is pinned', () => {
    const fixture = render([]);

    // Not an empty state — an empty shelf is noise above the board.
    expect(fixture.nativeElement.querySelector('.pinned')).toBeNull();
  });

  it('shows at most three before it is expanded', () => {
    const fixture = render([1, 2, 3, 4, 5].map((id) => pinnedItem(id)));

    expect(rows(fixture).length).toBe(3);
  });

  it('hides the toggle when everything already fits', () => {
    const fixture = render([1, 2, 3].map((id) => pinnedItem(id)));

    expect(toggle(fixture)).toBeNull();
  });

  it('says how many more there are, then reveals them and offers to collapse', () => {
    const fixture = render([1, 2, 3, 4, 5].map((id) => pinnedItem(id)));

    expect(toggle(fixture)?.textContent?.trim()).toBe('Show 2 more');
    expect(toggle(fixture)?.getAttribute('aria-expanded')).toBe('false');

    toggle(fixture)?.click();
    fixture.detectChanges();

    expect(rows(fixture).length).toBe(5);
    expect(toggle(fixture)?.textContent?.trim()).toBe('Show less');
    expect(toggle(fixture)?.getAttribute('aria-expanded')).toBe('true');

    toggle(fixture)?.click();
    fixture.detectChanges();

    expect(rows(fixture).length).toBe(3);
  });

  it('scrolls rather than growing without limit once expanded', () => {
    const fixture = render(Array.from({ length: 30 }, (_, i) => pinnedItem(i + 1)));

    expect(fixture.nativeElement.querySelector('.pinned__list--scroll')).toBeNull();

    toggle(fixture)?.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.pinned__list--scroll')).not.toBeNull();
  });

  it('links every pinned request to its own page', () => {
    // The shelf had no links at all, so a pinned request could not be opened,
    // read in full, or commented on — the board cards linked, this did not.
    const fixture = render([pinnedItem(7)]);

    const links = [...fixture.nativeElement.querySelectorAll('a')].map((a: Element) =>
      a.getAttribute('href'),
    );

    expect(links).toContain('/requests/7');
    expect(fixture.nativeElement.querySelector('.pinned__title a')).not.toBeNull();
  });

  it('offers a way through to the discussion, like the board cards do', () => {
    const fixture = render([pinnedItem(7, { commentCount: 3 })]);

    const comments = fixture.nativeElement.querySelector('.pinned__comments');

    expect(comments?.textContent?.replace(/\s+/g, ' ').trim()).toBe('3 comments');
    expect(comments?.getAttribute('href')).toBe('/requests/7');
  });

  it('names the author and the admin who pinned it, as separate facts', () => {
    const fixture = render([pinnedItem(1)]);

    // Who wrote it and who promoted it are different things, so they are not
    // run together into one byline where the second reads as an afterthought.
    expect(fixture.nativeElement.querySelector('.pinned__byline').textContent).toContain(
      'Sam Lindqvist',
    );
    expect(fixture.nativeElement.querySelector('.pinned__attribution').textContent).toContain(
      'Pinned by Robin Alvarez',
    );
  });

  it('does not invent an actor for a pin that predates the record', () => {
    const fixture = render([pinnedItem(1, { pinnedBy: null })]);

    const attribution = fixture.nativeElement.querySelector('.pinned__attribution');

    expect(attribution.textContent).not.toContain('Pinned by');
    expect(attribution.textContent).toContain('Pinned');
  });

  it('reports pinned requests the endpoint would not return', () => {
    // Pinning is unlimited by decision, so the shelf can be showing a subset.
    // Saying so beats silently truncating.
    const fixture = render([1, 2, 3].map((id) => pinnedItem(id)), 104);

    expect(fixture.nativeElement.querySelector('.pinned__overflow')?.textContent).toContain(
      '101 more pinned requests are not shown',
    );
  });

  it('counts every pinned request in the heading, not just the visible ones', () => {
    const fixture = render([1, 2, 3, 4, 5].map((id) => pinnedItem(id)));

    expect(fixture.nativeElement.querySelector('.pinned__count')?.textContent?.trim()).toBe('5');
  });

  it('offers unpin only to someone who may pin', () => {
    const asUser = render([pinnedItem(1, { canPin: false })]);
    expect(asUser.nativeElement.querySelector('.pinned__unpin')).toBeNull();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', children: [] }])],
    });

    const asAdmin = render([pinnedItem(1, { canPin: true })]);
    expect(asAdmin.nativeElement.querySelector('.pinned__unpin')).not.toBeNull();
  });

  it('emits intent rather than calling the API itself', () => {
    const fixture = render([pinnedItem(1, { canPin: true })]);
    const voted: number[] = [];
    const unpinned: number[] = [];

    fixture.componentInstance.vote.subscribe((r) => voted.push(r.id));
    fixture.componentInstance.unpin.subscribe((r) => unpinned.push(r.id));

    (fixture.nativeElement.querySelector('.vote') as HTMLButtonElement).click();
    (fixture.nativeElement.querySelector('.pinned__unpin') as HTMLButtonElement).click();

    expect(voted).toEqual([1]);
    expect(unpinned).toEqual([1]);
  });

  it('disables a row while its request is in flight', () => {
    const fixture = TestBed.createComponent(PinnedPanel);
    fixture.componentRef.setInput('items', [pinnedItem(1, { canPin: true })]);
    fixture.componentRef.setInput('total', 1);
    fixture.componentRef.setInput('pendingIds', new Set([1]));
    fixture.detectChanges();

    expect((fixture.nativeElement.querySelector('.vote') as HTMLButtonElement).disabled).toBe(true);
    expect(
      (fixture.nativeElement.querySelector('.pinned__unpin') as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
