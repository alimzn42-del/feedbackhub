import { Router } from 'express';
import { votesRouter } from '../votes/votes.routes.js';
import {
  createRequest,
  listPinnedRequests,
  listRequests,
  pinRequest,
  unpinRequest,
} from './requests.controller.js';

export const requestsRouter = Router();

// Before any ':id' route, so "pinned" is never read as an id.
requestsRouter.get('/pinned', listPinnedRequests);

requestsRouter.post('/', createRequest);
requestsRouter.get('/', listRequests);

// Pinning is a property of the request, expressed as a sub-resource so the
// verb carries the intent: PUT to pin, DELETE to unpin.
requestsRouter.put('/:id/pin', pinRequest);
requestsRouter.delete('/:id/pin', unpinRequest);

// A request's votes are part of that request's URL space, not a top-level
// collection. There is no route that names a vote by id.
requestsRouter.use('/:id/vote', votesRouter);
