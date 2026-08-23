/**
 * The error taxonomy. Every failure the application raises deliberately is an
 * AppError; anything else reaching the error handler is a bug and is reported
 * as an opaque 500.
 *
 * That distinction is the exposure rule: an AppError's message was written to be
 * read by a caller and is always safe to send. An unknown error's message may
 * contain a SQL fragment, a file path or a driver internal, and never crosses
 * the wire.
 */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'SERVER_MISCONFIGURED'
  | 'INTERNAL';

/** One thing wrong with one field, in a form the client can attach to an input. */
export interface FieldIssue {
  /** Dot/bracket path from the root of the payload, e.g. `title`, `items[0].name`. */
  field: string;
  /** Stable machine code, e.g. TOO_SHORT. Safe to switch on. */
  code: string;
  /** Human-readable and safe to render directly. */
  message: string;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: FieldIssue[] | undefined;

  constructor(status: number, code: ErrorCode, message: string, details?: FieldIssue[]) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** The body could not be understood at all — malformed JSON, wrong content type. */
export class BadRequestError extends AppError {
  constructor(message: string) {
    super(400, 'BAD_REQUEST', message);
  }
}

/**
 * The body parsed and a field is wrong. Distinct from 400 because the client
 * handles them differently: a 400 is a bug in the caller, a 422 renders on the
 * form next to the offending input.
 */
export class ValidationError extends AppError {
  constructor(message: string, details: FieldIssue[]) {
    super(422, 'VALIDATION_FAILED', message, details);
  }
}

/** No identity could be established for the request. */
export class UnauthenticatedError extends AppError {
  constructor(message = 'This request has no identity.') {
    super(401, 'UNAUTHENTICATED', message);
  }
}

/**
 * The caller is known and is not allowed to do this.
 *
 * Decision 5: this is a 403 and never a disguised 404. The board is internal and
 * every request on it is visible to everyone, so pretending a resource does not
 * exist conceals nothing and only makes the client's job harder.
 */
export class ForbiddenError extends AppError {
  constructor(message = 'You are not allowed to do that.') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'That resource does not exist.') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
  }
}

/**
 * Allowed, correct, and too soon.
 *
 * Carries how long until they may try again rather than a bare refusal, because
 * the interface has to say something more useful than no — and "in about three
 * hours" is a different sentence from "tomorrow". The number is seconds, and it
 * also goes out as the Retry-After header, which is what the standard says and
 * what anything that is not this application's own client will look for.
 *
 * A 429 and not a 403: the caller is permitted to do this, and would succeed if
 * they waited. A 403 would tell them to stop asking.
 */
export class RateLimitedError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(429, 'RATE_LIMITED', message);
    // Never below one: a Retry-After of 0 invites an immediate retry that is
    // certain to be refused again.
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

/**
 * The server is set up wrongly — not the caller's fault and not a crash. A 500,
 * but with a message that says what to fix, because the alternative is an
 * operator reading "Something went wrong" and guessing.
 */
export class MisconfigurationError extends AppError {
  constructor(message: string) {
    super(500, 'SERVER_MISCONFIGURED', message);
  }
}
