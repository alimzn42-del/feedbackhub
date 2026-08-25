import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'requests',
    title: 'Feedback requests · FeedbackHub',
    loadComponent: () =>
      import('./features/requests/request-list/request-list').then((m) => m.RequestList),
  },
  {
    path: 'requests/new',
    title: 'New request · FeedbackHub',
    loadComponent: () =>
      import('./features/requests/request-create/request-create').then((m) => m.RequestCreate),
  },
  {
    // After 'requests/new', so that segment is never parsed as an id.
    path: 'requests/:id',
    title: 'Request · FeedbackHub',
    loadComponent: () =>
      import('./features/requests/request-detail/request-detail').then((m) => m.RequestDetail),
  },
  {
    path: 'account',
    title: 'Your account · FeedbackHub',
    loadComponent: () => import('./features/settings/account/account').then((m) => m.Account),
  },
  {
    // Same rule as the taxonomy screen below: reachable by anybody who types
    // it, and it renders the server's 403 rather than guarding the route.
    path: 'admin/settings',
    title: 'Application settings · FeedbackHub',
    loadComponent: () =>
      import('./features/settings/admin-settings/admin-settings').then((m) => m.AdminSettings),
  },
  {
    // Reachable by anybody who types it. The screen renders the server's own
    // refusal rather than pretending the route does not exist, because hiding
    // it in the navigation was never the guarantee.
    path: 'admin/taxonomy',
    title: 'Categories and statuses · FeedbackHub',
    loadComponent: () =>
      import('./features/admin/admin-taxonomy/admin-taxonomy').then((m) => m.AdminTaxonomy),
  },
  {
    // Where Keycloak returns to, and the one address registered with it. It
    // renders under the shell like everything else, but the shell lets it
    // through while there is no session — it is what produces one.
    path: 'auth/callback',
    title: 'Signing in · FeedbackHub',
    loadComponent: () =>
      import('./core/auth/auth-callback/auth-callback').then((m) => m.AuthCallback),
  },
  { path: '', pathMatch: 'full', redirectTo: 'requests' },
  { path: '**', redirectTo: 'requests' },
];
