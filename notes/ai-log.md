# AI collaboration log

Raw working notes. Appended to as work happens, not tidied afterwards. Records
what was asked, what came back, and what changed between the first output and
what was kept — the wrong, outdated and rejected parts, and also the places
where the output was better than the instruction, because a log that only
contains corrections is not an honest record of how the work went either.

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

Worth noting because it went the other way from most of this session: the
model's objection changed a decision the human had already locked, rather than
the reverse.

### The pinning-index justification — right output, wrong reasoning

The proposal said `is_pinned` was included in `idx_requests_feed` from day one
"so the sort never changes underneath the pagination later."

That is false, and the reviewer caught it by reading the rationale rather than
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
  it out of a deployed environment.
- **Tests were missing from the proposed structure** despite the README having
  to document how to run them.
- **No database container**, despite MySQL being needed from day one.
- **A hand-written migration runner** had been proposed. Corrected: keep raw
  `.sql`, use an existing runner.

### The boot guard — output went past the instruction

The instruction was specific: fail to boot when `NODE_ENV=production` and the
development seam is active. The obvious reading is to assert on
`DEV_CURRENT_USER_EMAIL`, since that is the variable that switches the seam on.

What was implemented instead asserts on `IDENTITY_MODE` — a constant in
`api/src/auth/identity-mode.ts` recording which identity implementation is
compiled into the build — and treats the environment variable as a secondary
check.

The difference matters. Guarding on the variable alone means that deleting it
looks like disabling the seam, while `resolveCurrentUser` is still the
development implementation that authenticates nobody. Production would then boot
cleanly with no identity provider at all. Guarding on `IDENTITY_MODE` makes the
check about what the code *is*, not about what the environment happens to say,
and the guard only passes once someone has actually swapped in a real provider.

The reviewer confirmed this closed a hole they had not considered. Recorded here
because it is the one place in this slice where the output improved on the
instruction rather than needing correction — and because the reasoning
generalises: assert on the thing that is true, not on the thing that toggles it.

---

## 2026-08-21 — Slice 1 implementation

### Migration runner: first choice rejected on inspection

Went to `db-migrate` first. It is mature, it has a documented SQL-file mode, and
the description matched the constraint exactly. Rather than take that on faith,
ran `db-migrate create users --sql-file` to see what it actually produces.

It produces three files per migration, not one:

```
migrations/20260821044720-users.js          <- generated stub
migrations/sqls/20260821044720-users-up.sql
migrations/sqls/20260821044720-users-down.sql
```

The `.sql` pair is what was wanted. Alongside them comes a generated CommonJS
stub — about 50 lines of boilerplate whose whole job is to read the `.sql` file
off disk and hand it to `db.runSql`. Inside it, on both the up and the down
path:

```js
fs.readFile(filePath, {encoding: 'utf-8'}, function(err,data){
  if (err) return reject(err);
  console.log('received data: ' + data);   // every run, entire file
  resolve(data);
});
```

Two things in that decided it. The `console.log` dumps the full text of every
migration to stdout on every run, so real migration output — which file is being
applied, what failed — would be buried in echoed DDL. And four near-identical
50-line stubs would sit in the migrations directory beside the four `.sql` files
a reviewer is meant to read, outweighing the actual DDL roughly two to one.

Neither is visible from the README. Both were obvious within seconds of opening
the generated file.

Uninstalled it and switched to **postgrator**: plain `001.do.users.sql` /
`001.undo.users.sql` with no per-migration JavaScript, its own
`schema_migrations` table, ordering, and checksum validation. The glue is a
wrapper that hands it a mysql2 connection.

The general point: the package was chosen on its description and rejected on its
output. Reading what a tool actually emits took one command and would have
changed nothing about the shortlist — only about which one shipped.

### Windows path bug in the runner glue

First migration run reported:

```
schema version: 0
already up to date
```

Version 0 and "up to date" at the same time is a contradiction — it had matched
no files at all. `path.join` produces backslashes on Windows and postgrator
matches `migrationPattern` with a glob, which does not accept them. Fixed by
normalising to forward slashes.

