import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AdminSettings } from './admin-settings';
import { provideStubbedConfig } from '../../../core/config/app-config.testing';
import type { SettingDescriptor } from '../../../core/api/api.types';

/* ════════════════════════════════════════════════════════════════════════════
 * The application settings screen.
 *
 * Refused at the route rather than hidden: hiding the link was never the
 * guarantee, and this proves what somebody who types the address actually gets.
 *
 * The queue below the moderation toggle is the feature flag's visible half —
 * turning the setting on creates work, and the screen that created it is where
 * the work should appear.
 * ══════════════════════════════════════════════════════════════════════════ */

const APPROVAL: SettingDescriptor = {
  key: 'comments.requireApproval',
  label: 'Approve comments before they appear',
  description: 'A new comment waits for an admin.',
  value: true,
  source: 'global',
  editable: true,
  control: { kind: 'toggle' },
};

const PENDING = {
  data: [
    {
      id: 9,
      requestId: 7,
      requestTitle: 'Dark mode for the board',
      parentId: null,
      author: { id: 3, displayName: 'Sam Lindqvist' },
      body: 'This would help in the evenings.',
      createdAt: '2026-08-21T09:00:00.000Z',
    },
  ],
  total: 1,
};

describe('AdminSettings', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideStubbedConfig({ capabilities: { canManageSettings: true } }),
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

  async function render(rows: SettingDescriptor[] = [APPROVAL], pending = PENDING) {
    const fixture = TestBed.createComponent(AdminSettings);
    fixture.detectChanges();

    http.expectOne('/api/settings').flush({ data: rows });
    http.expectOne('/api/comments/pending').flush(pending);

    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  it('renders the server’s own refusal when the caller is not an admin', async () => {
    const fixture = TestBed.createComponent(AdminSettings);
    fixture.detectChanges();

    http.expectOne('/api/settings').flush(
      {
        error: {
          code: 'FORBIDDEN',
          message: 'Only an admin can see the application settings.',
          requestId: 'abc-1',
        },
      },
      { status: 403, statusText: 'Forbidden' },
    );
    http
      .expectOne('/api/comments/pending')
      .flush(
        {
          error: {
            code: 'FORBIDDEN',
            message: 'Only an admin can approve comments.',
            requestId: 'abc-2',
          },
        },
        { status: 403, statusText: 'Forbidden' },
      );

    await fixture.whenStable();
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('This screen is for admins');
    expect(alert?.textContent).toContain('Only an admin can see the application settings.');
  });

  it('sends only the setting that changed', async () => {
    const fixture = await render();

    const toggle = fixture.nativeElement.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));

    const sent = http.expectOne((r) => r.url === '/api/settings' && r.method === 'PATCH');
    expect(sent.request.body).toEqual({ 'comments.requireApproval': false });

    sent.flush({ data: [APPROVAL] });
    await settle(fixture);
  });

  /**
   * The words, not just a count. A moderation decision made without reading
   * what is being decided is not a decision.
   */
  it('shows what is waiting, with the comment and the request it answers', async () => {
    const fixture = await render();
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Waiting for approval');
    expect(text).toContain('This would help in the evenings.');
    expect(text).toContain('Sam Lindqvist');
    expect(text).toContain('Dark mode for the board');
  });

  it('approves one comment and asks for the queue again', async () => {
    const fixture = await render();

    const approve = (
      [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[]
    ).find((button) => button.textContent?.includes('Approve'))!;

    approve.click();

    const sent = http.expectOne((r) => r.url === '/api/comments/9/approval' && r.method === 'PUT');
    sent.flush({ data: {} });

    await settle(fixture, '/api/comments/pending', { data: [], total: 0 });

    expect(fixture.nativeElement.textContent).toContain('Nothing is waiting');
  });

  /**
   * This screen writes the installation's value, so it must never render
   * anybody's personal one — including the admin's own.
   *
   * The server resolves the global document without personal rows for exactly
   * that reason; this is the half of it a reader sees.
   */
  it('says a board default is set for everybody, never that it is theirs', async () => {
    const fixture = await render([
      {
        key: 'board.defaultSort',
        label: 'Order the board opens on',
        description: 'Applied when somebody arrives without an ordering.',
        value: 'oldest',
        source: 'global',
        editable: true,
        control: { kind: 'choice', options: [{ value: 'oldest', label: 'Oldest first' }] },
      },
    ]);

    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Set for everybody');
    expect(text).not.toContain('Your choice');
    expect(text).toContain('a choice made there wins over what is set here');
  });

  it('says when the installation has not set one at all', async () => {
    const fixture = await render([
      {
        key: 'board.defaultSort',
        label: 'Order the board opens on',
        description: 'Applied when somebody arrives without an ordering.',
        value: 'newest',
        source: 'default',
        editable: true,
        control: { kind: 'choice', options: [{ value: 'newest', label: 'Newest first' }] },
      },
    ]);

    expect(fixture.nativeElement.textContent).toContain('using the built-in default');
  });

  /**
   * Flushes before awaiting: an unanswered resource request is a pending task,
   * so waiting for stability first would wait on a response this test has not
   * sent.
   */
  async function settle(
    fixture: { detectChanges: () => void },
    url = '/api/settings',
    body: object = { data: [APPROVAL] },
  ) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      fixture.detectChanges();

      const pending = http.match(url);

      if (pending.length > 0) {
        pending.forEach((request) => request.flush(body));
        fixture.detectChanges();
        return;
      }

      await Promise.resolve();
    }
  }
});
