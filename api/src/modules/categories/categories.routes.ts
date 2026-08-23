import { Router } from 'express';
import {
  archiveCategory,
  createCategory,
  listCategories,
  renameCategory,
  reorderCategories,
  restoreCategory,
} from './categories.controller.js';

export const categoriesRouter = Router();

categoriesRouter.get('/', listCategories);
categoriesRouter.post('/', createCategory);

// Before any ':id' route, so "order" is never read as an id.
categoriesRouter.put('/order', reorderCategories);

categoriesRouter.patch('/:id', renameCategory);

// Retirement is a property of the category, expressed as a sub-resource so the
// verb carries the intent: PUT retires, DELETE restores. There is no
// DELETE /:id, because the row never goes away.
categoriesRouter.put('/:id/archive', archiveCategory);
categoriesRouter.delete('/:id/archive', restoreCategory);
