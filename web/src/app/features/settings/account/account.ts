import { Component, computed, effect, inject, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AppConfig } from '../../../core/config/app-config';
import { toApiError, type ApiError } from '../../../core/api/api-error';
import type { SettingDescriptor, Wrapped } from '../../../core/api/api.types';
import { ConfirmDialog } from '../../../shared/confirm-dialog/confirm-dialog';
import { SettingControl } from '../setting-control/setting-control';
import { SettingsApi } from '../data/settings.api';
import { Translate } from '../../../core/i18n/translate';

const DISPLAY_NAME_MAX = 120;

/**
 * The person's own screen: who they are, how the board looks to them, and the
 * way out.
 *
 * The full preference document is fetched HERE rather than carried by the
 * bootstrap payload. Only the settings that decide what the first paint looks
 * like travel with the application; an email preference changes nothing until
 * somebody opens this screen, so it is asked for when they do.
 */
@Component({
  selector: 'app-account',
  imports: [ReactiveFormsModule, RouterLink, SettingControl, ConfirmDialog],
  templateUrl: './account.html',
  styleUrl: './account.scss',
})
export class Account {
  /** The message catalogue, in the language this person chose. */
  protected readonly t = inject(Translate).t;

  private readonly api = inject(SettingsApi);
  private readonly router = inject(Router);
  protected readonly config = inject(AppConfig);

  protected readonly limits = { DISPLAY_NAME_MAX };

  private readonly userId = computed(() => this.config.user()?.id ?? null);

  protected readonly settings = httpResource<Wrapped<SettingDescriptor[]>>(() => {
    const id = this.userId();
    return id === null ? undefined : { url: this.api.userSettingsUrl(id) };
  });

  protected readonly rows = computed<SettingDescriptor[]>(() =>
    this.settings.hasValue() ? (this.settings.value()?.data ?? []) : [],
  );

  /** Theirs alone: nothing at the installation level has an opinion about these. */
  protected readonly presentation = computed(() =>
    this.rows().filter((row) => row.key.startsWith('profile.')),
  );

  /**
   * The three that exist at both levels, kept in their own section so the
   * relationship to the administrative screen is visible rather than implied.
   */
  protected readonly boardDefaults = computed(() =>
    this.rows().filter((row) => row.key.startsWith('board.')),
  );

  protected readonly notifications = computed(() =>
    this.rows().filter((row) => row.key.startsWith('notifications.')),
  );

  protected readonly loadFailure = computed<ApiError | null>(() => {
    const error = this.settings.error();
    return error ? toApiError(error) : null;
  });

  protected readonly saving = signal(false);
  protected readonly saveFailure = signal<ApiError | null>(null);
  protected readonly saved = signal(false);

  /* ── The display name ──────────────────────────────────────────────────── */

  protected readonly displayName = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(DISPLAY_NAME_MAX)],
  });

  /**
   * Seeded once the payload arrives, and not on every change afterwards — an
   * effect that kept writing into the control would fight whoever is typing.
   */
  private readonly seedName = effect(() => {
    const name = this.config.user()?.displayName;
    if (name !== undefined && this.displayName.pristine) {
      this.displayName.setValue(name);
    }
  });

  protected saveName(): void {
    const id = this.userId();
    if (id === null || this.displayName.invalid) {
      this.displayName.markAsTouched();
      return;
    }

    this.begin();

    this.api.updateProfile(id, this.displayName.value.trim()).subscribe({
      next: () => {
        // reset(), not setValue(): clearing a control is three things, and a
        // control left dirty would immediately be reseeded by the effect above.
        this.displayName.reset(this.displayName.value.trim());
        this.finish();
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  /* ── Preferences ───────────────────────────────────────────────────────── */

  /**
   * One control changed, one key sent.
   *
   * Not a whole document: two things this application never does are letting
   * one save undo another, and sending a value the person did not touch. A
   * change is the key they changed and nothing else.
   */
  protected change(key: string, value: unknown): void {
    const id = this.userId();
    if (id === null) return;

    this.begin();

    this.api.updateUser(id, { [key]: value }).subscribe({
      next: () => {
        this.settings.reload();
        // The colour scheme, the language and the board's defaults are in the
        // startup payload, so it has to be asked again or the screen would show
        // a value the application is not using.
        this.config.reload();
        this.finish();
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  /* ── Leaving ───────────────────────────────────────────────────────────── */

  protected readonly confirmingDeletion = signal(false);

  protected confirmDeletion(): void {
    const id = this.userId();
    if (id === null) return;

    this.confirmingDeletion.set(false);
    this.begin();

    this.api.deleteAccount(id).subscribe({
      next: () => {
        // Their identity no longer exists, so everything the application holds
        // about it is stale. Reloading is the honest thing: the next request
        // establishes whoever they are now.
        this.config.reload();
        void this.router.navigate(['/requests']);
      },
      error: (error: unknown) => this.fail(error),
    });
  }

  private begin(): void {
    this.saving.set(true);
    this.saveFailure.set(null);
    this.saved.set(false);
  }

  private finish(): void {
    this.saving.set(false);
    this.saved.set(true);
  }

  private fail(error: unknown): void {
    this.saving.set(false);
    this.saveFailure.set(toApiError(error));
  }

  protected retry(): void {
    this.settings.reload();
  }
}
