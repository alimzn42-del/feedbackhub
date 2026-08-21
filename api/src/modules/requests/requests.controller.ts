import type { RequestHandler } from 'express';
import { parseOrThrow } from '../../http/validate.js';
import * as requestsService from './requests.service.js';
import { createRequestBodySchema, listRequestsQuerySchema } from './requests.schema.js';

/**
 * HTTP in, HTTP out. No rules, no SQL. Express 5 forwards a rejected promise
 * from a handler to the error middleware, so there is no wrapper here.
 */
export const createRequest: RequestHandler = async (req, res) => {
  const body = parseOrThrow(createRequestBodySchema, req.body, 'body');
  const created = await requestsService.create(req.actor, body);

  res.status(201).json({ data: created });
};

export const listRequests: RequestHandler = async (req, res) => {
  const query = parseOrThrow(listRequestsQuerySchema, req.query, 'query');
  const page = await requestsService.list(req.actor, query);

  res.status(200).json(page);
};
