import {
  Component,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

/**
 * A modal confirmation.
 *
 * Written out rather than delegating to the native `<dialog>` element. The
 * native one traps focus and closes on Escape for free, which is the whole
 * requirement — and a test could then only assert that `showModal()` was
 * called, which proves the method was reached and nothing about the behaviour.
 * The trap is the feature, so it is code with tests on it.
 *
 * What it does, in order: moves focus into the dialog when it opens, keeps Tab
 * and Shift+Tab inside it, closes on Escape, and puts focus back on whatever
 * opened it. The last one matters most: without it a keyboard user who cancels
 * is dropped at the top of the document with no idea where they were.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [],
  templateUrl: './confirm-dialog.html',
  styleUrl: './confirm-dialog.scss',
  host: {
    '(keydown)': 'onKeydown($event)',
  },
})
export class ConfirmDialog {
  readonly title = input.required<string>();
  readonly body = input.required<string>();

  /** The wording of the destructive action. Never "OK": say what happens. */
  readonly confirmLabel = input('Delete');
  readonly cancelLabel = input('Cancel');

  /** Disables both buttons while the action it confirmed is in flight. */
  readonly busy = input(false);

  readonly confirmed = output<void>();
  readonly cancelled = output<void>();

  private readonly host = inject(ElementRef<HTMLElement>);

  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');

  /** Whatever had focus when this opened, so it can be given back. */
  private readonly opener = document.activeElement as HTMLElement | null;

  constructor() {
    afterNextRender(() => {
      // Cancel first, not the destructive button: an accidental Enter should
      // not delete a discussion.
      this.focusable()[0]?.focus();
    });
  }

  private focusable(): HTMLElement[] {
    return Array.from(
      this.panel().nativeElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    );
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }

    if (event.key !== 'Tab') return;

    const elements = this.focusable();
    if (elements.length === 0) return;

    const first = elements[0]!;
    const last = elements[elements.length - 1]!;
    const active = document.activeElement;

    // Wrapping by hand, because focus is only trapped if it cannot leave in
    // either direction. Shift+Tab off the first element is the one people
    // forget, and it is how you fall out of a dialog backwards.
    if (event.shiftKey && (active === first || !this.host.nativeElement.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  protected confirm(): void {
    this.confirmed.emit();
  }

  protected close(): void {
    this.restoreFocus();
    this.cancelled.emit();
  }

  /**
   * Called by the parent when the dialog is dismissed after a successful
   * action, so focus does not vanish on that path either.
   */
  restoreFocus(): void {
    this.opener?.focus?.();
  }
}
