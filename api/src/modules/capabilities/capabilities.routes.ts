import { Router } from 'express';
import { getCapabilities } from './capabilities.controller.js';

export const capabilitiesRouter = Router();

capabilitiesRouter.get('/', getCapabilities);
