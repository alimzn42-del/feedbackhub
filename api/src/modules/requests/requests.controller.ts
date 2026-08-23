import type { RequestHandler } from 'express';
import { parseOrThrow } from '../../http/validate.js';
import { authorize } from '../../policy/index.js';
import { requestPolicy } from '../../policy/requests.policy.js';
import * as requestsService from './requests.service.js';
import {
  changeStatusBodySchema,
  createRequestBodySchema,
  listPinnedQuerySchema,
  listRequestsQuerySchema,
  requestIdParamsSchema,
  updateRequestBodySchema,
} from './requests.schema.js';

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

/**
 * The pinned panel. Deliberately not paginated: the panel shows a few and
 * expands to scroll the rest, so there are no pages to describe. It reports the
 * true total separately, because the response is capped.
 *
 * It accepts `sort` and nothing else — the strict schema refuses the board's
 * filters here, which is honest: a filtered board has no shelf to filter.
 */
export const listPinnedRequests: RequestHandler = async (req, res) => {
  const query = parseOrThrow(listPinnedQuerySchema, req.query, 'query');
  const { data, total } = await requestsService.listPinned(req.actor, query);

  res.status(200).json({ data, total });
};

export const pinRequest: RequestHandler = async (req, res) => {
  const { id } = parseOrThrow(requestIdParamsSchema, req.params, 'params');
  const updated = await requestsService.pin(req.actor, id);

  res.status(200).json({ data: updated });
};

export const unpinRequest: RequestHandler = async (req, res) => {
  const { id } = parseOrThrow(requestIdParamsSchema, req.params, 'params');
  const updated = await requestsService.unpin(req.actor, id);

  res.status(200).json({ data: updated });
};

/**
 * Editing the text, by its author.
 *
 * The subject is loaded before the body is parsed, which is the whole reason
 * this handler is shaped the way it is: the rule is "only the author", so it
 * cannot be asked without knowing who wrote it, and asking it afterwards would
 * hand a caller who may not edit a 422 enumerating every field and its limits.
 * A missing request is a 404 from that same lookup, before any of it.
 */
export const updateRequest: RequestHandler = async (req, res) => {
  const { id } = parseOrThrow(requestIdParamsSchema, req.params, 'params');

  const subject = await requestsService.findSubject(id);
  authorize(requestPolicy.editContent(req.actor, subject));

  const body = parseOrThrow(updateRequestBodySchema, req.body, 'body');
  const updated = await requestsService.update(req.actor, id, body);

  res.status(200).json({ data: updated });
};

/**
 * Deleting the request, by its author or an admin.
 *
 * 204: the resource is gone, so there is nothing to return that describes it.
 * The votes and comments go with it through the schema's cascades.
 */
export const deleteRequest: RequestHandler = async (req, res) => {
  const { id } = parseOrThrow(requestIdParamsSchema, req.params, 'params');

  const subject = await requestsService.findSubject(id);
  authorize(requestPolicy.delete(req.actor, subject));

  await requestsService.remove(req.actor, id);

  res.status(204).end();
};

/**
 * Triage, admin only. Refused before anything is looked up — the rule depends
 * on the caller alone, so there is nothing to load first, and a caller who may
 * not do this learns neither the payload shape nor whether the request exists.
 */
export const changeRequestStatus: RequestHandler = async (req, res) => {
  authorize(requestPolicy.changeStatus(req.actor));

  const { id } = parseOrThrow(requestIdParamsSchema, req.params, 'params');
  const body = parseOrThrow(changeStatusBodySchema, req.body, 'body');
  const updated = await requestsService.changeStatus(req.actor, id, body);

  res.status(200).json({ data: updated });
};

/**
 * One request in full, for its own page. The board only ever sends an excerpt,
 * so until now the complete description had nowhere to be read.
 */
export const getRequest: RequestHandler = async (req, res) => {
  authorize(requestPolicy.read(req.actor));

  const { id } = parseOrThrow(requestIdParamsSchema, req.params, 'params');
  const found = await requestsService.findById(req.actor, id);

  res.status(200).json({ data: found });
};
