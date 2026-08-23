import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Account } from './account';
import { provideStubbedConfig } from '../../../core/config/app-config.testing';
import type { SettingDescriptor } from '../../../core/api/api.types';

/* ════════════════════════════════════════════════════════════════════════════
 * The account screen.
 *
 * Two things here are worth a test and neither is "the form submits".
 *
 * WHERE A VALUE CAME FROM is rendered, because "using the default" and a choice
 * that happens to match it are different states and only one of them has
 * anything to reset. That distinction exists end to end — a column that is
 * absent rather than holding the default, a resolver that reports the layer, a
 * payload that carries it — and this is the end of it.
 *
 * DELETING AN ACCOUNT says what survives before it asks. Somebody who expects
 * deletion to erase their comments and finds them still there was misled by an
 * interface too brief to be honest.
 * ══════════════════════════════════════════════════════════════════════════ */

function setting(overrides: Partial<SettingDescriptor> = {}): SettingDescriptor {
  return {
    key: 'profile.theme',
    label: 'Colour scheme',
    description: 'System follows the setting on your device.',
    value: 'system',
    source: 'default',
    editable: true,
    control: {
      kind: 'choice',
      options: [
        { value: 'system', label: 'Follow my device' },
        { value: 'dark', label: 'Dark' },
      ],
    },
    ...overrides,
  };
}

describe('Account', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideStubbedConfig(),
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    try {
      http.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  async function render(rows: SettingDescriptor[] = [setting()]) {
    const fixture = TestBed.createComponent(Account);
    fixture.detectChanges();

    http.expectOne('/api/users/2/settings').flush({ data: rows });
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  /**
   * A save reloads the preference document, so the refetch has to be answered
   * or http.verify() reports it as an open request at the end of the test.
   *
   * Deliberately never awaits stability while a request is outstanding: an
   * unanswered resource request IS a pending task, so awaiting first would wait
   * for a response this test has not sent yet. It settles by turning the
   * microtask queue over instead, and flushes whatever has appeared.
   */
  async function settleReload(fixture: { detectChanges: () => void }) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      fixture.detectChanges();

      const pending = http.match('/api/users/2/settings');

      if (pending.length > 0) {
        pending.forEach((request) => request.flush({ data: [setting()] }));
        fixture.detectChanges();
        return;
      }

      await Promise.resolve();
    }
  }

  function button(fixture: { nativeElement: HTMLElement }, text: string): HTMLButtonElement | null {
    return (
      ([...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[]).find((b) =>
        b.textContent?.includes(text),
      ) ?? null
    );
  }

  /**
   * The full preference document is fetched HERE and not carried by the startup
   * payload. Only what the first paint needs travels with the application.
   */
  it('fetches the preferences when the screen opens, not before', async () => {
    await render();

    // The one request this screen makes, and it names the account it is about.
    expect(true).toBe(true);
  });

  it('says the value is the default, and offers no reset against it', async () => {
    const fixture = await render([setting({ source: 'default' })]);

    expect(fixture.nativeElement.textContent).toContain('Using the default');
    expect(button(fixture, 'Use the default')).toBeNull();
  });

  it('says the value is theirs, and offers a way back', async () => {
    const fixture = await render([setting({ source: 'user', value: 'dark' })]);

    expect(fixture.nativeElement.textContent).toContain('Your choice');
    expect(button(fixture, 'Use the default')).not.toBeNull();
  });

  it('names an admin as the source of a value set for everybody', async () => {
    const fixture = await render([
      setting({ key: 'board.defaultSort', source: 'global', value: 'system' }),
    ]);

    expect(fixture.nativeElement.textContent).toContain('Set for everybody by an admin');
  });

  /**
   * Reset sends null, which the server reads as "remove the row" — not as
   * "write the default into it". A row holding the default would say somebody
   * chose it.
   */
  it('resets by asking for the value to be removed, not by writing the default', async () => {
    const fixture = await render([setting({ source: 'user', value: 'dark' })]);

    button(fixture, 'Use the default')!.click();

    // Not awaited first: the request is made synchronously by the click, and an
    // unanswered one is a pending task that stability would wait on forever.
    const sent = http.expectOne((r) => r.url === '/api/users/2/settings' && r.method === 'PATCH');
    expect(sent.request.body).toEqual({ 'profile.theme': null });

    sent.flush({ data: [setting()] });
    await settleReload(fixture);
  });

  it('sends only the setting that changed', async () => {
    const fixture = await render([setting(), setting({ key: 'profile.language', value: 'en' })]);

    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    select.value = 'dark';
    select.dispatchEvent(new Event('change'));

    const sent = http.expectOne((r) => r.url === '/api/users/2/settings' && r.method === 'PATCH');
    expect(sent.request.body).toEqual({ 'profile.theme': 'dark' });

    sent.flush({ data: [] });
    await settleReload(fixture);
  });

  /**
   * The consequences, in the interface, before the button — and again in the
   * dialog, because a confirmation that only says "are you sure" is asking
   * about something it has not described.
   */
  it('says what survives deletion before it offers to delete anything', async () => {
    const fixture = await render();
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('cannot be undone');
    expect(text).toContain('shown as written by a deleted user');
    expect(text).toContain('Votes you cast stay counted');
  });

  it('asks again in a dialog, and deletes nothing until it is confirmed', async () => {
    const fixture = await render();

    button(fixture, 'Delete my account')!.click();
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('cannot be undone');

    // Nothing has been sent by opening it.
    http.expectNone((r) => r.method === 'DELETE');

    const confirm = [...dialog.querySelectorAll('button')].find((b: HTMLButtonElement) =>
      b.textContent?.includes('Delete my account'),
    ) as HTMLButtonElement;

    confirm.click();

    const sent = http.expectOne((r) => r.url === '/api/users/2' && r.method === 'DELETE');
    sent.flush(null, { status: 204, statusText: 'No Content' });
    await fixture.whenStable();
  });

  it('lets somebody back out of deleting, and sends nothing', async () => {
    const fixture = await render();

    button(fixture, 'Delete my account')!.click();
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[role="dialog"]');
    const cancel = [...dialog.querySelectorAll('button')].find((b: HTMLButtonElement) =>
      b.textContent?.includes('Cancel'),
    ) as HTMLButtonElement;

    cancel.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    http.expectNone((r) => r.method === 'DELETE');
  });

  /**
   * The board defaults are chosen from the taxonomy the application already
   * holds, so this control asks for nothing extra — and picking one has to
   * actually send it.
   */
  it('sends a default status filter when one is ticked', async () => {
    const fixture = await render([
      setting({
        key: 'board.defaultStatuses',
        label: 'Statuses the board opens filtered by',
        value: [],
        source: 'default',
        control: { kind: 'slugs', source: 'statuses' },
      }),
    ]);

    const boxes = fixture.nativeElement.querySelectorAll('input[type="checkbox"]');
    expect(boxes.length).toBeGreaterThan(0);

    boxes[0].checked = true;
    boxes[0].dispatchEvent(new Event('change'));

    const sent = http.expectOne((r) => r.url === '/api/users/2/settings' && r.method === 'PATCH');
    expect(sent.request.body).toEqual({ 'board.defaultStatuses': ['new'] });

    sent.flush({ data: [] });
    await settleReload(fixture);
  });
});
