import { Router } from 'express';
import { deleteComment, editComment } from './comments.controller.js';

/**
 * Editing and deleting name a comment directly; listing and creating hang off
 * the request they belong to and are mounted in requests.routes.ts.
 */
export const commentsRouter = Router();

commentsRouter.patch('/:id', editComment);
commentsRouter.delete('/:id', deleteComment);
