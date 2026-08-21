import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, BadRequestError, NotFoundError, type ErrorCode, type FieldIssue } from './errors.js';


/** The single error envelope. Every non-2xx response from this API looks like this. */
export interface ErrorResponseBody {
  error: {
    code: ErrorCode;
    message: string;
    /** Present only on validation failures. */
    details?: FieldIssue[];
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
    : error;

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
