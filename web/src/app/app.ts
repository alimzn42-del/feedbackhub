import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AppConfig } from './core/config/app-config';
import { Session } from './core/auth/session';
import { Translate } from './core/i18n/translate';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  /** The message catalogue, in the language this person chose. */
  protected readonly t = inject(Translate).t;

  /**
   * The one request the application makes before it can draw anything.
   *
   * The shell renders around it: while it is in flight there is a loading
   * state, if it fails there is an error with a retry, and the outlet exists
   * only once it has answered. Nothing below here runs on a hardcoded fallback,
   * because nothing below here is mounted until there is a real answer.
   */
  protected readonly config = inject(AppConfig);

  protected readonly canManageTaxonomy = computed(() => {
    const may = this.config.capabilities();
    return may.canManageCategories || may.canManageStatuses;
  });

  protected readonly canManageSettings = computed(
    () => this.config.capabilities().canManageSettings,
  );

  /**
   * How many comments are waiting, or null when there is nothing to say.
   *
   * This is the whole discovery path for comment approval. Without it a waiting
   * comment sits in a thread nobody has a reason to open, and the setting that
   * held it back does nothing at all.
   *
   * Null when moderation is off or when this caller cannot approve — and the
   * header then renders nothing, rather than a badge showing zero.
   */
  protected readonly pendingComments = this.config.pendingComments;

  /** Shown in the navigation, so it is obvious which account the board is being read as. */
  protected readonly displayName = computed(() => this.config.user()?.displayName ?? '');

  /**
   * Who is calling, resolved before anything below the shell is mounted.
   *
   * This is what replaces a route guard. The outlet does not exist until the
   * session has an answer, so no screen can render against an identity that has
   * not arrived — including a screen added later, which is covered because it
   * cannot be mounted rather than because somebody remembered to list it.
   *
   * One mechanism, not two. A guard per route and a gate on the outlet would be
   * the same rule written twice, and the day they disagreed the one that was
   * wrong would be the one nobody was reading.
   */
  protected readonly session = inject(Session);

  protected signIn(): void {
    void this.session.signIn();
  }
}