Worth remembering because the failure mode is a silent no-op that exits zero and
prints a success message. "Found nothing" and "nothing to do" looked identical.

### Two bugs found by exercising the API — and how

Neither came from reading the code. Both came from the habit of, once an
endpoint returns 201, immediately throwing bad input at it and reading the
actual response body rather than just the status code.

**How the first was noticed.** After the happy path worked, sent three curls in
a row — valid, semantically invalid, and syntactically malformed:

```bash
curl -X POST localhost:3000/api/requests -d '{not json'
```

The status was right (400) and the message was right, so a status-code
assertion would have passed. Reading the whole body showed:

```json
{"error":{"code":"BAD_REQUEST","message":"The request body is not valid JSON.",
          "requestId":"unknown"}}
```

`"unknown"`. Every other response carried a real id. `express.json()` was
mounted before the request-id middleware, so a body that failed to parse
produced the one class of response with no way to trace it to a log line —
precisely the response most worth tracing. Moved `attachRequestId` first.

**How the second was noticed.** The same batch included a payload with fields
the client has no business setting, to check they were rejected rather than
dropped:

```bash
curl ... -d '{"title":"...","description":"...","categoryId":2,
              "status":"Done","isPinned":true}'
```

422 as intended, and the summary message was correct. But the `details` array
read:

```json
[{"field":"(root)","code":"UNKNOWN_FIELD","message":"Unrecognized key: \"status\""}]
```

One entry for two bad keys, `field` pointing at the payload as a whole, and the
message a raw Zod string. Zod reports `unrecognized_keys` with an empty path and
the offending keys in a separate property, so the generic path-mapping had
nothing to work with. Now emits one entry per key, each naming the key, so a
client can point at the field that caused it.

Both would have passed a code review and both would have passed a test that only
asserted the status code. The method that caught them was sending hostile input
early and reading the whole response, not just checking it was red.

### Scope gap: the create form could not be built as specified

Slice 1 as agreed includes a create-request form with a category, and no
categories endpoint. Categories are admin-managed data rather than an
application enum, so the form cannot be built without reading them, and
hardcoding the four seeded values in the frontend would have contradicted the
entire reason they are a table.

Added a read-only `GET /api/categories`. Managing categories stays in its own
later slice. Raised with the reviewer rather than done quietly; approved.

### Angular version blocker

`ng new` refused: Angular 22 requires Node 24.15.0+, the machine had 24.12.0.
Three options put to the reviewer — Angular 21 instead, `fnm` with a repository
pin, or a global Node upgrade. Chose the `fnm` pin, so `.node-version` holds
24.19.0 and "latest stable Angular" survives without touching the machine's
global Node.

### Frontend test scaffolding fought back

Three failures before the component tests ran, all in the harness rather than
the components:

1. `TestBed` was not reset between tests under the vitest runner, so every test
   after the first failed with "test module already instantiated" instead of its
   own reason. Reset moved into a `finally` so a `verify()` failure does not
   mask every later test.
2. `await fixture.whenStable()` before flushing the mocked response deadlocked —
   the testing backend holds the request until the test flushes it, so waiting
   for stability first waits forever. Every test timed out at 5s. Changed to
   `detectChanges()` first, flush, then await.
3. `httpResource` propagates its response over a microtask, so `detectChanges()`
   straight after `flush()` still saw no data. The create-form tests then failed
   in a way that pointed at the component — no `<option>` elements, submit
   button still disabled — when the cause was entirely in the test. Needed
   `await whenStable()` after the flush.

Then a passing suite still emitted an unhandled rejection, because the success
path navigates to `/requests` and the test router had no routes. A green suite
with an unhandled rejection in the output is worse than a red one; added a stub
route.

### Verified rather than assumed

- Descending index confirmed on `feedback_requests` via `SHOW INDEX`
  (`Collation = D` on all three columns), and `utf8mb4_0900_ai_ci` confirmed on
  every table, rather than trusting the DDL to have been applied as written.
