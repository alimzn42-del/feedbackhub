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
  { path: '', pathMatch: 'full', redirectTo: 'requests' },
  { path: '**', redirectTo: 'requests' },
];
