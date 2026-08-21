import { InjectionToken } from '@angular/core';

/**
 * A relative base path on purpose. In development the CLI proxy
 * (web/proxy.conf.json) forwards /api to the API; in a deployment the same
 * relative path is served by whatever sits in front of both. There is no
 * absolute URL to configure, and therefore no build-time environment file to
 * get wrong.
 *
 * It is a token rather than a constant so a different origin can be injected
 * later without editing every service.
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => '/api',
});