- The production boot guard was run as a real process, not only unit-tested: it
  exits 1 with the explanatory message.
- The identity seam was checked by restarting under a different seeded user and
  confirming authorship of a new request followed it.
- Pagination checked at a page past the end, where the `COUNT(*) OVER ()`
  optimisation returns nothing and the fallback count runs.
- The compiled `dist` build was started and served requests, not just emitted.

---

## 2026-08-21 — Review round 1

### The tests proved the wrong claim

The reviewer asked which kind the policy tests were: direct calls asserting a
rule returns false, or requests through the route asserting a 403.

They were all the first kind — `requestPolicy.editContent(bystander, request)`
and similar. That proves the rules are written correctly. It says nothing about
whether any handler asks, and the vulnerability that actually ships is the
second one: an endpoint that forgets to check keeps every one of those tests
green.

This had been reported in the previous summary as "16 API tests (policy rules
incl. the non-author/non-admin refusal)", which is true and misleading in the
same sentence. The count was right; the implied coverage was not.

**Constraint that had to be stated rather than worked around.** No endpoint in
slice 1 can return 403. Every rule a route reaches — create, list, list
categories — allows any authenticated user. Edit, delete, change-status and pin
have policy rules but no routes. So the two cases the reviewer asked for could
not be written without building slice 2 endpoints to test against.

What was built instead: a supertest harness over the real Express app, proving
the mechanism — each route consults the policy with the acting user, a denial
becomes a 403 in the standard envelope and not a 404 or a 500, and the denial
stops the work rather than only changing the status code. The file states in a
header comment exactly which cases it cannot cover yet and that asserting them
is part of the first denying slice's definition of done.

### Writing that test found a real ordering bug

One of the first tests written was "checks permission before validating the
body". It passed immediately — which was suspicious, because nothing had been
written to make it true.

It passed because the test sent a *valid* body, so validation had nothing to
complain about and the 403 came out regardless of order. The test asserted its
own name without testing it.

Rewriting it to send a body that is invalid three ways exposed the actual
behaviour: the controller ran `parseOrThrow` before anything asked the policy,
so an unauthorized caller received a 422 enumerating every field, its type and
its length limits. Free schema disclosure to someone who may not use the
endpoint at all.

Fixed by asking the policy first in the controller, before the body is
inspected. The service still checks too — the controller check is at the edge,
the service check is the boundary any future caller crosses — and the test now
asserts the response is a 403 with no `details` array.

Two lessons, both about tests rather than about the code: a test that passes the
moment it is written has not been shown to test anything, and the name of a test
is a claim that has to be checked against what it actually exercises.

### DECISIONS.md contained decisions about code that did not exist

The reviewer's rule: the file should describe only what is in the repository,
because a decisions file that arrives complete before the code reads as written
retrospectively.

Two entries failed that test — "vote and comment counts are derived, never
stored" (no votes or comments table exists) and the role-change reversal (no
role-change endpoint, no audit table). Both moved to
`notes/decisions-pending.md`, which exists to hold commitments already argued
out but not yet true, each with the slice that will move it back.

One judgment call kept in place: the note under the feed index saying it cannot
serve a sort by vote count. That describes the limits of an index that exists,
not a decision about unwritten code, and deleting it would restore exactly the
overclaim the previous round required removing.

### Two version-pinning defects

Checking the reviewer's question rather than answering it from memory turned up
both.

`engines.node` said `^24.19.0` while `.node-version` said `24.19.0`. The caret
permits 24.20 and above, so the two files did not name the same version. Set to
exact.

And `.node-version` had a UTF-8 BOM — `efbbbf` before the digits — because it
was written from PowerShell with `-Encoding utf8`. The file read as `﻿24.19.0`
rather than `24.19.0`. Rewritten without it.

The BOM is the more interesting one: nothing had failed. `node -v` still
reported the right version because the correct Node was already on PATH from the
install, so the pin had never actually been exercised.
