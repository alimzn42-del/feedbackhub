import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { DOCUMENT } from '@angular/common';
import { API_BASE_URL } from '../api/api-base-url';
import { toApiError, type ApiError } from '../api/api-error';
import type {
  Bootstrap,
  LanguageChoice,
  ResolvedSetting,
  SortOption,
  TaxonomyRef,
  ThemeChoice,
  Wrapped,
} from '../api/api.types';

/* ════════════════════════════════════════════════════════════════════════════
 *                          THE CONFIGURED APPLICATION
 *
 * One request at startup, and everything drawn from what it answers.
 *
 * WHY NOT provideAppInitializer
 * An initializer that blocks bootstrapping has nowhere to put a retry: the
 * application does not exist yet, so a failure is a blank page with a message
 * in the console. The shell renders instead, and gates its own outlet on this
 * resource — so a failed startup is a screen with a button on it.
 *
 * WHY A SERVICE AND NOT A RESOLVER
 * A route resolver would run per navigation and would have to be attached to
 * every route, including ones added later. This is answered once and shared.
 *
 * WHAT REFETCHES IT
 * Saving a setting. The colour scheme and the board's defaults come from here,
 * so a save that did not refresh this would leave the screen displaying a value
 * the server has moved on from — which is the same failure as a client that
 * merges settings itself, arriving by a different route.
 * ══════════════════════════════════════════════════════════════════════════ */
@Injectable({ providedIn: 'root' })
export class AppConfig {
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly document = inject(DOCUMENT);

  /**
   * Bumped to ask again. `httpResource` refetches when a signal its request
   * depends on changes, so the reload is a dependency rather than an imperative
   * call — which is what keeps a retry from racing with the first attempt.
   */
  private readonly attempt = signal(0);

  private readonly bootstrap = httpResource<Wrapped<Bootstrap>>(() => {
    this.attempt();
    return { url: `${this.baseUrl}/bootstrap` };
  });

  /**
   * True only while there is nothing to show.
   *
   * Not a bare isLoading: a refetch after saving a setting must not unmount the
   * outlet, which would take every screen below it — and its in-flight requests
   * — with it. That failure has already happened once in this codebase and is
   * written down as a convention because of it.
   */
  readonly isStarting = computed(() => this.bootstrap.isLoading() && !this.bootstrap.hasValue());

  readonly failure = computed<ApiError | null>(() => {
    const error = this.bootstrap.error();
    return error ? toApiError(error) : null;
  });

  /** Nothing renders on a fallback. Either the server answered, or it did not. */
  readonly isReady = computed(() => this.bootstrap.hasValue());

  retry(): void {
    this.attempt.update((n) => n + 1);
  }

  /** Refetch after a change that this payload describes. */
  reload(): void {
    this.attempt.update((n) => n + 1);
  }

  private readonly data = computed<Bootstrap | null>(() =>
    this.bootstrap.hasValue() ? (this.bootstrap.value()?.data ?? null) : null,
  );

  readonly user = computed(() => this.data()?.user ?? null);

  /**
   * What this caller may do where there is no row to hang the answer on.
   *
   * False while the payload is missing, which is the safe direction: a menu
   * item that fails to appear costs a click, and the endpoint behind it refuses
   * on its own regardless.
   */
  readonly capabilities = computed(
    () =>
      this.data()?.capabilities ?? {
        canManageCategories: false,
        canManageStatuses: false,
        canManageSettings: false,
      },
  );

  readonly categories = computed<TaxonomyRef[]>(() => this.data()?.taxonomy.categories ?? []);
  readonly statuses = computed<TaxonomyRef[]>(() => this.data()?.taxonomy.statuses ?? []);

  /**
   * One resolved setting, or null if this caller was not sent it.
   *
   * Null is the ordinary answer for an administrative setting seen by somebody
   * who is not an admin: it is withheld, not merely uneditable, so there is
   * nothing here to read.
   */
  setting<T>(key: string): ResolvedSetting<T> | null {
    return (this.data()?.settings[key] as ResolvedSetting<T> | undefined) ?? null;
  }

  private value<T>(key: string, fallback: T): T {
    return this.setting<T>(key)?.value ?? fallback;
  }

  /**
   * The board's opening state, resolved by the server across both levels.
   *
   * The fallbacks below are not a second copy of the defaults — they are what
   * this getter answers before the payload has arrived, and nothing renders
   * from them because the outlet does not exist until it has.
   */
  readonly defaultSort = computed<SortOption>(() => this.value<SortOption>('board.defaultSort', 'newest'));

  readonly defaultStatuses = computed<string[]>(() => this.value<string[]>('board.defaultStatuses', []));

  readonly defaultCategories = computed<string[]>(() =>
    this.value<string[]>('board.defaultCategories', []),
  );

  readonly theme = computed<ThemeChoice>(() => this.value<ThemeChoice>('profile.theme', 'system'));

  readonly language = computed<LanguageChoice>(() =>
    this.value<LanguageChoice>('profile.language', 'en'),
  );

  constructor() {
    /**
     * The colour scheme, applied to the document rather than to a component.
     *
     * `system` removes the attribute instead of writing a third value, so the
     * stylesheet's own prefers-color-scheme query is what decides — one
     * mechanism rather than two that have to agree. color-scheme follows, so
     * scrollbars and form controls the application does not style are dark too.
     */
    effect(() => {
      const root = this.document.documentElement;
      const choice = this.theme();

      if (choice === 'system') {
        root.removeAttribute('data-theme');
        root.style.removeProperty('color-scheme');
        return;
      }

      root.setAttribute('data-theme', choice);
      root.style.setProperty('color-scheme', choice);
    });

    /**
     * The document language, which is what a screen reader announces in and
     * what the date and number pipes format against.
     *
     * Honest about its scope: the interface copy is not translated. There is no
     * message catalogue, and a half-populated one would be worse than an
     * application that formats correctly and speaks one language.
     */
    effect(() => {
      this.document.documentElement.lang = this.language();
    });
  }
}
