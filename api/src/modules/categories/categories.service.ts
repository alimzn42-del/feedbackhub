import type { Actor } from '../../auth/actor.js';
import { MisconfigurationError, NotFoundError } from '../../http/errors.js';
import { authorize } from '../../policy/index.js';
import { categoryPolicy } from '../../policy/categories.policy.js';
import {
  assertCompleteOrder,
  rethrowDuplicate,
  type DuplicateKeys,
} from '../taxonomy/taxonomy.service.js';
import type {
  CategoryAdminRow,
  CreateTaxonomyBody,
  ReorderBody,
  RenameTaxonomyBody,
} from '../taxonomy/taxonomy.schema.js';
import * as categoriesRepository from './categories.repository.js';

/** The unique keys the database refuses duplicates on. */
const KEYS: DuplicateKeys = { name: 'uq_categories_name', slug: 'uq_categories_slug' };

export function listAll(actor: Actor): Promise<CategoryAdminRow[]> {
  authorize(categoryPolicy.listAll(actor));
  return categoriesRepository.listAll();
}

/** Every mutation asks the same rule, and asks it before doing anything. */
async function findOne(id: number): Promise<void> {
  if ((await categoriesRepository.findById(id)) === null) {
    throw new NotFoundError('That category does not exist.');
  }
}

async function readBack(id: number): Promise<CategoryAdminRow> {
  const rows = await categoriesRepository.listAll();
  const found = rows.find((row) => row.id === id);

  if (!found) {
    throw new MisconfigurationError('The category changed but could not be read back.');
  }

  return found;
}

export async function create(actor: Actor, body: CreateTaxonomyBody): Promise<CategoryAdminRow> {
  authorize(categoryPolicy.manage(actor));

  try {
    const id = await categoriesRepository.insert(body.name, body.slug);
    return await readBack(id);
  } catch (error) {
    // The unique keys are the check. Reading first would leave a window where
    // two admins both see "no such name" and both proceed.
    return rethrowDuplicate(error, KEYS, 'category', body);
  }
}

export async function rename(
  actor: Actor,
  id: number,
  body: RenameTaxonomyBody,
): Promise<CategoryAdminRow> {
  authorize(categoryPolicy.manage(actor));
  await findOne(id);

  try {
    await categoriesRepository.rename(id, body.name);
  } catch (error) {
    rethrowDuplicate(error, KEYS, 'category', body);
  }

  return readBack(id);
}

export async function reorder(actor: Actor, body: ReorderBody): Promise<CategoryAdminRow[]> {
  authorize(categoryPolicy.manage(actor));

  assertCompleteOrder(body.ids, await categoriesRepository.allIds());
  await categoriesRepository.setOrder(body.ids);

  return categoriesRepository.listAll();
}

/**
 * Retiring, which is deliberately not deleting.
 *
 * A category with requests on it can still be retired: that is what retirement
 * is for. The rows keep pointing at it and keep rendering it; it simply stops
 * being offered for anything new. The usage count is shown next to this action
 * to inform the decision, not to block it.
 */
export async function archive(actor: Actor, id: number): Promise<CategoryAdminRow> {
  authorize(categoryPolicy.manage(actor));
  await findOne(id);

  await categoriesRepository.archive(id);

  return readBack(id);
}

export async function restore(actor: Actor, id: number): Promise<CategoryAdminRow> {
  authorize(categoryPolicy.manage(actor));
  await findOne(id);

  await categoriesRepository.restore(id);

  return readBack(id);
}
