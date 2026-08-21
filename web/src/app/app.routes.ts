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
  { path: '', pathMatch: 'full', redirectTo: 'requests' },
  { path: '**', redirectTo: 'requests' },
];
