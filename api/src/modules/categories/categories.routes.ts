import { Router } from 'express';
import { listCategories } from './categories.controller.js';

export const categoriesRouter = Router();

categoriesRouter.get('/', listCategories);
