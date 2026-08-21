import type { Actor } from '../auth/actor.js';

declare global {
  namespace Express {
    interface Request {
      /** Set by attachRequestId on every request. */
      requestId: string;

      /**
       * Set by attachCurrentUser. Declared non-optional because every route that
       * reads it is mounted behind that middleware; a route that is not has no
       * business asking who the caller is.
       */
      actor: Actor;
    }
  }
}

export {};
