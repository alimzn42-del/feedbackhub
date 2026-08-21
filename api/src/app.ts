import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { attachCurrentUser } from './auth/current-user.js';
import { attachRequestId, errorHandler, notFoundHandler } from './http/error-handler.js';
import { categoriesRouter } from './modules/categories/categories.routes.js';
import { requestsRouter } from './modules/requests/requests.routes.js';

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

  // Everything under /api has an identity before it reaches a handler.
  app.use('/api', attachCurrentUser);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/requests', requestsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
