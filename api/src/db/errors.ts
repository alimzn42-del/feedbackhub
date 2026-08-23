/**
 * Recognising the constraint violations this application deliberately provokes.
 *
 * Uniqueness is checked by letting the database refuse the write, not by
 * SELECTing first: a check-then-insert leaves a window in which two concurrent
 * requests both see "no such name" and both proceed. The same reasoning that
 * makes casting a vote an INSERT IGNORE.
 */
interface DriverError {
  code?: string;
  errno?: number;
  sqlMessage?: string;
}

function asDriverError(error: unknown): DriverError | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as DriverError;
  return typeof candidate.code === 'string' ? candidate : null;
}

/**
 * Whether this is a duplicate-key failure, optionally for one named key.
 *
 * The key name is matched from the driver's message, which reports it as
 * `Duplicate entry 'x' for key 'table.uq_name'`. Matching the name is what lets
 * a handler say WHICH field collided — refusing a rename with "a category
 * called Bug already exists" rather than "that did not work".
 */
export function isDuplicateEntry(error: unknown, keyName?: string): boolean {
  const driver = asDriverError(error);

  if (driver?.code !== 'ER_DUP_ENTRY') return false;
  if (keyName === undefined) return true;

  return (driver.sqlMessage ?? '').includes(keyName);
}
