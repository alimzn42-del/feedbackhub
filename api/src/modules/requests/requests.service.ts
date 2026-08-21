import type { Actor } from '../../auth/actor.js';
import { MisconfigurationError, NotFoundError, ValidationError } from '../../http/errors.js';
import { toOffset, toPageMeta, type Paginated } from '../../http/pagination.js';
import { authorize } from '../../policy/index.js';
import { requestPolicy } from '../../policy/requests.policy.js';
import { votePolicy } from '../../policy/votes.policy.js';
import * as categoriesRepository from '../categories/categories.repository.js';
import * as statusesRepository from '../statuses/statuses.repository.js';
import * as requestsRepository from './requests.repository.js';
import {
  MAX_PINNED_RETURNED,
  type CreateRequestBody,
  type FeedbackRequestDetail,
  type FeedbackRequestListItem,
  type ListRequestsQuery,
} from './requests.schema.js';

/**
 * Attaches the two "may I" answers the browser cannot work out for itself.
 *
 * It is never told who it is, and even if it were, reimplementing the rules
 * client-side would mean two copies free to disagree. The server decides and
 * sends the answer, per row.
 */
function withPermissions<T extends { author: { id: number } }>(
  actor: Actor,
  row: T,
): T & { canVote: boolean; canPin: boolean } {
  return {
    ...row,
    canVote: votePolicy.cast(actor, { authorId: row.author.id }).allowed,
    canPin: requestPolicy.setPinned(actor).allowed,
  };
}

/**
 * Every entry point asks the policy module first and does nothing before it has
 * an answer. The check is not conditional on what the handler then does.
 */
export async function create(
  actor: Actor,
  body: CreateRequestBody,
): Promise<FeedbackRequestDetail> {
  authorize(requestPolicy.create(actor));

  const categoryId = await categoriesRepository.findActiveId(body.categoryId);

  if (categoryId === null) {
    // A category that does not exist is a bad value in a field the user chose,
    // so it belongs next to that field rather than as a bare 404.
    throw new ValidationError('The submitted values are not valid.', [
      {
        field: 'categoryId',
        code: 'NOT_FOUND',
        message: 'That category does not exist or is no longer available.',
      },
    ]);
  }

  const statusId = await statusesRepository.findDefaultId();

  if (statusId === null) {
    // The unique key on statuses guarantees at most one default, not at least
    // one. If an admin has cleared it, fail loudly and say what to fix rather
    // than inventing a status or writing a NULL.
    throw new MisconfigurationError(
      'No default status is configured, so new requests cannot be filed. ' +
        'An admin must mark one status as the default.',
    );
  }

  const id = await requestsRepository.insert({
    title: body.title,
    description: body.description,
    categoryId,
    statusId,
    // Authorship comes from the identity seam, never from the payload.
    authorId: actor.id,
  });

  const created = await requestsRepository.findById(id, actor.id);

  if (!created) {
    throw new MisconfigurationError('The request was created but could not be read back.');
  }

  return withPermissions(actor, created);
}

export async function list(
  actor: Actor,
  query: ListRequestsQuery,
): Promise<Paginated<FeedbackRequestListItem>> {
  authorize(requestPolicy.list(actor));

  const { items, total } = await requestsRepository.list({
    limit: query.pageSize,
    offset: toOffset(query),
    viewerId: actor.id,
  });

  return {
    data: items.map((item) => withPermissions(actor, item)),
    page: toPageMeta(query, total),
  };
}

export async function findById(actor: Actor, id: number): Promise<FeedbackRequestDetail> {
  authorize(requestPolicy.read(actor));

  const found = await requestsRepository.findById(id, actor.id);

  if (!found) {
    throw new NotFoundError('That request does not exist.');
  }

  return withPermissions(actor, found);
}

export interface PinnedResult {
  data: FeedbackRequestListItem[];
  /** Every pinned request, including any the cap held back. */
  total: number;
}

/**
 * Pinned requests are not paginated — the panel shows a few and expands to
 * scroll the rest — so this returns them in one response, capped for safety.
 */
export async function listPinned(actor: Actor): Promise<PinnedResult> {
  authorize(requestPolicy.list(actor));

  const { items, total } = await requestsRepository.listPinned(actor.id, MAX_PINNED_RETURNED);

  return { data: items.map((item) => withPermissions(actor, item)), total };
}

/**
 * Pin and unpin are admin-only, and re-pinning is not an error: it refreshes
 * who and when, which is what makes the panel ordering mean something. There is
 * no state to conflict with, so no 409 here.
 *
 * Existence is checked separately rather than read from affectedRows, which
 * counts CHANGED rows — unpinning something already unpinned changes nothing
 * and would otherwise look like a missing request.
 */
async function setPinned(
  actor: Actor,
  id: number,
  apply: () => Promise<void>,
): Promise<FeedbackRequestListItem> {
  authorize(requestPolicy.setPinned(actor));

  if (!(await requestsRepository.exists(id))) {
    throw new NotFoundError('That request does not exist.');
  }

  await apply();

  const updated = await requestsRepository.findListItemById(id, actor.id);

  if (!updated) {
    throw new MisconfigurationError('The request changed but could not be read back.');
  }

  return withPermissions(actor, updated);
}

export function pin(actor: Actor, id: number): Promise<FeedbackRequestListItem> {
  return setPinned(actor, id, () => requestsRepository.pin(id, actor.id));
}

export function unpin(actor: Actor, id: number): Promise<FeedbackRequestListItem> {
  return setPinned(actor, id, () => requestsRepository.unpin(id));
}
