import { Router } from 'express';
import { getAppSettings, updateAppSettings } from './settings.controller.js';

export const settingsRouter = Router();

/**
 * The application settings, at one address with no id in it, because there is
 * exactly one installation.
 *
 * Personal preferences do NOT live under here — they are at
 * /api/users/:id/settings, because they belong to an account and the account
 * has to be nameable for the refusal to mean anything.
 */
settingsRouter.get('/', getAppSettings);
settingsRouter.patch('/', updateAppSettings);
