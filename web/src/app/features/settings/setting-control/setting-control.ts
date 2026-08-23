import { Component, computed, inject, input, output } from '@angular/core';
import { AppConfig } from '../../../core/config/app-config';
import type { SettingDescriptor } from '../../../core/api/api.types';

/**
 * One setting, whichever kind it is.
 *
 * The screens do not know which control belongs to which setting — the server
 * says, in the same registry entry that holds the setting's validator and its
 * default. A screen that decided for itself would be a second list of the
 * settings, in another language, in another repository, and a setting added
 * without that second edit would simply never appear.
 *
 * It emits the value and writes nothing. Saving belongs to the screen, which is
 * the thing that knows which address a change is sent to.
 */
@Component({
  selector: 'app-setting-control',
  imports: [],
  templateUrl: './setting-control.html',
  styleUrl: './setting-control.scss',
})
export class SettingControl {
  private readonly config = inject(AppConfig);

  readonly setting = input.required<SettingDescriptor>();

  /** Disabled while a save is in flight, so a second change cannot overtake it. */
  readonly busy = input(false);

  /**
   * Which level this control writes.
   *
   * The same three settings appear on both screens, because they exist at both
   * levels — that is the feature. What made it read as a duplicate was that
   * neither copy said which one it was setting, so the administrative screen and
   * the personal one were word for word identical. The level decides the wording
   * below, and nothing else.
   */
  readonly level = input<'global' | 'user'>('user');

  /** The new value, or null to reset it to whatever the layer below says. */
  readonly changed = output<unknown>();

  protected readonly control = computed(() => this.setting().control);

  protected readonly asBoolean = computed(() => this.setting().value === true);
  protected readonly asString = computed(() => String(this.setting().value ?? ''));
  protected readonly asNumber = computed(() => Number(this.setting().value ?? 0));

  protected readonly asList = computed<string[]>(() => {
    const value = this.setting().value;
    return Array.isArray(value) ? (value as string[]) : [];
  });

  /** One string per line, which is how a person edits a short list. */
  protected readonly asLines = computed(() => this.asList().join('\n'));

  /**
   * The taxonomy a slug list chooses from, already in memory: it arrived with
   * the application, so this screen asks for nothing extra.
   */
  protected readonly options = computed(() => {
    const control = this.control();
    if (control.kind !== 'slugs') return [];
    return control.source === 'statuses' ? this.config.statuses() : this.config.categories();
  });

  /**
   * Where the value came from, in words.
   *
   * This is the whole reason `source` is sent. "Using the default" and a choice
   * that happens to match it look identical in the value alone, and only one of
   * them has anything to reset.
   */
  protected readonly origin = computed(() => {
    const source = this.setting().source;

    if (this.level() === 'global') {
      // There is no personal value for the whole installation, so `user` is not
      // a source this screen can be shown. The server resolves the global
      // document without anybody's own rows for exactly that reason.
      return source === 'global' ? 'Set for everybody' : 'Not set — using the built-in default';
    }

    switch (source) {
      case 'user':
        return 'Your choice';
      case 'global':
        return 'Following the board default';
      default:
        return 'Using the default';
    }
  });

  /**
   * What resetting goes back TO, which is different on the two screens: the
   * installation falls back to what this build ships with, and a person falls
   * back to whatever the board is set to.
   */
  protected readonly resetLabel = computed(() =>
    this.level() === 'global' ? 'Use the built-in default' : 'Use the board default',
  );

  /** Only an explicit choice can be reset; there is nothing behind a default. */
  protected readonly canReset = computed(() => this.setting().source !== 'default');

  protected toggle(event: Event): void {
    this.changed.emit((event.target as HTMLInputElement).checked);
  }

  protected choose(event: Event): void {
    this.changed.emit((event.target as HTMLSelectElement).value);
  }

  protected setNumber(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    // Sent as written. An empty box is not zero, and inventing a number here
    // would hide the refusal the server is about to give.
    this.changed.emit(raw === '' ? raw : Number(raw));
  }

  protected setLines(event: Event): void {
    const lines = (event.target as HTMLTextAreaElement).value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    this.changed.emit(lines);
  }

  protected toggleSlug(slug: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const current = this.asList();

    this.changed.emit(checked ? [...current, slug] : current.filter((s) => s !== slug));
  }

  protected reset(): void {
    this.changed.emit(null);
  }

  protected isSelected(slug: string): boolean {
    return this.asList().includes(slug);
  }
}
