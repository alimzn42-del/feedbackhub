import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { registerLocaleData } from '@angular/common';
import localeDe from '@angular/common/locales/de';
import localeFr from '@angular/common/locales/fr';
import { routes } from './app.routes';

/**
 * The formatting data for the languages the settings screen offers.
 *
 * Registered here rather than provided as LOCALE_ID, because LOCALE_ID is
 * resolved once when the injector is created and the person's choice does not
 * arrive until the bootstrap request answers. The date pipe takes a locale as
 * an argument instead, so the choice can change without a reload — which is
 * what a preference is supposed to do.
 */
registerLocaleData(localeFr);
registerLocaleData(localeDe);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // withComponentInputBinding binds route query parameters straight to
    // component inputs, which is what keeps list state in the URL rather than
    // in a component field.
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch()),
  ],
};
