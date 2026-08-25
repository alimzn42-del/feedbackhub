import { TestBed } from '@angular/core/testing';
import type { Provider } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './app';
import { provideStubbedSession } from './core/auth/session.testing';

/* ════════════════════════════════════════════════════════════════════════════
 * Startup.
 *
 * The brief singles this out and so does this file: one request, and a shell
 * that is honest about what happens when it does not answer.
 *
 * The failure case is the one worth testing. A blank screen and an interface
 * running on hardcoded fallbacks both LOOK like they worked — the first for a
 * moment, the second indefinitely — and neither tells anybody that the
 * application does not know how it is configured.
 * ══════════════════════════════════════════════════════════════════════════ */

const BOOTSTRAP = {
  data: {
    user: { id: 2, email: 'dana@feedbackhub.local', displayName: 'Dana Okafor' },
    capabilities: {
      canManageCategories: false,
      canManageStatuses: false,
      canManageSettings: false,
    },
    settings: {
      'profile.theme': { value: 'dark', source: 'user', editable: true },
      'profile.language': { value: 'en', source: 'user', editable: true },
    },
    taxonomy: { categories: [], statuses: [] },
  },
};

/** The same payload, read by somebody who chose French. */
function inFrench() {
  return {
    data: {
      ...BOOTSTRAP.data,
      settings: {
        ...BOOTSTRAP.data.settings,
        'profile.language': { value: 'fr', source: 'user', editable: true },
      },
    },
  };
}

