import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import {
  AppError,
  BadRequestError,
  NotFoundError,
  PayloadTooLargeError,
  ProviderUnavailableError,
  RateLimitedError,
  UnauthenticatedError,
  type ErrorCode,
  type FieldIssue,
} from './errors.js';

/** The single error envelope. Every non-2xx response from this API looks like this. */
export interface ErrorResponseBody {
  error: {
    code: ErrorCode;
    message: string;
    /** Present only on validation failures. */
    details?: FieldIssue[];
    /** Present only on a 429. Seconds until the same call would be accepted. */
    retryAfterSeconds?: number;
    /** Echoed in the X-Request-Id header; the join key to the server log. */
    requestId: string;
  };
}

export const attachRequestId: RequestHandler = (req, res, next) => {
  const supplied = req.get('X-Request-Id');
  req.requestId = supplied && supplied.length <= 128 ? supplied : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};

/** Unmatched routes are a 404 raised through the same path as everything else. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`No route matches ${req.method} ${req.path}.`));
};

function isJsonParseFailure(error: unknown): boolean {
  // express.json() rejects malformed bodies with a SyntaxError carrying the raw body.
  return error instanceof SyntaxError && 'body' in error;
}

/**
 * body-parser's refusal when the body exceeds the configured limit.
 *
 * Recognised by `type`, which is the field body-parser documents and sets on
 * every error it raises, rather than by the class — the class is not exported
 * and `instanceof` against a transitive dependency's internals is a test that
 * breaks on a patch release.
 *
 * The size is read from the error rather than repeated from app.ts, so the
 * sentence cannot drift away from the limit that produced it.
 */
function payloadTooLarge(error: unknown): PayloadTooLargeError | null {
  if (typeof error !== 'object' || error === null) return null;

  const candidate = error as { type?: string; limit?: number };
  if (candidate.type !== 'entity.too.large') return null;

  const limit = typeof candidate.limit === 'number' ? `${Math.round(candidate.limit / 1024)} KB` : null;

  return new PayloadTooLargeError(
    limit
      ? `The request body is larger than this API accepts (${limit}).`
      : 'The request body is larger than this API accepts.',
  );
}

/**
 * The only place in the application that turns an error into a response body.
 * Handlers and services throw; nothing else formats.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    // The response is already on the wire; Express's default handler destroys
    // the socket, which is the only honest option left.
    next(error);
    return;
  }

  const requestId = req.requestId ?? 'unknown';
  const appError = isJsonParseFailure(error)
    ? new BadRequestError('The request body is not valid JSON.')
    : (payloadTooLarge(error) ?? error);

  if (appError instanceof AppError) {
    const body: ErrorResponseBody = {
      error: {
        code: appError.code,
        message: appError.message,
        requestId,
      },
    };

    if (appError.details) {
      body.error.details = appError.details;
    }

    // In the body as well as the header. The header is what the standard
    // defines and what a proxy or a generic client will honour; the body is
    // what this application's own screen renders a sentence from, and it should
    // not have to read headers to do that.
    if (appError instanceof RateLimitedError) {
      body.error.retryAfterSeconds = appError.retryAfterSeconds;
      res.setHeader('Retry-After', String(appError.retryAfterSeconds));
    }

    /**
     * A refused sign-in says more in the log than it says on the wire.
     *
     * The caller gets one sentence and no detail about why the token was not
     * good enough — telling an unauthenticated stranger that the signature was
     * fine and the audience was wrong tells them something about the
     * installation. The operator gets the reason, because a missing token, an
     * expired one, a malformed one and a client pointed at the wrong realm are
     * four different problems that would otherwise be one line reading 401.
     *
     * warn and not error: most of these are ordinary. A token expiring while
     * somebody was reading is what expiry is for.
     */
    if (appError instanceof UnauthenticatedError || appError instanceof ProviderUnavailableError) {
      console.warn(
        `[${requestId}] ${appError.status} ${appError.reason} on ${req.method} ${req.originalUrl}`,
      );
    }

    // 5xx AppErrors are still our fault and still worth a log line.
    if (appError.status >= 500) {
      console.error(`[${requestId}] ${appError.name}: ${appError.message}`);
    }

    res.status(appError.status).json(body);
    return;
  }

  // Anything reaching here is unplanned. Log everything, disclose nothing.
  console.error(`[${requestId}] Unhandled error on ${req.method} ${req.originalUrl}`);
  // Logs are server-side; the full error including its stack belongs here in every
  // environment. What must not leak is the response body below.
  console.error(error);

  const body: ErrorResponseBody = {
    error: {
      code: 'INTERNAL',
      message: 'Something went wrong handling this request.',
      requestId,
    },
  };

  res.status(500).json(body);
};
