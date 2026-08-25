import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DOCUMENT } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../api/api-base-url';
import { challengeFor, randomToken } from './pkce';

/* ════════════════════════════════════════════════════════════════════════════
 *                                THE SESSION
 *
 * Signing in, staying signed in, and signing out. One service, and the only
 * thing in this application that knows what a token is.
 *
 * THE FLOW IS THE STANDARD ONE
 * Authorization code with PKCE, against a public client. The person is
 * redirected to Keycloak, authenticates there, and comes back with a code this
 * exchanges for tokens. There is deliberately NO sign-in form here: a form that
 * collected a password would mean this application had handled one, which is
 * the entire thing delegating authentication is for.
 *
 * WHERE THE TOKENS LIVE, AND WHY
 * The access token is held in memory only. The refresh token is in
 * sessionStorage, and that is a deliberate, bounded compromise:
 *
 *   - In memory alone, every page reload signs the person out. That reads as a
 *     broken application, and people work around broken applications.
 *   - localStorage would survive the browser closing and is shared across every
 *     tab of the origin — a longer-lived credential in a wider place.
 *   - sessionStorage is scoped to one tab and dies with it. A new tab does not
 *     inherit the token; it redirects, Keycloak recognises its own SSO session,
 *     and the person comes back without typing anything.
 *
 * The honest limit: anything that can run script on this origin can read it. A
 * deployment that wanted to close that would put a back-end-for-frontend in
 * front of this and keep the tokens in an httpOnly cookie, which is a piece of
 * infrastructure this application does not have. That trade is written down in
 * DECISIONS.md rather than left as an assumption.
 *
 * WHAT REPLACES A ROUTE GUARD
 * Nothing below the shell renders until this has resolved — the outlet does not
 * exist. That is a stronger guarantee than a guard per route, and it is one
 * mechanism instead of two that can disagree: a route added later is covered
 * because it cannot be mounted, not because somebody remembered to list it.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Where the browser is sent, discovered rather than assumed. */
interface Endpoints {
  authorization: string;
  token: string;
  endSession: string;
}

interface AuthConfig {
  mode: 'keycloak' | 'development-seam';
  issuer?: string;
  clientId?: string;
}

export type SessionState =
  /** Asking the API how to sign in, or redeeming a refresh token. */
  | 'resolving'
  /** Nobody is signed in. The shell offers a way to start.  */
  | 'signed-out'
  /** There is a usable access token. */
  | 'signed-in'
  /** The provider or the API could not be reached at all. */
  | 'unavailable';

interface StoredFlow {
  verifier: string;
  state: string;
  returnTo: string;
}

const FLOW_KEY = 'feedbackhub.auth.flow';
const REFRESH_KEY = 'feedbackhub.auth.refresh';
const ID_TOKEN_KEY = 'feedbackhub.auth.id';

/** Refresh this long before expiry, so a request never races the clock. */
const REFRESH_MARGIN_SECONDS = 60;

@Injectable({ providedIn: 'root' })
export class Session {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly apiBase = inject(API_BASE_URL);

  private endpoints: Endpoints | null = null;
  private clientId = '';
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly state = signal<SessionState>('resolving');
  private readonly token = signal<string | null>(null);

  /** What went wrong, when the answer is "we could not even ask". */
  readonly failure = signal<string | null>(null);

  readonly isResolving = computed(() => this.state() === 'resolving');
  readonly isSignedOut = computed(() => this.state() === 'signed-out');
  readonly isSignedIn = computed(() => this.state() === 'signed-in');
  readonly isUnavailable = computed(() => this.state() === 'unavailable');

  /**
   * The bearer for outgoing calls, and the dependency the startup request
   * waits on. Null while resolving, and null under the development seam —
   * where the API establishes identity without one.
   */
  readonly accessToken = this.token.asReadonly();

  /** True when this build has a provider at all. False under the seam. */
  readonly usesProvider = signal(true);

  /**
   * True from the moment the browser lands on the redirect URI until the code
   * has been redeemed or abandoned.
   *
   * The shell reads it to let that one route render while there is no session,
   * because it is the route that produces one. Deciding this from the address
   * the page loaded at, rather than from the router, is deliberate: the shell
   * has to answer it on the very first paint, before any navigation has
   * completed, and arriving here is always a fresh page load — Keycloak
   * redirects the browser, and nothing inside the application ever links here.
   */
  private readonly completing = signal(false);
  readonly isCompletingSignIn = computed(() => this.completing());

  /**
   * Resolves when startup has finished, so the callback route can wait for the
   * endpoints it needs. Both run at once on a page load that lands on the
   * redirect URI, and without this the exchange would race the discovery it
   * depends on — intermittently, which is the worst way for it to fail.
   */
  private resolved: Promise<void>;

