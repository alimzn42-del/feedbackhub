import type { RequestHandler } from 'express';
import { parseOrThrow } from '../../http/validate.js';
import { requestIdParamsSchema } from '../requests/requests.schema.js';
import * as votesService from './votes.service.js';

/**
 * The vote resource is singular and scoped to the caller — /requests/:id/vote,
 * not /votes/:voteId. There is deliberately no way to name somebody else's
 * vote, which is what makes "vote for yourself only" structural rather than a
 * rule a handler has to remember to check.
 *
 * Permission depends on the request being voted on, so the id is parsed first;
 * that is reading the subject of the decision, not validating a payload.
 */
export const castVote: RequestHandler = async (req, res) => {
  const { id } = parseOrThrow(requestIdParamsSchema, req.params, 'params');
  const state = await votesService.cast(req.actor, id);

  res.status(201).json({ data: state });
};

export const withdrawVote: RequestHandler = async (req, res) => {
  const { id } = parseOrThrow(requestIdParamsSchema, req.params, 'params');
  const state = await votesService.withdraw(req.actor, id);

  res.status(200).json({ data: state });
};
