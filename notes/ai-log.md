# AI collaboration log

Raw working notes. Appended to as work happens, not tidied afterwards. Records
what was asked, what came back, and what changed between the first output and
what was kept — especially the wrong, outdated and rejected parts. It is not
meant to be flattering and it is not a summary of the finished code.

Tool: Claude Code (Opus 5).

---

## 2026-08-21 — Design review before any code

**Asked:** propose the folder structure and the schema for `users`, `categories`,
`statuses`, `feedback_requests`; say where the current-user seam sits and what
its signature is; give the error response shape; say what in the locked
decisions looks wrong.

**Came back:** the structure and schema roughly as they now stand, plus one
objection and four open questions.

### Kept as proposed

- `slug`/`name` split on taxonomy rows, `archived_at` instead of deletion, and
  `ON DELETE RESTRICT` on `author_id`. Noted by the reviewer as things they had
  not asked for and were keeping. The RESTRICT reasoning — "the database refuses
  until the application says explicitly what should happen" — was called better
  than the decision itself.
- The error envelope, the seam signature, offset pagination, `mysql2` with
  hand-written SQL, Zod.

### The role-rule objection — overturned a locked decision

The original decision 6 said an admin may only demote *themselves*. Raised as
wrong: a departed or mistaken admin would be unremovable through the
application, and the only recovery is a manual database edit, which is exactly
what the audit trail exists to prevent.

Accepted. The reviewer's original concern had been admins demoting each other in
a dispute; they judged that exposure smaller because it is reversible, recorded
and blocked at the last admin. Rule is now: any admin may promote or demote any
user, refused when it would leave zero admins, every change recorded.

Worth noting for the record because it went the other way from most of this
session: the model's objection changed a decision the human had already locked,
rather than the reverse.

### The pinning-index justification — right output, wrong reasoning

The proposal said `is_pinned` was included in `idx_requests_feed` from day one
"so the sort never changes underneath the pagination later."

That is false and the reviewer caught it by reading the rationale rather than
the result. The brief requires sorting by vote count, which becomes the primary
sort key once voting lands, and the vote count is derived rather than stored so
this index cannot serve it at all.

The index and the `id` tiebreaker were kept unchanged — the total-order argument
for `id` is correct. Only the justification was rewritten, in the migration
comment and in `DECISIONS.md`, to say plainly that this index serves the current
sort and that vote-count sorting will need separate treatment.

This is the failure mode to watch in this log: plausible-sounding reasoning
attached to a correct artefact, which survives review unless someone reads the
*why* rather than the *what*.

### The `is_default` constraint — correct implementation, overstated guarantee

The generated-column-plus-unique-key trick was proposed as enforcing that
exactly one status is the default. It enforces *at most one*. Nothing stops an
admin clearing every default and leaving the table without one, at which point
request creation breaks.

Implementation kept, wording corrected in the migration comment and
`DECISIONS.md`. The lower bound is now explicitly application logic in the
statuses slice, and `POST /api/requests` fails loudly with a
`SERVER_MISCONFIGURED` error naming the fix rather than inventing a status or
writing a NULL.

### Corrections the reviewer added that the proposal had missed entirely

- **The seam had no structural lock.** `DEV_CURRENT_USER_EMAIL` as proposed was
  an unauthenticated impersonation mechanism with nothing but convention keeping
  it out of a deployed environment. Now a hard boot failure in the config module
  when `NODE_ENV=production` and the development seam is compiled in, asserted
  against `IDENTITY_MODE` rather than against the env var alone, so removing the
  variable does not quietly re-open it.
- **Tests were missing from the proposed structure** despite the README having
  to document how to run them.
- **No database container**, despite MySQL being needed from day one.
- **A hand-written migration runner** had been proposed. Corrected: keep raw
  `.sql`, use an existing runner.

---

## 2026-08-21 — Slice 1 implementation

### Migration runner: first choice rejected on inspection

