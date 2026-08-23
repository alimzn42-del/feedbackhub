import { Component, computed, inject, signal } from '@angular/core';
import { httpResource, HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { AppConfig } from '../../../core/config/app-config';
import { API_BASE_URL } from '../../../core/api/api-base-url';
import { toApiError, type ApiError } from '../../../core/api/api-error';
import type { PendingComment, SettingDescriptor, Wrapped } from '../../../core/api/api.types';
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
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);
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

  /**
   * Whether comments are currently held. Read from the settings document rather
   * than from a second source, so the queue below cannot disagree with the
   * control above it.
   */
  protected readonly approvalOn = computed(
    () => this.rows().find((row) => row.key === 'comments.requireApproval')?.value === true,
  );

  /* ── The moderation queue ──────────────────────────────────────────────── */

  private readonly queueAttempt = signal(0);

  protected readonly pending = httpResource<{ data: PendingComment[]; total: number }>(() => {
    this.queueAttempt();
    // Fetched whatever the setting says: turning approval off releases what is
    // waiting, but a comment written while it was on and never approved is
    // still worth showing an admin until somebody deals with it.
    return { url: `${this.baseUrl}/comments/pending` };
  });

  protected readonly pendingComments = computed<PendingComment[]>(() =>
    this.pending.hasValue() ? (this.pending.value()?.data ?? []) : [],
  );

  protected readonly pendingTotal = computed(() =>
    this.pending.hasValue() ? (this.pending.value()?.total ?? 0) : 0,
  );

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

  protected approve(id: number): void {
    this.saving.set(true);
    this.failure.set(null);

    this.http.put(`${this.baseUrl}/comments/${id}/approval`, {}).subscribe({
      next: () => {
        this.queueAttempt.update((n) => n + 1);
        this.saving.set(false);
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
