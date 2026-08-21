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
    this.comments().reduce(
      (running, comment) => running + 1 + comment.replies.length,
      0,
    ),
  );

  /* ── Composing ─────────────────────────────────────────────────────────── */

  protected readonly newComment = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, notBlank, Validators.maxLength(BODY_MAX)],
  });

  protected readonly replyBody = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, notBlank, Validators.maxLength(BODY_MAX)],
  });

  protected readonly editBody = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, notBlank, Validators.maxLength(BODY_MAX)],
  });

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
    this.replyBody.setValue('');
    this.replyBody.markAsUntouched();
    this.replyingTo.set(this.replyingTo() === comment.id ? null : comment.id);
  }

  protected openEdit(comment: Comment): void {
    this.replyingTo.set(null);
    this.editBody.setValue(comment.body ?? '');
    this.editBody.markAsUntouched();
    this.editing.set(this.editing() === comment.id ? null : comment.id);
  }

  protected cancel(): void {
    this.replyingTo.set(null);
    this.editing.set(null);
  }

  protected submitComment(): void {
    if (!this.guard(this.newComment)) return;

    this.run(this.api.create(this.requestId(), { body: this.newComment.value.trim() }), () => {
      this.newComment.setValue('');
      this.newComment.markAsUntouched();
    });
  }

  protected submitReply(parent: Comment): void {
    if (!this.guard(this.replyBody)) return;

    this.run(
      this.api.create(this.requestId(), {
        body: this.replyBody.value.trim(),
        parentId: parent.id,
      }),
      () => this.replyingTo.set(null),
    );
  }

  protected submitEdit(comment: Comment): void {
    if (!this.guard(this.editBody)) return;

    this.run(this.api.edit(comment.id, this.editBody.value.trim()), () =>
      this.editing.set(null),
    );
  }

  /**
   * Deleting is not optimistic. The server decides whether the row goes or
   * becomes a tombstone, and whether replies are hidden with it — guessing
   * would mean rendering one outcome and correcting it a moment later.
   */
  protected remove(comment: Comment): void {
    if (this.busy()) return;

    this.run(this.api.remove(comment.id), () => {
      this.replyingTo.set(null);
      this.editing.set(null);
    });
  }

  private guard(control: FormControl<string>): boolean {
    if (this.busy()) return false;

    if (control.invalid || control.value.trim().length === 0) {
      control.markAsTouched();
      return false;
    }

    return true;
  }

  /**
   * Every mutation ends the same way: stop being busy, reload the thread, tell
   * the page its count moved. The thread is reloaded rather than patched because
   * a delete can turn a comment into a tombstone, remove it entirely, or hide
   * several replies with it — three different shapes to guess at.
   */
  private run(call: Observable<unknown>, onDone: () => void): void {
    this.busy.set(true);
    this.failure.set(null);

    call.subscribe({
      next: () => {
        onDone();
        this.busy.set(false);
        this.thread.reload();
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