  constructor() {
    this.completing.set(this.currentPath().startsWith('/auth/callback'));
    this.resolved = this.resolve();
  }

  /* ── Startup ──────────────────────────────────────────────────────────── */

  /**
   * Work out where sign-in lives, then find out whether this tab already has a
   * session to resume.
   *
   * Two requests before anything renders, and both are unauthenticated: the
   * API's own answer about which provider it verifies against, and that
   * provider's discovery document. Neither can be folded into /api/bootstrap,
   * which needs the token these produce.
   */
  private async resolve(): Promise<void> {
    this.state.set('resolving');
    this.failure.set(null);

    let config: AuthConfig;

    try {
      config = await this.fetchJson<AuthConfig>(`${this.apiBase}/auth/config`);
    } catch {
      this.failure.set('Could not reach the server to find out how to sign in.');
      this.state.set('unavailable');
      return;
    }

    /**
     * The API is running the development seam: it invents an identity for every
     * caller and there is nowhere to send anybody. Skipping the flow entirely is
     * better than redirecting the browser to a realm that is not running.
     */
    if (config.mode !== 'keycloak') {
      this.usesProvider.set(false);
      this.state.set('signed-in');
      return;
    }

    this.clientId = config.clientId ?? '';

    try {
      this.endpoints = await this.discover(config.issuer ?? '');
    } catch {
      this.failure.set('The identity provider could not be reached.');
      this.state.set('unavailable');
      return;
    }

    // A refresh token in this tab means the person was here a moment ago.
    const stored = this.read<string>(REFRESH_KEY);
    if (stored && (await this.redeemRefreshToken(stored))) return;

    this.state.set('signed-out');
  }

  /**
   * OpenID Connect discovery, rather than three URLs assembled from the issuer.
   *
   * The paths under a realm are Keycloak's, and assuming them here would put
   * knowledge of one provider's URL shape into the browser. The document is
   * public, and this is the one request that establishes everything else.
   */
  private async discover(issuer: string): Promise<Endpoints> {
    const document = await this.fetchJson<{
      authorization_endpoint: string;
      token_endpoint: string;
      end_session_endpoint: string;
    }>(`${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`);

    return {
      authorization: document.authorization_endpoint,
      token: document.token_endpoint,
      endSession: document.end_session_endpoint,
    };
  }

  /** Retry after a failed startup, without a page reload. */
  retry(): void {
    this.resolved = this.resolve();
  }

  /* ── Signing in ───────────────────────────────────────────────────────── */

