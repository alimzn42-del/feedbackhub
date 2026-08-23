import { Router } from 'express';
import { getBootstrap } from './bootstrap.controller.js';

export const bootstrapRouter = Router();

bootstrapRouter.get('/', getBootstrap);
