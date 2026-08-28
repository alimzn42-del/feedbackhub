import type { Actor } from '../../auth/actor.js';
import { ConflictError, NotFoundError } from '../../http/errors.js';
import { authorize } from '../../policy/index.js';
import { votePolicy } from '../../policy/votes.policy.js';
import * as requestsRepository from '../requests/requests.repository.js';
import * as votesRepository from './votes.repository.js';
import type { VoteState } from './votes.repository.js';

/**
 * Loads just enough of the request to decide, and 404s if it is not there.
 *
 * A missing request really is missing, so this one is a 404 rather than a 403 —
 * decision 5 is about not disguising refusals as absences, not about pretending
 * absences are refusals.
 */
async function subjectOf(requestId: number): Promise<{ authorId: number }> {
  const authorId = await requestsRepository.findAuthorId(requestId);

  if (authorId === null) {
    throw new NotFoundError('That request does not exist.');
  }

  return { authorId };
}

/**
 * The vote is always the caller's own: the user id comes from the identity seam
 * and neither the URL nor the payload has anywhere to put a different one.
 */
export async function cast(actor: Actor, requestId: number): Promise<VoteState> {
  const subject = await subjectOf(requestId);

  authorize(votePolicy.cast(actor, subject));

  const outcome = await votesRepository.cast(requestId, actor.id);

  if (outcome === 'request-missing') {
    // The request was there when its author was read, a moment ago, and is not
    // there now. The same answer as if it had been gone all along — what a
    // caller must not be told is that they have already voted on it.
    throw new NotFoundError('That request does not exist.');
  }

  if (outcome === 'already-voted') {
    // One user, one request, at most once — so a second cast is a conflict with
    // the state, not a silent success. The UI toggles rather than casting
    // twice, so reaching this means two tabs, a retry, or a stale page.
    throw new ConflictError('You have already voted on this request.');
  }

  return votesRepository.readState(requestId, actor.id);
}

export async function withdraw(actor: Actor, requestId: number): Promise<VoteState> {
  // Called for its 404: withdrawing from a request that does not exist is not
  // a quiet success.
  await subjectOf(requestId);

  authorize(votePolicy.withdraw(actor));

  // Withdrawing a vote that is not there is not an error: the caller wanted
  // their vote gone and it is gone. Unlike casting, repeating this changes
  // nothing, so there is no conflicting state to report.
  await votesRepository.withdraw(requestId, actor.id);

  return votesRepository.readState(requestId, actor.id);
}
