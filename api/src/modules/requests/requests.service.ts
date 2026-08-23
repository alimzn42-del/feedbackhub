import type { Actor } from '../../auth/actor.js';
import {
  MisconfigurationError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from '../../http/errors.js';
import { toOffset, toPageMeta, type Paginated } from '../../http/pagination.js';
import { authorize } from '../../policy/index.js';
import { requestPolicy } from '../../policy/requests.policy.js';
import { votePolicy } from '../../policy/votes.policy.js';
import * as categoriesRepository from '../categories/categories.repository.js';
import { globalValue } from '../settings/settings.service.js';
import * as statusesRepository from '../statuses/statuses.repository.js';
import * as requestsRepository from './requests.repository.js';
import type { ListFilters } from './requests.repository.js';
import {
  DEFAULT_SORT,
  MAX_PINNED_RETURNED,
  isFiltered,
  type ChangeStatusBody,
  type CreateRequestBody,
  type ListPinnedQuery,
  type UpdateRequestBody,
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
): T & { canVote: boolean; canPin: boolean; canEdit: boolean; canDelete: boolean; canChangeStatus: boolean } {
  const subject = { authorId: row.author.id };

  return {
    ...row,
    canVote: votePolicy.cast(actor, subject).allowed,
    canPin: requestPolicy.setPinned(actor).allowed,
    // Asked of the same rules the endpoints ask. The interface hides what it is
    // told to hide; the server refuses regardless, so this is a courtesy and
    // never the guarantee.
    canEdit: requestPolicy.editContent(actor, subject).allowed,
    canDelete: requestPolicy.delete(actor, subject).allowed,
    canChangeStatus: requestPolicy.changeStatus(actor).allowed,
  };
}

/**
 * Every entry point asks the policy module first and does nothing before it has
 * an answer. The check is not conditional on what the handler then does.
 */
/**
 * Whether comments still waiting for approval count towards what this viewer
 * sees — which is what the comment count on a request has to agree with.
 *
 * An admin sees them because judging them is their job. Everybody else sees
 * them only while the gate is open, in which case nothing is waiting on
 * anybody. Their own comments are visible either way, and that half of the rule
 * lives in the SQL, where it belongs to the row rather than to the caller.
 *
 * Every read below asks this. A count that disagreed with the thread underneath
 * it is precisely the failure the moderation decision was parked with a warning
 * about.
 */
async function seesPendingComments(actor: Actor): Promise<boolean> {
  if (actor.role === 'admin') return true;
  return !(await globalValue('comments.requireApproval'));
}

/** The window the submission limit is counted over. */
const RATE_LIMIT_WINDOW_HOURS = 24;

/**
 * How many requests one person may file in a rolling day.
 *
 * The limit is a setting, not a constant — the number is an operational
 * judgement that changes with the size of the board, and changing it should not
 * be a deploy. It is read on every submission for the same reason the identity
 * seam reads the user on every request: an admin who lowers it wants that to be
 * true now, not after a restart.
 *
 * Enforced here rather than as middleware on the route. Middleware counting
 * HTTP calls would refuse a submission that was about to fail validation
 * anyway, and would have to know which routes count as "a submission" from the
 * outside. This is the one place that knows a request was actually filed.
 */
async function assertNotRateLimited(actor: Actor): Promise<void> {
  const limit = await globalValue('submissions.perUserPerDay');
  const { filed, oldestInWindow } = await requestsRepository.countRecentByAuthor(
    actor.id,
    RATE_LIMIT_WINDOW_HOURS,
  );

  if (filed < limit) return;

  // A slot comes back when the earliest submission still inside the window ages
  // out of it. oldestInWindow is non-null whenever filed > 0, and filed is at
  // least the limit to be here — but the fallback keeps the arithmetic total
  // rather than trusting that across a future change.
  const freesAt = oldestInWindow
    ? oldestInWindow.getTime() + RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000
    : Date.now();

  throw new RateLimitedError(
    `You have filed ${filed} ${filed === 1 ? 'request' : 'requests'} in the last day, which is ` +
      'as many as this board allows.',
    (freesAt - Date.now()) / 1000,
  );
}

export async function create(
  actor: Actor,
  body: CreateRequestBody,
): Promise<FeedbackRequestDetail> {
  authorize(requestPolicy.create(actor));

  // Before the category is looked up and before anything is written: being
  // refused for filing too often is not a fact about the payload, and finding
  // out only after the form has been validated would read as the board being
  // slow to say no.
  await assertNotRateLimited(actor);

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

  const created = await requestsRepository.findById(
    id,
    actor.id,
    await seesPendingComments(actor),
  );

  if (!created) {
    throw new MisconfigurationError('The request was created but could not be read back.');
  }

  return withPermissions(actor, created);
}

/**
 * Turns the slugs in the URL into the ids the query filters on, and refuses the
 * ones that name nothing.
 *
 * Refusing rather than ignoring is the point. A typo in a filter value would
 * otherwise return the unfiltered board, which looks exactly like a filter that
 * matched everything — the user reads a wrong answer as a right one. This is
 * the same call made for an unknown category on create, and it is reported the
 * same way: a 422 naming the field and the value.
 *
 * The lookup deliberately includes archived rows, so a link shared before a
 * category was retired still opens.
 */
async function resolveSlugs(
  field: 'category' | 'status',
  slugs: readonly string[] | undefined,
  lookup: (slugs: readonly string[]) => Promise<{ id: number; slug: string }[]>,
): Promise<number[] | undefined> {
  if (!slugs || slugs.length === 0) {
    return undefined;
  }

  const found = await lookup(slugs);
  const known = new Set(found.map((row) => row.slug));
  const unknown = slugs.filter((slug) => !known.has(slug));

  if (unknown.length > 0) {
    // One entry per bad value rather than one for the parameter: the filter bar
    // can then drop exactly the chip that is wrong and keep the rest.
    throw new ValidationError(
      'The query parameters are not valid.',
      unknown.map((slug) => ({
        field,
        code: 'NOT_FOUND',
        message: `There is no ${field} called "${slug}".`,
      })),
    );
  }

  return found.map((row) => row.id);
}

/**
 * The two taxonomy lookups do not depend on each other, so they are issued
 * together. Neither runs at all when its filter is absent.
 */
async function resolveFilters(actor: Actor, query: ListRequestsQuery): Promise<ListFilters> {
  const [categoryIds, statusIds] = await Promise.all([
    resolveSlugs('category', query.category, categoriesRepository.findIdsBySlugs),
    resolveSlugs('status', query.status, statusesRepository.findIdsBySlugs),
  ]);

  return {
    categoryIds,
    statusIds,
    // "Mine" is answered here, from the identity seam, and never from a
    // parameter. The browser is not told who it is, so it cannot name an author
    // — and nobody can page through somebody else's requests by editing a URL.
    authorId: query.mine === true ? actor.id : undefined,
    search: query.q,
  };
}

export async function list(
  actor: Actor,
  query: ListRequestsQuery,
): Promise<Paginated<FeedbackRequestListItem>> {
  authorize(requestPolicy.list(actor));

  const filters = await resolveFilters(actor, query);

  const { items, total } = await requestsRepository.list({
    ...filters,
    limit: query.pageSize,
    offset: toOffset(query),
    viewerId: actor.id,
    seesPendingComments: await seesPendingComments(actor),
    // Absent means the board's default. The parameter stays optional all the
    // way from the URL so the shelf can tell "no ordering was asked for" from
    // "this ordering was asked for", which is what decides its own order.
    sort: query.sort ?? DEFAULT_SORT,
    // The default board keeps pinned requests on their own shelf and out of
    // the list. A filtered board has no shelf — one that ignored the filter
    // beside it would contradict what the screen says it is showing — so the
    // pinned rows join the results, ranked first, and the total counts them.
    includePinned: isFiltered(query),
  });

  return {
    data: items.map((item) => withPermissions(actor, item)),
    page: toPageMeta(query, total),
  };
}

export async function findById(actor: Actor, id: number): Promise<FeedbackRequestDetail> {
  authorize(requestPolicy.read(actor));

  const found = await requestsRepository.findById(
    id,
    actor.id,
    await seesPendingComments(actor),
  );

  if (!found) {
    throw new NotFoundError('That request does not exist.');
  }

  return withPermissions(actor, found);
}

/**
 * The minimum a permission rule needs about a request, and nothing more.
 *
 * Loaded before the body is validated, because "may this caller edit this
 * request" cannot be answered without knowing who wrote it — and a caller who
 * may not act should not learn the payload schema from a 422.
 */
export async function findSubject(id: number): Promise<{ authorId: number }> {
  const authorId = await requestsRepository.findAuthorId(id);

  if (authorId === null) {
    throw new NotFoundError('That request does not exist.');
  }

  return { authorId };
}

/**
 * The author's edit. Admins are deliberately not included: moderation is
 * deleting a request or changing its status, not rewriting what somebody wrote
 * under their own name. That boundary lives in requestPolicy.editContent.
 */
export async function update(
  actor: Actor,
  id: number,
  body: UpdateRequestBody,
): Promise<FeedbackRequestDetail> {
  authorize(requestPolicy.editContent(actor, await findSubject(id)));

  const categoryId = await categoriesRepository.findActiveId(body.categoryId);

  if (categoryId === null) {
    // Same answer as creation: a category that does not exist is a bad value in
    // a field the user chose, so it belongs next to that field.
    throw new ValidationError('The submitted values are not valid.', [
      {
        field: 'categoryId',
        code: 'NOT_FOUND',
        message: 'That category does not exist or is no longer available.',
      },
    ]);
  }

  await requestsRepository.updateContent(id, {
    title: body.title,
    description: body.description,
    categoryId,
  });

  const updated = await requestsRepository.findById(
    id,
    actor.id,
    await seesPendingComments(actor),
  );

  if (!updated) {
    throw new MisconfigurationError('The request was updated but could not be read back.');
  }

  return withPermissions(actor, updated);
}

/**
 * The author's, or an admin's as a moderator.
 *
 * The votes and the comments go with it, by the schema rather than by a loop
 * here: both foreign keys are ON DELETE CASCADE, so one statement is the whole
 * operation and nothing can half-succeed.
 */
export async function remove(actor: Actor, id: number): Promise<void> {
  authorize(requestPolicy.delete(actor, await findSubject(id)));

  await requestsRepository.remove(id);
}

/**
 * Triage, admin only — and refused before anything is looked up, like pinning.
 * A caller who may not change a status learns nothing about the request from
 * trying.
 */
export async function changeStatus(
  actor: Actor,
  id: number,
  body: ChangeStatusBody,
): Promise<FeedbackRequestDetail> {
  authorize(requestPolicy.changeStatus(actor));

  if (!(await requestsRepository.exists(id))) {
    throw new NotFoundError('That request does not exist.');
  }

  const statusId = await statusesRepository.findActiveId(body.statusId);

  if (statusId === null) {
    throw new ValidationError('The submitted values are not valid.', [
      {
        field: 'statusId',
        code: 'NOT_FOUND',
        message: 'That status does not exist or is no longer available.',
      },
    ]);
  }

  await requestsRepository.updateStatus(id, statusId);

  const updated = await requestsRepository.findById(
    id,
    actor.id,
    await seesPendingComments(actor),
  );

  if (!updated) {
    throw new MisconfigurationError('The status changed but the request could not be read back.');
  }

  return withPermissions(actor, updated);
}

export interface PinnedResult {
  data: FeedbackRequestListItem[];
  /** Every pinned request, including any the cap held back. */
  total: number;
}

/**
 * Pinned requests are not paginated — the panel shows a few and expands to
 * scroll the rest — so this returns them in one response, capped for safety.
 *
 * It takes no filters, because a filtered board has no shelf at all. It does
 * take the ordering: the shelf is a group within the board, and follows it when
 * one was asked for. Left alone, it is most recently pinned first.
 */
export async function listPinned(
  actor: Actor,
  query: ListPinnedQuery = {},
): Promise<PinnedResult> {
  authorize(requestPolicy.list(actor));

  const { items, total } = await requestsRepository.listPinned(
    actor.id,
    await seesPendingComments(actor),
    MAX_PINNED_RETURNED,
    query.sort,
  );

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

  const updated = await requestsRepository.findListItemById(
    id,
    actor.id,
    await seesPendingComments(actor),
  );

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
