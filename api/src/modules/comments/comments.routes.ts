import { Router } from 'express';
import { approveComment, deleteComment, editComment } from './comments.controller.js';

/**
 * Editing and deleting name a comment directly; listing and creating hang off
 * the request they belong to and are mounted in requests.routes.ts.
 */
export const commentsRouter = Router();

commentsRouter.patch('/:id', editComment);
commentsRouter.delete('/:id', deleteComment);

// Approval is a state the comment reaches, so it is a property of the comment
// and not an action posted to. There is deliberately no way to un-approve: a
// comment an admin wants gone is deleted, which records who did it, and a
// silent reversal would be the one moderation act on this board with no trail.
commentsRouter.put('/:id/approval', approveComment);
