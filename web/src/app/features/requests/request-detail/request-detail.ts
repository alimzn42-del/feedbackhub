import { Component, computed, inject, input, numberAttribute, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { RequestsApi } from '../data/requests.api';
import { toApiError, type ApiError } from '../../../core/api/api-error';
import { CommentThread } from '../../comments/comment-thread/comment-thread';
import { ConfirmDialog } from '../../../shared/confirm-dialog/confirm-dialog';
import { RequestEdit } from '../request-edit/request-edit';
import type { FeedbackRequestDetail, TaxonomyRef, Wrapped } from '../../../core/api/api.types';

/** Which action is in flight, so only its own control shows a pending state. */
type Pending = 'status' | 'pin' | 'delete' | null;

/**
 * One request in full, with its discussion and everything that acts on it.
 *
 * Which actions appear is decided by the server, per row: `canEdit`,
 * `canDelete`, `canChangeStatus` and `canPin` arrive with the request, the same
 * way `canVote` does. Hiding a control is a courtesy — every one of these
 * endpoints refuses on its own, and the page never carries a second copy of a
 * rule that could disagree with the first.
 */
@Component({
  selector: 'app-request-detail',
  imports: [RouterLink, DatePipe, CommentThread, RequestEdit, ConfirmDialog],
  templateUrl: './request-detail.html',
  styleUrl: './request-detail.scss',
})
export class RequestDetail {
  private readonly api = inject(RequestsApi);
  private readonly router = inject(Router);

  /** Bound from the route by withComponentInputBinding. */
  readonly id = input.required({ transform: numberAttribute });

  protected readonly request = httpResource<Wrapped<FeedbackRequestDetail>>(() => ({
    url: this.api.detailUrl(this.id()),
  }));

  protected readonly item = computed(() =>
    this.request.hasValue() ? (this.request.value()?.data ?? null) : null,
  );

  protected readonly error = computed(() => {
    const failure = this.request.error();
    return failure ? toApiError(failure) : null;
  });

  /**
   * Loading with nothing to show yet, which is the only time the page is
   * replaced by a loading state.
   *
   * A plain isLoading() here tore the whole page down on every refetch — and
   * with it the comment thread, which was then re-created and re-fetched
   * because pinning had reloaded the request above it. The thread had nothing
   * to do with the pin.
   */
  protected readonly isFirstLoad = computed(
    () => this.request.isLoading() && this.item() === null,
  );

  /**
   * Whether the status control is on screen at all.
   *
   * Pulled out as its own computed so the resource below depends on a BOOLEAN
   * rather than on the request object. Depending on the object meant every
   * successful action produced a new one and refetched the taxonomy, which
   * cannot have changed and which nobody asked for.
   */
  private readonly canChangeStatus = computed(() => this.item()?.canChangeStatus ?? false);

  /**
   * The statuses an admin can move this request to. Only fetched when the
   * caller may actually change one — a regular user has no use for the list and
   * no control to put it in.
   */
  private readonly statuses = httpResource<Wrapped<TaxonomyRef[]>>(() =>
    this.canChangeStatus() ? { url: this.api.statusesUrl } : undefined,
  );

  protected readonly statusOptions = computed(() =>
    this.statuses.hasValue() ? (this.statuses.value()?.data ?? []) : [],
  );

  /* ── Action state ──────────────────────────────────────────────────────── */

  protected readonly editing = signal(false);
  protected readonly confirmingDelete = signal(false);
  protected readonly pending = signal<Pending>(null);
  protected readonly actionFailure = signal<ApiError | null>(null);

  /** The status the select is showing, which may not be the saved one yet. */
  protected readonly chosenStatus = signal<number | null>(null);

  protected readonly selectedStatusId = computed(
    () => this.chosenStatus() ?? this.item()?.status.id ?? null,
  );

  protected readonly statusChanged = computed(
    () => this.selectedStatusId() !== (this.item()?.status.id ?? null),
  );

  protected isPending(action: Exclude<Pending, null>): boolean {
    return this.pending() === action;
  }

  /**
   * What went wrong with an action, in words that match what happened.
   *
   * A 403 will not come good by trying again; a dropped connection might; and a
   * 404 means somebody deleted this request while the page was open, which is
   * its own situation and needs a way out rather than a retry.
   */
  protected readonly actionMessage = computed<string | null>(() => {
    const failure = this.actionFailure();
    if (!failure) return null;

    if (failure.status === 404) {
      return 'This request no longer exists. Somebody deleted it while this page was open.';
    }

    return failure.message;
  });

  protected readonly isGone = computed(() => this.actionFailure()?.status === 404);

  /** Handed to the thread so a new or removed comment refreshes the count here. */
  protected readonly refresh = (): void => {
    this.request.reload();
  };

  /* ── Editing ───────────────────────────────────────────────────────────── */

  protected startEdit(): void {
    this.actionFailure.set(null);
    this.editing.set(true);
  }

  protected onSaved(updated: FeedbackRequestDetail): void {
    this.editing.set(false);
    // The server sent the request back, so it is applied rather than refetched:
    // asking again would be asking for something already in hand.
    this.request.set({ data: updated });
  }

  protected cancelEdit(): void {
    this.editing.set(false);
  }

  /* ── Status ────────────────────────────────────────────────────────────── */

  protected onStatusSelected(value: string): void {
    const id = Number(value);
    this.chosenStatus.set(Number.isFinite(id) ? id : null);
  }

  protected applyStatus(): void {
    const id = this.selectedStatusId();
    const current = this.item();

    if (id === null || !current || !this.statusChanged() || this.pending() !== null) {
      return;
    }

    this.begin('status');

    this.api.changeStatus(current.id, id).subscribe({
      next: ({ data }) => {
        this.finish();
        this.chosenStatus.set(null);
        this.request.set({ data });
      },
      error: (raw: unknown) => this.fail(raw),
    });
  }

  /* ── Pinning ───────────────────────────────────────────────────────────── */

  protected togglePin(): void {
    const current = this.item();
    if (!current || this.pending() !== null) return;

    this.begin('pin');

    const call = current.isPinned ? this.api.unpin(current.id) : this.api.pin(current.id);

    call.subscribe({
      // The pin endpoints answer with a list row, which carries less than this
      // page shows, so this one is refetched rather than patched from it.
      next: () => {
        this.finish();
        this.request.reload();
      },
      error: (raw: unknown) => this.fail(raw),
    });
  }

  /* ── Deleting ──────────────────────────────────────────────────────────── */

  protected askDelete(): void {
    this.actionFailure.set(null);
    this.confirmingDelete.set(true);
  }

  protected cancelDelete(): void {
    this.confirmingDelete.set(false);
  }

  /**
   * Confirmed, because this destroys a discussion rather than a single remark:
   * the votes and every comment go with it.
   */
  protected confirmDelete(): void {
    const current = this.item();
    if (!current || this.pending() !== null) return;

    this.begin('delete');

    this.api.remove(current.id).subscribe({
      next: () => {
        this.finish();
        this.confirmingDelete.set(false);
        // Back to the board rather than left on a URL that now 404s.
        void this.router.navigate(['/requests']);
      },
      error: (raw: unknown) => {
        this.confirmingDelete.set(false);
        this.fail(raw);
      },
    });
  }

  /* ── Shared plumbing ───────────────────────────────────────────────────── */

  private begin(action: Exclude<Pending, null>): void {
    this.actionFailure.set(null);
    this.pending.set(action);
  }

  private finish(): void {
    this.pending.set(null);
  }

  private fail(raw: unknown): void {
    this.pending.set(null);
    this.actionFailure.set(toApiError(raw));
  }

  protected voteLabel(item: FeedbackRequestDetail): string {
    const votes = `${item.voteCount} ${item.voteCount === 1 ? 'vote' : 'votes'}`;

    if (!item.canVote) {
      return `You cannot vote on your own request. ${votes}.`;
    }

    return `${item.hasVoted ? 'Remove your vote from' : 'Vote for'} "${item.title}". ${votes}.`;
  }
}
