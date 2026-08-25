import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { attachCurrentUser } from './auth/current-user.js';
import { attachRequestId, errorHandler, notFoundHandler } from './http/error-handler.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { bootstrapRouter } from './modules/bootstrap/bootstrap.routes.js';
import { categoriesRouter } from './modules/categories/categories.routes.js';
import { commentsRouter } from './modules/comments/comments.routes.js';
import { requestsRouter } from './modules/requests/requests.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { statusesRouter } from './modules/statuses/statuses.routes.js';
import { usersRouter } from './modules/users/users.routes.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());

  // The web app normally reaches the API same-origin through the dev proxy, so
  // this only matters when `ng serve` is run without it.
  app.use(cors({ origin: env.WEB_ORIGIN }));

  // Before the body parser: a request that fails to parse still needs an id, so
  // the 400 it produces can be traced to a log line like any other failure.
  app.use(attachRequestId);
  app.use(express.json({ limit: '256kb' }));

  // Unauthenticated on purpose: a liveness probe must not depend on identity.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Before the identity middleware, and the only thing that is. A browser has
  // to be told where to sign in before it can present a token, so this one
  // route cannot require one. See auth.controller.ts for why it is not part of
  // the startup payload.
  app.use('/api/auth', authRouter);

  // Everything else under /api has an identity before it reaches a handler.
  app.use('/api', attachCurrentUser);
  // One request, answering everything the shell needs to draw itself. It
  // replaces GET /api/capabilities, which answered a third of the same question
  // and has been removed rather than left as a second way to ask it.
  app.use('/api/bootstrap', bootstrapRouter);

  app.use('/api/categories', categoriesRouter);
  app.use('/api/statuses', statusesRouter);
  app.use('/api/requests', requestsRouter);
  app.use('/api/comments', commentsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/users', usersRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
