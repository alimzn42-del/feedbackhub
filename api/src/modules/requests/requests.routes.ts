import { Router } from 'express';
import { votesRouter } from '../votes/votes.routes.js';
import { createRequest, listRequests } from './requests.controller.js';

export const requestsRouter = Router();

requestsRouter.post('/', createRequest);
requestsRouter.get('/', listRequests);

// A request's votes are part of that request's URL space, not a top-level
// collection. There is no route that names a vote by id.
requestsRouter.use('/:id/vote', votesRouter);
