import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestDetail } from './request-detail';
import type { FeedbackRequestDetail } from '../../../core/api/api.types';

/* ════════════════════════════════════════════════════════════════════════════
 * Acting on a request from its own page.
 *
 * Which controls appear is decided by the server, per row. These tests set the
 * canEdit / canDelete / canPin / canChangeStatus flags the way the API would
 * and assert what the page then offers — and, for every action, they click the
 * real control rather than calling the handler.
 *
 * Hiding a control is a courtesy. The refusals themselves are proved in
 * api/src/app.authorization.test.ts, through the real routes.
 * ══════════════════════════════════════════════════════════════════════════ */

const STATUSES = [
  { id: 1, name: 'New', slug: 'new' },
  { id: 4, name: 'In Progress', slug: 'in-progress' },
  { id: 5, name: 'Done', slug: 'done' },
];

function detail(overrides: Partial<FeedbackRequestDetail> = {}): FeedbackRequestDetail {
  return {
    id: 7,
    title: 'Dark mode for the board',
    description: 'Reading the board in the evening is harsh and a dark theme would help.',
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
    createdAt: '2026-08-21T04:59:42.237Z',
    updatedAt: '2026-08-21T04:59:42.237Z',
    editedAt: null,
    ...overrides,
  };
}

/**
 * Lets the delivered response settle without waiting for stability.
 *
 * whenStable() cannot be used between a flush and the render it causes: an
 * outstanding request is itself what keeps the app unstable, so waiting for
 * stability before answering the next request waits for a request that is
 * waiting for the test. A turn of the task queue is all that is needed.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('RequestDetail actions', () => {
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
   * Renders the page for one request and answers everything it asks for: the
   * request itself, its comment thread, and the statuses when the caller may
   * change one.
   */
  async function render(row: FeedbackRequestDetail = detail()) {
    const fixture = TestBed.createComponent(RequestDetail);
    fixture.componentRef.setInput('id', row.id);
    fixture.detectChanges();

    http.expectOne((r) => r.url === `/api/requests/${row.id}`).flush({ data: row });

    // The thread and the status list are inside the branch that only renders
    // once the request has arrived, so they are asked for on the NEXT pass.
    await settle();
    fixture.detectChanges();

    http.expectOne((r) => r.url === `/api/requests/${row.id}/comments`).flush({ data: [] });

    if (row.canChangeStatus) {
      http.expectOne((r) => r.url === '/api/statuses').flush({ data: STATUSES });
    }

    await settle();
    fixture.detectChanges();

    return fixture;
  }

  function button(fixture: { nativeElement: HTMLElement }, label: string): HTMLButtonElement | null {
    return (
      (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find(
        (candidate) => candidate.textContent?.trim().startsWith(label),
      ) ?? null
    );
  }

  /* ── What is offered ─────────────────────────────────────────────────── */

  it('offers nothing to a reader who may do nothing', async () => {
    const fixture = await render();

    expect(button(fixture, 'Edit request')).toBeNull();
    expect(button(fixture, 'Delete request')).toBeNull();
    expect(button(fixture, 'Pin')).toBeNull();
    expect(fixture.nativeElement.querySelector('#detail-status')).toBeNull();
    // The whole panel goes, rather than sitting there empty.
    expect(fixture.nativeElement.querySelector('.manage')).toBeNull();
  });

  it('offers the author edit and delete, and nothing else', async () => {
    const fixture = await render(detail({ canEdit: true, canDelete: true }));

    expect(button(fixture, 'Edit request')).not.toBeNull();
    expect(button(fixture, 'Delete request')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#detail-status')).toBeNull();
  });

  it('offers an admin the status, the pin and delete — but not the edit', async () => {
    const fixture = await render(
      detail({ canDelete: true, canPin: true, canChangeStatus: true, canEdit: false }),
    );

    expect(fixture.nativeElement.querySelector('#detail-status')).not.toBeNull();
    expect(button(fixture, 'Pin to the board')).not.toBeNull();
    expect(button(fixture, 'Delete request')).not.toBeNull();
    // Moderation is removing or restatusing, never rewriting somebody's words.
    expect(button(fixture, 'Edit request')).toBeNull();
  });

  it('asks for the statuses only when the caller can change one', async () => {
    // render() would fail on an unexpected request and verify() on an
    // unanswered one, so not listing /api/statuses is the assertion.
    await render(detail({ canEdit: true }));
  });

  /* ── Editing ─────────────────────────────────────────────────────────── */

  it('edits through the real form and applies what the server sends back', async () => {
    const fixture = await render(detail({ canEdit: true }));

    button(fixture, 'Edit request')!.click();
    fixture.detectChanges();
    await settle();

    http.expectOne((r) => r.url === '/api/categories').flush({
      data: [
        { id: 2, name: 'Feature', slug: 'feature' },
        { id: 4, name: 'Bug', slug: 'bug' },
      ],
    });

    await settle();
    fixture.detectChanges();

    const title = fixture.nativeElement.querySelector('#edit-title') as HTMLInputElement;
    expect(title.value).toBe('Dark mode for the board');

    title.value = 'Dark mode for the entire board';
    title.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await settle();

    const sent = http.expectOne((r) => r.url === '/api/requests/7' && r.method === 'PATCH');
    expect(sent.request.body).toEqual({
      title: 'Dark mode for the entire board',
      description: 'Reading the board in the evening is harsh and a dark theme would help.',
      categoryId: 2,
    });

    sent.flush({
      data: detail({ canEdit: true, title: 'Dark mode for the entire board', editedAt: '2026-08-22T09:00:00.000Z' }),
    });
    await settle();
    fixture.detectChanges();

    // Applied from the response rather than refetched: the server already sent
    // the request back.
    expect(fixture.nativeElement.textContent).toContain('Dark mode for the entire board');
    expect(fixture.nativeElement.querySelector('#edit-title')).toBeNull();
  });

  it('shows an edited marker only once the text has been edited', async () => {
    const fixture = await render(detail({ editedAt: '2026-08-22T09:00:00.000Z' }));

    expect(fixture.nativeElement.textContent).toContain('edited');
  });

  it('does not call something edited because an admin pinned it', async () => {
    // updatedAt moved and editedAt did not, which is exactly the case the
    // separate column exists for.
    const fixture = await render(
      detail({ updatedAt: '2026-08-22T11:00:00.000Z', editedAt: null, isPinned: true }),
    );

    expect(fixture.nativeElement.textContent).not.toContain('edited');
  });

  /* ── Status ──────────────────────────────────────────────────────────── */

  it('changes the status through the select, and not before it changes', async () => {
    const fixture = await render(detail({ canChangeStatus: true }));

    const apply = button(fixture, 'Update status')!;
    // Nothing has been chosen yet, so there is nothing to save.
    expect(apply.disabled).toBe(true);

    const select = fixture.nativeElement.querySelector('#detail-status') as HTMLSelectElement;
    select.value = '5';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(button(fixture, 'Update status')!.disabled).toBe(false);
    button(fixture, 'Update status')!.click();
    await settle();

    const sent = http.expectOne((r) => r.url === '/api/requests/7/status' && r.method === 'PUT');
    expect(sent.request.body).toEqual({ statusId: 5 });

    sent.flush({ data: detail({ canChangeStatus: true, status: STATUSES[2]! }) });
    await settle();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Done');
  });

  it('offers the statuses by name, from the table rather than a hardcoded list', async () => {
    const fixture = await render(detail({ canChangeStatus: true }));
    const options = Array.from(
      fixture.nativeElement.querySelectorAll('#detail-status option'),
    ) as HTMLOptionElement[];

    expect(options.map((option) => option.textContent?.trim())).toEqual([
      'New',
      'In Progress',
      'Done',
    ]);
  });

  /* ── Pinning ─────────────────────────────────────────────────────────── */

  it('pins and refetches, since the pin endpoint answers with a list row', async () => {
    const fixture = await render(detail({ canPin: true }));

    button(fixture, 'Pin to the board')!.click();
    await settle();

    http
      .expectOne((r) => r.url === '/api/requests/7/pin' && r.method === 'PUT')
      .flush({ data: {} });

    // The success handler reloads the request, and the response reaches it a
    // turn later, so the refetch does not exist until then.
    await settle();

    http.expectOne((r) => r.url === '/api/requests/7').flush({
      data: detail({
        canPin: true,
        isPinned: true,
        pinnedBy: { id: 9, displayName: 'Robin Alvarez' },
        pinnedAt: '2026-08-22T09:00:00.000Z',
      }),
    });

    await settle();
    fixture.detectChanges();

    // The page names who pinned it, matching the card.
    expect(fixture.nativeElement.textContent).toContain('Pinned by Robin Alvarez');
    expect(button(fixture, 'Unpin from the board')).not.toBeNull();
  });

  /* ── Deleting ────────────────────────────────────────────────────────── */

  it('asks before deleting, and sends nothing until it is confirmed', async () => {
    const fixture = await render(detail({ canDelete: true }));

    button(fixture, 'Delete request')!.click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="dialog"]')).not.toBeNull();

    // Cancelling sends nothing at all; http.verify() in afterEach proves it.
    button(fixture, 'Cancel')!.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
  });

  it('deletes on confirmation and leaves the dead URL behind', async () => {
    const fixture = await render(detail({ canDelete: true }));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    button(fixture, 'Delete request')!.click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();

    // The dialog's own button, clicked for real.
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    const confirm = Array.from(dialog.querySelectorAll('button')).find((candidate) =>
      candidate.textContent?.trim().startsWith('Delete request'),
    ) as HTMLButtonElement;

    confirm.click();
    await settle();

    http.expectOne((r) => r.url === '/api/requests/7' && r.method === 'DELETE').flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    await settle();

    expect(navigate).toHaveBeenCalledWith(['/requests']);
  });

  /* ── Failures that read differently ──────────────────────────────────── */

  it('shows the server’s own words when an action is refused', async () => {
    const fixture = await render(detail({ canChangeStatus: true }));

    const select = fixture.nativeElement.querySelector('#detail-status') as HTMLSelectElement;
    select.value = '5';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    button(fixture, 'Update status')!.click();
    await settle();

    http.expectOne((r) => r.url === '/api/requests/7/status').flush(
      {
        error: {
          code: 'FORBIDDEN',
          message: 'Only an admin can change a request status.',
          requestId: 'abc-123',
        },
      },
      { status: 403, statusText: 'Forbidden' },
    );
    await settle();
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert.textContent).toContain('Only an admin can change a request status.');
  });

  it('says so plainly when somebody else deleted the request first', async () => {
    const fixture = await render(detail({ canDelete: true, canPin: true }));

    button(fixture, 'Pin to the board')!.click();
    await settle();

    http.expectOne((r) => r.url === '/api/requests/7/pin').flush(
      {
        error: { code: 'NOT_FOUND', message: 'That request does not exist.', requestId: 'x' },
      },
      { status: 404, statusText: 'Not Found' },
    );
    await settle();
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector('[role="alert"]');
    // A retry cannot help here, so the offer is a way out rather than a retry.
    expect(alert.textContent).toContain('deleted it while this page was open');
    expect(alert.querySelector('a')).not.toBeNull();
  });

  it('distinguishes a dead connection from a refusal', async () => {
    const fixture = await render(detail({ canPin: true }));

    button(fixture, 'Pin to the board')!.click();
    await settle();

    http
      .expectOne((r) => r.url === '/api/requests/7/pin')
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await settle();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'Could not reach the server',
    );
  });
});
