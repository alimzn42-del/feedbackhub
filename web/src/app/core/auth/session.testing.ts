import { computed, signal, type Provider } from '@angular/core';
import { Session, type SessionState } from './session';

/**
 * A resolved session, without the two requests that resolve one.
 *
 * The same reasoning as provideStubbedConfig next door: AppConfig now waits on
 * a token before it fetches anything, and the shell waits on this before it
 * renders an outlet. A component test that did not provide this would issue
 * GET /api/auth/config and a discovery request, in every spec, describing
 * nothing about the component under test.
 *
 * Deliberately not a partial. It answers everything Session answers, so a new
 * member on the service is a compile error here rather than an undefined at
 * runtime in fifty specs.
 */
export interface SessionStub {
  state: SessionState;
  token: string | null;
  failure: string | null;
  completingSignIn: boolean;
  usesProvider: boolean;
  /** Recorded rather than performed: a test asserts these, never a redirect. */
  onSignIn?: (returnTo?: string) => void;
  onSignOut?: () => void;
}

const DEFAULTS: SessionStub = {
  state: 'signed-in',
  token: 'a-test-access-token',
  failure: null,
  completingSignIn: false,
  usesProvider: true,
};

export function provideStubbedSession(overrides: Partial<SessionStub> = {}): Provider {
  const stub = { ...DEFAULTS, ...overrides };
  const state = signal<SessionState>(stub.state);

  return {
    provide: Session,
    useValue: {
      isResolving: computed(() => state() === 'resolving'),
      isSignedOut: computed(() => state() === 'signed-out'),
      isSignedIn: computed(() => state() === 'signed-in'),
      isUnavailable: computed(() => state() === 'unavailable'),
      isCompletingSignIn: signal(stub.completingSignIn),
      usesProvider: signal(stub.usesProvider),
      accessToken: signal(stub.token),
      failure: signal(stub.failure),

      signIn: (returnTo?: string) => {
        stub.onSignIn?.(returnTo);
        return Promise.resolve();
      },
      completeSignIn: () => Promise.resolve('/requests'),
      abandonSignIn: () => undefined,
      signOut: () => stub.onSignOut?.(),
      expire: () => state.set('signed-out'),
      retry: () => undefined,

      /** Lets a test move the session while the component is mounted. */
      _state: state,
    },
  };
}