  /**
   * Leaves for Keycloak.
   *
   * `returnTo` is remembered so that somebody who followed a link to a request
   * lands on that request when they come back, rather than at the root. It is
   * stored rather than put in the redirect URI because the redirect URI is
   * registered with the provider and must not vary.
   */
  async signIn(returnTo?: string): Promise<void> {
    if (!this.endpoints) return;

    const verifier = randomToken();
    const state = randomToken(16);

    this.write(FLOW_KEY, {
      verifier,
      state,
      returnTo: returnTo ?? this.currentPath(),
    } satisfies StoredFlow);

    const parameters = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri(),
      scope: 'openid email profile',
      code_challenge: await challengeFor(verifier),
      code_challenge_method: 'S256',
      state,
    });

    this.document.defaultView?.location.assign(`${this.endpoints.authorization}?${parameters}`);
  }

  /**
   * The other side of the redirect: swap the code for tokens.
   *
   * Returns where to send the person next, so the callback route navigates and
   * this does not have to know about the router.
   *
   * The `state` check is not ceremony. It is what ties this response to the
   * request this tab actually started, and without it a code from somewhere
   * else could be walked into this browser.
   */
  async completeSignIn(code: string | null, state: string | null): Promise<string> {
    // The endpoints come from startup, which is running concurrently with this
    // on a page load that landed here.
    await this.resolved;

    const flow = this.read<StoredFlow>(FLOW_KEY);
    this.remove(FLOW_KEY);

    try {
      if (!code || !flow || !state || state !== flow.state) {
        this.failure.set('That sign-in could not be completed. Try again.');
        this.state.set('signed-out');
        return '/requests';
      }

      try {
        await this.exchange(
          new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: this.clientId,
            code,
            redirect_uri: this.redirectUri(),
            code_verifier: flow.verifier,
          }),
        );
      } catch {
        this.failure.set('That sign-in could not be completed. Try again.');
        this.state.set('signed-out');
        return '/requests';
      }

      return flow.returnTo || '/requests';
    } finally {
      // Whatever happened, this route has finished being the exception.
      this.completing.set(false);
    }
  }

  /** Somebody pressed cancel on the provider's screen. Not a failure. */
  abandonSignIn(): void {
    this.completing.set(false);
  }

  /* ── Staying signed in ────────────────────────────────────────────────── */

  private async redeemRefreshToken(refreshToken: string): Promise<boolean> {
    try {
      await this.exchange(
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: this.clientId,
          refresh_token: refreshToken,
        }),
      );
      return true;
    } catch {
      // The refresh token has expired or been revoked — the session at the
      // provider is over. Not an error to show anybody: this is what signing
      // out somewhere else, or leaving overnight, looks like.
      this.forget();
      return false;
    }
  }

  /**
   * One code path for both grants, because the response and everything done
   * with it are identical: keep the access token in memory, put the refresh
   * token where a reload can find it, and book the next refresh.
   */
  private async exchange(body: URLSearchParams): Promise<void> {
    const tokens = await firstValueFrom(
      this.http.post<{
        access_token: string;
        refresh_token?: string;
        id_token?: string;
        expires_in: number;
      }>(this.endpoints?.token ?? '', body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );

    this.token.set(tokens.access_token);
    if (tokens.refresh_token) this.write(REFRESH_KEY, tokens.refresh_token);
    if (tokens.id_token) this.write(ID_TOKEN_KEY, tokens.id_token);

    this.state.set('signed-in');
    this.failure.set(null);
    this.scheduleRefresh(tokens.expires_in);
  }

  /**
   * Renew before the token expires rather than after a request has failed.
   *
   * Reacting to a 401 works and is the fallback in the interceptor, but it
   * means one request in every session lifetime fails first — and if that
   * request was a POST somebody typed, retrying it is a decision, not a detail.
   */
  private scheduleRefresh(expiresInSeconds: number): void {
    this.clearTimer();

    const delay = Math.max(5, expiresInSeconds - REFRESH_MARGIN_SECONDS) * 1000;

    this.refreshTimer = setTimeout(() => {
      const refreshToken = this.read<string>(REFRESH_KEY);
      if (!refreshToken) {
        this.expire();
        return;
      }

      void this.redeemRefreshToken(refreshToken).then((renewed) => {
        if (!renewed) this.expire();
      });
    }, delay);
  }

  /**
   * The session ended while somebody was using the application.
   *
   * Called by the interceptor when the API refuses a token it was given, and by
   * the refresh timer when renewal fails. The shell then shows the way back in
   * rather than a screen full of failed requests.
   */
  expire(): void {
    this.forget();
    this.state.set('signed-out');
  }

  /* ── Signing out ──────────────────────────────────────────────────────── */

  /**
   * Ends the session at Keycloak, not only here.
   *
   * Clearing local state alone would be a sign-out that undoes itself: the next
   * sign-in finds the provider's SSO session still open and returns
   * immediately, without asking for anything. Somebody who signed out on a
   * shared machine would be one click from being signed back in.
   */
  signOut(): void {
    const idToken = this.read<string>(ID_TOKEN_KEY);
    const endSession = this.endpoints?.endSession;

    this.forget();
    this.state.set('signed-out');

    if (!endSession) return;

    const parameters = new URLSearchParams({
      client_id: this.clientId,
      post_logout_redirect_uri: this.origin(),
    });
    if (idToken) parameters.set('id_token_hint', idToken);

    this.document.defaultView?.location.assign(`${endSession}?${parameters}`);
  }

  private forget(): void {
    this.clearTimer();
    this.token.set(null);
    this.remove(REFRESH_KEY);
    this.remove(ID_TOKEN_KEY);
  }

  private clearTimer(): void {
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  /* ── The browser ──────────────────────────────────────────────────────── */

  private origin(): string {
    return this.document.defaultView?.location.origin ?? '';
  }

  private redirectUri(): string {
    return `${this.origin()}/auth/callback`;
  }

  private currentPath(): string {
    const location = this.document.defaultView?.location;
    return location ? `${location.pathname}${location.search}` : '/requests';
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await firstValueFrom(this.http.get<{ data: T } | T>(url));
    return (response as { data?: T }).data ?? (response as T);
  }

  /**
   * sessionStorage, defensively.
   *
   * A browser with storage disabled throws on access rather than returning
   * null, and an application that cannot remember a refresh token should still
   * work — it just signs in more often.
   */
  private write(key: string, value: unknown): void {
    try {
      this.document.defaultView?.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* Nothing to do: the session simply will not survive a reload. */
    }
  }

  private read<T>(key: string): T | null {
    try {
      const raw = this.document.defaultView?.sessionStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  private remove(key: string): void {
    try {
      this.document.defaultView?.sessionStorage.removeItem(key);
    } catch {
      /* As above. */
    }
  }
}
