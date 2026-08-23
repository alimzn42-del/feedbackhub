import { inject, Injectable } from '@angular/core';
import { AppConfig } from '../config/app-config';
import { MESSAGES, type Language, type MessageKey } from './messages';

/**
 * Looks a message up in the language the person chose.
 *
 * WHY A FUNCTION AND NOT A PIPE
 *
 * A pipe would work, and every component would have to import it. This is one
 * injected property that templates call, and it reads the language signal on
 * every call — so changing language re-renders whatever displayed a message,
 * with no subscription anywhere and no reload. That is the whole reason this
 * catalogue is a runtime one rather than Angular's build-time i18n.
 *
 * Bound as an arrow property so a component can hand `t` straight to its
 * template without losing `this`.
 */
@Injectable({ providedIn: 'root' })
export class Translate {
  private readonly config = inject(AppConfig);

  /** The chosen language, for anything that needs the tag itself. */
  readonly language = this.config.language;

  /**
   * `{name}` placeholders are replaced from `params`.
   *
   * A missing placeholder is left as written rather than blanked: a visible
   * `{count}` in the interface is a bug somebody reports, and an empty space is
   * a bug nobody notices.
   */
  readonly t = (key: MessageKey, params?: Record<string, string | number>): string => {
    const language = this.language() as Language;
    const catalogue = MESSAGES[language] ?? MESSAGES.en;

    // The catalogues are typed against the same keys, so this cannot miss —
    // the fallback is for a language that has not been added to MESSAGES yet.
    const message: string = catalogue[key] ?? MESSAGES.en[key];

    if (!params) return message;

    return message.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in params ? String(params[name]) : whole,
    );
  };

  /**
   * The two-form plural these messages need, and no more.
   *
   * Not a plural library: English and French agree on where the boundary is for
   * every count this application shows, and inventing a rules engine for two
   * languages that behave the same would be machinery nobody asked for.
   */
  readonly plural = (
    count: number,
    one: MessageKey,
    many: MessageKey,
    params?: Record<string, string | number>,
  ): string => this.t(count === 1 ? one : many, { count, ...params });
}