Went to `db-migrate` first because it has a documented SQL-file mode. Generated
a migration to check the layout and it produced, per migration, a 50-line
CommonJS stub that reads the `.sql` file and `console.log`s the entire file
contents on every run. Four of those would have buried the DDL a reviewer is
supposed to read.

Uninstalled it and switched to **postgrator**: plain `001.do.users.sql` /
`001.undo.users.sql` files with no per-migration JavaScript, its own
`schema_migrations` table, ordering, and checksum validation. The glue is a
wrapper that hands it a mysql2 connection.

Caught only because the generated file was actually opened and read. Picking a
package by its README description would have shipped the stubs.

### Windows path bug in the runner glue

First migration run reported "already up to date" at schema version 0 — it had
matched nothing. `path.join` produces backslashes and postgrator matches its
`migrationPattern` with a glob, which does not accept them. Fixed by normalising
to forward slashes.

A silent no-op that reports success. Worth remembering that "already up to date"
and "found nothing" looked identical here.

### Two bugs found by exercising the API rather than by reading it

1. **`requestId` was `"unknown"` on malformed JSON.** `express.json()` was
   mounted before the request-id middleware, so a body that failed to parse
   produced a 400 with no traceable id — precisely the response most worth
   tracing. Moved `attachRequestId` first.
2. **Unknown-field errors reported `field: "(root)"`.** Zod reports
   `unrecognized_keys` with an empty path and the offending keys in a separate
   property, so the generic path-mapping produced nothing useful. Now emits one
   entry per key, named, so the client can point at the field.

Both would have passed a code review. Neither would have passed a user.

### Scope gap: the create form could not be built as specified

Slice 1 as agreed includes a create-request form with a category, and no
categories endpoint. Since categories are admin-managed data rather than an
application enum, the form cannot be built without reading them. Hardcoding the
four seeded categories in the frontend would have contradicted the entire reason
they are a table.

Added a read-only `GET /api/categories`. Managing categories stays in its own
later slice. Flagged rather than done silently.

### Angular version blocker

`ng new` refused: Angular 22 requires Node 24.15.0+, the machine had 24.12.0.
Three options put to the reviewer — Angular 21 instead, `fnm` with a repository
pin, or a global Node upgrade. Chose the `fnm` pin, so `.node-version` now pins
24.19.0 and "latest stable Angular" holds without touching the machine's global
Node.

### Frontend test scaffolding fought back

Three separate failures before the component tests ran, all in the test harness
rather than the components:

1. `TestBed` was not reset between tests under the vitest runner, so every test
   after the first failed with "test module already instantiated" instead of its
   own reason. Reset moved into a `finally` so a `verify()` failure does not
   mask every later test.
2. `await fixture.whenStable()` before flushing the mocked response deadlocked —
   the testing backend holds the request until the test flushes it, so waiting
   for stability first waits forever. Every test timed out at 5s. Changed to
   `detectChanges()` first, flush, then await.
3. `httpResource` propagates its response over a microtask, so `detectChanges()`
   straight after `flush()` still saw no data. The create-form tests failed in a
   way that pointed at the component (no `<option>` elements, submit button
   still disabled) when the cause was entirely in the test. Needed
   `await whenStable()` after the flush.

Then a passing suite still emitted an unhandled rejection, because the success
path navigates to `/requests` and the test router had no routes. Passing tests
with an unhandled rejection in the output is worse than a failure; added a stub
route.

### Verified rather than assumed

- Descending index confirmed present on `feedback_requests` via `SHOW INDEX`
  (`Collation = D` on all three columns), and `utf8mb4_0900_ai_ci` confirmed on
  every table, rather than trusting the DDL to have been applied as written.
- The production boot guard was run as a real process, not only unit-tested: it
  exits 1 with the explanatory message.
- The identity seam was checked by restarting under a different seeded user and
  confirming authorship of a new request followed it.
- Pagination checked at a page past the end, where the `COUNT(*) OVER ()`
  optimisation returns nothing and the fallback count runs.

### Still unverified

The two screens are covered by 13 component tests in jsdom and both builds are
clean, but no one has looked at them in a real browser. Layout, focus order and
the dark scheme are unverified visually.
