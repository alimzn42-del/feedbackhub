import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfirmDialog } from './confirm-dialog';

/* ════════════════════════════════════════════════════════════════════════════
 * The confirmation dialog.
 *
 * The trap IS the feature here, so it is tested by pressing keys rather than by
 * asserting that a method was called. A test that checks `showModal()` was
 * reached proves the call site exists and nothing about whether focus can
 * escape — which is the only thing anybody cares about.
 * ══════════════════════════════════════════════════════════════════════════ */

describe('ConfirmDialog', () => {
  let opener: HTMLButtonElement;

  beforeEach(() => {
    TestBed.configureTestingModule({});

    // Something outside the dialog that had focus first, so the restore has
    // somewhere real to put it back.
    opener = document.createElement('button');
    opener.textContent = 'Delete request';
    document.body.appendChild(opener);
    opener.focus();
  });

  afterEach(() => {
    opener.remove();
    TestBed.resetTestingModule();
  });

  async function render() {
    const fixture = TestBed.createComponent(ConfirmDialog);
    fixture.componentRef.setInput('title', 'Delete this request?');
    fixture.componentRef.setInput('body', 'This removes the request and every comment on it.');
    fixture.componentRef.setInput('confirmLabel', 'Delete request');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function buttons(fixture: Awaited<ReturnType<typeof render>>): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('button'));
  }

  function press(fixture: Awaited<ReturnType<typeof render>>, init: KeyboardEventInit): boolean {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    fixture.nativeElement.firstElementChild!.dispatchEvent(event);
    fixture.detectChanges();
    return event.defaultPrevented;
  }

  it('says what will happen, rather than asking to confirm an unnamed action', async () => {
    const fixture = await render();
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Delete this request?');
    expect(text).toContain('every comment on it');
    // Never "OK": the button says what it does.
    expect(buttons(fixture).map((button) => button.textContent?.trim())).toContain(
      'Delete request',
    );
  });

  it('is a modal dialog to assistive technology, not a styled div', async () => {
    const fixture = await render();
    const panel = fixture.nativeElement.querySelector('[role="dialog"]');

    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.getAttribute('aria-labelledby')).toBeTruthy();
  });

  it('opens with focus on cancel, not on the destructive button', async () => {
    const fixture = await render();

    // An accidental Enter on arrival must not delete a discussion.
    expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
  });

  it('keeps Tab inside the dialog', async () => {
    const fixture = await render();
    const [cancel, confirm] = buttons(fixture);

    confirm!.focus();
    const prevented = press(fixture, { key: 'Tab' });

    // Tab off the last control wraps to the first instead of leaving.
    expect(prevented).toBe(true);
    expect(document.activeElement).toBe(cancel);
  });

  it('keeps Shift+Tab inside the dialog, which is the one people forget', async () => {
    const fixture = await render();
    const [cancel, confirm] = buttons(fixture);

    cancel!.focus();
    const prevented = press(fixture, { key: 'Tab', shiftKey: true });

    expect(prevented).toBe(true);
    expect(document.activeElement).toBe(confirm);
  });

  it('closes on Escape', async () => {
    const fixture = await render();
    let cancelled = 0;
    fixture.componentInstance.cancelled.subscribe(() => (cancelled += 1));

    const prevented = press(fixture, { key: 'Escape' });

    expect(prevented).toBe(true);
    expect(cancelled).toBe(1);
  });

  it('gives focus back to whatever opened it', async () => {
    const fixture = await render();

    press(fixture, { key: 'Escape' });

    // Without this a keyboard user who cancels is dropped at the top of the
    // document with no idea where they were.
    expect(document.activeElement).toBe(opener);
  });

  it('emits the confirmation only when the destructive button is clicked', async () => {
    const fixture = await render();
    let confirmed = 0;
    fixture.componentInstance.confirmed.subscribe(() => (confirmed += 1));

    const [cancel, confirm] = buttons(fixture);

    cancel!.click();
    expect(confirmed).toBe(0);

    confirm!.click();
    expect(confirmed).toBe(1);
  });

  it('disables both buttons while the action it confirmed is in flight', async () => {
    const fixture = await render();
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();

    // Otherwise a second click sends a second delete for something already gone.
    expect(buttons(fixture).every((button) => button.disabled)).toBe(true);
  });
});
