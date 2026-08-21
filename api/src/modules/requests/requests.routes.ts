import { Router } from 'express';
import { createRequest, listRequests } from './requests.controller.js';

export const requestsRouter = Router();

requestsRouter.post('/', createRequest);
requestsRouter.get('/', listRequests);
