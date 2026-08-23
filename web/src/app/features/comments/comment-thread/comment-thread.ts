import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import {
  FormControl,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import type { Observable } from 'rxjs';
import { CommentsApi } from '../data/comments.api';
import { toApiError } from '../../../core/api/api-error';
import type { Comment, Wrapped } from '../../../core/api/api.types';

const BODY_MAX = 5000;

/**
 * Validators.required accepts a string of spaces, and the server does not — it
 * trims before checking length. Without this the user gets silence instead of a
 * message when they submit whitespace.
 */
function notBlank(control: AbstractControl): ValidationErrors | null {
  return typeof control.value === 'string' && control.value.trim().length === 0
    ? { blank: true }
    : null;
}

@Component({
  selector: 'app-comment-thread',
  imports: [ReactiveFormsModule, DatePipe],
  templateUrl: './comment-thread.html',
  styleUrl: './comment-thread.scss',
})
export class CommentThread {
  private readonly api = inject(CommentsApi);

  readonly requestId = input.required<number>();

  /** Told when the thread changes size, so the page can refresh its count. */
  readonly changed = input<(() => void) | null>(null);

  protected readonly thread = httpResource<Wrapped<Comment[]>>(() => ({
    url: this.api.threadUrl(this.requestId()),
  }));

  protected readonly comments = computed(() => this.thread.value()?.data ?? []);

  protected readonly loadFailure = computed(() => {
    const failure = this.thread.error();
    return failure ? toApiError(failure) : null;
  });

  protected readonly total = computed(() =>
    this.comments().reduce((running, comment) => running + 1 + comment.replies.length, 0),
  );

  /* ── Composing ─────────────────────────────────────────────────────────── */

  private newControl(): FormControl<string> {
    return new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, notBlank, Validators.maxLength(BODY_MAX)],
    });
  }

  protected readonly newComment = this.newControl();
  protected readonly replyBody = this.newControl();
  protected readonly editBody = this.newControl();

  /** At most one reply box and one edit box open at a time, by id. */
  protected readonly replyingTo = signal<number | null>(null);
  protected readonly editing = signal<number | null>(null);

  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly limits = { BODY_MAX };

  constructor() {
    // Moving to another request must not leave a half-typed reply attached to a
    // comment that is no longer on screen.
    effect(() => {
      this.requestId();
      this.replyingTo.set(null);
      this.editing.set(null);
      this.failure.set(null);
    });
  }

  protected openReply(comment: Comment): void {
    this.editing.set(null);
    // Pristine as well as untouched: typing in this box and closing it left it
    // dirty, so reopening it showed a validation message before a key was
    // pressed.
    this.replyBody.reset();
    this.replyingTo.set(this.replyingTo() === comment.id ? null : comment.id);
  }

  protected openEdit(comment: Comment): void {
    this.replyingTo.set(null);
    this.editBody.reset(comment.body ?? '');
    this.editing.set(this.editing() === comment.id ? null : comment.id);
  }

  protected cancel(): void {
    this.replyingTo.set(null);
    this.editing.set(null);
  }

  /**
   * Each composer is a single control rather than a form group, so no Angular
   * directive is attached to its <form> element — and `ngSubmit` is an output of
   * NgForm or FormGroupDirective, not of <form> itself.
   *
   * Binding `(ngSubmit)` here was silent and wrong: Angular registered a
   * listener for a DOM event named "ngSubmit" that nothing ever raises, the
   * browser performed its own submit, and the page reloaded with the typed text
   * discarded. The native `submit` event is used instead, with its default
   * prevented explicitly.
   */
  protected submitComment(event: Event): void {
    event.preventDefault();
    if (!this.guard(this.newComment)) return;

    this.send(
      this.api.create(this.requestId(), { body: this.newComment.value.trim() }),
      (posted) => {
        // Inserted in place rather than refetched: the server has already sent
        // back the comment it saved, so asking for the whole thread again would
        // be a round trip to learn something already known.
        this.insert(posted);
        // reset(), not setValue('') — it clears the value AND marks the control
        // pristine and untouched together. Clearing the value alone left the
        // control dirty from having been typed in, so the emptied box
        // immediately failed `required` and told the author to "write something
        // first" about the comment they had just posted successfully.
        this.newComment.reset();
      },
    );
  }

  protected submitReply(event: Event, parent: Comment): void {
    event.preventDefault();
    if (!this.guard(this.replyBody)) return;

    this.send(
      this.api.create(this.requestId(), {
        body: this.replyBody.value.trim(),
        parentId: parent.id,
      }),
      (posted) => {
        this.insert(posted);
        this.replyingTo.set(null);
      },
    );
  }

  protected submitEdit(event: Event, comment: Comment): void {
    event.preventDefault();
    if (!this.guard(this.editBody)) return;

    this.send(this.api.edit(comment.id, this.editBody.value.trim()), (updated) => {
      this.replace(updated);
      this.editing.set(null);
    });
  }

  /**
   * Deleting is the one action that still refetches, and not for want of trying.
   * The server decides whether the row goes, becomes a tombstone, or takes
   * several replies down with it — three shapes, chosen by rules the browser
   * does not hold. Guessing would mean rendering one and correcting it.
   */
  protected remove(comment: Comment): void {
    if (this.busy()) return;

    this.busy.set(true);
    this.failure.set(null);

    this.api.remove(comment.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.replyingTo.set(null);
        this.editing.set(null);
        this.thread.reload();
        this.changed()?.();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.failure.set(toApiError(error).message);
      },
    });
  }

  /* ── Thread updates ────────────────────────────────────────────────────── */

  private patch(update: (comments: Comment[]) => Comment[]): void {
    this.thread.update((current) =>
      current ? { ...current, data: update(current.data) } : current,
    );
  }

  private insert(comment: Comment): void {
    if (comment.parentId === null) {
      this.patch((comments) => [...comments, comment]);
      return;
    }

    this.patch((comments) =>
      comments.map((root) =>
        root.id === comment.parentId ? { ...root, replies: [...root.replies, comment] } : root,
      ),
    );
  }

  private replace(comment: Comment): void {
    this.patch((comments) =>
      comments.map((root) =>
        root.id === comment.id
          ? { ...comment, replies: root.replies }
          : { ...root, replies: root.replies.map((r) => (r.id === comment.id ? comment : r)) },
      ),
    );
  }

  private guard(control: FormControl<string>): boolean {
    if (this.busy()) return false;

    if (control.invalid) {
      control.markAsTouched();
      return false;
    }

    return true;
  }

  private send(call: Observable<Wrapped<Comment>>, onSuccess: (comment: Comment) => void): void {
    this.busy.set(true);
    this.failure.set(null);

    call.subscribe({
      next: ({ data }) => {
        onSuccess(data);
        this.busy.set(false);
        this.changed()?.();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.failure.set(toApiError(error).message);
      },
    });
  }

  protected tombstone(comment: Comment): string {
    switch (comment.deletedReason) {
      case 'moderator':
        return 'An admin removed this comment.';
      case 'with-parent':
        return 'Removed along with the comment it replied to.';
      default:
        return 'The author removed this comment.';
    }
  }

  protected errorFor(control: FormControl<string>): string | null {
    if (!control.invalid || !(control.dirty || control.touched)) return null;
    if (control.errors?.['maxlength']) {
      return `A comment cannot be longer than ${BODY_MAX} characters.`;
    }
    return 'Write something first.';
  }
}
