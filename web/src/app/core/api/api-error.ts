import { HttpErrorResponse } from '@angular/common/http';

/**
 * The client-side mirror of the API's error envelope. Every failure the UI
 * handles arrives in this shape, whatever went wrong underneath, so no component
 * has to know what an HttpErrorResponse looks like.
 */
export interface FieldIssue {
  field: string;
  code: string;
  message: string;
}

export interface ApiError {
  /** HTTP status, or 0 when the request never reached the server. */
  status: number;
  code: string;
  message: string;
  /** Populated on 422 only. Keyed onto form controls by field path. */
  details: FieldIssue[];

  /**
   * Populated on 429 only: seconds until the same call would be accepted.
   *
   * Read from the body rather than the Retry-After header, because a screen
   * should not have to reach into headers to write a sentence. The header is
   * sent too, for anything that is not this client.
   */
  retryAfterSeconds: number | null;

  requestId: string | null;
}

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: FieldIssue[];
    retryAfterSeconds?: number;
    requestId: string;
  };
}

function looksLikeEnvelope(body: unknown): body is ErrorEnvelope {
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof (body as ErrorEnvelope).error?.code === 'string'
  );
}

/**
 * Resources wrap a thrown non-Error value, so the HttpErrorResponse can arrive
 * either directly or as the cause of a wrapper. Unwrapping here means callers
 * never have to care which.
 */
function unwrap(error: unknown): unknown {
  if (error instanceof HttpErrorResponse) return error;
  if (error instanceof Error && error.cause !== undefined) return unwrap(error.cause);
  return error;
}

export function toApiError(raw: unknown): ApiError {
  const error = unwrap(raw);

  if (error instanceof HttpErrorResponse) {
    if (looksLikeEnvelope(error.error)) {
      const envelope = error.error.error;
      return {
        status: error.status,
        code: envelope.code,
        message: envelope.message,
        details: envelope.details ?? [],
        retryAfterSeconds: envelope.retryAfterSeconds ?? null,
        requestId: envelope.requestId ?? null,
      };
    }

    // Status 0 means the browser never got a response: the API is down, the
    // proxy is misconfigured, or the network dropped. Saying "server error"
    // here would be a guess.
    if (error.status === 0) {
      return {
        status: 0,
        code: 'NETWORK_UNAVAILABLE',
        message: 'Could not reach the server. Check that the API is running.',
        details: [],
        retryAfterSeconds: null,
        requestId: null,
      };
    }

    return {
      status: error.status,
      code: 'UNEXPECTED_RESPONSE',
      message: `The server responded with ${error.status} but not in the expected format.`,
      details: [],
      retryAfterSeconds: null,
      requestId: null,
    };
  }

  return {
    status: 0,
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : 'Something went wrong.',
    details: [],
    retryAfterSeconds: null,
    requestId: null,
  };
}

/** Field issues the form could not attach to a control, so they are not lost. */
export function unassignedIssues(error: ApiError, knownFields: readonly string[]): FieldIssue[] {
  return error.details.filter((issue) => !knownFields.includes(issue.field));
}

/**
 * How long to wait, in words somebody can act on.
 *
 * "Try again in 3,347 seconds" is a number, not an answer. Rounded up on
 * purpose: telling somebody to come back in an hour when it is really an hour
 * and a minute earns a second refusal.
 */
export function waitInWords(seconds: number): string {
  if (seconds < 90) return 'in under a minute';

  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `in about ${minutes} minutes`;

  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? 'in about an hour' : `in about ${hours} hours`;
}
