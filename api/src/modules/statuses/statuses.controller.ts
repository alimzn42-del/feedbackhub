import type { RequestHandler } from 'express';
import { parseOrThrow } from '../../http/validate.js';
import { authorize } from '../../policy/index.js';
import { statusPolicy } from '../../policy/statuses.policy.js';
import {
  createTaxonomyBodySchema,
  renameTaxonomyBodySchema,
  reorderBodySchema,
  taxonomyIdParamsSchema,
  taxonomyQuerySchema,
} from '../taxonomy/taxonomy.schema.js';
import * as statusesRepository from './statuses.repository.js';
import * as statusesService from './statuses.service.js';

/**
 * Read-only for everybody, manageable by an admin.
 *
 * The default listing is what the filter bar and the status selector need. The
 * managed one carries the display order, which row is the default, and how many
 * requests are sitting in each — and is refused to anybody who cannot act on
 * them.
 */
export const listStatuses: RequestHandler = async (req, res) => {
  const { scope } = parseOrThrow(taxonomyQuerySchema, req.query, 'query');

  if (scope === 'all') {
    const statuses = await statusesService.listAll(req.actor);
    res.status(200).json({ data: statuses });
    return;
  }

  authorize(statusPolicy.list(req.actor));

  const statuses = await statusesRepository.listActive();

  res.status(200).json({ data: statuses });
};

export const createStatus: RequestHandler = async (req, res) => {
  authorize(statusPolicy.manage(req.actor));

  const body = parseOrThrow(createTaxonomyBodySchema, req.body, 'body');
  const created = await statusesService.create(req.actor, body);

  res.status(201).json({ data: created });
};

export const renameStatus: RequestHandler = async (req, res) => {
  authorize(statusPolicy.manage(req.actor));

  const { id } = parseOrThrow(taxonomyIdParamsSchema, req.params, 'params');
  const body = parseOrThrow(renameTaxonomyBodySchema, req.body, 'body');
  const updated = await statusesService.rename(req.actor, id, body);

  res.status(200).json({ data: updated });
};

export const reorderStatuses: RequestHandler = async (req, res) => {
  authorize(statusPolicy.manage(req.actor));

  const body = parseOrThrow(reorderBodySchema, req.body, 'body');
  const ordered = await statusesService.reorder(req.actor, body);

  res.status(200).json({ data: ordered });
};

/**
 * Answers with the whole list, because this changes two rows: the status that
 * gained the default and the one that lost it.
 *
 * There is no endpoint that clears a default without setting another. That
 * absence is what keeps the table's lower bound — the one the schema cannot
 * express.
 */
export const setDefaultStatus: RequestHandler = async (req, res) => {
  authorize(statusPolicy.manage(req.actor));

  const { id } = parseOrThrow(taxonomyIdParamsSchema, req.params, 'params');
  const statuses = await statusesService.setDefault(req.actor, id);

  res.status(200).json({ data: statuses });
};
