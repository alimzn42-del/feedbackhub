import { Router } from 'express';
import { castVote, withdrawVote } from './votes.controller.js';

// mergeParams so :id from the parent mount is visible here.
export const votesRouter = Router({ mergeParams: true });

votesRouter.post('/', castVote);
votesRouter.delete('/', withdrawVote);
