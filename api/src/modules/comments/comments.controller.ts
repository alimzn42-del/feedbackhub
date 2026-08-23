import type { RequestHandler } from 'express';
import { parseOrThrow } from '../../http/validate.js';
import { authorize } from '../../policy/index.js';
import { commentPolicy } from '../../policy/comments.policy.js';
import { requestIdParamsSchema } from '../requests/requests.schema.js';
import * as commentsService from './comments.service.js';
import {
  commentIdParamsSchema,
  createCommentBodySchema,
  editCommentBodySchema,
} from './comments.schema.js';

/**
 * HTTP in, HTTP out. Permission is checked before the body is validated, so a
 * caller who may not act does not learn the payload schema from a 422.
 *
 * The thread is not paginated. A feedback request with hundreds of comments is
 * a different product problem, and pretending otherwise would add pages nobody
 * would ever turn.
 */
export const listComments: RequestHandler = async (req, res) => {
  const { id } = parseOrThrow(requestIdParamsSchema, req.params, 'params');
  const thread = await commentsService.listForRequest(req.actor, id);

  // The thread and one fact about the composer above it: whether a comment
  // posted now will wait for approval. That is the moderation setting's
  // consequence, not the setting -- the setting is administrative and is never
  // sent to somebody who cannot manage it.
  res.status(200).json({ data: thread.comments, awaitsApproval: thread.awaitsApproval });
};

/**
 * Approving is a PUT on a sub-resource of the comment rather than a POST to an
 * action, matching the way a status default is set: it is a property of the
 * comment reaching a state, and repeating it is not a second approval.
 */
export const approveComment: RequestHandler = async (req, res) => {
  authorize(commentPolicy.approve(req.actor));

  const { id } = parseOrThrow(commentIdParamsSchema, req.params, 'params');
  const approved = await commentsService.approve(req.actor, id);

  res.status(200).json({ data: approved });
};

export const createComment: RequestHandler = async (req, res) => {
  authorize(commentPolicy.create(req.actor));

  const { id } = parseOrThrow(requestIdParamsSchema, req.params, 'params');
  const body = parseOrThrow(createCommentBodySchema, req.body, 'body');
  const created = await commentsService.create(req.actor, id, body);

  res.status(201).json({ data: created });
};

export const editComment: RequestHandler = async (req, res) => {
  const { id } = parseOrThrow(commentIdParamsSchema, req.params, 'params');
  const body = parseOrThrow(editCommentBodySchema, req.body, 'body');
  const updated = await commentsService.edit(req.actor, id, body);

  res.status(200).json({ data: updated });
};

export const deleteComment: RequestHandler = async (req, res) => {
  const { id } = parseOrThrow(commentIdParamsSchema, req.params, 'params');
  const outcome = await commentsService.remove(req.actor, id);

  res.status(200).json({ data: outcome });
};
