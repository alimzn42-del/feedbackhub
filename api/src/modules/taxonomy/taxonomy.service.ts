import { isDuplicateEntry } from '../../db/errors.js';
import { ValidationError } from '../../http/errors.js';

/**
 * The parts of managing a taxonomy that are the same for both of them.
 *
 * Categories and statuses differ in what they allow — one is retired, the other
 * has a default — but a duplicate name is a duplicate name, and a reorder that
 * does not name every row is wrong in the same way for both.
 */

export interface DuplicateKeys {
  /** The unique key on the name column, e.g. `uq_categories_name`. */
  name: string;
  slug: string;
}

/**
 * Turns the database's refusal into a message the form can put next to the
 * field that caused it.
 *
 * A duplicate is reported as 422 rather than 409. Both are defensible; this one
 * is chosen because the caller is a form and the answer belongs against an
 * input, in the same shape as every other field error the client already knows
 * how to render. A 409 would be correct about the state of the world and
 * useless to the screen.
 */
export function rethrowDuplicate(
  error: unknown,
  keys: DuplicateKeys,
  noun: string,
  value: { name: string; slug?: string },
): never {
  if (isDuplicateEntry(error, keys.name)) {
    throw new ValidationError('The submitted values are not valid.', [
      {
        field: 'name',
        code: 'DUPLICATE',
        message: `A ${noun} called "${value.name}" already exists.`,
      },
    ]);
  }

  if (value.slug !== undefined && isDuplicateEntry(error, keys.slug)) {
    throw new ValidationError('The submitted values are not valid.', [
      {
        field: 'slug',
        code: 'DUPLICATE',
        message: `The slug "${value.slug}" is already taken by another ${noun}.`,
      },
    ]);
  }

  throw error;
}

/**
 * A reorder must name every row exactly once.
 *
 * Accepting a partial list would mean inventing positions for whatever was left
 * out, and accepting a repeated id would mean two rows claiming one position.
 * Both are refused by name, because both are a client bug and neither should be
 * papered over with a guess.
 */
export function assertCompleteOrder(ids: readonly number[], existing: readonly number[]): void {
  const seen = new Set(ids);

  if (seen.size !== ids.length) {
    throw new ValidationError('The query parameters are not valid.', [
      {
        field: 'ids',
        code: 'DUPLICATE',
        message: 'The same id appears twice in the order.',
      },
    ]);
  }

  const known = new Set(existing);
  const unknown = ids.filter((id) => !known.has(id));

  if (unknown.length > 0) {
    throw new ValidationError('The submitted values are not valid.', [
      {
        field: 'ids',
        code: 'NOT_FOUND',
        message: `No row with id ${unknown[0]} exists here.`,
      },
    ]);
  }

  if (ids.length !== existing.length) {
    throw new ValidationError('The submitted values are not valid.', [
      {
        field: 'ids',
        code: 'INCOMPLETE',
        message: 'The order must name every row exactly once.',
      },
    ]);
  }
}
