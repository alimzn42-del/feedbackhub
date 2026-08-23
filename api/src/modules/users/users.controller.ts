import type { RequestHandler } from 'express';
import { parseOrThrow } from '../../http/validate.js';
import { authorize } from '../../policy/index.js';
import { settingPolicy } from '../../policy/settings.policy.js';
import { updateProfileSchema, userIdParamsSchema } from '../settings/settings.schema.js';
import * as usersService from './users.service.js';

/**
 * Permission before the body, as everywhere else: somebody who may not write
 * this profile does not get to learn what it accepts from a 422.
 */
export const updateProfile: RequestHandler = async (req, res) => {
  const { id } = parseOrThrow(userIdParamsSchema, req.params, 'params');

  authorize(settingPolicy.writeUser(req.actor, id));

  const body = parseOrThrow(updateProfileSchema, req.body, 'body');
  const profile = await usersService.updateProfile(req.actor, id, body);

  res.status(200).json({ data: profile });
};

/**
 * 204, and the account is anonymised rather than removed.
 *
 * Nothing comes back because there is nothing to say: the caller's own identity
 * no longer exists, and the next request they make will be somebody new.
 */
export const deleteAccount: RequestHandler = async (req, res) => {
  const { id } = parseOrThrow(userIdParamsSchema, req.params, 'params');

  authorize(settingPolicy.deleteAccount(req.actor, id));

  await usersService.deleteAccount(req.actor, id);

  res.status(204).send();
};
