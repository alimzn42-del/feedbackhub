import { Router } from 'express';
import { createComment, listComments } from '../comments/comments.controller.js';
import { votesRouter } from '../votes/votes.routes.js';
import {
  createRequest,
  getRequest,
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
requestsRouter.get('/:id', getRequest);

// Pinning is a property of the request, expressed as a sub-resource so the
// verb carries the intent: PUT to pin, DELETE to unpin.
requestsRouter.put('/:id/pin', pinRequest);
requestsRouter.delete('/:id/pin', unpinRequest);

// A request's comments live under it, like its votes.
requestsRouter.get('/:id/comments', listComments);
requestsRouter.post('/:id/comments', createComment);

// A request's votes are part of that request's URL space, not a top-level
// collection. There is no route that names a vote by id.
requestsRouter.use('/:id/vote', votesRouter);
