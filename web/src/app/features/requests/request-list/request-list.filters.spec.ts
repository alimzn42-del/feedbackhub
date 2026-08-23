import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestList } from './request-list';
import type { FeedbackRequestListItem, Paginated } from '../../../core/api/api.types';

/* ════════════════════════════════════════════════════════════════════════════
 * Filtering and sorting, from the board's side.
 *
 * The claim under test is that the browser does none of it. Every filter goes
 * to the server as a query parameter, and every link the page offers carries
 * the ones already applied — a pager that drops them silently changes what the
 * reader is looking at.
 * ══════════════════════════════════════════════════════════════════════════ */

const STATUSES = [
  { id: 1, name: 'New', slug: 'new' },
  { id: 5, name: 'Done', slug: 'done' },
];

const CATEGORIES = [
  { id: 2, name: 'Feature', slug: 'feature' },
  { id: 4, name: 'Bug', slug: 'bug' },
];

function item(overrides: Partial<FeedbackRequestListItem> = {}): FeedbackRequestListItem {
  return {
    id: 1,
    title: 'Dark mode for the board',
    excerpt: 'Reading the board in the evening is harsh.',
    excerptTruncated: false,
    category: { id: 2, name: 'Feature', slug: 'feature' },
    status: { id: 1, name: 'New', slug: 'new' },
    author: { id: 1, displayName: 'Robin Alvarez' },
    isPinned: false,
    pinnedAt: null,
    pinnedBy: null,
    canPin: false,
    voteCount: 3,
    hasVoted: false,
    commentCount: 0,
    canVote: true,
    canEdit: false,
    canDelete: false,
    canChangeStatus: false,
    editedAt: null,
    createdAt: '2026-08-21T04:59:42.237Z',
    updatedAt: '2026-08-21T04:59:42.237Z',
    ...overrides,
  };
}

function page(
  data: FeedbackRequestListItem[],
  total = data.length,
  pageNumber = 1,
): Paginated<FeedbackRequestListItem> {
  return {
    data,
    page: {
      page: pageNumber,
      pageSize: 20,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / 20),
    },
  };
}

