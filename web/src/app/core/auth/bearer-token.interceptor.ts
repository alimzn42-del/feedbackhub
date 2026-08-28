import { inject } from '@angular/core';
import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { API_BASE_URL } from '../api/api-base-url';
import { toApiError } from '../api/api-error';
import { Session } from './session';

/* ════════════════════════════════════════════════════════════════════════════
 * The one place a token is attached to a request.
 *
 * Every service in this application calls the API without knowing that
 * authentication exists, in the same way no component knows what a role is.
 * There is exactly one function that reads the token, and this is it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It does not attach the token to requests that are not this API's. The token
 * is a credential for one audience, and sending it to the identity provider's
 * own token endpoint — or to anything else a future screen might call — would
 * hand it somewhere it was not minted for.
 * ══════════════════════════════════════════════════════════════════════════ */
export const bearerToken: HttpInterceptorFn = (request, next) => {
  const session = inject(Session);
  const apiBase = inject(API_BASE_URL);

  const isOurApi = request.url.startsWith(apiBase);
  // The route that says where to sign in cannot require being signed in.
  const isAuthConfig = request.url.startsWith(`${apiBase}/auth/`);
  const token = session.accessToken();

  const outgoing =
    isOurApi && !isAuthConfig && token
      ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : request;

  return next(outgoing).pipe(
    catchError((error: unknown) => {
      /**
       * The API refused the token we had.
       *
       * The scheduled refresh normally means this never happens — a token is
       * renewed a minute before it expires. It still can: a laptop that slept
       * through the expiry, a session ended from another device, a realm
       * restarted. Telling the session lets the shell offer the way back in,
       * instead of leaving every screen showing a failure it cannot explain.
       *
       * Only for our own API, and only when we actually sent a token: a 401
       * from anywhere else is not evidence about this session.
       */
      if (isOurApi && !isAuthConfig && token && error instanceof HttpErrorResponse) {
        // The API's own sentence travels with it, so the sign-in panel can say
        // WHY — an unverified address is not an expired session.
        if (error.status === 401) session.expire(toApiError(error).message);
      }

      return throwError(() => error);
    }),
  );
};
