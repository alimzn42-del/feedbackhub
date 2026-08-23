import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdminTaxonomy } from './admin-taxonomy';
import type { CategoryAdminRow, StatusAdminRow } from '../../../core/api/api.types';

/* ════════════════════════════════════════════════════════════════════════════
 * The admin screen, end to end through the DOM.
 *
 * The refusal matters as much as the happy path: a regular user who types the
 * URL must see the server's own answer, not two empty tables that look like a
 * taxonomy nobody has filled in yet.
 * ══════════════════════════════════════════════════════════════════════════ */

const CATEGORIES: CategoryAdminRow[] = [
  { id: 2, name: 'Feature', slug: 'feature', sortOrder: 0, archivedAt: null, requestCount: 4 },
  { id: 4, name: 'Bug', slug: 'bug', sortOrder: 1, archivedAt: null, requestCount: 0 },
];

const STATUSES: StatusAdminRow[] = [
  { id: 1, name: 'New', slug: 'new', sortOrder: 0, isDefault: true, requestCount: 6 },
  { id: 5, name: 'Done', slug: 'done', sortOrder: 1, isDefault: false, requestCount: 2 },
];

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('AdminTaxonomy', () => {
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

  async function render() {
    const fixture = TestBed.createComponent(AdminTaxonomy);
    fixture.detectChanges();

    http
      .expectOne((r) => r.url === '/api/categories' && r.params.get('scope') === 'all')
      .flush({ data: CATEGORIES });
    http
      .expectOne((r) => r.url === '/api/statuses' && r.params.get('scope') === 'all')
      .flush({ data: STATUSES });

    await settle();
    fixture.detectChanges();
    return fixture;
  }

  type Fixture = Awaited<ReturnType<typeof render>>;

  const byLabel = (fixture: Fixture, label: string): HTMLButtonElement | null =>
    fixture.nativeElement.querySelector(`button[aria-label="${label}"]`);

  /* ── Loading and refusal ─────────────────────────────────────────────── */

  it('asks for the managed representation of both taxonomies', async () => {
    const fixture = await render();

    // scope=all, which the server refuses to anybody who cannot act on it.
    expect(fixture.nativeElement.textContent).toContain('Feature');
    expect(fixture.nativeElement.textContent).toContain('New');
  });

  it('shows the server’s refusal when somebody who may not manage arrives', async () => {
    const fixture = TestBed.createComponent(AdminTaxonomy);
    fixture.detectChanges();

    const forbidden = {
      error: {
        code: 'FORBIDDEN',
        message: 'Only an admin can see the managed categories.',
        requestId: 'abc',
      },
    };

    http
      .expectOne((r) => r.url === '/api/categories')
      .flush(forbidden, { status: 403, statusText: 'Forbidden' });
    http
      .expectOne((r) => r.url === '/api/statuses')
      .flush(forbidden, { status: 403, statusText: 'Forbidden' });

    await settle();
    fixture.detectChanges();

    // The route exists for everybody; the answer comes from the server.
    expect(fixture.nativeElement.textContent).toContain('This screen is for admins');
    expect(fixture.nativeElement.textContent).toContain('Only an admin can see');
    expect(fixture.nativeElement.querySelector('app-taxonomy-table')).toBeNull();
  });

  /* ── Categories ──────────────────────────────────────────────────────── */

  it('creates a category, then reloads rather than guessing the new order', async () => {
    const fixture = await render();

    const name = fixture.nativeElement.querySelector('#new-name-category') as HTMLInputElement;
    name.value = 'Documentation';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (name.closest('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await settle();

    const posted = http.expectOne((r) => r.url === '/api/categories' && r.method === 'POST');
    expect(posted.request.body).toEqual({ name: 'Documentation', slug: 'documentation' });

    posted.flush({ data: { ...CATEGORIES[0], id: 9 } });
    await settle();

    http
      .expectOne((r) => r.url === '/api/categories' && r.method === 'GET')
      .flush({ data: CATEGORIES });
    await settle();
    fixture.detectChanges();
  });

  it('puts a duplicate name against the field, not in a banner', async () => {
    const fixture = await render();

    const name = fixture.nativeElement.querySelector('#new-name-category') as HTMLInputElement;
    name.value = 'Bug';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (name.closest('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await settle();

    http.expectOne((r) => r.method === 'POST').flush(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The submitted values are not valid.',
          requestId: 'abc',
          details: [
            { field: 'name', code: 'DUPLICATE', message: 'A category called "Bug" already exists.' },
          ],
        },
      },
      { status: 422, statusText: 'Unprocessable Content' },
    );

    await settle();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('A category called "Bug" already exists.');
    expect(name.getAttribute('aria-invalid')).toBe('true');
  });

  it('does not show one table’s field error against the other', async () => {
    const fixture = await render();

    const name = fixture.nativeElement.querySelector('#new-name-category') as HTMLInputElement;
    name.value = 'Bug';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (name.closest('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await settle();

    http.expectOne((r) => r.method === 'POST').flush(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The submitted values are not valid.',
          requestId: 'abc',
          details: [{ field: 'name', code: 'DUPLICATE', message: 'A category called "Bug" already exists.' }],
        },
      },
      { status: 422, statusText: 'Unprocessable Content' },
    );

    await settle();
    fixture.detectChanges();

    // Both tables are the same component. Without an owner, the category's
    // duplicate would light up the status form too.
    const statusName = fixture.nativeElement.querySelector('#new-name-status') as HTMLInputElement;
    expect(statusName.getAttribute('aria-invalid')).toBeNull();
  });

  it('reorders by sending the whole list', async () => {
    const fixture = await render();

    byLabel(fixture, 'Move Bug up')!.click();
    await settle();

    const sent = http.expectOne((r) => r.url === '/api/categories/order');
    expect(sent.request.method).toBe('PUT');
    expect(sent.request.body).toEqual({ ids: [4, 2] });

    sent.flush({ data: CATEGORIES });
    await settle();
    http.expectOne((r) => r.url === '/api/categories' && r.method === 'GET').flush({ data: CATEGORIES });
    await settle();
    fixture.detectChanges();
  });

  it('confirms a retirement, and says what it will and will not do', async () => {
    const fixture = await render();

    byLabel(fixture, 'Retire Feature')!.click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    // Four requests carry it; the wording says they keep it, because that is
    // exactly what retirement means here.
    expect(dialog.textContent).toContain('4 requests keep it');
    expect(dialog.textContent).toContain('stops being offered');
    expect(dialog.textContent).toContain('restored');
  });

  it('retires only once confirmed, and by archiving rather than deleting', async () => {
    const fixture = await render();

    byLabel(fixture, 'Retire Feature')!.click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    const confirm = Array.from(dialog.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Retire it'),
    ) as HTMLButtonElement;

    confirm.click();
    await settle();

    const sent = http.expectOne((r) => r.url === '/api/categories/2/archive');
    // PUT to an archive sub-resource, never DELETE on the category: the row
    // does not go away.
    expect(sent.request.method).toBe('PUT');

    sent.flush({ data: { ...CATEGORIES[0], archivedAt: '2026-08-22T09:00:00.000Z' } });
    await settle();
    http.expectOne((r) => r.url === '/api/categories' && r.method === 'GET').flush({ data: CATEGORIES });
    await settle();
    fixture.detectChanges();
  });

  it('sends nothing when a retirement is cancelled', async () => {
    const fixture = await render();

    byLabel(fixture, 'Retire Feature')!.click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    const cancel = Array.from(dialog.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Cancel',
    ) as HTMLButtonElement;

    cancel.click();
    fixture.detectChanges();

    // http.verify() in afterEach is the assertion: nothing was sent.
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
  });

  /* ── Statuses ────────────────────────────────────────────────────────── */

  it('moves the default, and reloads because two rows changed', async () => {
    const fixture = await render();

    byLabel(fixture, 'Make Done the default status')!.click();
    await settle();

    const sent = http.expectOne((r) => r.url === '/api/statuses/5/default');
    expect(sent.request.method).toBe('PUT');

    sent.flush({ data: STATUSES });
    await settle();

    // The status that lost the default is not the one that was clicked, so the
    // list is re-read rather than patched from the response.
    http.expectOne((r) => r.url === '/api/statuses' && r.method === 'GET').flush({ data: STATUSES });
    await settle();
    fixture.detectChanges();
  });

  it('offers no way to retire a status', async () => {
    const fixture = await render();

    // A status is a position requests are sitting in. Retiring one would
    // strand them.
    expect(byLabel(fixture, 'Retire New')).toBeNull();
    expect(byLabel(fixture, 'Retire Done')).toBeNull();
  });
});
