import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { RequestList } from './request-list';
import type { FeedbackRequestListItem, Paginated } from '../../../core/api/api.types';

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
    createdAt: '2026-08-21T04:59:42.237Z',
    updatedAt: '2026-08-21T04:59:42.237Z',
    ...overrides,
  };
}

function page(data: FeedbackRequestListItem[], total = data.length): Paginated<FeedbackRequestListItem> {
  return {
    data,
    page: { page: 1, pageSize: 20, total, totalPages: total === 0 ? 0 : Math.ceil(total / 20) },
  };
}

describe('RequestList', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      // A stub route for '/requests': the success path navigates there, and an
      // unroutable navigation surfaces as an unhandled rejection rather than a
      // test failure, which is worse than a failure.
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    // The reset must happen even when verify() fails, or every later test in the
    // file fails with "test module already instantiated" instead of its own reason.
    try {
      http.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  /**
   * Creates the component and runs the first change detection, which is what
   * issues the request. Deliberately does NOT await whenStable: the testing
   * backend holds the response until the test flushes it, so waiting for
   * stability first would deadlock.
   */
  function render() {
    const fixture = TestBed.createComponent(RequestList);
    fixture.detectChanges();
    // The pinned shelf is a second collection fetched alongside the list.
    http.expectOne((r) => r.url === '/api/requests/pinned').flush({ data: [], total: 0 });
    return fixture;
  }

  it('asks the server for the page, rather than fetching everything', async () => {
    render();

    const request = http.expectOne((r) => r.url === '/api/requests');

    expect(request.request.params.get('page')).toBe('1');
    expect(request.request.params.get('pageSize')).toBe('20');

    request.flush(page([]));
  });

  it('shows a loading state before the response arrives', async () => {
    const fixture = render();

    expect(fixture.nativeElement.textContent).toContain('Loading requests');
    expect(fixture.nativeElement.querySelector('.card--skeleton')).not.toBeNull();

    http.expectOne((r) => r.url === '/api/requests').flush(page([item()]));
  });

  it('renders the fields the board is meant to show', async () => {
    const fixture = render();

    http.expectOne((r) => r.url === '/api/requests').flush(page([item()]));
    await fixture.whenStable();

    const text: string = fixture.nativeElement.textContent;

    expect(text).toContain('Dark mode for the board');
    expect(text).toContain('Reading the board in the evening is harsh.');
    expect(text).toContain('Feature');
    expect(text).toContain('New');
    expect(text).toContain('Robin Alvarez');
    expect(fixture.nativeElement.querySelector('time')?.getAttribute('datetime')).toBe(
      '2026-08-21T04:59:42.237Z',
    );
  });

  it('distinguishes an empty board from a failure', async () => {
    const fixture = render();

    http.expectOne((r) => r.url === '/api/requests').flush(page([], 0));
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Nothing here yet');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('surfaces the server error message and its reference, not a generic failure', async () => {
    const fixture = render();

    http.expectOne((r) => r.url === '/api/requests').flush(
      {
        error: {
          code: 'INTERNAL',
          message: 'Something went wrong handling this request.',
          requestId: 'abc-123',
        },
      },
      { status: 500, statusText: 'Server Error' },
    );
    await fixture.whenStable();

    const alert = fixture.nativeElement.querySelector('[role="alert"]');

    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain('Something went wrong handling this request.');
    expect(alert.textContent).toContain('abc-123');
  });

  it('hides pagination when everything fits on one page', async () => {
    const fixture = render();

    http.expectOne((r) => r.url === '/api/requests').flush(page([item()]));
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[aria-label="Pagination"]')).toBeNull();
  });
});

