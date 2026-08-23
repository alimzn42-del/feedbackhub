import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestList } from './request-list';
import { App } from '../../../app';
import { routes } from '../../../app.routes';
import { provideStubbedConfig } from '../../../core/config/app-config.testing';

/* ════════════════════════════════════════════════════════════════════════════
 * A saved default decides where you LAND; the URL still says where you are.
 *
 * Arriving at /requests with a bare address replaces it with one carrying the
 * person's default ordering and filters. Two tests, because they can fail
 * independently: the board deciding to redirect, and the whole chain — startup
 * payload, router, rebound inputs, the request that actually goes out.
 * ══════════════════════════════════════════════════════════════════════════ */

const EMPTY_PAGE = { data: [], page: { page: 1, pageSize: 20, total: 0, totalPages: 0 } };

describe('RequestList opening defaults', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideStubbedConfig({
          settings: {
            'board.defaultStatuses': { value: ['new'], source: 'user', editable: true },
            'board.defaultCategories': { value: ['bug'], source: 'user', editable: true },
          },
        }),
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.match(() => true).forEach((request) => request.flush(EMPTY_PAGE));
    TestBed.resetTestingModule();
  });

  /**
   * The case the first version of this rule got wrong, and the one that was
   * reported.
   *
   * Somebody whose default ORDERING is oldest lands on /requests?sort=oldest.
   * That address is not bare, so the old rule never fired again — and a default
   * STATUS chosen afterwards could never take effect. The setting saved, the
   * payload carried it, the board ignored it.
   */
  it('applies a default filter even when the address already carries an ordering', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate');

    const fixture = TestBed.createComponent(RequestList);
    // As if arrived at /requests?sort=oldest — an ordering asked for, no filter.
    fixture.componentRef.setInput('sort', 'oldest');
    fixture.detectChanges();

    http.match(() => true).forEach((request) => request.flush(EMPTY_PAGE));
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith(
      ['/requests'],
      expect.objectContaining({
        queryParams: { status: 'new', category: 'bug', sort: 'oldest' },
        replaceUrl: true,
      }),
    );
  });

  /**
   * The other half of the same rule: an address that DOES narrow the board is
   * somebody asking for something specific, and a preference does not overrule
   * a shared link.
   */
  it('leaves an address that already narrows the board alone', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate');

    const fixture = TestBed.createComponent(RequestList);
    fixture.componentRef.setInput('status', 'done');
    fixture.detectChanges();

    http.match(() => true).forEach((request) => request.flush(EMPTY_PAGE));
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    // The ordering it did not ask for is still filled in; the filter is not.
    const [, extras] = navigate.mock.calls[0] ?? [];
    const params = (extras as { queryParams?: Record<string, string> })?.queryParams ?? {};

    expect(params['status']).toBeUndefined();
    expect(params['category']).toBeUndefined();
  });

  /**
   * Clearing the filters happens while somebody is already on the board, and
   * this component is reused across that navigation — so the defaults do not
   * come back and re-narrow what they just cleared.
   */
  it('does not re-apply once somebody is working on the board', async () => {
    const router = TestBed.inject(Router);

    const fixture = TestBed.createComponent(RequestList);
    fixture.detectChanges();

    http.match(() => true).forEach((request) => request.flush(EMPTY_PAGE));
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    const navigate = vi.spyOn(router, 'navigate');

    // The same instance, now told the address has been cleared.
    fixture.componentRef.setInput('status', '');
    fixture.componentRef.setInput('category', '');
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    http.match(() => true).forEach((request) => request.flush(EMPTY_PAGE));

    expect(navigate).not.toHaveBeenCalled();
  });

  it('replaces a bare address with one carrying the saved defaults', async () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate');

    const fixture = TestBed.createComponent(RequestList);
    fixture.detectChanges();

    // Flushed rather than awaited: an unanswered resource request is a pending
    // task, so awaiting stability first would deadlock.
    http.match(() => true).forEach((request) => request.flush(EMPTY_PAGE));
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledWith(
      ['/requests'],
      expect.objectContaining({
        queryParams: { status: 'new', category: 'bug' },
        replaceUrl: true,
      }),
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The same thing through the real wiring.
 *
 * The real AppConfig, the real routes, the real router with component input
 * binding. This is the test that would have caught a redirect that fires and
 * then does not reach the request — the preference is only applied if the
 * parameters come back round through the address bar and into the list.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('opening defaults, through the whole chain', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        // The real provider set: withComponentInputBinding is what binds query
        // parameters to the board's inputs, and is how list state reaches it.
        provideRouter(routes, withComponentInputBinding()),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.match(() => true).forEach((request) => request.flush(EMPTY_PAGE));
    TestBed.resetTestingModule();
  });

  it('lands on a board already filtered by the saved defaults', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/requests');
    fixture.detectChanges();

    // The one startup request, answered with a person who has saved defaults.
    http.expectOne('/api/bootstrap').flush({
      data: {
        user: { id: 2, email: 'dana@feedbackhub.local', displayName: 'Dana Okafor' },
        capabilities: {
          canManageCategories: false,
          canManageStatuses: false,
          canManageSettings: false,
        },
        settings: {
          'board.defaultSort': { value: 'oldest', source: 'user', editable: true },
          'board.defaultStatuses': { value: ['new'], source: 'user', editable: true },
          'board.defaultCategories': { value: [], source: 'default', editable: true },
        },
        taxonomy: {
          categories: [{ id: 1, name: 'Bug', slug: 'bug' }],
          statuses: [{ id: 1, name: 'New', slug: 'new' }],
        },
      },
    });

    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    const listed = http.match((request) => request.url === '/api/requests');

    // The last request is the one the screen settled on. An earlier unfiltered
    // one is fine — the redirect had not happened yet — but the board must not
    // come to rest showing everything.
    const settled = listed.at(-1);

    expect(settled).toBeDefined();
    expect(settled!.request.params.get('status')).toBe('new');
    expect(settled!.request.params.get('sort')).toBe('oldest');
    expect(router.url).toContain('status=new');
  });
});
