import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Session } from '../session';
import { Translate } from '../../i18n/translate';

/**
 * Where Keycloak sends the browser back to.
 *
 * It renders almost nothing on purpose: it exists for the moment between
 * arriving with a code and having a session, and the only outcome anybody
 * should see is the page they were trying to reach in the first place.
 *
 * `replaceUrl` on the navigation matters. Without it, the address carrying the
 * authorization code stays in history, and the back button walks somebody onto
 * a code that has already been redeemed — which fails, and looks like the
 * application being broken rather than a code being single-use.
 */
@Component({
  selector: 'app-auth-callback',
  template: `<p class="startup" role="status">{{ message() }}</p>`,
  styles: `
    .startup {
      padding: 3rem 1rem;
      text-align: center;
      color: var(--colour-text-muted);
    }
  `,
})
export class AuthCallback {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(Session);
  private readonly t = inject(Translate).t;

  protected readonly message = signal(this.t('auth.completing'));

  constructor() {
    const parameters = this.route.snapshot.queryParamMap;

    /**
     * The provider refused, or the person pressed cancel on the Keycloak
     * screen. That is not a failure to report — it is somebody choosing not to
     * sign in — so it goes back to the shell, which offers the way in again.
     */
    if (parameters.get('error')) {
      this.session.abandonSignIn();
      void this.router.navigateByUrl('/requests', { replaceUrl: true });
      return;
    }

    void this.session
      .completeSignIn(parameters.get('code'), parameters.get('state'))
      .then((returnTo) => this.router.navigateByUrl(returnTo, { replaceUrl: true }));
  }
}
