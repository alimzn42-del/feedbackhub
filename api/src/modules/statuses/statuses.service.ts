import type { Actor } from '../../auth/actor.js';
import { MisconfigurationError, NotFoundError } from '../../http/errors.js';
import { authorize } from '../../policy/index.js';
import { statusPolicy } from '../../policy/statuses.policy.js';
import {
  assertCompleteOrder,
  rethrowDuplicate,
  type DuplicateKeys,
} from '../taxonomy/taxonomy.service.js';
import type {
  CreateTaxonomyBody,
  ReorderBody,
  RenameTaxonomyBody,
  StatusAdminRow,
} from '../taxonomy/taxonomy.schema.js';
import * as statusesRepository from './statuses.repository.js';

const KEYS: DuplicateKeys = { name: 'uq_statuses_name', slug: 'uq_statuses_slug' };

export function listAll(actor: Actor): Promise<StatusAdminRow[]> {
  authorize(statusPolicy.listAll(actor));
  return statusesRepository.listAll();
}

async function findOne(id: number): Promise<void> {
  if ((await statusesRepository.findById(id)) === null) {
    throw new NotFoundError('That status does not exist.');
  }
}

async function readBack(id: number): Promise<StatusAdminRow> {
  const rows = await statusesRepository.listAll();
  const found = rows.find((row) => row.id === id);

  if (!found) {
    throw new MisconfigurationError('The status changed but could not be read back.');
  }

  return found;
}

/**
 * Creating a status, which is where the lower bound on the default is kept.
 *
 * The database enforces AT MOST one default, through a generated column and a
 * unique key. It cannot enforce at least one. The only way a table reaches zero
 * defaults is by being empty, so the first status created becomes the default —
 * otherwise the table would exist, look fine, and refuse every new request with
 * SERVER_MISCONFIGURED.
 *
 * Everything after the first is created as an ordinary status; making a new
 * status the default silently would move the workflow's entry point because
 * somebody added a stage.
 */
export async function create(actor: Actor, body: CreateTaxonomyBody): Promise<StatusAdminRow> {
  authorize(statusPolicy.manage(actor));

  const isFirst = (await statusesRepository.countAll()) === 0;

  try {
    const id = await statusesRepository.insert(body.name, body.slug, isFirst);
    return await readBack(id);
  } catch (error) {
    return rethrowDuplicate(error, KEYS, 'status', body);
  }
}

export async function rename(
  actor: Actor,
  id: number,
  body: RenameTaxonomyBody,
): Promise<StatusAdminRow> {
  authorize(statusPolicy.manage(actor));
  await findOne(id);

  try {
    await statusesRepository.rename(id, body.name);
  } catch (error) {
    rethrowDuplicate(error, KEYS, 'status', body);
  }

  return readBack(id);
}

/**
 * The order statuses appear in everywhere: the filter bar, the status selector
 * on a request, and this screen. It is a workflow, so the order is meaningful
 * rather than cosmetic.
 */
export async function reorder(actor: Actor, body: ReorderBody): Promise<StatusAdminRow[]> {
  authorize(statusPolicy.manage(actor));

  assertCompleteOrder(body.ids, await statusesRepository.allIds());
  await statusesRepository.setOrder(body.ids);

  return statusesRepository.listAll();
}

/**
 * Moving the default from one status to another.
 *
 * Expressed as "make this one the default" rather than "clear that one", so
 * there is no request in this API that can leave the table without a default.
 * The clearing happens inside the same transaction, because the schema permits
 * at most one and the swap has to pass through zero to get there.
 */
export async function setDefault(actor: Actor, id: number): Promise<StatusAdminRow[]> {
  authorize(statusPolicy.manage(actor));
  await findOne(id);

  await statusesRepository.setDefault(id);

  // The whole list comes back, because this changed two rows: the one that
  // gained the default and the one that lost it.
  return statusesRepository.listAll();
}
