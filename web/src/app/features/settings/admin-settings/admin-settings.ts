import { Component, computed, inject, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { AppConfig } from '../../../core/config/app-config';
import { toApiError, type ApiError } from '../../../core/api/api-error';
import type { SettingDescriptor, Wrapped } from '../../../core/api/api.types';
import { SettingControl } from '../setting-control/setting-control';
import { SettingsApi } from '../data/settings.api';
import { Translate } from '../../../core/i18n/translate';

/**
 * The application settings, and the queue the one feature flag creates.
 *
 * Refused at the route before it is hidden in the navigation: a regular user
 * who types this address gets the server's own 403, rendered, rather than an
 * empty screen that implies there was nothing here.
 *
 * The queue lives on this screen rather than a separate one because it only
 * exists while the setting above it is on, and an admin who turns the setting
 * on should not then have to go looking for what it did.
 */
@Component({
  selector: 'app-admin-settings',
  imports: [RouterLink, SettingControl],
  templateUrl: './admin-settings.html',
  styleUrl: './admin-settings.scss',
})
export class AdminSettings {
  /** The message catalogue, in the language this person chose. */
  protected readonly t = inject(Translate).t;

  private readonly api = inject(SettingsApi);
  private readonly config = inject(AppConfig);

  protected readonly settings = httpResource<Wrapped<SettingDescriptor[]>>(() => ({
    url: this.api.appSettingsUrl,
  }));

  protected readonly rows = computed<SettingDescriptor[]>(() =>
    this.settings.hasValue() ? (this.settings.value()?.data ?? []) : [],
  );

  protected readonly registration = computed(() =>
    this.rows().filter((row) => row.key.startsWith('registration.')),
  );

  protected readonly moderation = computed(() =>
    this.rows().filter((row) => row.key.startsWith('comments.')),
  );

  protected readonly limits = computed(() =>
    this.rows().filter((row) => row.key.startsWith('submissions.')),
  );

  protected readonly boardDefaults = computed(() =>
    this.rows().filter((row) => row.key.startsWith('board.')),
  );

  protected readonly loadFailure = computed<ApiError | null>(() => {
    const error = this.settings.error();
    return error ? toApiError(error) : null;
  });

  /** A 403 here is the ordinary case, not a fault: somebody typed the URL. */
  protected readonly refused = computed(() => this.loadFailure()?.status === 403);

  protected readonly saving = signal(false);
  protected readonly failure = signal<ApiError | null>(null);
  protected readonly saved = signal(false);

  protected change(key: string, value: unknown): void {
    this.saving.set(true);
    this.failure.set(null);
    this.saved.set(false);

    this.api.updateApp({ [key]: value }).subscribe({
      next: () => {
        this.settings.reload();
        // The board's defaults are in the startup payload, so an admin changing
        // one has to see it take effect rather than at the next reload.
        this.config.reload();
        this.saving.set(false);
        this.saved.set(true);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.failure.set(toApiError(error));
      },
    });
  }

  protected retry(): void {
    this.settings.reload();
  }
}
