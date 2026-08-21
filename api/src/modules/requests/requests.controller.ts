import type { RequestHandler } from 'express';
import { parseOrThrow } from '../../http/validate.js';
import { authorize } from '../../policy/index.js';
import { requestPolicy } from '../../policy/requests.policy.js';
import * as requestsService from './requests.service.js';
import { createRequestBodySchema, listRequestsQuerySchema } from './requests.schema.js';

/**
 * HTTP in, HTTP out. No rules, no SQL — the handler asks the policy module and
 * does what it is told. Express 5 forwards a rejected promise from a handler to
 * the error middleware, so there is no wrapper here.
 *
 * Permission is checked BEFORE the body is validated. A caller who may not
 * perform the action should not learn the payload schema from a 422 listing
 * every field and its constraints. The service checks again, because the
 * service — not the controller — is the boundary any future caller crosses;
 * the duplication is deliberate and costs a comparison.
 */
export const createRequest: RequestHandler = async (req, res) => {
  authorize(requestPolicy.create(req.actor));

  const body = parseOrThrow(createRequestBodySchema, req.body, 'body');
  const created = await requestsService.create(req.actor, body);

  res.status(201).json({ data: created });
};

export const listRequests: RequestHandler = async (req, res) => {
  authorize(requestPolicy.list(req.actor));

  const query = parseOrThrow(listRequestsQuerySchema, req.query, 'query');
  const page = await requestsService.list(req.actor, query);

  res.status(200).json(page);
};
