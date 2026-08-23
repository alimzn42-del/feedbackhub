import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { Translate } from './translate';
import { MESSAGES } from './messages';
import { AppConfig } from '../config/app-config';

/* ════════════════════════════════════════════════════════════════════════════
 * The catalogue, and the thing that reads it.
 *
 * The failure this guards against is not a crash. It is an English word in the
 * middle of a French sentence, which nobody notices in review and everybody
 * notices in use.
 * ══════════════════════════════════════════════════════════════════════════ */

function withLanguage(language: string): Translate {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: AppConfig, useValue: { language: signal(language) } }],
  });
  return TestBed.inject(Translate);
}

describe('the message catalogue', () => {
  /**
   * The types already enforce this at compile time. It is asserted at runtime
   * as well because a `Record<MessageKey, string>` is satisfied by a key whose
   * value is an empty string, and an empty label renders as a blank button.
   */
  it('translates every key, with nothing left blank', () => {
    const keys = Object.keys(MESSAGES.en) as (keyof typeof MESSAGES.en)[];

    expect(keys.length).toBeGreaterThan(100);

    const missing = keys.filter((key) => !MESSAGES.fr[key]?.trim());
    expect(missing).toEqual([]);
  });

  it('has no French entry that is simply the English left in place', () => {
    const keys = Object.keys(MESSAGES.en) as (keyof typeof MESSAGES.en)[];

    /**
     * A handful of words are the same in both languages and are meant to be.
     * Everything else being identical means somebody copied a line and did not
     * come back to it.
     */
    const sameByDesign = new Set([
      'board.votes',
      'board.oneVote',
      'board.pagination',
      'request.description',
      'comment.heading',
    ]);

    const untranslated = keys.filter(
      (key) => !sameByDesign.has(key) && MESSAGES.fr[key] === MESSAGES.en[key],
    );

    expect(untranslated).toEqual([]);
  });

  it('keeps the placeholders in both languages the same', () => {
    const placeholders = (text: string) => (text.match(/\{(\w+)\}/g) ?? []).sort().join(',');
    const keys = Object.keys(MESSAGES.en) as (keyof typeof MESSAGES.en)[];

    // A French message that dropped a {count} would render a sentence with a
    // number missing from it, and nothing would fail.
    const mismatched = keys.filter(
      (key) => placeholders(MESSAGES.en[key]) !== placeholders(MESSAGES.fr[key]),
    );

    expect(mismatched).toEqual([]);
  });
});

describe('looking a message up', () => {
  it('answers in the language the person chose', () => {
    expect(withLanguage('en').t('nav.board')).toBe('Board');
    expect(withLanguage('fr').t('nav.board')).toBe('Tableau');
  });

  it('follows the preference as it changes, without anything being rebuilt', () => {
    const language = signal('en');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: AppConfig, useValue: { language } }],
    });
    const translate = TestBed.inject(Translate);

    expect(translate.t('nav.settings')).toBe('Settings');

    language.set('fr');

    // The same instance, the same call, a different answer: this is what makes
    // changing language take effect without a reload.
    expect(translate.t('nav.settings')).toBe('Paramètres');
  });

  it('fills placeholders from the parameters', () => {
    expect(withLanguage('en').t('board.page', { page: 2, total: 5 })).toBe('Page 2 of 5');
    expect(withLanguage('fr').t('board.page', { page: 2, total: 5 })).toBe('Page 2 sur 5');
  });

  /**
   * A visible `{count}` is a bug somebody reports. A blank is a bug nobody
   * notices, so a placeholder with nothing to fill it is left as written.
   */
  it('leaves a placeholder alone rather than blanking it', () => {
    expect(withLanguage('en').t('board.page', { page: 2 })).toBe('Page 2 of {total}');
  });

  it('falls back to English for a language it does not have', () => {
    expect(withLanguage('de').t('nav.board')).toBe('Board');
  });
});
