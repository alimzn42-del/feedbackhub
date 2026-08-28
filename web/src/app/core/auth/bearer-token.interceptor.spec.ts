import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bearerToken } from './bearer-token.interceptor';
import { Session } from './session';
import { provideStubbedSession } from './session.testing';

/* ════════════════════════════════════════════════════════════════════════════
 * The one place a token is attached to a request — and the two places it must
 * not be.
 * ══════════════════════════════════════════════════════════════════════════ */
describe('the bearer token interceptor', () => {
  let http: HttpTestingController;
  let client: HttpClient;

  function configure(session = provideStubbedSession()) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([bearerToken])),
        provideHttpClientTesting(),
        session,
      ],
    });

    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('signs calls to this API', () => {
    configure();

    client.get('/api/requests').subscribe();

    expect(http.expectOne('/api/requests').request.headers.get('Authorization')).toBe(
      'Bearer a-test-access-token',
    );
  });

  /**
   * The token is a credential minted for one audience. Sending it to the
   * provider's own token endpoint — or to anything else a later screen calls —
   * would hand it somewhere it was never meant to go.
   */
  it('does not sign anything that is not this API', () => {
    configure();

    client
      .post('http://localhost:8080/realms/feedbackhub/protocol/openid-connect/token', '')
      .subscribe();

    const outgoing = http.expectOne(() => true);
    expect(outgoing.request.headers.has('Authorization')).toBe(false);
  });

  it('does not sign the route that says where to sign in', () => {
    configure();

    client.get('/api/auth/config').subscribe();

    expect(http.expectOne('/api/auth/config').request.headers.has('Authorization')).toBe(false);
  });

  it('sends nothing when there is nothing to send', () => {
    configure(provideStubbedSession({ token: null }));

    client.get('/api/requests').subscribe();

    expect(http.expectOne('/api/requests').request.headers.has('Authorization')).toBe(false);
  });

  /**
   * The scheduled refresh means this normally never happens. It still can: a
   * laptop that slept through the expiry, a session ended from another device,
   * a realm restarted. The shell then offers the way back in, instead of every
   * screen showing a failure none of them can explain.
   */
  it('ends the session when the API refuses a token it was given', () => {
    configure();
    const session = TestBed.inject(Session);

    client.get('/api/requests').subscribe({ error: () => undefined });
    http.expectOne('/api/requests').flush('', { status: 401, statusText: 'Unauthorized' });

    expect(session.isSignedOut()).toBe(true);
  });

  /**
   * Not every 401 is an expiry, and the difference is the sentence. A token
   * whose account was just deleted, or an address the provider never verified,
   * is refused with words that tell the person what to do next — and they are
   * only useful if they survive the trip from the envelope to the sign-in
   * panel. This is the trip.
   */
  it('carries the API’s reason for the refusal to the sign-in panel', () => {
    configure();
    const session = TestBed.inject(Session);

    client.get('/api/bootstrap').subscribe({ error: () => undefined });
    http.expectOne('/api/bootstrap').flush(
      {
        error: {
          code: 'UNAUTHENTICATED',
          message:
            'This account has been deleted. You have been signed out; create a new account to use the board again.',
          requestId: 'req-deleted',
        },
      },
      { status: 401, statusText: 'Unauthorized' },
    );

    expect(session.isSignedOut()).toBe(true);
    expect(session.failure()).toContain('This account has been deleted');
  });

  /**
   * 403 is "you may not do that", and 503 is the identity provider being
   * unreachable — the API cannot check a token it may have no quarrel with.
   * Treating either as the end of a session would sign the whole building out
   * over a Keycloak restart, and keep them out until they noticed.
   */
  it.each([
    [403, 'Forbidden'],
    [503, 'Service Unavailable'],
  ])('does not end the session over a %i, which is not about identity', (status, text) => {
    configure();
    const session = TestBed.inject(Session);

    client.get('/api/settings').subscribe({ error: () => undefined });
    http.expectOne('/api/settings').flush('', { status, statusText: text });

    expect(session.isSignedIn()).toBe(true);
  });
});
