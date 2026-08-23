import { Router } from 'express';
import {
  createStatus,
  listStatuses,
  renameStatus,
  reorderStatuses,
  setDefaultStatus,
} from './statuses.controller.js';

export const statusesRouter = Router();

statusesRouter.get('/', listStatuses);
statusesRouter.post('/', createStatus);

// Before any ':id' route, so "order" is never read as an id.
statusesRouter.put('/order', reorderStatuses);

statusesRouter.patch('/:id', renameStatus);

// The default is a property of the status, expressed as a sub-resource. There
// is no DELETE: nothing may clear the default without naming its replacement,
// and there is no archive route either — a status is a position requests are
// sitting in, not a label they carry.
statusesRouter.put('/:id/default', setDefaultStatus);
