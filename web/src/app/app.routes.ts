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
    // Reachable by anybody who types it. The screen renders the server's own
    // refusal rather than pretending the route does not exist, because hiding
    // it in the navigation was never the guarantee.
    path: 'admin/taxonomy',
    title: 'Categories and statuses · FeedbackHub',
    loadComponent: () =>
      import('./features/admin/admin-taxonomy/admin-taxonomy').then((m) => m.AdminTaxonomy),
  },
  { path: '', pathMatch: 'full', redirectTo: 'requests' },
  { path: '**', redirectTo: 'requests' },
];
