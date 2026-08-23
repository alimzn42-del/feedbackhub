import { Component, computed, inject } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { API_BASE_URL } from './core/api/api-base-url';
import type { Capabilities, Wrapped } from './core/api/api.types';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly baseUrl = inject(API_BASE_URL);

  /**
   * What this caller may do that is not attached to a row.
   *
   * Asked once, for the navigation. Every list item already carries its own
   * answers because there is a row to hang them on; a whole screen has none,
   * and the menu still has to decide whether to offer it.
   *
   * This is not what protects the screen. The endpoints behind it refuse on
   * their own, and the route renders that refusal — so this being wrong, or
   * failing, costs a menu item and nothing else.
   */
  private readonly capabilities = httpResource<Wrapped<Capabilities>>(() => ({
    url: `${this.baseUrl}/capabilities`,
  }));

  protected readonly canManageTaxonomy = computed(() => {
    if (!this.capabilities.hasValue()) return false;

    const answers = this.capabilities.value()?.data;
    return (answers?.canManageCategories ?? false) || (answers?.canManageStatuses ?? false);
  });
}