describe('App', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        // Signed in already. What this spec is about is the ONE startup request
        // and the shell's honesty when it does not answer; the identity in
        // front of it has its own tests below.
        provideStubbedSession(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    try {
      http.verify();
    } finally {
      TestBed.resetTestingModule();
      document.documentElement.removeAttribute('data-theme');
    }
  });

  async function render() {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    return fixture;
  }

  it('asks for its configuration exactly once, and nothing else', async () => {
    const fixture = await render();

    // One request. Not capabilities, then statuses, then categories.
    const asked = http.match(() => true);
    expect(asked.map((r) => r.request.url)).toEqual(['/api/bootstrap']);

    asked[0]!.flush(BOOTSTRAP);
    await fixture.whenStable();
  });

  it('does not draw the board until it knows how it is configured', async () => {
    const fixture = await render();

    expect(fixture.nativeElement.textContent).toContain('Starting FeedbackHub');
    // Nothing that implies a working application: no navigation, no outlet.
    expect(fixture.nativeElement.querySelector('nav')).toBeNull();

    http.expectOne('/api/bootstrap').flush(BOOTSTRAP);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('nav')).not.toBeNull();
  });

  /**
   * The failure the brief asks to be handled deliberately: an error somebody
   * can act on, not a blank page and not a half-configured interface.
   */
  it('shows an error with a retry when its configuration cannot be loaded', async () => {
    const fixture = await render();

    http.expectOne('/api/bootstrap').flush(
      {
        error: {
          code: 'INTERNAL',
          message: 'Something went wrong.',
          requestId: 'abc-123',
        },
      },
      { status: 500, statusText: 'Server Error' },
    );

    await fixture.whenStable();
    fixture.detectChanges();

    const alert = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('FeedbackHub could not start');
    expect(alert?.textContent).toContain('Something went wrong.');
    expect(alert?.textContent).toContain('abc-123');

    // No navigation, no outlet: nothing renders on a guessed configuration.
    expect(fixture.nativeElement.querySelector('nav')).toBeNull();

    const retry = [...fixture.nativeElement.querySelectorAll('button')].find(
      (button: HTMLButtonElement) => button.textContent?.includes('Try again'),
    ) as HTMLButtonElement;

    expect(retry).toBeTruthy();

    retry.click();
    fixture.detectChanges();

    // The retry is a real second attempt, not a cosmetic reset.
    http.expectOne('/api/bootstrap').flush(BOOTSTRAP);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('nav')).not.toBeNull();
  });

  /**
   * The colour scheme is applied to the document, so it covers the parts of the
   * page no component styles — and it is applied from the payload, so it is
   * right on the first frame rather than after a flash of the other one.
   */
  it('applies the chosen colour scheme and language to the document', async () => {
    const fixture = await render();

    http.expectOne('/api/bootstrap').flush(inFrench());
    await fixture.whenStable();
    fixture.detectChanges();

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.lang).toBe('fr');
  });

  /**
   * The language setting translates the interface. It used to set the document
   * language and the date locale and nothing else, which read to anybody trying
   * it as a setting that did nothing.
   */
  it('renders the navigation in the language the person chose', async () => {
    const fixture = await render();

    http.expectOne('/api/bootstrap').flush(inFrench());
    await fixture.whenStable();
    fixture.detectChanges();

    const nav = fixture.nativeElement.querySelector('nav').textContent;

    expect(nav).toContain('Tableau');
    expect(nav).toContain('Nouvelle demande');
    expect(nav).not.toContain('Board');
  });

  /**
   * `system` removes the attribute rather than writing a third value, so the
   * stylesheet's own prefers-color-scheme query decides. Two mechanisms both
   * claiming to choose the scheme is how a dark board ends up with light
   * scrollbars.
   */
  it('hands the colour scheme back to the operating system when asked to', async () => {
    const fixture = await render();

    http.expectOne('/api/bootstrap').flush({
      data: {
        ...BOOTSTRAP.data,
        settings: {
          'profile.theme': { value: 'system', source: 'default', editable: true },
        },
      },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('offers the admin screens only to somebody the server says may manage them', async () => {
    const fixture = await render();

    http.expectOne('/api/bootstrap').flush({
      data: {
        ...BOOTSTRAP.data,
        capabilities: {
          canManageCategories: true,
          canManageStatuses: true,
          canManageSettings: true,
        },
      },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const nav = fixture.nativeElement.querySelector('nav').textContent;
    expect(nav).toContain('Categories');
    expect(nav).toContain('Settings');
  });

  /* ── The moderation indicator ──────────────────────────────────────────── */

  /**
   * The whole discovery path for comment approval. Without it a waiting comment
   * sits in a thread nobody has a reason to open, and the setting that held it
   * back does nothing at all.
   */
  it('shows how many comments are waiting, linking to the requests that carry them', async () => {
    const fixture = await render();

    http.expectOne('/api/bootstrap').flush({
      data: { ...BOOTSTRAP.data, pendingComments: 4 },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('.masthead__pending') as HTMLAnchorElement;

    expect(link).not.toBeNull();
    expect(link.textContent).toContain('4');
    expect(link.getAttribute('href')).toContain('pending=true');
  });

  /**
   * Absent, not zero. A badge showing 0 and a header with nothing in it are
   * different claims, and the server makes the distinction by omitting the
   * field when moderation is off or the reader cannot approve anything.
   */
  it('shows nothing at all when there is nothing to say', async () => {
    const fixture = await render();

    http.expectOne('/api/bootstrap').flush(BOOTSTRAP);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.masthead__pending')).toBeNull();
  });

  it('shows nothing when the count is zero rather than a badge saying none', async () => {
    const fixture = await render();

    http.expectOne('/api/bootstrap').flush({
      data: { ...BOOTSTRAP.data, pendingComments: 0 },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.masthead__pending')).toBeNull();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 *                        IDENTITY, BEFORE ANYTHING ELSE
 *
 * The shell is where route guarding happens in this application, and these are
 * the tests that say so. There is no per-route guard: the outlet does not exist
 * until the session has resolved, which covers a route added later because it
 * cannot be mounted rather than because somebody remembered to list it.
 *
 * The first test is the one the brief asks for by name — a guarded screen must
 * not flash its content before the identity resolves.
 * ══════════════════════════════════════════════════════════════════════════ */
describe('the shell, before there is anybody', () => {
  let http: HttpTestingController;

  function render(session: Provider) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        session,
      ],
    });

    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('draws no screen and asks for no configuration while the identity resolves', () => {
    const fixture = render(provideStubbedSession({ state: 'resolving', token: null }));

    expect(fixture.nativeElement.querySelector('router-outlet')).toBeNull();
    expect(fixture.nativeElement.querySelector('nav')).toBeNull();
    // And the startup request has not been made, because there is nobody to
    // make it for. It would come back 401.
    http.expectNone(() => true);
  });

  /**
   * There is no sign-in form here and there must never be one. Collecting a
   * password would mean this application had handled one, which is the entire
   * thing delegating authentication exists to avoid.
   */
  it('offers a way in, and never a password field', () => {
    let asked = false;
    const fixture = render(
      provideStubbedSession({ state: 'signed-out', token: null, onSignIn: () => (asked = true) }),
    );

    expect(fixture.nativeElement.querySelector('input[type="password"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    expect(fixture.nativeElement.querySelector('router-outlet')).toBeNull();

    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toContain('Sign in');

    button.click();
    expect(asked).toBe(true);
  });

  /**
   * Not the same statement as "you are signed out": nobody has been asked yet.
   * Offering a sign-in button here would send somebody to a page that is not
   * answering.
   */
  it('separates a provider that cannot be reached from nobody being signed in', () => {
    const fixture = render(
      provideStubbedSession({
        state: 'unavailable',
        token: null,
        failure: 'The identity provider could not be reached.',
      }),
    );

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Sign-in is unavailable');
    expect(text).toContain('could not be reached');
    expect(text).not.toContain('Sign in to FeedbackHub');
  });

  /** The one route that renders without a session, because it produces one. */
  it('lets the sign-in callback render while there is still nobody', () => {
    const fixture = render(
      provideStubbedSession({ state: 'signed-out', token: null, completingSignIn: true }),
    );

    expect(fixture.nativeElement.querySelector('router-outlet')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Sign in to FeedbackHub');
  });

  it('offers a way out once somebody is in', async () => {
    let signedOut = false;
    const fixture = render(provideStubbedSession({ onSignOut: () => (signedOut = true) }));

    http.expectOne('/api/bootstrap').flush(BOOTSTRAP);
    await fixture.whenStable();
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.masthead__signout') as HTMLButtonElement;
    expect(button.textContent).toContain('Sign out');

    button.click();
    expect(signedOut).toBe(true);
  });

  /**
   * Under the development seam the API establishes an identity without a token
   * and there is no provider session to end. A sign-out control there would be
   * a button that cannot do what it says.
   */
  it('offers no way out when there is no session to end', async () => {
    const fixture = render(provideStubbedSession({ usesProvider: false, token: null }));

    http.expectOne('/api/bootstrap').flush(BOOTSTRAP);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.masthead__signout')).toBeNull();
  });
});
