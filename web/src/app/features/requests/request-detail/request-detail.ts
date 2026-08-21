import { Component, computed, inject, input, numberAttribute } from '@angular/core';
import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { RequestsApi } from '../data/requests.api';
import { toApiError } from '../../../core/api/api-error';
import { CommentThread } from '../../comments/comment-thread/comment-thread';
import type { FeedbackRequestDetail, Wrapped } from '../../../core/api/api.types';

/**
 * One request in full, with its discussion.
 *
 * The board only ever sends an excerpt, so until this page existed the complete
 * description had nowhere to be read — and a comment thread had no URL anyone
 * could send to a colleague.
 */
@Component({
  selector: 'app-request-detail',
  imports: [RouterLink, DatePipe, CommentThread],
  templateUrl: './request-detail.html',
  styleUrl: './request-detail.scss',
})
export class RequestDetail {
  private readonly api = inject(RequestsApi);

  /** Bound from the route by withComponentInputBinding. */
  readonly id = input.required({ transform: numberAttribute });

  protected readonly request = httpResource<Wrapped<FeedbackRequestDetail>>(() => ({
    url: this.api.detailUrl(this.id()),
  }));

  protected readonly item = computed(() => this.request.value()?.data ?? null);

  protected readonly error = computed(() => {
    const failure = this.request.error();
    return failure ? toApiError(failure) : null;
  });

  /** Handed to the thread so a new or removed comment refreshes the count here. */
  protected readonly refresh = (): void => {
    this.request.reload();
  };

  protected voteLabel(item: FeedbackRequestDetail): string {
    const votes = `${item.voteCount} ${item.voteCount === 1 ? 'vote' : 'votes'}`;

    if (!item.canVote) {
      return `You cannot vote on your own request. ${votes}.`;
    }

    return `${item.hasVoted ? 'Remove your vote from' : 'Vote for'} "${item.title}". ${votes}.`;
  }
}
