import type { Actor } from '../../auth/actor.js';
import { MisconfigurationError, ValidationError } from '../../http/errors.js';
import { toOffset, toPageMeta, type Paginated } from '../../http/pagination.js';
import { authorize } from '../../policy/index.js';
import { requestPolicy } from '../../policy/requests.policy.js';
import * as requestsRepository from './requests.repository.js';
import * as categoriesRepository from '../categories/categories.repository.js';
import * as statusesRepository from '../statuses/statuses.repository.js';
import type {
  CreateRequestBody,
  FeedbackRequestDetail,
  FeedbackRequestListItem,
  ListRequestsQuery,
} from './requests.schema.js';

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

  const created = await requestsRepository.findById(id);

  if (!created) {
    throw new MisconfigurationError('The request was created but could not be read back.');
  }

  return created;
}

export async function list(
  actor: Actor,
  query: ListRequestsQuery,
): Promise<Paginated<FeedbackRequestListItem>> {
  authorize(requestPolicy.list(actor));

  const { items, total } = await requestsRepository.list(query.pageSize, toOffset(query));

  return { data: items, page: toPageMeta(query, total) };
}
