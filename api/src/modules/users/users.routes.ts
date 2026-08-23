import { Router } from 'express';
import { getUserSettings, updateUserSettings } from '../settings/settings.controller.js';
import { deleteAccount, updateProfile } from './users.controller.js';

export const usersRouter = Router();

/**
 * Every route here names the account it acts on, and none of them means
 * "whoever is calling".
 *
 * There is no /me. An endpoint that acted on the caller could not tell an
 * attempt to change somebody else's preferences from an ordinary save — it
 * would answer 200 and write the wrong row's neighbour — so the target is in
 * the path and the answer to another person's id is 403. That refusal has a
 * test; a /me endpoint would have nothing to test.
 *
 * It is also the same rule as everywhere else on this board: the browser is
 * never told who it is. It learns its own id from the bootstrap payload, along
 * with everything else about itself, and sends it back like any other id.
 */
usersRouter.patch('/:id', updateProfile);
usersRouter.delete('/:id', deleteAccount);

usersRouter.get('/:id/settings', getUserSettings);
usersRouter.patch('/:id/settings', updateUserSettings);
