import { Router } from 'express';
import { getAuthConfig } from './auth.controller.js';

export const authRouter = Router();

authRouter.get('/config', getAuthConfig);
