import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './app';

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
});
