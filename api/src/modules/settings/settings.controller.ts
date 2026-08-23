import type { RequestHandler } from 'express';
import { parseOrThrow } from '../../http/validate.js';
import { authorize } from '../../policy/index.js';
import { settingPolicy } from '../../policy/settings.policy.js';
import { settingsPatchSchema, userIdParamsSchema } from './settings.schema.js';
import * as settingsService from './settings.service.js';

/**
 * The application settings, for the screen that manages them.
 *
 * Refused at the route before it is hidden in the interface — a non-admin gets
 * a 403 here, not an empty document, and the screen renders that refusal rather
 * than pretending the settings do not exist.
 */
export const getAppSettings: RequestHandler = async (req, res) => {
  authorize(settingPolicy.readGlobal(req.actor));

  const settings = await settingsService.describe(req.actor, 'global');

  res.status(200).json({ data: settings });
};

/**
 * Answers with the whole document rather than the changed keys.
 *
 * Two of these settings constrain each other, so a write can change what a key
 * the caller never mentioned resolves to. Returning everything means the screen
 * cannot end up displaying a value the server has since moved on from.
 */
export const updateAppSettings: RequestHandler = async (req, res) => {
  authorize(settingPolicy.writeGlobal(req.actor));

  const patch = parseOrThrow(settingsPatchSchema, req.body, 'body');
  await settingsService.updateGlobal(req.actor, patch);

  const settings = await settingsService.describe(req.actor, 'global');

  res.status(200).json({ data: settings });
};

/**
 * One person's preferences, named in the path.
 *
 * Permission is checked before the body is parsed, so somebody who may not
 * write these does not learn what they accept from a 422.
 */
export const getUserSettings: RequestHandler = async (req, res) => {
  const { id } = parseOrThrow(userIdParamsSchema, req.params, 'params');

  authorize(settingPolicy.writeUser(req.actor, id));

  const settings = await settingsService.describe(req.actor, 'user');

  res.status(200).json({ data: settings });
};

export const updateUserSettings: RequestHandler = async (req, res) => {
  const { id } = parseOrThrow(userIdParamsSchema, req.params, 'params');

  authorize(settingPolicy.writeUser(req.actor, id));

  const patch = parseOrThrow(settingsPatchSchema, req.body, 'body');
  await settingsService.updateForUser(req.actor, id, patch);

  const settings = await settingsService.describe(req.actor, 'user');

  res.status(200).json({ data: settings });
};
