import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DOCUMENT } from '@angular/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Session } from './session';

/* ════════════════════════════════════════════════════════════════════════════
 * The sign-in lifecycle.
 *
 * These tests never touch a real browser navigation and never reach a real
 * Keycloak. The document is a fake, so `location.assign` is a recorded string
 * rather than a page load, and every HTTP call is flushed by hand — which is
 * what makes it possible to assert on the URL the browser WOULD have been sent
 * to, including the PKCE challenge in it.
 * ══════════════════════════════════════════════════════════════════════════ */

const ISSUER = 'http://localhost:8080/realms/feedbackhub';
const AUTHORIZE = `${ISSUER}/protocol/openid-connect/auth`;
const TOKEN = `${ISSUER}/protocol/openid-connect/token`;
const END_SESSION = `${ISSUER}/protocol/openid-connect/logout`;

function fakeBrowser(pathname = '/requests') {
  const store = new Map<string, string>();
  const assigned: string[] = [];

  return {
    assigned,
    store,
    document: {
      documentElement: document.documentElement,
      defaultView: {
        location: {
          origin: 'http://localhost:4200',
          pathname,
          search: '',
          assign: (url: string) => assigned.push(url),
        },
        sessionStorage: {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => void store.set(key, value),
          removeItem: (key: string) => void store.delete(key),
        },
      },
    },
  };
}

