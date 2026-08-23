import type { RequestHandler } from 'express';
import { categoryPolicy } from '../../policy/categories.policy.js';
import { statusPolicy } from '../../policy/statuses.policy.js';

/**
 * What the caller may do that is not attached to any particular row.
 *
 * Every list item already carries its own answers — canVote, canEdit, canPin —
 * because there is a row to hang them on. A whole screen has no row, and the
 * navigation still has to decide whether to offer it.
 *
 * This is the same rule in the same shape, asked once for the application
 * rather than per item: the browser is told what it may DO, never who it is. It
 * is not the guarantee either. Every endpoint behind these flags refuses on its
 * own, and this one lying would change nothing but the menu.
 */
export const getCapabilities: RequestHandler = (req, res) => {
  res.status(200).json({
    data: {
      canManageCategories: categoryPolicy.manage(req.actor).allowed,
      canManageStatuses: statusPolicy.manage(req.actor).allowed,
    },
  });
};
