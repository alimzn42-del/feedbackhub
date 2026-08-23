import { Component, computed, inject, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AppConfig } from '../../../core/config/app-config';
import { RouterLink } from '@angular/router';
import type { FeedbackRequestListItem } from '../../../core/api/api.types';

/** How many are visible before the panel is expanded. */
const COLLAPSED_COUNT = 3;

/**
 * The pinned shelf above the board.
 *
 * Presentational on purpose: it renders what it is given and emits intent.
 * Voting and unpinning are the same operations the list performs, so they live
 * in one place there rather than being reimplemented here with their own
 * optimistic updates to keep in step.
 *
 * Pinned requests do not also appear in the list below — the server excludes
 * them — so a request is in exactly one place on the page.
 */
@Component({
  selector: 'app-pinned-panel',
  imports: [DatePipe, RouterLink],
  templateUrl: './pinned-panel.html',
  styleUrl: './pinned-panel.scss',
})
export class PinnedPanel {
  /**
   * The locale dates are written in. Passed to the pipe rather than provided
   * as LOCALE_ID, which is fixed before the person's preference has arrived.
   */
  protected readonly locale = inject(AppConfig).language;

  readonly items = input.required<FeedbackRequestListItem[]>();

  /** Every pinned request, which can exceed what the endpoint returned. */
  readonly total = input.required<number>();

  readonly pendingIds = input<ReadonlySet<number>>(new Set<number>());

  readonly vote = output<FeedbackRequestListItem>();
  readonly unpin = output<FeedbackRequestListItem>();

  protected readonly expanded = signal(false);

  protected readonly visible = computed(() =>
    this.expanded() ? this.items() : this.items().slice(0, COLLAPSED_COUNT),
  );

  /** How many more the panel can reveal without another request. */
  protected readonly expandable = computed(() =>
    Math.max(0, this.items().length - COLLAPSED_COUNT),
  );

  /**
   * Pinned requests beyond what the endpoint will return. Pinning is unlimited
   * by decision, so this can be non-zero; saying so is better than quietly
   * showing a subset as if it were everything.
   */
  protected readonly beyondCap = computed(() => Math.max(0, this.total() - this.items().length));

  protected toggle(): void {
    this.expanded.update((open) => !open);
  }

  protected isBusy(id: number): boolean {
    return this.pendingIds().has(id);
  }

  protected voteLabel(item: FeedbackRequestListItem): string {
    const votes = `${item.voteCount} ${item.voteCount === 1 ? 'vote' : 'votes'}`;

    if (!item.canVote) {
      return `You cannot vote on your own request. ${votes}.`;
    }

    return `${item.hasVoted ? 'Remove your vote from' : 'Vote for'} "${item.title}". ${votes}.`;
  }
}