/** Lets the promise chains inside the service run to their next await. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Session', () => {
  let http: HttpTestingController;
  let browser: ReturnType<typeof fakeBrowser>;

  function start(pathname = '/requests') {
    browser = fakeBrowser(pathname);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DOCUMENT, useValue: browser.document },
      ],
    });

    http = TestBed.inject(HttpTestingController);
    return TestBed.inject(Session);
  }

  /** The two unauthenticated requests every startup makes. */
  async function answerDiscovery(mode: 'keycloak' | 'development-seam' = 'keycloak') {
    await settle();
    http
      .expectOne('/api/auth/config')
      .flush({ data: { mode, issuer: ISSUER, clientId: 'feedbackhub-web' } });

    if (mode !== 'keycloak') {
      await settle();
      return;
    }

    await settle();
    http.expectOne(`${ISSUER}/.well-known/openid-configuration`).flush({
      authorization_endpoint: AUTHORIZE,
      token_endpoint: TOKEN,
      end_session_endpoint: END_SESSION,
    });
    await settle();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('asks the API where to sign in, and the provider what its endpoints are', async () => {
    const session = start();

    expect(session.isResolving()).toBe(true);

    await answerDiscovery();

    // Nobody is signed in, and nothing was assumed about the provider's URLs:
    // both came from its own discovery document.
    expect(session.isSignedOut()).toBe(true);
    expect(session.accessToken()).toBeNull();
  });

  /**
   * The development seam is still a mode this build can be compiled in, and
   * when it is there is nowhere to send anybody. Redirecting the browser to a
   * realm that is not running would be worse than not asking.
   */
  it('skips the whole flow when the API establishes identity without a token', async () => {
    const session = start();

    await answerDiscovery('development-seam');

    expect(session.isSignedIn()).toBe(true);
    expect(session.usesProvider()).toBe(false);
    expect(session.accessToken()).toBeNull();
    http.verify();
  });

  it('reports the provider being unreachable, without pretending anybody is signed out', async () => {
    const session = start();

    await settle();
    http
      .expectOne('/api/auth/config')
      .flush({ data: { mode: 'keycloak', issuer: ISSUER, clientId: 'feedbackhub-web' } });

    await settle();
    http
      .expectOne(`${ISSUER}/.well-known/openid-configuration`)
      .flush('', { status: 503, statusText: 'Unavailable' });
    await settle();

    expect(session.isUnavailable()).toBe(true);
    expect(session.isSignedOut()).toBe(false);
    expect(session.failure()).toBeTruthy();
  });

  /**
   * The least diagnosable failure this application was capable of producing: a
   * sign-in button that navigates nowhere, logs nothing and reports nothing,
   * because startup had not finished and `signIn` returned early.
   */
  it('recovers rather than doing nothing when startup did not finish', async () => {
    const session = start();

    await settle();
    http.expectOne('/api/auth/config').flush('', { status: 503, statusText: 'Unavailable' });
    await settle();
    expect(session.isUnavailable()).toBe(true);

    // The click. It retries startup rather than returning.
    const leaving = session.signIn('/requests');

    await settle();
    http
      .expectOne('/api/auth/config')
      .flush({ data: { mode: 'keycloak', issuer: ISSUER, clientId: 'feedbackhub-web' } });
    await settle();
    http.expectOne(`${ISSUER}/.well-known/openid-configuration`).flush({
      authorization_endpoint: AUTHORIZE,
      token_endpoint: TOKEN,
      end_session_endpoint: END_SESSION,
    });
    await leaving;

    expect(browser.assigned[0]).toContain(AUTHORIZE);
  });

  it('says so, rather than nothing, when the retry also fails', async () => {
    const session = start();

    await settle();
    http.expectOne('/api/auth/config').flush('', { status: 503, statusText: 'Unavailable' });
    await settle();

    const leaving = session.signIn('/requests');
    await settle();
    http.expectOne('/api/auth/config').flush('', { status: 503, statusText: 'Unavailable' });
    await leaving;

    expect(browser.assigned).toEqual([]);
    expect(session.failure()).toBeTruthy();
  });

  describe('leaving for the provider', () => {
    it('sends a code challenge and never the verifier', async () => {
      const session = start();
      await answerDiscovery();

      await session.signIn('/requests/42');

      const url = new URL(browser.assigned[0]!);
      expect(url.origin + url.pathname).toBe(AUTHORIZE);
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('client_id')).toBe('feedbackhub-web');
      expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:4200/auth/callback');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('code_challenge')).toBeTruthy();

      // The whole point of PKCE: the secret stays in this browser.
      const flow = JSON.parse(browser.store.get('feedbackhub.auth.flow')!);
      expect(url.toString()).not.toContain(flow.verifier);
      expect(url.searchParams.get('state')).toBe(flow.state);
    });

    /**
     * The redirect URI is registered with the provider and cannot vary, so
     * where somebody was going is remembered here instead. Without it,
     * following a link to a request and signing in lands you on the board.
     */
    it('remembers where the person was going', async () => {
      const session = start();
      await answerDiscovery();

      await session.signIn('/requests/42?tab=comments');

      const flow = JSON.parse(browser.store.get('feedbackhub.auth.flow')!);
      expect(flow.returnTo).toBe('/requests/42?tab=comments');
    });
  });

  describe('coming back', () => {
    async function signInAndReturn(session: Session) {
      await session.signIn('/requests/42');
      const flow = JSON.parse(browser.store.get('feedbackhub.auth.flow')!);

      const landing = session.completeSignIn('an-authorization-code', flow.state);

      await settle();
      http.expectOne(TOKEN).flush({
        access_token: 'an-access-token',
        refresh_token: 'a-refresh-token',
        id_token: 'an-id-token',
        expires_in: 300,
      });

      return { landing: await landing, flow };
    }

    it('exchanges the code, holding the access token in memory only', async () => {
      const session = start('/auth/callback');
      await answerDiscovery();

      const { landing } = await signInAndReturn(session);

      expect(session.isSignedIn()).toBe(true);
      expect(session.accessToken()).toBe('an-access-token');
      expect(landing).toBe('/requests/42');

      // The refresh token survives a reload; the access token does not exist
      // anywhere a script could read it back off disk.
      expect(browser.store.get('feedbackhub.auth.refresh')).toBe('"a-refresh-token"');
      expect([...browser.store.values()].join()).not.toContain('an-access-token');
    });

    it('lets that one route render while there is no session, and stops afterwards', async () => {
      const session = start('/auth/callback');

      // True from the first paint, before any navigation has resolved — which
      // is why it is decided from the address and not from the router.
      expect(session.isCompletingSignIn()).toBe(true);

      await answerDiscovery();
      await signInAndReturn(session);

      expect(session.isCompletingSignIn()).toBe(false);
    });

    /**
     * Asked twice, redeemed once.
     *
     * This is not a hypothetical. The shell mounts and unmounts the outlet the
     * callback component lives in as the session resolves — succeeding makes
     * `completing` false, which tears that branch down, and a moment later
     * another branch renders an outlet into which the router re-activates the
     * still-current callback route. The component is constructed again and asks
     * again.
     *
     * An authorization code is single-use, so the second attempt used to find
     * the flow already consumed, take the failure branch, and write "that
     * sign-in could not be completed" over a session that had just succeeded.
     * A sign-in that worked, followed immediately by a screen saying it had
     * not — which is exactly what a browser showed.
     */
    it('redeems the code once, however many times it is asked', async () => {
      const session = start('/auth/callback');
      await answerDiscovery();
      await session.signIn('/requests/42');
      const flow = JSON.parse(browser.store.get('feedbackhub.auth.flow')!);

      const first = session.completeSignIn('an-authorization-code', flow.state);
      // The second construction, before the first has finished.
      const second = session.completeSignIn('an-authorization-code', flow.state);

      await settle();
      // One exchange, not two. expectOne fails outright if there were two.
      http.expectOne(TOKEN).flush({
        access_token: 'an-access-token',
        refresh_token: 'a-refresh-token',
        expires_in: 300,
      });

      expect(await first).toBe('/requests/42');
      expect(await second).toBe('/requests/42');
      expect(session.isSignedIn()).toBe(true);
      expect(session.failure()).toBeNull();

      // And again after it has settled, which is the case that actually
      // happened: the second component is constructed after the first
      // succeeded, not alongside it.
      expect(await session.completeSignIn('an-authorization-code', flow.state)).toBe(
        '/requests/42',
      );
      expect(session.isSignedIn()).toBe(true);
      expect(session.failure()).toBeNull();
      http.verify();
    });

    /** A fresh attempt after a failed one is a fresh attempt, not the old answer. */
    it('starts over when somebody presses sign in again', async () => {
      const session = start('/auth/callback');
      await answerDiscovery();
      await session.signIn('/requests');

      await session.completeSignIn('a-code', 'the-wrong-state');
      expect(session.isSignedIn()).toBe(false);

      await session.signIn('/requests/7');
      const flow = JSON.parse(browser.store.get('feedbackhub.auth.flow')!);
      const landing = session.completeSignIn('a-second-code', flow.state);

      await settle();
      http.expectOne(TOKEN).flush({ access_token: 'fresh', expires_in: 300 });

      expect(await landing).toBe('/requests/7');
      expect(session.isSignedIn()).toBe(true);
    });

    /**
     * The state parameter is what ties the response to the request THIS tab
     * started. Without the check, a code from somewhere else could be walked
     * into this browser.
     */
    it('refuses a response whose state does not match the request it started', async () => {
      const session = start('/auth/callback');
      await answerDiscovery();
      await session.signIn('/requests');

      const landing = await session.completeSignIn('a-code', 'somebody-elses-state');

      expect(session.isSignedIn()).toBe(false);
      expect(session.failure()).toBeTruthy();
      expect(landing).toBe('/requests');
      http.verify(); // no exchange was attempted
    });

    it('resumes a session this tab already had, without asking anybody anything', async () => {
      browser = fakeBrowser();
      browser.store.set('feedbackhub.auth.refresh', '"a-stored-refresh-token"');

      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: DOCUMENT, useValue: browser.document },
        ],
      });
      http = TestBed.inject(HttpTestingController);
      const session = TestBed.inject(Session);

      await settle();
      http
        .expectOne('/api/auth/config')
        .flush({ data: { mode: 'keycloak', issuer: ISSUER, clientId: 'feedbackhub-web' } });
      await settle();
      http.expectOne(`${ISSUER}/.well-known/openid-configuration`).flush({
        authorization_endpoint: AUTHORIZE,
        token_endpoint: TOKEN,
        end_session_endpoint: END_SESSION,
      });

      await settle();
      const exchange = http.expectOne(TOKEN);
      expect(exchange.request.body).toContain('grant_type=refresh_token');
      exchange.flush({ access_token: 'renewed', expires_in: 300 });
      await settle();

      expect(session.isSignedIn()).toBe(true);
      expect(browser.assigned).toEqual([]);
    });

    it('falls back to signed out when the stored refresh token is spent', async () => {
      browser = fakeBrowser();
      browser.store.set('feedbackhub.auth.refresh', '"an-expired-refresh-token"');

      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: DOCUMENT, useValue: browser.document },
        ],
      });
      http = TestBed.inject(HttpTestingController);
      const session = TestBed.inject(Session);

      await settle();
      http
        .expectOne('/api/auth/config')
        .flush({ data: { mode: 'keycloak', issuer: ISSUER, clientId: 'feedbackhub-web' } });
      await settle();
      http.expectOne(`${ISSUER}/.well-known/openid-configuration`).flush({
        authorization_endpoint: AUTHORIZE,
        token_endpoint: TOKEN,
        end_session_endpoint: END_SESSION,
      });
      await settle();
      http.expectOne(TOKEN).flush('', { status: 400, statusText: 'Bad Request' });
      await settle();

      expect(session.isSignedOut()).toBe(true);
      // Nothing to show anybody: this is what leaving overnight looks like.
      expect(session.failure()).toBeNull();
      expect(browser.store.has('feedbackhub.auth.refresh')).toBe(false);
    });
  });

  describe('signing out', () => {
    /**
     * The half that is easy to miss. Clearing local state alone leaves the
     * provider's own session open, so the next sign-in returns immediately
     * without asking for anything — a sign-out that undoes itself, on the
     * shared machine where it mattered most.
     */
    it('ends the session at the provider, not only here', async () => {
      const session = start('/auth/callback');
      await answerDiscovery();
      await session.signIn('/requests');
      const flow = JSON.parse(browser.store.get('feedbackhub.auth.flow')!);
      const landing = session.completeSignIn('a-code', flow.state);
      await settle();
      http.expectOne(TOKEN).flush({
        access_token: 'an-access-token',
        refresh_token: 'a-refresh-token',
        id_token: 'an-id-token',
        expires_in: 300,
      });
      await landing;

      browser.assigned.length = 0;
      session.signOut();

      const url = new URL(browser.assigned[0]!);
      expect(url.origin + url.pathname).toBe(END_SESSION);
      expect(url.searchParams.get('id_token_hint')).toBe('an-id-token');
      expect(url.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost:4200');

      expect(session.isSignedIn()).toBe(false);
      expect(session.accessToken()).toBeNull();
      expect(browser.store.has('feedbackhub.auth.refresh')).toBe(false);
    });
  });
});