describe('RequestList filtering', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    try {
      http.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  /** The parameters that narrow the board. `sort` is not one of them. */
  function narrows(params: Record<string, string>): boolean {
    return ['status', 'category', 'q'].some((key) => params[key]) || params['mine'] === 'true';
  }

  /**
   * Renders the board with the given query parameters, as the router would bind
   * them, and answers every request it makes. Returns the list request so a
   * test can assert what was asked of the server.
   *
   * The shelf is only requested on the default board — a filtered one has no
   * shelf, so asking for it would be asking for something with nowhere to go.
   */
  async function render(
    params: Record<string, string> = {},
    body: Paginated<FeedbackRequestListItem> = page([item()]),
  ) {
    const fixture = TestBed.createComponent(RequestList);

    for (const [key, value] of Object.entries(params)) {
      fixture.componentRef.setInput(key, value);
    }

    fixture.detectChanges();

    if (!narrows(params)) {
      http.expectOne((r) => r.url === '/api/requests/pinned').flush({ data: [], total: 0 });
    }

    http.expectOne((r) => r.url === '/api/statuses').flush({ data: STATUSES });
    http.expectOne((r) => r.url === '/api/categories').flush({ data: CATEGORIES });

    const listed = http.expectOne((r) => r.url === '/api/requests');
    listed.flush(body);

    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, listed };
  }

  it('asks the server to filter, rather than filtering what it was given', async () => {
    const { listed } = await render({ status: 'done', category: 'bug' });

    expect(listed.request.params.get('status')).toBe('done');
    expect(listed.request.params.get('category')).toBe('bug');
  });

  it('passes several values for one filter through as the server reads them', async () => {
    const { listed } = await render({ status: 'new,done' });

    expect(listed.request.params.get('status')).toBe('new,done');
  });

  it('sends the search term and the ordering', async () => {
    const { listed } = await render({ q: 'dark mode', sort: 'oldest' });

    expect(listed.request.params.get('q')).toBe('dark mode');
    expect(listed.request.params.get('sort')).toBe('oldest');
  });

  it('leaves the default ordering out of the request', async () => {
    const { listed } = await render({ sort: 'newest' });

    // The board opens on newest, so saying so adds nothing. It also keeps
    // `/requests` and the default view the same link.
    expect(listed.request.params.get('sort')).toBeNull();
  });

  it('resolves "mine" against the server, which knows who that is', async () => {
    const { listed } = await render({ mine: 'true' });

    // The browser is never told who it is. It asks for "mine" and the server
    // answers it from the identity seam.
    expect(listed.request.params.get('mine')).toBe('true');
  });

  it('sends no filter parameters when nothing is filtered', async () => {
    const { listed } = await render();

    for (const key of ['status', 'category', 'mine', 'q']) {
      expect(listed.request.params.get(key)).toBeNull();
    }
    // Paging is always explicit, even at its defaults.
    expect(listed.request.params.get('page')).toBe('1');
    expect(listed.request.params.get('pageSize')).toBe('20');
  });

  it('ignores an ordering it does not have, rather than sending it on', async () => {
    const { listed } = await render({ sort: 'controversial' });

    // A hand-edited URL can carry anything. The server would refuse this one;
    // there is no reason to make it.
    expect(listed.request.params.get('sort')).toBeNull();
  });

  it('carries the filters into the pager links, so a page turn keeps them', async () => {
    const { fixture } = await render({ status: 'done', sort: 'oldest' }, page([item()], 60));

    const next = Array.from(fixture.nativeElement.querySelectorAll('a')).find((anchor) =>
      (anchor as HTMLAnchorElement).textContent?.trim() === 'Next',
    ) as HTMLAnchorElement;

    expect(next).toBeDefined();
    const href = next.getAttribute('href')!;
    expect(href).toContain('page=2');
    expect(href).toContain('status=done');
    expect(href).toContain('sort=oldest');
  });

  it('navigates to page 1 when a filter changes', async () => {
    const { fixture } = await render({ page: '3', status: 'done' }, page([item()], 60, 3));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const bar = fixture.debugElement.children.find((child) =>
      child.nativeElement.tagName.toLowerCase() === 'app-filter-bar',
    );
    bar!.componentInstance.changed.emit({
      statuses: ['new'],
      categories: [],
      mine: false,
      q: '',
      sort: 'newest',
    });

    // Page 3 of one filtered board is rarely page 3 of another, and landing
    // past the end reads as "nothing matched".
    expect(navigate).toHaveBeenCalledWith(['/requests'], {
      queryParams: { status: 'new' },
      // Ticking a box is a deliberate step, so it keeps its history entry.
      replaceUrl: false,
    });
  });

  it('leaves a default out of the URL, so a shared link is the short one', async () => {
    const { fixture } = await render({ status: 'done' });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const bar = fixture.debugElement.children.find((child) =>
      child.nativeElement.tagName.toLowerCase() === 'app-filter-bar',
    );
    bar!.componentInstance.changed.emit({
      statuses: [],
      categories: [],
      mine: false,
      q: '',
      sort: 'newest',
    });

    expect(navigate).toHaveBeenCalledWith(['/requests'], {
      queryParams: {},
      replaceUrl: false,
    });
  });

  it('replaces the history entry while a search is being typed', async () => {
    const { fixture } = await render({ q: 'dar' });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const bar = fixture.debugElement.children.find(
      (child) => child.nativeElement.tagName.toLowerCase() === 'app-filter-bar',
    );
    bar!.componentInstance.changed.emit({
      statuses: [],
      categories: [],
      mine: false,
      q: 'dark',
      sort: 'newest',
    });

    // Otherwise Back walks backwards through every prefix somebody typed on
    // the way to the word they wanted.
    expect(navigate).toHaveBeenCalledWith(['/requests'], {
      queryParams: { q: 'dark' },
      replaceUrl: true,
    });
  });

  it('pushes a history entry when a search arrives with another change', async () => {
    const { fixture } = await render({ q: 'dar' });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const bar = fixture.debugElement.children.find(
      (child) => child.nativeElement.tagName.toLowerCase() === 'app-filter-bar',
    );
    bar!.componentInstance.changed.emit({
      statuses: ['done'],
      categories: [],
      mine: false,
      q: 'dark',
      sort: 'newest',
    });

    expect(navigate).toHaveBeenCalledWith(['/requests'], {
      queryParams: { status: 'done', q: 'dark' },
      replaceUrl: false,
    });
  });

  it('says nothing matched, rather than that nothing has been filed', async () => {
    const { fixture } = await render({ status: 'done' }, page([], 0));
    const text = fixture.nativeElement.textContent;

    // "Be the first to file one" is wrong when eleven requests are one click
    // away behind a filter.
    expect(text).toContain('Nothing matches these filters');
    expect(text).not.toContain('No one has filed a request');
  });

  it('still says the board is empty when it is empty and unfiltered', async () => {
    const { fixture } = await render({}, page([], 0));

    expect(fixture.nativeElement.textContent).toContain('Nothing here yet');
  });

  it('offers a way out of a filter that matched nothing', async () => {
    const { fixture } = await render({ status: 'done' }, page([], 0));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const clear = Array.from(fixture.nativeElement.querySelectorAll('button')).find((button) =>
      (button as HTMLButtonElement).textContent?.includes('Clear all filters'),
    ) as HTMLButtonElement;

    clear.click();

    expect(navigate).toHaveBeenCalledWith(['/requests'], {
      queryParams: {},
      replaceUrl: false,
    });
  });

  it('shows the server’s reason when a filter names something that does not exist', async () => {
    const fixture = TestBed.createComponent(RequestList);
    fixture.componentRef.setInput('status', 'planed');
    fixture.detectChanges();

    // No shelf request: a status filter is applied, so there is no shelf.
    http.expectOne((r) => r.url === '/api/statuses').flush({ data: STATUSES });
    http.expectOne((r) => r.url === '/api/categories').flush({ data: CATEGORIES });
    http.expectOne((r) => r.url === '/api/requests').flush(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The query parameters are not valid.',
          details: [
            { field: 'status', code: 'NOT_FOUND', message: 'There is no status called "planed".' },
          ],
        },
      },
      { status: 422, statusText: 'Unprocessable Content' },
    );

    await fixture.whenStable();
    fixture.detectChanges();

    // A link that no longer resolves is an error, not an empty board.
    const alert = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert.textContent).toContain('The query parameters are not valid.');
  });

  it('shows the shelf on the default board, and asks for it', async () => {
    const { fixture } = await render();

    // Nothing is filtered, so the two collections are separate and a request
    // appears in exactly one of them.
    expect(fixture.nativeElement.querySelector('app-pinned-panel')).not.toBeNull();
  });

  it('drops the shelf as soon as anything is filtered, and stops asking for it', async () => {
    const { fixture } = await render({ status: 'done' });

    // render() would have failed on an unexpected request, and http.verify()
    // in afterEach fails on an unanswered one — so the absence is asserted
    // twice over. The panel is gone from the DOM as well as from the network.
    expect(fixture.nativeElement.querySelector('app-pinned-panel')).toBeNull();
  });

  it('keeps the shelf when only the ordering changed', async () => {
    const { fixture } = await render({ sort: 'oldest' });

    // Sorting hides nothing, so the shelf still makes sense beside it.
    expect(fixture.nativeElement.querySelector('app-pinned-panel')).not.toBeNull();
  });

  it('sends the ordering to the shelf too, so it is one board and not two', async () => {
    const fixture = TestBed.createComponent(RequestList);
    fixture.componentRef.setInput('sort', 'oldest');
    fixture.detectChanges();

    const shelf = http.expectOne((r) => r.url === '/api/requests/pinned');
    expect(shelf.request.params.get('sort')).toBe('oldest');

    shelf.flush({ data: [], total: 0 });
    http.expectOne((r) => r.url === '/api/statuses').flush({ data: STATUSES });
    http.expectOne((r) => r.url === '/api/categories').flush({ data: CATEGORIES });
    http.expectOne((r) => r.url === '/api/requests').flush(page([item()]));

    await fixture.whenStable();
  });

  it('asks the shelf for nothing in particular on the default board', async () => {
    const fixture = TestBed.createComponent(RequestList);
    fixture.detectChanges();

    const shelf = http.expectOne((r) => r.url === '/api/requests/pinned');

    // No ordering sent means the shelf uses its own — most recently pinned
    // first — which is what puts something just pinned in the visible three.
    expect(shelf.request.params.keys()).toHaveLength(0);

    shelf.flush({ data: [], total: 0 });
    http.expectOne((r) => r.url === '/api/statuses').flush({ data: STATUSES });
    http.expectOne((r) => r.url === '/api/categories').flush({ data: CATEGORIES });
    http.expectOne((r) => r.url === '/api/requests').flush(page([item()]));

    await fixture.whenStable();
  });

  it('shows a matching pinned request in the results, badged, once filtered', async () => {
    const { fixture } = await render(
      { q: 'dark' },
      page([item({ id: 9, isPinned: true, pinnedAt: '2026-08-21T09:00:00.000Z' }), item({ id: 10 })]),
    );

    const cards = fixture.nativeElement.querySelectorAll('.card');
    expect(cards).toHaveLength(2);

    // Ranked first by the server, and still wearing the badge, so the pin is
    // visible even though the shelf is not.
    expect(cards[0].textContent).toContain('Pinned');
    expect(cards[1].textContent).not.toContain('Pinned');
  });

  it('counts the pinned rows in the total once they are in the results', async () => {
    const { fixture } = await render(
      { q: 'dark' },
      page([item({ id: 9, isPinned: true })], 4),
    );

    // One result set, one total: the pinned exclusion from the count belongs to
    // the default board only.
    expect(fixture.nativeElement.textContent).toContain('4');
  });
});