describe('RequestList voting', () => {
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

  async function renderWith(first: FeedbackRequestListItem) {
    const fixture = TestBed.createComponent(RequestList);
    fixture.detectChanges();
    http.expectOne((r) => r.url === '/api/requests/pinned').flush({ data: [], total: 0 });
    http.expectOne((r) => r.url === '/api/requests').flush(page([first]));
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const voteButton = (fixture: { nativeElement: HTMLElement }) =>
    fixture.nativeElement.querySelector('.vote') as HTMLButtonElement;

  it('shows the count the server reported', async () => {
    const fixture = await renderWith(item({ voteCount: 3 }));

    expect(voteButton(fixture).textContent).toContain('3');
  });

  it('casts a vote and moves the count immediately, before the server answers', async () => {
    const fixture = await renderWith(item({ voteCount: 3, hasVoted: false }));

    voteButton(fixture).click();
    fixture.detectChanges();

    // Optimistic: the number has already moved while the request is in flight.
    expect(voteButton(fixture).textContent).toContain('4');

    const posted = http.expectOne('/api/requests/1/vote');
    expect(posted.request.method).toBe('POST');

    posted.flush({ data: { requestId: 1, voteCount: 4, hasVoted: true } });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(voteButton(fixture).getAttribute('aria-pressed')).toBe('true');
  });

  it('withdraws with DELETE when the vote is already yours', async () => {
    const fixture = await renderWith(item({ voteCount: 4, hasVoted: true }));

    voteButton(fixture).click();
    fixture.detectChanges();

    // A duplicate vote is never sent: the control picks the verb from state.
    const sent = http.expectOne('/api/requests/1/vote');
    expect(sent.request.method).toBe('DELETE');
    expect(voteButton(fixture).textContent).toContain('3');

    sent.flush({ data: { requestId: 1, voteCount: 3, hasVoted: false } });
    await fixture.whenStable();
  });

  it('rolls the count back and explains when the server refuses', async () => {
    const fixture = await renderWith(item({ voteCount: 3, hasVoted: false }));

    voteButton(fixture).click();
    fixture.detectChanges();
    expect(voteButton(fixture).textContent).toContain('4');

    http.expectOne('/api/requests/1/vote').flush(
      {
        error: {
          code: 'CONFLICT',
          message: 'You have already voted on this request.',
          requestId: 'abc-1',
        },
      },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(voteButton(fixture).textContent).toContain('3');
    expect(voteButton(fixture).getAttribute('aria-pressed')).toBe('false');
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'already voted',
    );
  });

  it('trusts the server over its own guess', async () => {
    // Another tab voted too. The optimistic 4 is replaced by the real 9.
    const fixture = await renderWith(item({ voteCount: 3, hasVoted: false }));

    voteButton(fixture).click();
    fixture.detectChanges();

    http
      .expectOne('/api/requests/1/vote')
      .flush({ data: { requestId: 1, voteCount: 9, hasVoted: true } });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(voteButton(fixture).textContent).toContain('9');
  });

  it('disables the control on your own request and says why', async () => {
    const fixture = await renderWith(item({ canVote: false, voteCount: 0 }));
    const button = voteButton(fixture);

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toContain('your own request');
    // aria-pressed is meaningless on a control that cannot be toggled.
    expect(button.getAttribute('aria-pressed')).toBeNull();

    button.click();
    fixture.detectChanges();

    http.expectNone('/api/requests/1/vote');
  });

  it('describes the action for a screen reader, not just the number', async () => {
    const fixture = await renderWith(item({ voteCount: 1, hasVoted: false }));

    expect(voteButton(fixture).getAttribute('aria-label')).toBe(
      'Vote for "Dark mode for the board". 1 vote so far.',
    );
  });
});

describe('RequestList voting from the pinned shelf', () => {
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

  /**
   * A request lives in the list OR on the shelf, never both — the server
   * excludes pinned rows from the list. Voting from the shelf therefore has to
   * update the shelf's copy; an earlier version only ever patched the list, so
   * the call succeeded and the count on screen never moved.
   */
  it('moves the count on the shelf, not only in the list', async () => {
    const pinnedRow = item({
      id: 42,
      title: 'A pinned request',
      isPinned: true,
      pinnedAt: '2026-08-21T09:00:00.000Z',
      pinnedBy: { id: 1, displayName: 'Robin Alvarez' },
      voteCount: 5,
      hasVoted: false,
    });

    const fixture = TestBed.createComponent(RequestList);
    fixture.detectChanges();
    http.expectOne((r) => r.url === '/api/requests/pinned').flush({ data: [pinnedRow], total: 1 });
    http.expectOne((r) => r.url === '/api/requests').flush(page([]));
    await fixture.whenStable();
    fixture.detectChanges();

    const shelfVote = fixture.nativeElement.querySelector(
      '.pinned__item .vote',
    ) as HTMLButtonElement;

    expect(shelfVote.textContent).toContain('5');

    shelfVote.click();
    fixture.detectChanges();

    // Optimistic, on the shelf's own copy of the row.
    expect(shelfVote.textContent).toContain('6');

    http
      .expectOne('/api/requests/42/vote')
      .flush({ data: { requestId: 42, voteCount: 6, hasVoted: true } });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(shelfVote.getAttribute('aria-pressed')).toBe('true');
    expect(shelfVote.textContent).toContain('6');
  });

  it('rolls the shelf back when the server refuses', async () => {
    const pinnedRow = item({ id: 42, isPinned: true, voteCount: 5, hasVoted: false });

    const fixture = TestBed.createComponent(RequestList);
    fixture.detectChanges();
    http.expectOne((r) => r.url === '/api/requests/pinned').flush({ data: [pinnedRow], total: 1 });
    http.expectOne((r) => r.url === '/api/requests').flush(page([]));
    await fixture.whenStable();
    fixture.detectChanges();

    const shelfVote = fixture.nativeElement.querySelector(
      '.pinned__item .vote',
    ) as HTMLButtonElement;

    shelfVote.click();
    fixture.detectChanges();
    expect(shelfVote.textContent).toContain('6');

    http.expectOne('/api/requests/42/vote').flush(
      { error: { code: 'CONFLICT', message: 'You have already voted.', requestId: 'x' } },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(shelfVote.textContent).toContain('5');
  });

  it('shows both the author and the admin who pinned it', async () => {
    const pinnedRow = item({
      id: 42,
      isPinned: true,
      pinnedAt: '2026-08-21T09:00:00.000Z',
      pinnedBy: { id: 1, displayName: 'Robin Alvarez' },
    });

    const fixture = TestBed.createComponent(RequestList);
    fixture.detectChanges();
    http.expectOne((r) => r.url === '/api/requests/pinned').flush({ data: [pinnedRow], total: 1 });
    http.expectOne((r) => r.url === '/api/requests').flush(page([]));
    await fixture.whenStable();
    fixture.detectChanges();

    const shelf = fixture.nativeElement.querySelector('.pinned__item');

    // Two different facts, shown separately.
    expect(shelf.querySelector('.pinned__byline').textContent).toContain('Robin Alvarez');
    expect(shelf.querySelector('.pinned__attribution').textContent).toContain(
      'Pinned by Robin Alvarez',
    );
  });
});

describe('RequestList pagination summary', () => {
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

  async function renderPage(
    rows: number,
    meta: { page: number; pageSize: number; total: number; totalPages: number },
  ) {
    const fixture = TestBed.createComponent(RequestList);
    fixture.detectChanges();
    http.expectOne((r) => r.url === '/api/requests/pinned').flush({ data: [], total: 0 });
    http.expectOne((r) => r.url === '/api/requests').flush({
      data: Array.from({ length: rows }, (_, i) => item({ id: i + 1 })),
      page: meta,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const summary = (fixture: { nativeElement: HTMLElement }) =>
    fixture.nativeElement.querySelector('.pager__summary')?.textContent?.replace(/\s+/g, ' ').trim();

  it('says which rows of the whole collection this page holds', async () => {
    const fixture = await renderPage(20, { page: 1, pageSize: 20, total: 27, totalPages: 2 });

    expect(summary(fixture)).toContain('Showing 1–20 of 27 requests');
    expect(summary(fixture)).toContain('page 1 of 2');
  });

  it('does not overstate the last page, which is rarely full', async () => {
    // page * pageSize would say 40; only 7 rows came back.
    const fixture = await renderPage(7, { page: 2, pageSize: 20, total: 27, totalPages: 2 });

    expect(summary(fixture)).toContain('Showing 21–27 of 27 requests');
  });

  it('still reports the count when there is only one page', async () => {
    const fixture = await renderPage(8, { page: 1, pageSize: 20, total: 8, totalPages: 1 });

    expect(summary(fixture)).toContain('Showing 1–8 of 8 requests');
    // The count is worth showing; the controls are not, with nowhere to go.
    expect(fixture.nativeElement.querySelector('[aria-label="Pagination"]')).toBeNull();
    expect(summary(fixture)).not.toContain('page 1 of 1');
  });

  it('says "request" rather than "requests" when there is one', async () => {
    const fixture = await renderPage(1, { page: 1, pageSize: 20, total: 1, totalPages: 1 });

    expect(summary(fixture)).toBe('Showing 1–1 of 1 request');
  });

  it('announces the range to a screen reader as well', async () => {
    const fixture = await renderPage(20, { page: 1, pageSize: 20, total: 27, totalPages: 2 });

    const live = fixture.nativeElement.querySelector('[role="status"]');

    expect(live.textContent.replace(/\s+/g, ' ')).toContain(
      'Showing 1 to 20 of 27 requests, page 1 of 2',
    );
  });
});
