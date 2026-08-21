import { z } from 'zod';
import { ValidationError, type FieldIssue } from './errors.js';

/**
 * Turns a Zod failure into the `details` array of the error envelope.
 *
 * The array is ordered rather than a { field: message } map on purpose: one
 * field can fail two ways at once, and the order they are reported in is the
 * order the form shows them.
 */
function toFieldPath(path: PropertyKey[]): string {
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    return acc ? `${acc}.${String(segment)}` : String(segment);
  }, '');
}

/**
 * Stable machine codes for the client to switch on, derived from the Zod issue
 * rather than from the message text, which is free to be reworded.
 */
function toIssueCode(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.input === undefined ? 'REQUIRED' : 'INVALID_TYPE';
    case 'too_small':
      return issue.origin === 'string' ? 'TOO_SHORT' : 'TOO_SMALL';
    case 'too_big':
      return issue.origin === 'string' ? 'TOO_LONG' : 'TOO_BIG';
    case 'invalid_format':
      return 'INVALID_FORMAT';
    case 'invalid_value':
      return 'NOT_ALLOWED';
    case 'unrecognized_keys':
      return 'UNKNOWN_FIELD';
    default:
      return 'INVALID';
  }
}

const SUMMARY: Record<'body' | 'query' | 'params', string> = {
  body: 'The submitted values are not valid.',
  query: 'The query parameters are not valid.',
  params: 'The URL is not valid.',
};

export function parseOrThrow<T>(
  schema: z.ZodType<T>,
  input: unknown,
  source: 'body' | 'query' | 'params',
): T {
  const result = schema.safeParse(input);

  if (result.success) {
    return result.data;
  }

  const details: FieldIssue[] = result.error.issues.flatMap((issue) => {
    // An unrecognized-keys issue carries an empty path and a list of the offending
    // keys. Reported as one entry per key, so the client can point at the field
    // that caused it rather than at the payload as a whole.
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        field: toFieldPath([...(issue.path as PropertyKey[]), key]),
        code: 'UNKNOWN_FIELD',
        message: `"${String(key)}" is not a field you can set here.`,
      }));
    }

    return [
      {
        field: toFieldPath(issue.path as PropertyKey[]) || '(root)',
        code: toIssueCode(issue),
        message: issue.message,
      },
    ];
  });

  throw new ValidationError(SUMMARY[source], details);
}
