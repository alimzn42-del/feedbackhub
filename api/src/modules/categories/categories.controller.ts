import type { RequestHandler } from 'express';
import { authorize } from '../../policy/index.js';
import { categoryPolicy } from '../../policy/categories.policy.js';
import * as categoriesRepository from './categories.repository.js';

/**
 * Read-only, and not paginated: this is a bounded taxonomy an admin curates, not
 * a growing collection. It returns `data` like every other response, without the
 * `page` block, because there are no pages to describe.
 */
export const listCategories: RequestHandler = async (req, res) => {
  authorize(categoryPolicy.list(req.actor));

  const categories = await categoriesRepository.listActive();

  res.status(200).json({ data: categories });
};
