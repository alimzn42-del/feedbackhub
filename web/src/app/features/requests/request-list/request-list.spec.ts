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
