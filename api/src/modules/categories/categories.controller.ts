import type { RequestHandler } from 'express';
import { parseOrThrow } from '../../http/validate.js';
import { authorize } from '../../policy/index.js';
import { categoryPolicy } from '../../policy/categories.policy.js';
import {
  createTaxonomyBodySchema,
  renameTaxonomyBodySchema,
  reorderBodySchema,
  taxonomyIdParamsSchema,
  taxonomyQuerySchema,
} from '../taxonomy/taxonomy.schema.js';
import * as categoriesRepository from './categories.repository.js';
import * as categoriesService from './categories.service.js';

/**
 * Read-only, and not paginated: this is a bounded taxonomy an admin curates, not
 * a growing collection. It returns `data` like every other response, without the
 * `page` block, because there are no pages to describe.
 */
export const listCategories: RequestHandler = async (req, res) => {
  const { scope } = parseOrThrow(taxonomyQuerySchema, req.query, 'query');

  // Two representations, asked for explicitly. The default is what a selector
  // needs; the managed one carries the order, the retirement state and the
  // usage counts, and is refused to anybody who cannot act on them.
  if (scope === 'all') {
    const categories = await categoriesService.listAll(req.actor);
    res.status(200).json({ data: categories });
    return;
  }

  authorize(categoryPolicy.list(req.actor));

  const categories = await categoriesRepository.listActive();

  res.status(200).json({ data: categories });
};

/**
 * Every mutation below checks permission BEFORE the body is validated, so an
 * admin-only screen does not describe its payloads to somebody who may not use
 * them. The service checks again, because the service is the boundary any
 * future caller crosses.
 */
export const createCategory: RequestHandler = async (req, res) => {
  authorize(categoryPolicy.manage(req.actor));

  const body = parseOrThrow(createTaxonomyBodySchema, req.body, 'body');
  const created = await categoriesService.create(req.actor, body);

  res.status(201).json({ data: created });
};

/** The name only — there is deliberately no endpoint that changes a slug. */
export const renameCategory: RequestHandler = async (req, res) => {
  authorize(categoryPolicy.manage(req.actor));

  const { id } = parseOrThrow(taxonomyIdParamsSchema, req.params, 'params');
  const body = parseOrThrow(renameTaxonomyBodySchema, req.body, 'body');
  const updated = await categoriesService.rename(req.actor, id, body);

  res.status(200).json({ data: updated });
};

/** The whole order in one request, so it cannot half-apply. */
export const reorderCategories: RequestHandler = async (req, res) => {
  authorize(categoryPolicy.manage(req.actor));

  const body = parseOrThrow(reorderBodySchema, req.body, 'body');
  const ordered = await categoriesService.reorder(req.actor, body);

  res.status(200).json({ data: ordered });
};

/**
 * Retirement as a sub-resource, like pinning: PUT retires, DELETE restores.
 *
 * Not DELETE /api/categories/:id, which would say the row goes away — and it
 * does not. Requests already carrying it keep rendering it.
 */
export const archiveCategory: RequestHandler = async (req, res) => {
  authorize(categoryPolicy.manage(req.actor));

  const { id } = parseOrThrow(taxonomyIdParamsSchema, req.params, 'params');
  const updated = await categoriesService.archive(req.actor, id);

  res.status(200).json({ data: updated });
};

export const restoreCategory: RequestHandler = async (req, res) => {
  authorize(categoryPolicy.manage(req.actor));

  const { id } = parseOrThrow(taxonomyIdParamsSchema, req.params, 'params');
  const updated = await categoriesService.restore(req.actor, id);

  res.status(200).json({ data: updated });
};
