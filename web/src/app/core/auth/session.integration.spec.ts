import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DOCUMENT } from '@angular/common';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from './session';
import { bearerToken } from './bearer-token.interceptor';

/* ════════════════════════════════════════════════════════════════════════════
 * The real Session and the real interceptor, in one injector.
 *
 * THE GAP THIS FILLS. session.spec.ts provides HttpClient without any
 * interceptor; bearer-token.interceptor.spec.ts provides the interceptor with a
 * STUBBED session. So the two had never met — and they have a relationship:
 * the interceptor injects Session, and Session issues an HTTP request from its
 * own constructor. Whether that is a circular dependency is not a thing to
 * reason about, it is a thing to run.
 *
 * Two specs that each pass while the pair is broken is exactly the shape of gap
 * that put a bug in front of somebody's browser.
 * ══════════════════════════════════════════════════════════════════════════ */

const ISSUER = 'http://localhost:8080/realms/feedbackhub';

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

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Session, behind the interceptor that injects it', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('starts up without a circular dependency, and signs in', async () => {
    const browser = fakeBrowser();

    TestBed.configureTestingModule({
      providers: [
        // The real provider set from app.config.ts, not a reduced one.
        provideHttpClient(withInterceptors([bearerToken])),
        provideHttpClientTesting(),
        { provide: DOCUMENT, useValue: browser.document },
      ],
    });

    const http = TestBed.inject(HttpTestingController);
    const session = TestBed.inject(Session);

    await settle();
    http
      .expectOne('/api/auth/config')
      .flush({ data: { mode: 'keycloak', issuer: ISSUER, clientId: 'feedbackhub-web' } });

    await settle();
    http.expectOne(`${ISSUER}/.well-known/openid-configuration`).flush({
      authorization_endpoint: `${ISSUER}/protocol/openid-connect/auth`,
      token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
      end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`,
    });
    await settle();

    expect(session.isUnavailable()).toBe(false);
    expect(session.isSignedOut()).toBe(true);

    // And the endpoints actually landed, which is the difference between a
    // sign-in button that works and one that silently does nothing.
    await session.signIn('/requests');
    expect(browser.assigned[0]).toContain('/protocol/openid-connect/auth');
  });

  /**
   * The startup request must not carry a token, and must not be able to.
   * It is issued before there is one, by the service the interceptor asks.
   */
  it('does not sign its own startup requests', async () => {
    const browser = fakeBrowser();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([bearerToken])),
        provideHttpClientTesting(),
        { provide: DOCUMENT, useValue: browser.document },
      ],
    });

    const http = TestBed.inject(HttpTestingController);
    TestBed.inject(Session);

    await settle();
    const config = http.expectOne('/api/auth/config');
    expect(config.request.headers.has('Authorization')).toBe(false);
    config.flush({ data: { mode: 'development-seam' } });
    await settle();
  });
});
