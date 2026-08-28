# AI collaboration log

Raw working notes. Appended to as work happens; two later passes rewrote
earlier entries (`d52fbee`, `93ee4e1`), both visible in git. Records
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

---

## 2026-08-21 — Slice 2: voting

### The requirement that could not be built as literally stated

"The count should be at the API, not on the DB."

Two readings, and they are not close. Either *no counter column exists and the
API returns a count derived from the vote rows* — which is what slice 1 already
committed to — or *Node loads the rows and counts them in JavaScript*.

The second breaks two locked rules at once. To order the whole board by votes
the API would need every request and every vote in memory before it could pick
page one, so sorting and pagination stop being server-side, and the cost grows
with every vote ever cast.

Rather than pick the convenient reading and move on, or refuse and stall, the
two options were put back with the actual SQL and the actual JavaScript side by
side, so the difference was visible rather than described. Confirmed as the
first reading — no counter column. Worth noting that the phrasing was not wrong,
it was ambiguous, and the ambiguity was only visible to someone who knew what
the second reading would cost.

### The first rule in this codebase that refuses anybody

"Can an author vote on their own request?" — answered no, it does not make
sense. That is a bigger deal than it looks.

Every rule reachable by a route until now allowed any authenticated user. The
reviewer had asked, two rounds ago, for authorization tested through the route
rather than only in the policy — a real request refused with a real 403 — and it
could not be written, because nothing could be refused. The route-level tests
had to deny artificially by stubbing the policy, and the test file said so.

Self-voting is refused by the real policy, on a real request, with nothing
stubbed to make it happen:

    POST /api/requests/4/vote      (as the author)
    403  {"code":"FORBIDDEN","message":"You cannot vote on your own request."}

The test asserts both the refusal and that no write occurred. Still unreachable:
a regular user refused an *admin-only* action. Change status and pin have rules
but no routes.

### canVote is computed on the server, and that was not the first design

The card needs to disable its vote control on your own request. The obvious
route is for the browser to compare the author id it already has against the
current user id — except the browser is never told who it is. There is no /me
endpoint, deliberately: identity is the deferred half of the auth decision.

The first instinct was to add one. The better answer was to notice that the
client does not need identity at all, it needs an answer: every list row now
carries `canVote`, computed per row by the policy module. The rule stays in one
place, the browser cannot drift out of step with it, and no new endpoint had to
exist to support a checkbox.

### Measuring the sort instead of asserting it

Slice 1's log recorded a claim caught by the reviewer: reasoning that sounded
right attached to an artefact that was right, which survived review only because
somebody read the *why*. The sort here was the same risk — "no index can serve
it" is easy to say and easy to be wrong about.

So it was measured. `EXPLAIN` on the real query against the real data:

    table  type    key                            rows  Extra
    c      index   idx_categories_display_order   4     Using index; Using filesort
    r      ref     idx_requests_category          7
    u      eq_ref  PRIMARY                        1     Using index
    s      eq_ref  PRIMARY                        1     Using index
    <cte>  ref     <auto_key0>                    2

Filesort confirmed, over the full matching set rather than the page — `LIMIT`
cannot help, because which twenty rows to return is not known until all of them
are sorted. Every join is an index lookup and the CTE is materialised with an
auto-generated key. The claim held, but it is now recorded as a measurement
rather than as a confident sentence.

### Verified by exercising, again

Each of these was run against the live API or the live database rather than
inferred from the code:

- Self-vote refused 403; unknown request 404; non-numeric id 422 naming `id`.
- Duplicate cast 409; withdraw twice 200 both times; counts correct after each.
- Sort order 2,2,1,1,1,1,1,0 with ties broken consistently.
- A pinned request with **zero** votes still sorts above two-vote requests —
  the point of "pinning is absolute" is exactly that it survives the vote sort.
- `canVote:false` on a request the caller authored, confirmed on a row created
  during the check rather than a seeded one.
- Deleting a request with two votes removed both (CASCADE); deleting a user with
  votes was refused by `fk_votes_user` (RESTRICT). Both behaviours were asserted
  by pointing at the database, not by trusting the DDL to have applied.

### Shell friction worth recording

Two separate rounds were lost to backticks. Generating TypeScript containing
template literals through `node -e "..."` inside bash means the string passes
through two layers that both treat backticks as command substitution, and the
result is silently corrupted code — `this.http.post(, {})` — that only fails at
compile time. Twice. The fix both times was to stop generating code through the
shell and write the file directly.

Also: `ng serve` had written an analytics UUID into `web/angular.json` during
manual testing. Pinned to `false` explicitly rather than committing a generated
identifier, and rather than leaving it to reappear next time somebody runs the
CLI on a fresh machine.

---

## 2026-08-21 — Slice 3: pinning

### Asked for an opinion, and gave one that partly disagreed

The requested design: a pinned panel at the top, three visible, "show more"
expanding into a scrollable list, the name of whoever pinned it, no limit on how
many can be pinned, and no duplication between the panel and the list.

Most of that is better than what it replaced, and the reason is worth writing
down. Slice 2 ordered pinned requests first *inside* the single list. That put
them at the top of page 1 only and shifted every other row along, so the
pagination was subtly wrong — page 2 began one row later than it looked like it
should. Splitting the board into two collections removes the interleaving
entirely and makes both queries simpler.

The disagreement was unlimited pinning: a board where twenty things are pinned
has nothing pinned. That was said in one sentence and then the feature was built
as asked, because it is the reviewer's product call and not a correctness
question. What did change as a result: the panel shows the total so
over-pinning is visible, the endpoint is capped at 100 so a runaway cannot blow
up the page, and the panel says when it is not showing everything rather than
truncating in silence.

### The boolean had to go, and that was not in the request

"Show who pinned it" sounds like a display change. It is a schema change: a
boolean cannot carry an actor.

The first instinct was to add `pinned_by` alongside `is_pinned`. That would have
left two columns describing one fact, free to disagree the first time something
set one and forgot the other — exactly the argument used twice already in this
project to keep a vote counter out of the schema. So `is_pinned` was dropped and
"pinned" became derived: `pinned_at IS NOT NULL`.

The migration had a detail worth recording. One request was already pinned, set
by hand during slice 2 testing. It has a time but no actor, because nobody
recorded one. `pinned_by` stays NULL and the UI says "Pinned" rather than
"Pinned by ...", instead of attributing it to an admin who did not do it. There
is a test for that specific case.

### The test that has been outstanding for three rounds

Two rounds ago the reviewer asked for authorization tested through the route:
a real request, refused, with a real 403. It could not be written, because
nothing in the application refused anybody.

Slice 2's no-self-voting rule got halfway there — a genuine refusal, but one
that applies to everybody equally. Pinning is the first rule that refuses based
on *who you are*. Verified live, not just in tests:

    PUT /api/requests/12/pin        (as Dana, role 'user')
    403  Only an admin can pin or unpin a request.

One assertion in that group is worth more than the rest:

    it('refuses before checking whether the request exists')

A refused caller must not be able to use the endpoint as an id oracle — pinning
id 999999 as a regular user returns 403, not 404, so nothing leaks about which
ids are real. The test asserts `exists` was never called.

### Two bugs written and caught in the same session

Both came from writing code faster than thinking about it.

**`affectedRows` does not mean what it looks like.** `unpin` originally returned
`result.affectedRows === 1` and the service turned `false` into a 404. But
MySQL's `affectedRows` counts rows *changed*, not rows *matched* — unpinning
something already unpinned changes nothing, so a perfectly valid request would
have 404'd. Existence is now checked separately, which is also what makes the
"refuse before looking up" ordering explicit rather than incidental.

**A cache-busting query parameter would have 422'd.** The first attempt at
keeping the two collections in step added `v: boardVersion()` to both requests
so bumping a signal refetched them. The list query schema is `.strict()` and
rejects unknown parameters, so every list request would have failed — and the
same strictness that was deliberately chosen in slice 1 to make ignored fields
visible is what would have caught it. Replaced with explicit `.reload()` calls,
which do not touch the URL at all.

Neither reached the browser. Both would have, if the code had been written and
committed without reading it back.

### Deliberately not optimistic

Voting updates the count on click and rolls back on failure. Pinning does not,
and the difference is worth stating: a vote changes a number in place, so
guessing is cheap and reversible; a pin moves a request between two collections,
so guessing means rendering it in both or in neither until the server answers.
The row is disabled while the call is in flight instead.

### Shell friction, third time

Same lesson as slice 2, not learned quickly enough: generating code containing
backticks or apostrophes through `node -e "..."` inside bash corrupts silently.
This round it produced a duplicated import that only surfaced at compile time.
Also lost two minutes to `python - <<'PY'`, which hangs waiting on stdin — the
same mistake made earlier in the project.

---

## 2026-08-21 — Comments: schema only

Asked for the database and the migration, explicitly not the feature.

### Tried to put the depth rule in the database, and could not

"A reply cannot be replied to" is the kind of invariant this project has twice
put in the schema rather than in code — the votes primary key, and vote-for-
yourself-only being unexpressible rather than merely checked. So the first
attempt was structural: a stored generated column marking root rows, a unique
key on (id, is_root), and a composite foreign key from (parent_id, 1) into it.

It works. In a scratch database, a reply to a reply fails with error 1452,
enforced by InnoDB with no application code involved.

It cannot ship. MySQL refuses ON DELETE CASCADE on a foreign key involving
generated columns (error 1215), and without that cascade the self-reference
blocks its own parent's deletion — deleting a request fails with error 1451
while replies still point at their root. Verified both directions in a probe
database rather than reasoned about.

So the choice was: the database guarantees the depth limit, or the database
guarantees that deleting a request removes its comments. Only one was on offer.
Kept the cascade, because comments outliving their request whenever code forgets
is the worse failure, and wrote the finding into the migration so the next
reader does not have to rediscover it.

What survived from the attempt: the composite foreign key idea, repurposed. The
parent reference is (parent_id, request_id) into (id, request_id), which makes
it impossible for a reply on one request to answer a comment on another. That
was not in the requirement and is a real bug prevented for free.

### The probe that was not close enough to the real thing

The CHECK constraint tying deleted_at to deleted_by was tested in isolation and
accepted. It then failed on the real table:

    Column 'deleted_by' cannot be used in a check constraint
    'chk_comments_deletion': needed in a foreign key constraint
    'fk_comments_deleted_by' referential action.

The probe had the CHECK but no foreign key on that column. MySQL refuses a CHECK
on a column carrying a referential action, so the two only conflict when both
are present — exactly the combination the probe left out. Fixed by dropping
ON UPDATE CASCADE from that one foreign key, which bought nothing anyway since
user ids never change.

The lesson is narrow and worth keeping: a probe that omits part of the final
shape tests a different thing than the one being shipped.

### A test that produced the right rows and the wrong meaning

After the table was applied, the four deletion rules were exercised against real
rows. The output looked correct — until the tombstone column:

    id  author_id  deleted_by  tombstone
    2   2          2           author removed this
    3   3          2           an admin removed this      <- wrong

Row 3 is Sam's reply, hidden because Dana removed the comment it answered. Dana
is not an admin and moderated nobody. The naive rule "deleted_by <> author_id
means moderation" is wrong for every reply hidden alongside its parent, and the
screen would have told Sam an admin removed his words.

Three explanations, only two derivable. Added `hidden_with_parent` in its own
migration and left author-versus-admin derived from deleted_by, which genuinely
is a fact about the data rather than a second copy of one.

Migration 007 was already committed and pushed when this surfaced. It was not
edited: postgrator checksums applied migrations, and rewriting one that another
checkout may already have run turns a pull into a failure. 008 adds the column.
Slightly noisier history, no chance of a broken checkout.

### The requirement contradicted itself, and it mattered

Four deletion rules were given. Two of them covered the same case and disagreed:
a user deleting their own comment that has replies was hard-deleted by one rule
and soft-deleted by another.

Not a wording quibble. The parent_id cascade means hard delete physically
removes every reply underneath — other people's words destroyed because the
person above them changed their mind. Put back as a two-option question showing
what each does to the rows rather than describing the difference. Soft won.

### Shell friction, fourth time

Generating markdown containing backticks through `node -e "..."` inside bash
corrupted the file again. Fourth occurrence in this project. Switched to writing
files directly, which is what should have happened after the first.

---

## 2026-08-21 — Comments: API and screens

Asked for "the front comment, only not the setting". Built the endpoints too:
the previous round was schema only, so a comment UI would have had nothing to
talk to.

### Two things the request implied but did not say

A comment thread needs somewhere to live, and the board only ever sends an
excerpt — the full description of a request had nowhere to be read, and a
discussion had no URL anybody could send a colleague. So the slice grew a
detail page and a `GET /api/requests/:id` to feed it. That was raised as a
question the round before and not answered; built to the recommendation rather
than stalling on it, and flagged here.

The board also gained a comment count. Derived, like the vote count, and
counting only visible comments — a hidden comment stays in the table for the
audit trail but is not something a reader can open.

### The test that found a real gap

Writing "refuses to send an empty comment" produced a passing assertion on the
network — nothing was sent — and a failing one on the screen. `Validators.
required` accepts a string of spaces. The server does not: Zod trims before
checking length. So typing three spaces and pressing Comment did nothing at all
and said nothing at all.

Added a `notBlank` validator to all three composers. Worth recording because
the bug is invisible from either side alone: the client thought the value was
present, the server would have rejected it, and the user saw silence.

### Deliberately not optimistic, and why that is not inconsistent

Voting updates the count on click. Deleting a comment does not, and the
difference is the number of possible outcomes. A vote changes an integer in
place — one shape, trivially reversible. A delete can remove the row, replace
it with a tombstone, or hide several replies alongside it, and which one
depends on rules the browser does not hold. Guessing means rendering one of
three and correcting it a moment later.

### Where the shape came from

The reply control is not rendered on a reply at all, rather than rendered and
refused. The server sends `canReply: false` and the template has no branch that
would draw it. Same for edit and delete: the browser is never told who it is,
so it never decides — it is told, per row, what it may do.

### Verified by exercising

Ran the four deletion rules through the live API rather than trusting the unit
tests: an admin deleting their own comment that has a reply produced

    {"kind":"soft","repliesHidden":1}

    root  9 | deleted true | reason author      | body null
    reply 10 | deleted true | reason with-parent | body null

which is the case that motivated the `hidden_with_parent` column two rounds
ago — the reply is hidden, and it says so honestly rather than claiming a
moderator did it.

Also confirmed a reply to a reply is a 422 naming `parentId`, and that
`/requests/4` serves.

### A commit that did not happen

The service tests were meant to be their own commit. `git add
api/src/modules/comments` had already taken them in with the API, so the second
commit was empty. Left as it landed rather than rewritten — the history is
slightly less granular than intended and entirely accurate, which is the better
of the two.

### The comment box did nothing, and the tests said it worked

Reported: "I write the comment but doesn't save... each time refresh".

Both halves were one bug. Each composer is a single `FormControl`, not a
`FormGroup`, so no Angular directive was attached to its `<form>` element — and
`ngSubmit` is an output of `NgForm` or `FormGroupDirective`, not of `<form>`
itself. Binding `(ngSubmit)` on a bare form is silent: Angular registers a
listener for a DOM event named "ngSubmit" that nothing ever raises. The click
fell through to the browser, which submitted the form natively and reloaded the
page. Hence "doesn't save" and "each time refresh" — the second was a literal
description of the page reloading, not a complaint about the refetch.

Diagnosed by looking rather than guessing: the comments table held only the two
rows from earlier testing, the API log showed no errors, and `/health` was fine.
Nothing had left the browser.

**Why twelve passing tests missed it.** Every one of them called
`component.submitComment()` directly. The method was always correct; the path
from the button to the method was not, and no test crossed it. A dead button
with a working handler passes every test that starts at the handler.

Two tests added that start at the DOM: one types into the real textarea and
clicks the real button, one dispatches a native submit and asserts
`defaultPrevented`. Both were confirmed to fail against the old template and
pass against the new one, by reintroducing the bug and running them — a test
that has not been seen to fail has not been shown to test anything.

**And the refetch went too.** Creating and editing now patch the thread in place
using the comment the server already returned, rather than asking for the whole
thread again to learn something already known. Deleting still refetches, and
that one is not laziness: the server chooses between removing the row, leaving
a tombstone, and hiding replies alongside it, so there are three possible shapes
and the browser holds none of the rules that pick between them.

---

## 2026-08-22 — Slice 5: filters, search and sort

### Asked before building, and it changed the shape

Four questions went back before any code: which filters, which orderings,
whether the pinned shelf is filtered too, and one value per filter or several.
The answers were all four filters (status, category, mine, text search), newest
and oldest alongside the existing vote order, an unfiltered shelf, and several
values per filter.

Two of those answers changed the design rather than decorating it. Several
values per filter turned every taxonomy filter into an `IN` list with slug
resolution and multi-value parsing on both sides. An unfiltered shelf meant the
board can show a pinned request that contradicts the filter below it, which is
the kind of thing that reads as a bug when nobody says it out loud — so the
filter bar says it out loud.

"Most liked" was asked for as a third ordering. It is the vote count, which was
already the default, so it became `sort=votes` — selectable rather than new.
Stated rather than asked again, because there was no second reading of it worth
a round trip.

### The endpoint that was missing before the slice could start

Filtering by status needs the statuses by name, and nothing in the API offered
them. `statuses.repository.ts` had exactly one function, `findDefaultId`, for
request creation; there was no controller, no route, no policy. The board only
ever showed the status on a row, so the browser had never needed the list.

`GET /api/statuses` is the same shape as `GET /api/categories` — read-only,
unpaginated, archived excluded, one policy rule that allows any authenticated
user. Noted in DECISIONS.md under Scope next to the slice 1 note about
categories, because it is the same call for the same reason.

### Refusing a filter that names nothing

The first draft filtered on the joined taxonomy's slug: `WHERE s.slug IN (...)`.
It is one query and it reads well, and it is wrong in two ways.

It cannot use `idx_requests_status`, because the column being filtered is
reached through a join. And it silently returns nothing for a slug that does not
exist, which is indistinguishable from a filter that legitimately matched
nothing.

Resolving slugs to ids first costs one small query per filter actually used —
none when no filter is present — and fixes both. `WHERE r.status_id IN (...)`
hits the index, and a slug that resolves to nothing is a `422` naming the value,
in the same shape as an unknown category on create. One detail entry per bad
value rather than one for the parameter, so the filter bar can drop exactly the
chip that is wrong.

The lookup deliberately ignores `archived_at`, unlike the one that populates the
options. Archiving retires a status from the choices offered for a new request;
it does not retire the requests already carrying it, and a link shared before
the archiving has to still open.

### `IN ()` is a syntax error, not an empty filter

Each clause is added only when its array is non-empty. An empty array renders as
`IN ()`, which MySQL rejects outright rather than treating as "matches nothing".
The clause and its parameters are built together in one function for the same
reason: a condition can never be added without the value it needs.

`?status=` — a filter bar that was cleared — normalises to absent before it gets
anywhere near that, and the test says so.

### Reading value() on a resource in an error state throws

Twenty-one web tests went red the moment the filter bar was mounted, which was
expected: the board now fetches two taxonomies that the existing specs did not
answer. Twenty of them were exactly that. The twenty-first was a real
regression, and worth the whole slice.

The error-state test failed because the filter bar renders *above* the list and
reports the match count whatever the list is doing. `meta()` read
`requests.value()`, and reading `value()` while a resource is in its error state
throws. That had been latent since the board was written — every read sat inside
a branch the error state skipped — and mounting one component above the list was
enough to reach it.

Guarded with `hasValue()` on all four derived signals, including the two over
the pinned resource that had the same latent problem. A derived signal that
throws depending on where it is read from is not worth keeping.

### An input that could disagree with itself

The filter bar first took `filtered` as an input, computed by the parent. A test
failed because the harness did not set it, and the failure was the useful kind:
the bar was rendering filters while being told separately whether it was
filtering. Two sources for one fact.

It derives it now, from the filters it was already given, using the same
one-line helper the list uses for its empty state.

### The submit button, tested by clicking it

`ngSubmit` cost this project a session already, and the search box is a form
with a submit button. It is bound to `(submit)` with `preventDefault`, on a bare
form with neither `NgForm` nor `[formGroup]` — and there is a test that
dispatches a native submit and asserts `defaultPrevented`, plus one that clicks
the real button and one that presses through the real input. Anything a user
touches is touched by a test.

### What is not verified

The SQL. Docker Desktop is stopped, so the filter clauses, the escaped `LIKE`
and the three orderings have been exercised against mocked repositories and a
type checker, not against MySQL. Every previous slice probed the exact final
shape against the real table, and this one has not yet. It is the first thing to
do when the database is back up, and the shape to probe is a filtered,
searched, sorted page — not each clause alone, which is the mistake this log
already records once.

### Reversed within the hour: search as you type

Asked for, right after the slice was built: the search should run while you
type rather than on submit. The original reasoning is in DECISIONS.md and it was
not wrong — a navigation per keystroke does put a history entry behind every
letter and does send a request for every prefix — it just did not follow that
submit-to-search was the only way to avoid either. Both are ordinary problems
with ordinary answers.

Three things had to land together, and none of them is the debounce alone:

- **300ms debounce.** One word, one request. Enter still searches immediately
  and cancels the pending timer, so pressing it does not search twice.
- **`replaceUrl` when only the search term changed.** Otherwise Back walks
  backwards through `d`, `da`, `dar`. Ticking a box or changing the order keeps
  its history entry, because that is a deliberate step. The rule is one pure
  function, `isOnlySearchChange`, so the list is not deciding it inline.
- **Stale rows stay on screen, dimmed.** Skeletons are for a first load. The
  board refetches on every pause in typing, and emptying the list each time made
  a working board look like it was thrashing.

**The race the linkedSignal introduced.** The box re-seeds from the URL, which
is what makes Back and Clear all work. Once it searches as you type, the box's
own search changes that URL — so the re-seed fires while somebody is still
typing and replaces what they have written with what they wrote 300ms ago. It
is a small window, and it is exactly the window a fast typist lives in.

Fixed by recording the term the box last sent in a plain field — deliberately
not a signal, so reading it inside the computation does not make the computation
re-run — and keeping the current value when the incoming term is that one. The
URL catching up with this box is not an external change. There is a test that
types, settles, types again, and then delivers the first navigation late.

**And the flush.** Typing a term and then ticking a status a moment later used
to drop the term: the pending debounce was cancelled and the emitted state came
from the last URL, which did not have it. Any other change now flushes a pending
search into the same navigation. One test, and it also asserts the search does
not then fire a second time when the timer would have expired.

### Reversed again, and this one was the screen telling on itself

The shelf rule changed: it belongs to the default board, and once anything is
filtered it collapses into the results, where the pinned rows rank first and
keep their badge, and the total counts them.

Worth recording *why* the first rule was wrong, because it was chosen on
purpose and it was internally consistent. Pinning is absolute; a filter that can
hide a pinned request makes "pinned" mean less than it says; therefore the shelf
ignores filters. Each step follows. What it produced was a shelf sitting above a
filtered list showing requests that contradict the filter — and a caption
underneath it apologising for that. Writing that caption was the tell. A
sentence explaining why the screen disagrees with itself is not a mitigation,
it is the bug reported in prose.

The rule that replaced it does not weaken pinning. A pinned request that matches
is at the top of the matches; one that does not match is absent because it does
not match, which is the answer every other row gets.

**Two implementations of one predicate.** The server decides whether to include
pinned rows; the browser decides whether to render the shelf. They must agree
exactly, or the pinned rows appear twice on one screen or vanish from both.
`isFiltered` now exists in `requests.schema.ts` and in `board-filters.ts`, and
both exclude sorting for the same stated reason: reordering hides nothing, so
the shelf still makes sense beside it. Duplicated deliberately rather than
shared, because there is no code path between the two, and both are four lines
that read as their own justification. Noted in the handoff as a pair that has to
move together.

**The browser stops asking.** The pinned resource returns no request at all on a
filtered board rather than fetching a collection to hide it — one fewer round
trip on every filtered view, and the test asserts the absence twice over: the
testing controller fails on an unexpected request, and `verify()` fails on an
unanswered one.

**`WHERE` with no conditions.** Removing the unpinned predicate exposed a case
the clause builder had never had: a filtered board whose filters are all
optional could produce `WHERE` followed by nothing, which is a syntax error
rather than an empty filter. Same class of bug as `IN ()` earlier in the slice,
found the same way — by asking what the string looks like when every branch is
false.

### The shelf sorts, the board opens on newest, and one schema default had to go

Two changes asked for together, and they turned out to be one design problem.

**The shelf follows the ordering but not the filters.** Sorting reorders what is
on screen and hides nothing, so the shelf stays and sorts with the board — a
board sorted oldest-first under a shelf sorted by something else is two answers
to one question. Filtering hides things, so the shelf still collapses into the
results. The two rules look inconsistent side by side and are not: the question
is whether anything left the screen.

**The board opens on newest.** The old default was vote count, argued for on the
grounds that the count is the priority signal. That argument is right about
triage and wrong about the daily read: on a board where most rows sit on zero
votes, vote order barely moves, so what changed since yesterday is invisible.
Newest first makes the board answer "what is new" and leaves "what is wanted" to
a control that says so. Vote order is one select away and DECISIONS.md keeps the
reversed entry with the reasoning.

**Where it got interesting.** The shelf's default order is `pinned_at DESC` —
that is what keeps a freshly pinned request inside the three the panel shows
collapsed — and it follows the board only when an ordering was *asked for*. So
the code has to distinguish "no sort in the URL" from "this sort in the URL",
and `sort` had a `.default(DEFAULT_SORT)` on it in the query schema. A schema
default answers "was one asked for?" with "yes, always", before the service ever
sees the request. It had to come off; the default is applied in the service,
where only the list needs it. The handoff records that, because putting it back
would look like tidying and would silently break the shelf.

**The canonical-URL boundary.** An ordering equal to the default counts as "not
asked for", so `/requests` and the default view stay the same link however
somebody arrived. The cost: explicitly picking Newest first cannot force the
shelf out of pin order. That is the right trade, because picking Newest first
produces exactly the default board — the alternative was tracking whether a
control had been touched, which is state that belongs in neither the URL nor the
component.

Six web tests and two API tests failed on the default change, every one of them
correctly: they asserted `votes` where the code now says `newest`, or used
`sort=newest` as their example of an *explicit* ordering, which it no longer is.
Updated rather than relaxed.

---

## 2026-08-22 — Slice 6: request-level actions

### The slice every handoff has pointed at

Three rules in `requestPolicy` had zero callers since slice 1. They are called
now, and the two route-level tests named in every handoff since — a non-owner
refused an edit, a regular user refused a status change — are written and
passing, through the real routes, with nothing stubbed to make them refuse and
the write asserted not to have happened.

### The "edited" marker was a trap in the requirement

The brief asked for the marker to show when `updated_at` differs from
`created_at`. That is the obvious implementation and it is wrong on this schema:
`updated_at` is `ON UPDATE CURRENT_TIMESTAMP(3)`, so pinning a request or moving
it to Done moves it too. The marker would then say a request had been edited by
its author because an admin triaged it — a claim about somebody's words that
nobody made.

Migration 009 adds `edited_at`, which the comments table already has for exactly
this reason. Two tests hold the line: one asserts the marker appears when
`editedAt` is set, and one asserts it does NOT appear when `updatedAt` has moved
and `editedAt` has not.

### Permission before validation, when the permission needs the row

"Only the author may edit" cannot be asked without knowing who wrote it, which
means a lookup — and the convention says permission is checked before the body
is validated, so a caller who may not act never learns the payload schema from a
422.

The shape that satisfies both: the handler loads the *subject* (the author id
and nothing else), asks the policy, and only then parses the body. A 404 falls
out of the same lookup. The admin-only rules keep the simpler shape, refusing
before anything is looked up at all — a regular user attempting a status change
learns nothing, not even whether the request exists, and there is a test for
that specific claim.

### Two real bugs, both found by tests that click things

Both surfaced as "expected no open requests" failures, which reads like test
noise and was not.

**The status list refetched on every action.** The resource's request function
read `item()?.canChangeStatus`, so it depended on the request OBJECT. Every
successful edit, pin or status change produced a new one and refetched a
taxonomy that cannot have changed. Fixed by deriving the boolean as its own
computed and depending on that.

**A refetch tore the page down.** The top-level `@if (request.isLoading())`
replaced the whole article whenever the request reloaded — and with it the
comment thread, which was then re-created and refetched a discussion that had
nothing to do with the pin that caused the reload. Same fix as the board's
stale-rows change earlier in the day: show the loading state only when there is
nothing to show yet.

Neither is visible in a screenshot. Both are obvious the moment a test asserts
what the page asked the server for.

### The dialog does not use `<dialog>`

The native element traps focus and closes on Escape for free, which is the
entire requirement. The problem is what a test could then say about it: that
`showModal()` was called. That proves the call site exists and nothing about
whether focus can leave, which is the only thing anybody cares about.

So the trap is written out and tested by pressing keys: Tab off the last control
wraps to the first, Shift+Tab off the first wraps to the last (the direction
people forget, and how you fall out of a dialog backwards), Escape closes, focus
opens on Cancel rather than the destructive button, and it goes back to whatever
opened the dialog.

### An alias that shadowed a resource

`@else if (item(); as request)` shadowed the component's own `request` resource,
so `[request]="request"` on the edit form resolved to the HttpResourceRef and
the compiler reported a required input with no value. Renamed the alias to
`detail`. Worth recording because the error names the input rather than the
shadowing, and the template reads perfectly well while being wrong.

Also: a required input cannot be read in a constructor, which is where the edit
form first seeded itself from the request. Moved to `ngOnInit`, and deliberately
not to an effect — something that re-seeds the form mid-edit is a data-loss bug
wearing the costume of a refresh.

### Correcting the record

While writing this up: DECISIONS.md claimed `idx_requests_feed` "stays", and
after this morning's default-sort change I made it worse by writing that it
"serves the default again". It does neither. Migration 006 dropped it along with
the `is_pinned` column it led with, and added `idx_requests_recent (created_at
DESC, id DESC)` in as many words for the newest-first option. The file now says
that, and says when the earlier claim stopped being true.

### The migration nobody had run, and the verification pass that followed

The dev API started failing with `ER_BAD_FIELD_ERROR: Unknown column
'r.edited_at' in 'field list'` on every board read. Exactly the failure the
handoff had been carrying as the top outstanding item since slice 6 was written:
the code was at schema 9 and the database was at 8. `npm run migrate` applied
009 and the board came back.

Worth naming the shape of that mistake rather than just the fix. The migration
was written, the undo was written, the code that reads the column was written
and 243 tests passed — because every one of them mocks the repository. A schema
change is the one kind of change a mocked test suite cannot fail on, and the
gap between "the tests pass" and "the application runs" is exactly one command
that nobody had run.

With Docker finally up, everything outstanding from slices 5 and 6 was checked
against real MySQL. The full table is in the handoff. The results worth
repeating here:

- **`?q=%` matched 0 of 11 rows.** Unescaped it would have matched all 11, so
  the LIKE escaping is doing what it claims. Same for `_`.
- **A page past the end counted the filtered set** — total 6 with a status
  filter on a board of 11.
- **A status change moved `updated_at` and left `edited_at` alone**, which is
  the entire argument for migration 009, now observed rather than reasoned
  about.
- **The delete cascade ran through the endpoint for the first time.** A request
  with a vote from another user and a comment on it: `204`, and the vote, the
  comment and the row were all gone. The cascades had only ever been verified by
  writing SQL directly at the tables.

**And one prediction that was wrong.** The handoff said to check that `EXPLAIN`
shows `idx_requests_status` in use for a status filter. It does not — the
optimizer chooses `idx_requests_pinned` and applies the status as a
where-condition. The status index is in `possible_keys`, so the column is a
candidate, but on eleven rows the choice between two indexes is not evidence of
anything. Recorded as "not what was predicted" rather than quietly reworded into
a pass, because the point of writing the prediction down was to be able to be
wrong about it.

### "Write something first" about a comment that had just been posted

Reported from the running app: post a comment, it appears on the thread as it
should, and the emptied box immediately complains that it is empty.

`setValue('')` followed by `markAsUntouched()` clears two of the three things
that matter and not the third. The control was still **dirty** from having been
typed in, and the message renders on `invalid && (dirty || touched)` — so an
empty box that had been typed in fails `required` and says so, about the comment
that had just succeeded.

`reset()` does all three: value, pristine, untouched. The same pattern was in
`openReply`, where it was a quieter version of the same bug — type into a reply
box, close it, open it again, and it greets you with a validation message before
a key is pressed. `openEdit` had it too, hidden only because it seeds a non-empty
value.

Two tests, both confirmed to fail against the old code before the fix went in:
one posts through the real button and asserts the message is absent afterwards,
one opens a reply box, types, closes and reopens it. The first is an extension
of the test written when the submit button was dead — the same test would have
caught this the moment it looked at what was on screen after a success rather
than only at what was sent.

---

## 2026-08-22 — Slice 7: the admin taxonomy screen

### Two invariants the schema cannot hold

Most of this slice is ordinary CRUD. The parts worth recording are the two rules
the database cannot express, both of which had to be written into the
application without a comment somewhere claiming they are "enforced by the
schema".

**Exactly one default status.** The generated column and unique key give AT MOST
one. They cannot give at least one — an admin could leave the table with zero
and every new request would fail with SERVER_MISCONFIGURED, which is exactly the
failure mode the statuses migration warned about two slices ago. Two rules keep
the lower bound: the only endpoint that touches the default is "make this one
the default", and the first status created in an empty table becomes the
default. There is no endpoint that clears a default. That absence is the
invariant, so the handoff names it as something not to add back.

The swap also has a forced order. The unique key permits one row with the
marker, so setting the new default before clearing the old one collides —
clear-then-set is the only sequence that works, which means the table passes
through zero defaults, which is why it is a transaction rather than two
statements. Verified against real MySQL: default moved to Planned and back to
New, both through the endpoint.

**A reorder names every row exactly once.** There is no constraint that can say
that. It is checked in the service against the ids actually in the table, and
the three ways to get it wrong — omitting a row, repeating one, naming one that
does not exist — are refused separately, each with its own code, rather than
collapsed into "invalid order".

### The shape of the difference between the two taxonomies

Categories are retired; statuses are not. It is tempting to make that a flag on
a shared implementation, and it is not a flag — it is a difference in what the
things ARE. A category is a label a request carries; a status is a position a
request is sitting in, and retiring one strands whatever is in it.

So the shared parts are shared honestly (the schema of a name and a slug, the
reorder rule, the duplicate mapping) and the differences are separate routes on
separate modules. The one place they meet in the interface is a presentational
table with `retirable` and `hasDefault` inputs, and even there the inputs are
set by the parent rather than inferred from the rows — the difference is a
decision, not a shape.

### `?scope=all`, not `/api/admin/categories`

The admin screen needs the same rows with more on them: display order,
retirement state, usage counts. A separate URL would be the same collection in
two places, free to drift. A second representation of one collection, asked for
explicitly and refused to anybody who cannot act on it, keeps one source.

The first version of the web client baked the query into the URL string —
`/api/categories?scope=all` as a literal. The tests could not see it as a
parameter, which was the tell: it IS a parameter, and the client should be able
to read it as one. Changed to `params: { scope: 'all' }`.

### Telling the navigation what it may offer

Every permission on this board is per row, because there is a row to hang it on.
A whole screen has none, and the menu still has to decide whether to show a link
to it.

`GET /api/capabilities` answers what the caller MAY DO, never who they are —
there is a test asserting the response contains no email, no display name and no
role. It is not what protects the screen: the endpoints refuse on their own and
the route renders that refusal, so this being wrong costs a menu item. A route
guard would have been the other option, and it would have put a copy of the rule
in the browser and made the interface the thing that decides, which is the
opposite of how everything else here works.

### Reordering by button

The brief said a drag-only implementation is not acceptable, and the honest
reading of that is not "add keyboard support to a drag interaction" but "build
the version that works and stop". Two buttons per row, labelled with the row's
name so a screen reader says which one is moving, disabled at the ends. It is
also the version that can be tested by pressing it, which the tests do.

### Verified against MySQL

The default swap, the reorder, the duplicate mapping, and the claim that matters
most about retirement: a category with two requests on it was retired, vanished
from `GET /api/categories` — the list every form and the filter bar reads — and
both requests went on rendering it, with the filter link by its slug still
matching them. Then restored, and the order put back.

## 2026-08-23 — Slice 8: settings, and the configured application

### The two-table shape came from an old scar

The obvious storage for two-level settings is one table with a nullable
`user_id`, NULL meaning "global". I nearly wrote it and then checked what the
uniqueness would actually be: MySQL permits many NULLs under a `UNIQUE` key, so
`UNIQUE (user_id, setting_key)` would allow two global rows for one setting and
the resolver would have to pick between them. Making it illegal needs a STORED
generated column over `IFNULL(user_id, 0)` — the same device that cost this
schema a cascade in migration 007, where MySQL refused `ON DELETE CASCADE` on a
foreign key involving generated columns (error 1215).

Two tables, both primary keys NOT NULL, and the constraint is real without a
trick. The scopes turned out not to share columns anyway: a global row records
which admin last changed it, and a personal row has nobody to name.

### The default not being in the database is what makes "reset" answerable

The nice property fell out of putting defaults in code rather than seeding rows:
the absence of a row IS the answer to "is this the default". A row holding the
default value would say somebody chose it, and the screen would then offer a
reset against something with nothing behind it, and stop offering one against a
choice that happens to match. That distinction is now tested at three levels —
the resolver, the payload, and the rendered "Using the default" against "Your
choice".

It is also what makes the promise "adding a setting needs no migration" true
rather than nearly true. Nothing has to be inserted for a new setting to work.

### Probing before building, again, and it paid

Five probes against real MySQL before any of this was built on:

* JSON round-trip — booleans come back as booleans, numbers as numbers, arrays
  as arrays. mysql2 parses a JSON column on read, so nothing has to `JSON.parse`
  at a call site. Writes still need `CAST(:value AS JSON)` over a stringified
  value.
* The upsert updates rather than duplicating: one row, new value.
* The `CHECK` on `users` refused a deleted account that kept an `external_id` —
  error 3819. Worth checking specifically, because migration 007 was refused a
  CHECK (error 3818) for touching a column with a referential action; neither
  column here carries one, and it was not safe to assume that generalised.
* The 012 backfill left zero comments pending, so turning moderation on for the
  first time cannot hide the history.
* All three down-migrations run and re-apply.

### The feature flag had a premise that was wrong about this repository

The brief suggested comment approval "already has its column and its states from
the comments slice". It does not: `notes/decisions-pending.md` records the
opposite — the column was deliberately kept out, and the note warned that the
visibility condition would have to hold in more than one place. That warning was
the most useful thing in the file. The condition is now one exported SQL
fragment, `APPROVED_FOR_VIEWER`, imported by the requests repository for its
comment count, so a badge cannot promise three comments above a thread showing
one. Verified: the same request reports a count of 1 to the comment's author and
0 to somebody else, with the thread agreeing in both directions.

The direction that is easy to get wrong is switching the flag OFF. Stamping
`approved_at` at insert whenever the gate is down handles switching it on
without rewriting history; without the second half — the visibility test asking
whether the gate is up NOW — comments written during a moderated spell would be
stranded invisible forever the moment an admin changed their mind, with nothing
left in the interface to approve them from.

### Things that cost time

**`whenStable()` deadlocks on an unanswered `httpResource` request.** An
outstanding resource request is a pending task, so awaiting stability before
flushing waits for a response the test has not sent yet, and the test dies at the
5-second timeout rather than at an assertion. The fix is the opposite order from
the one that reads naturally: flush first, then await. An `HttpClient.subscribe`
in a click handler does not have the problem, which is why the same pattern
worked in earlier specs and made this look like a mystery.

**Every component that injects a root service making an HTTP call adds a request
to every one of its tests.** Moving the taxonomy and capabilities into one
startup request meant six specs suddenly had an unflushed `GET /api/bootstrap`.
A shared `provideStubbedConfig()` fixes it once; the alternative was flushing the
same request in fifty tests that have nothing to say about it.

**A component and a payload type sharing a name.** `CommentThread` is the
component; `CommentThread` was also the natural name for what the thread
endpoint returns. The auto-import resolved it to `rxjs` and the error was
"Individual declarations in merged declaration must be all exported or all
local", which says nothing about the actual problem. The payload is imported
aliased now.

**`LOCALE_ID` is fixed when the injector is created.** A language preference
that arrives with the startup response therefore cannot use it. The date pipe
takes a locale as its fourth argument instead, which also means changing the
language takes effect without a reload — better than the thing I was trying to
do.

**Replacing an error changes tests that were about the error.** The seam used to
throw a misconfiguration error when `DEV_CURRENT_USER_EMAIL` named nobody; that
branch is now where the registration policy runs. The old test asserted the 500.
Rewriting it turned one test into three better ones — a stranger provisioned on
an open board, a stranger refused on a restricted one, and the seam still failing
loudly when it is the server that is misconfigured.

## 2026-08-23 — Making the language setting mean something

The setting existed and did almost nothing: it set `<html lang>` and the locale
dates were formatted in, which is invisible unless you are looking at a date.
Reported, fairly, as "the language doesn't do anything".

### Runtime catalogue, not `$localize`

Angular's own i18n compiles one bundle per locale and picks it by URL or server
config. It cannot change language because somebody chose one from a list, without
a reload, on a preference that arrives from the API after the application has
started — which is exactly the shape of this feature. So the catalogue is a
typed object and `t()` reads the language signal on every call. Changing the
setting re-renders every message with no subscription anywhere.

The type does the work that matters: `french` is `Record<MessageKey, string>`, so
a missing key does not compile. Three tests cover what types cannot — nothing
blank, nothing still in English, and the same placeholders on both sides. That
last one matters more than it looks: a French message that dropped `{count}`
renders a sentence with the number missing and nothing fails.

### The one thing that does NOT live in the catalogue

Setting labels. They are in the API's registry, in both languages, beside the
setting they describe.

That looks inconsistent and is the opposite. The registry's promise is that
adding a setting is one edit in one file, and it would be a lie if every new
setting also needed two lines in the web app before its label could be read. The
server already resolves the caller's language in order to answer with it, so it
picks the label too.

### Dropping German rather than shipping three

The setting offered `en | fr | de`. Two catalogues is honest work; three is the
same work again in a language I would be guessing at, and a half-translated
option is the same bug as the one being fixed — a choice that appears to do
nothing. Only languages that are actually translated are offered.

### Things that cost time

**Substring replacements across templates.** `"        Cancel\n"` is a substring
of `"                Cancel\n"`, so replacing the shallow one first mangles the
deep one and the deep one's own replacement then fails to match. Anchor each
replacement with enough surrounding lines to be unique, or work outermost-first.

**Two catalogues, one anchor.** Inserting French keys "before `'comment.heading'`"
put them in the ENGLISH object, because both catalogues contain that key and the
first match won. It compiled — the object simply had duplicate keys — and TypeScript
caught it, but only after two blocks had gone to the wrong place.

**`npx prettier --write` from the repository root reformatted the whole API.**
The prettier config lives in `web/.prettierrc`; the API has none and was never
prettier-formatted, so prettier applied its defaults and rewrote 67 files to
double quotes and 80 columns. Reverted with `git checkout -- api/src` and the
three intended files re-applied from the scripts that made them, which is the
argument for making changes with a script you can re-run rather than by hand.
**Format the web workspace from inside it, and leave the API alone.**

## 2026-08-23 — The default filter that never applied

Reported as: choose a status under "How the board opens for you", go to the
board, nothing happens.

The server was fine — the setting saved, and the startup payload carried it. The
board's rule for WHEN to apply it was wrong, and wrong in the way that is hardest
to see: it worked the first time and never again.

The rule was "apply the defaults when the address is bare". The redirect it
performs makes the address non-bare. So somebody whose default ORDERING is
`oldest` lands on `/requests?sort=oldest`, and every later arrival at that
address — Back, a bookmark, a reload — carries a `sort` and is therefore not
bare. A default STATUS chosen afterwards could never take effect.

My first pass at this had a whole-chain test that passed, which is why I did not
find it by reasoning: the test arrived at a genuinely bare address, because that
was the only case I had thought about. The bug lived entirely in the second
visit.

The fix separates two questions that were being asked as one — did you ask for an
ordering, and did you ask to narrow the board — and answers each from the
preference if the address did not. That distinction is not new here: the pinned
shelf already rules that sorting is not filtering, and `isFiltered` excludes
`sort` for the same reason.

The other half is knowing when somebody has "arrived" rather than "is working".
That cannot live in the URL, because an address with no filters is the same
address whether it was cleared or arrived at. It lives on the component instance
instead: Angular rebuilds the board when you come to it from another screen and
reuses it while you stay, so the instance IS the distinction. One attempt per
arrival, and clearing the filters a moment later is not one.

**Worth remembering: a rule whose own action changes the condition it tests will
work once.** The bare-address check read as obviously correct and was, for the
first visit only.

## 2026-08-23 — Giving comment approval a way to be found

The setting worked and the feature did not. A held comment was visible to its
author and to admins in the thread, and there was a queue on the settings screen
listing waiting comments — but nothing anywhere said "three are waiting", so
unless an admin happened to open the settings screen, they sat there. A feature
whose only entry point is a screen nobody visits for that reason is not
functional, whatever its tests say.

### The queue was the wrong shape, not just the wrong place

It listed comment bodies with the request title above them. That reads fine and
cannot be acted on: whether "that is not what I meant" should be published
depends entirely on what it answers. So the queue is gone — the endpoint, the
repository query, the row type — and the decision moved to the thread, beside
the words, where the discussion is.

The control travels with the comment as `canApprove`, which is the same shape as
`canVote` and `canEdit`: the browser is told what it may do to THIS row and is
never told who it is. It is only ever true on a comment that is actually waiting,
so the same flag answers both "may you" and "is there anything to approve".

### Rejecting is deleting, on purpose

There was a pull toward a `rejected_at` column. There should not be one: a
rejected comment is a removed one, deletion already records which admin did it
and already tells the author an admin did, and a third state would be a kind of
hidden comment keeping no trail the other two do not keep. Reject is the existing
DELETE with a confirmation in front of it.

### Absent, not zero

The count is omitted from the startup payload when the gate is down or the reader
cannot approve, and the header renders nothing. It would have been easier to send
0 and hide the badge in the template, and it would have been a different claim: a
badge showing 0 says there is moderation here and nothing is waiting. Sending
`null` all the way through — server omits, `pendingComments()` is null, the
template's `@if` renders nothing — keeps one statement per state.

### Things that cost time

**`pending` was already taken.** The board had `protected readonly pending` for
the set of requests with a vote in flight, and `withComponentInputBinding` binds
query parameters by member NAME — so the URL parameter and the field could not
both be called that. The set was renamed to `voting`, which is what it was about
anyway.

**A mocked module has to carry its constants, not just its functions.** Mocking
the comments repository in the taxonomy test broke the requests repository, which
imports `VISIBLE_COMMENT` from it — a SQL fragment, interpolated at module load.
The error names the export, not the reason.

**The `whenStable()` deadlock, a third time.** Rejecting reloads the thread, and
the reload is scheduled rather than immediate, so flushing before awaiting is not
enough either — the request does not exist yet. The pattern that works is a short
loop: detectChanges, match, flush if present, turn the microtask queue over.

---

## 2026-08-25 — Slice 9: authentication, against Keycloak

**Asked:** the slice the seam was built for. The measure named up front: change
`auth/current-user.ts` and nothing that calls it. Two questions to answer and
wait on before writing anything — how the existing suite keeps running without a
live Keycloak, and how the realm import lines up with the seeded users.

### The two questions, answered before implementing

**The suite.** Two approaches were offered: tests minting their own tokens
against a generated key, or retaining the seam as a test-only identity mode. The
first was proposed, and with a sharper line than the question drew: mock ONLY
the JWKS fetch, so the signature, the issuer, the audience, the expiry and the
`kid` selection are all the real implementation. `createLocalJWKSet` is jose's
own resolver, so even "no key matches this kid" is genuinely exercised. The
second approach would have left verification — the part most worth covering —
untested.

Standing a JWKS endpoint up on loopback was considered and rejected: it would
test `fetch`, which is not the part anybody doubts, and needs a port per worker.

**The guard.** The prompt asked for the test mechanism to be structurally unable
to activate outside a test environment, "asserted on the identity mode". Under
this approach there is no third identity mode, so there is nothing new for such
an assertion to be about — said plainly rather than inventing a mode so the
sentence had a subject. What replaced it: the token-minting code is excluded
from `tsconfig.build.json` and is therefore absent from `dist/` entirely. The
reply back: *absent beats guarded*. A new assertion was added in the other
direction instead — a build that verifies tokens refuses to start without an
issuer, an audience and a client id, naming all the missing ones at once.

**The realm.** The failure being designed against was specific: Keycloak
generates user ids, the seeded admin has `external_id NULL`, matching is on
subject and never on address, so the seeded admin would authenticate perfectly,
match nothing, be sent to provisioning, and collide with `uq_users_email`. The
symptom is the only account that can reach the admin screens unable to get in,
on a board with nothing that can promote a replacement. Fixed by pinning the
three ids in the realm file and writing the same three into the seed.

Two additions came back with the approval, both accepted as stated: link on a
**verified** email only, set explicitly in the realm rather than relying on
Google's behaviour; and make the realm file unmistakably a development artefact,
so nobody reads three published passwords as leaked credentials.

### The mechanical half

173 supertest call sites needed a token. Rather than editing each, `request(app)`
became `signedIn(request(app))` — one substitution, one wrapper — and the
identity mock moved from `findByEmail` to `findByExternalId`. Which person each
test acts as is decided by the repository mock exactly as before, because the
token has never carried a role. Not one test changed what it asserts.

### The realm that would not import — the best failure in this project

Worth writing out in full, because every other mistake in this log was caught by
something. This one was caught by nothing, and the reason is the lesson.

**What was written.** The client in the realm file was given a field called
`postLogoutRedirectUris`, holding the URL Keycloak may return to after a
sign-out:

```json
"redirectUris": ["http://localhost:4200/auth/callback"],
"postLogoutRedirectUris": ["http://localhost:4200/"],
"webOrigins": ["http://localhost:4200"],
```

It is plausible. It sits between two fields that are real and spelled exactly
like that. It matches the OpenID Connect vocabulary — `post_logout_redirect_uri`
is a genuine parameter, and the code sending it was correct. It is the name the
field *would* have if Keycloak had one.

Keycloak does not. Post-logout URIs are an entry in the client's `attributes`
map, `post.logout.redirect.uris`, which the same file already had. So the field
was invented — not mistyped, not deprecated, not from an older version.
Invented, by pattern-matching on the two lines above it.

**What Keycloak did about it.** Refused the entire realm:

```
ERROR: Failed to start server in (development) mode
ERROR: Failed to run import
ERROR: Unrecognized field "postLogoutRedirectUris"
       (class org.keycloak.representations.idm.ClientRepresentation),
       not marked as ignorable (44 known properties: ...)
```

Not "ignored the field". Not "imported the realm without that setting". One
unknown key and **nothing** was imported: no realm, no client, no users, no
audience mapper. The strictness is correct — a realm that silently drops half of
what it was given is worse — but it converts a one-line typo into total failure.

**What it looked like from outside.** Not that. The container entered a restart
loop, and the only signal `docker compose` surfaced was the healthcheck:

```
keycloak: starting
keycloak: unhealthy
keycloak: starting
keycloak: unhealthy
```

and inside it:

```
/bin/sh: connect: Connection refused
/bin/sh: line 1: /dev/tcp/127.0.0.1/9000: Connection refused
```

Which is true and useless. The management port was refusing connections because
the server had exited; the healthcheck can only report that it cannot reach
something. Nothing in that output contains the word "realm", "import", or
"client". Read on its own it points at the healthcheck being wrong — the wrong
port, the wrong path, the `/dev/tcp` trick not working in that image — and half
an hour could go into fixing a healthcheck that was already correct. The actual
cause was thirty lines up in `docker logs`, and only there.

**And the whole time, everything was green.** 243 API tests, 220 web tests,
typecheck clean, production build clean. Not one of them was wrong to pass. They
cover the code, and the code was right: the sign-out request was well formed and
the URL it sent was the URL the realm was supposed to allow. The defect was in a
JSON document that no test loads, consumed by a program no test runs, validated
by a schema written in Java.

### The lesson, which is the part worth keeping

**A passing test suite says nothing about configuration a container consumes.**

Not "says little" — nothing. The suite's reach stops at the edge of the process
it runs in. Everything past that edge is unverified by construction:

- the realm file, validated by Keycloak's own representation classes
- `docker-compose.yml`, validated by Compose
- the Dockerfiles and the Kubernetes manifests added since, validated by the
  builder and by the API server
- the nginx configuration, validated by nginx

Every one of those is a schema, enforced by something that is not in the test
run and does not care what the tests think. And each fails in the same shape:
**strict validator, all-or-nothing outcome, error message somewhere the obvious
diagnostic does not look.**

Two things follow, and both are now habits rather than intentions:

1. **Run it.** Not as a final flourish once the suite is green — as the step
   that finds this class of defect, because nothing else will. The whole
   authentication slice was verified against a live Keycloak for exactly this
   reason, and this is what that found.
2. **Read the process's own log first, not the orchestrator's summary.** The
   healthcheck reports a symptom. `docker logs` had the sentence naming the
   field. Any time a container will not come up, that is the first place to
   look, and the healthcheck output is the last.

There is a third, smaller one: when writing a configuration file for somebody
else's schema, the fields that look most obviously right are the ones to check
against their documentation, because plausibility is exactly what makes an
invented field survive review.

### Other things that cost time

**The callback route races its own discovery.** On a page load that lands on the
redirect URI, the session's startup and the callback component both begin at
once, and the code exchange needs endpoints the discovery has not fetched yet.
Intermittent, which is the worst way for it to fail. Fixed by holding the
startup promise and awaiting it in `completeSignIn`.

**Whether the callback route may render cannot come from the router.** The shell
has to answer it on the first paint, before any navigation has completed — and
if it answers wrongly, the outlet is never mounted, the component never
constructs, and the code is never redeemed. A deadlock, not a flash. It is
decided from `location.pathname` instead, which is sound because arriving there
is always a fresh page load: Keycloak redirects the browser, and nothing inside
the application ever links to it.

**The default test token describes one person, and some tests act as another.**
Harmless everywhere except the one test asserting the caller's own address,
where reconciliation quietly rewrote it before the payload was built. That test
now mints a token for the person it is about; a `bearerFor(actor)` helper exists
for the handful of cases like it, and the comment says why almost nothing else
needs it.

**A boot guard tested against the compiled-in constant breaks when the constant
moves.** `parseEnv` asserts with the real `IDENTITY_MODE`, so the whole env spec
had been written around the seam being the default. Rewritten so every seam case
passes `'development-seam'` explicitly — which is what the mode being a
parameter was for in the first place.

---

## 2026-08-25 — Corrections, and the scope file that should have existed

**Asked:** two corrections and a consolidation.

**Correction 1: admin deactivation is not the next slice — it is not in the
brief at all.** Moderation there is defined precisely as deleting comments,
changing statuses and curating categories. Deactivation is a variant of a
tiered-ban feature already ruled out twice.

The handoff written at the end of the authentication slice had proposed user
administration as "the most valuable slice left", and had gone further: it
invented a question about what a deactivated account should mean to Keycloak,
wrote three candidate answers for it, and parked them. All of that was work
spent widening a boundary that had already been drawn.

The mechanism of the mistake is worth naming, because it is not carelessness. The
authentication slice genuinely does make somebody ask "and what about somebody
who should no longer be here?" — it is the adjacent thought. Adjacency is not
scope. A feature that follows naturally from what was just built is exactly the
kind that gets proposed without checking whether it was already refused.

**Correction 2: the account-deletion question was already answered.**
`DECISIONS.md` records that clearing `external_id` is deliberate — a returning
person gets a new account rather than recovering the old one, which is the
intended meaning of a deletion request. It had been re-opened as though it were
open.

**And the consolidation, which is the actual fix.** Both corrections are the same
failure: settled things were not written where the next reader would trip over
them. `notes/decisions-pending.md` had become the place where that happened —
nominally a holding pen for commitments argued out before their subject existed,
in practice a queue that made refused features look scheduled. "Parked" and
"planned" are one word apart and it read as the second.

So it is gone. `SCOPE.md` now says what is in, what is ruled out and why, with
the ban/suspend/deactivate family named as one feature so the next variant does
not arrive looking new. Its entries moved: the role-change rule to `SCOPE.md`
under what is ruled out — recorded as an argued-out rule, explicitly not a
commitment to build it — and the Node base image pin to `DECISIONS.md`, where it
has now come true.

**Also corrected: a capability described in three files that does not exist.**
`keycloak/README.md`, `DECISIONS.md` and the handoff all said a reviewer could
"promote a regular user and there are two admins". Nothing in this application
promotes anybody. A demo board has a second admin because `npm run demo` seeds
one. That sentence had been carried from a conversational aside into three
documents without being checked against the code — which is its own small
version of the same lesson as the realm file.

**Then:** the deployment artefacts, which had zero work in them and are a graded
deliverable. Dockerfiles for both applications, the compose file completed, and
Kubernetes manifests. Written knowing what the realm bug taught: every one of
those files is a schema enforced by something the test suite does not run, so
each was built and applied rather than written and believed.

---

## 2026-08-28 — The deployment slice, and three things only a cluster found

The artefacts existed from the previous session. This entry is about what
happened when they were held against a brief that asked specific questions, and
then applied to a real cluster.

### A correct-looking mechanism whose correctness held only for the first deploy

The API's init container waits for the schema before the process starts,
because a Job is not an ordering primitive — nothing makes a Deployment wait for
one. That much was right.

What it waited for was wrong. It polled for the **existence of the
`schema_migrations` table**, which is a perfectly sensible thing to check and
is correct exactly once: on a first install. On every deploy after that, the
table is already there. So a release that adds migration 13 would satisfy the
check at version 12 and start serving queries against columns that do not exist
yet.

It reviewed well. It ran correctly the only time it had ever been run. The bug
was reachable solely on the *second* deployment of a system that had never had
a first — which is the sort of defect that ships, sits quietly, and surfaces
months later as data errors during a release nobody connects to it.

Caught by re-reading it while answering a question about migrations, not by any
test and not by running it. The fix is to compare against the **version**, and
to derive the expected version from the highest migration file in the image, so
there is no constant to keep in step with the directory. A pod stuck in `Init`
is loud; a pod serving a half-migrated schema is not.

Both branches were then run inside the real image against a real MySQL before
being written into the manifest — the satisfied case (`schema at 12; this image
expects 12`, exit 0) and the waiting case (retrying, never exiting).

### Keycloak does not substitute environment variables in a realm import

The realm hardcoded `http://localhost:4200` as the client's redirect URI, which
is fine until the same realm is imported into a cluster where the browser is at
`http://feedbackhub.local`. Sign-in there failed with
`Invalid parameter: redirect_uri`.

The attractive fix was `"redirectUris": ["${env.WEB_ORIGIN}/auth/callback"]` —
one file, values from the environment, exactly what the brief asks for
everywhere else. It does not work. Keycloak validates the literal string as a
URI, rejects it, and refuses to start:

```
ERROR: Failed to start server in (development) mode
ERROR: Invalid client feedbackhub-web: A redirect URI is not a valid URI
```

The same all-or-nothing shape as the `postLogoutRedirectUris` failure earlier in
this project: one bad field, no realm at all, and a container that will not
come up. Worth noticing that the *fix* for an environment-configuration problem
was itself an unverified assumption about someone else's schema, and failed the
same way the original bug did.

So both origins are listed, as values, with the reasoning in
`keycloak/README.md`. A list of two is not a second realm.

### The deployment was reported as failing while it was working

`scripts/deploy-k8s.sh` waited five minutes for the migration Job and then
reported a timeout. The Job was fine — MySQL's image was still being pulled
*inside the kind node*, which took thirteen minutes on a cold cluster. Nothing
was broken except the number in the script.

Two changes: wait on the backing services first, so the message on screen names
the thing that is actually slow, and raise the timeouts to something a cold
cluster can meet. A deploy script that cries wolf teaches people to ignore it.

### What applying it actually proved

`kubectl apply -k . --dry-run=server` accepted every object, which is the check
that had been missing when these manifests were "rendered and reviewed". Then
the full apply, and a real sign-in through the ingress — authorization code with
PKCE, the seeded admin matched onto row 1 rather than provisioned, no role in
the payload.

The manifests were, as it turned out, correct. The thing they mounted was not.
That is worth stating precisely, because "the manifests were fine" and "the
deployment worked" are different claims, and only running it separates them.

---

## 2026-08-28 — The same mistake twice: schema claims about someone else's system

Two failures in this project, a week apart, look like separate incidents. They
are one pattern, and writing them up together is the only way that becomes
visible.

### The two

**One — an invented field.** The Keycloak client in the realm file was given
`postLogoutRedirectUris`, holding the URL to return to after sign-out. It sits
between `redirectUris` and `webOrigins`, both of which are real and spelled
exactly like that. It matches the OpenID Connect vocabulary, where
`post_logout_redirect_uri` genuinely exists. It is the name the field *would*
have if Keycloak had one. Keycloak does not: post-logout URIs are an entry in
the client's `attributes` map.

**Two — an invented capability.** The realm hardcoded `http://localhost:4200`
as the redirect URI, which broke sign-in the moment the same realm was imported
into a cluster where the browser is at `http://feedbackhub.local`. The fix
written was `"redirectUris": ["${env.WEB_ORIGIN}/auth/callback"]` — one file,
values from the environment, exactly the discipline applied everywhere else in
this repository. Keycloak's realm import does not do property substitution. It
validated the literal string as a URI, found it was not one, and refused.

The second is the more instructive, because it was a *fix* for an
environment-configuration problem, written immediately after the first
incident's lesson had been written down — and it failed in precisely the same
way as the thing it was fixing.

### Why they are one shape

Both are **a claim about another system's schema, made from plausibility rather
than from its documentation.** Neither was a typo. Neither was a deprecated
field or a version difference. Both were confident inventions that read
correctly to anyone who knows the domain but not that specific product.

And both failed identically, in a way that punishes the guess three times over:

1. **The importer rejects the entire file, not the offending field.** One bad
   key and there is no realm at all — no client, no users, no mappers. A
   validator that dropped the unknown field and carried on would be worse, so
   this is correct behaviour; it is also what turns a one-line mistake into
   total failure.
2. **The container then restart-loops**, because a Keycloak that cannot import
   its realm will not start.
3. **The diagnostic names none of it.** What the orchestrator surfaces is a
   healthcheck failing:

   ```
   keycloak: unhealthy
   /bin/sh: line 1: /dev/tcp/127.0.0.1/9000: Connection refused
   ```

   True, and useless. It contains no occurrence of "realm", "import" or
   "client". Read alone it points at the healthcheck — wrong port, wrong path,
   the `/dev/tcp` trick unsupported in that image — and time can be spent fixing
   a healthcheck that was already correct. The sentence naming the field is
   thirty lines up in `docker logs`, and nowhere else.

And through all of it, every test passed. They were not wrong to: the defect is
in a JSON document no test loads, consumed by a program no test runs, validated
by a schema written in Java.

### The correction

**A claim about another system's schema gets checked against that system's
documentation before it reaches a file.** Not after the container fails to come
up, and not by reasoning from what the field ought to be called.

The trigger is specific and easy to recognise: *writing a key into a
configuration file that some other program will parse.* A realm import, a
compose file, a Kubernetes manifest, an nginx directive. In application code a
wrong name is a compile error or a failing test within seconds. In these files
it is silent until a container will not start, and the message that explains it
is not the message you are shown.

The second-order version, which is what the repeat proved: **the fix for a
configuration problem is itself configuration, and gets the same treatment.**
Applying the lesson to the bug while exempting the patch is how the same
mistake arrives twice in a fortnight.

The practical habits, both now in use:

- Run it. Not once the suite is green — as the step that finds this class at
  all, because nothing else will.
- Read the process's own log first, never the orchestrator's summary. The
  healthcheck reports a symptom; `docker logs` had the answer both times.

## 2026-08-28 — Layer 1: a harness with a real database, and the probes run

`notes/test-plan.md` is written in six layers, and its own exit criteria say the
thing that matters: **L0 green is the floor and says nothing about L1–L5.** The
473 tests replace every repository, so no SQL in this repository had ever run
under test, no token had ever been fetched through `createRemoteJWKSet`, and
nothing had ever run two requests at once.

This entry is the harness, and the fourteen `⚠ probe` rows run against it.

### The harness

`api/vitest.l1.config.ts`, `api/test/l1/`. A second vitest project — deliberately
not part of `npm test`, because the default suite has to stay runnable with
nothing started.

- **Its own database.** `feedbackhub_l1`, created by the global setup, migrated
  0 → 12 through the same postgrator wiring `scripts/migrate.mjs` uses, then
  seeded. Nothing here can touch the development board.
- **Migrated every run, not dumped.** D-01 asks whether the migrations can build
  the schema from nothing; the only way to keep asking is to make every run do
  it.
- **The application's own database user.** The harness holds a second, root
  connection for reads and for the set-ups no route can produce. A test that
  passed because it ran as root would be testing a grant the deployment does not
  make.
- **A real JWKS fetch.** The plan says "the JWKS stub stays". This keeps that
  promise one level more strictly: the global setup generates a key pair and
  serves it over HTTP on 127.0.0.1, and `OIDC_INTERNAL_URL` points at it. So
  `createRemoteJWKSet` — the caching, the cooldown, the refetch on an unknown
  `kid` — runs for real, and the last `vi.mock` on the authentication path is
  gone. `iss` is still compared to `OIDC_ISSUER_URL` and only that.
- **Fresh and Demo** are the plan's two preconditions, as functions. Demo runs
  the real `scripts/demo-data.mjs` in a child process rather than a copy of its
  intent.

Two things cost time and are worth writing down.

**`test.env` does not reach `globalSetup`.** The workers get it; the main process
does not, and the global setup runs there. It migrated one database while the
tests ran against another, which presents as "no tables". The config now assigns
the same object to `process.env` as well, so there is one declaration of which
database this is.

**supertest does not send anything until somebody subscribes.** Two of the
concurrency probes hold a request "in flight" while a second one runs. Assigning
the `Test` object to a variable does not start it — superagent defers until
`.then()`. Both probes deadlocked on a gate that could never open, and did so as
a 30-second timeout with no other symptom, which then leaked the un-restored spy
into the next test and made *that* look like a hang too. `.then((r) => r)` is
the fix and the comment above it is the point.

### The probes, and what they did

Every row the plan marks `⚠ probe` was written as a test asserting what **should**
be true, run, and left red. Fourteen predictions; **fourteen confirmed, none
wrong.** The eight rows §16 predicted would *hold* all held.

| row | predicted | observed |
|---|---|---|
| P-08 | `ER_DUP_ENTRY` from `reconcile` reaches the handler as a 500 | **500**, `Duplicate entry 'sam@feedbackhub.local' for key 'users.uq_users_email'`, thrown from `updateEmail` at `current-user.ts:65` |
| P-14 | an anonymised subject's still-valid token provisions a **new** account | confirmed. `DELETE /api/users/3` → 204; the same token on the next request → **200**, and `users` now holds id 3 (anonymised) and **id 4** (fresh, named from the token) |
| C-25 | `isPending` / `canApprove` true on a comment everybody can read | confirmed |
| C-26 | the second gate-up re-hides a released comment | confirmed — visible to sam with the gate down, gone again when it went back up |
| C-27 | `?pending=true` lists requests whose comments are not waiting | confirmed, one row returned |
| H-02 | 300 KB body → 500, not 413 | confirmed. `PayloadTooLargeError`, `type: 'entity.too.large'`, straight to the unknown-error branch |
| R-10 | the author cannot keep a category that was retired under them | confirmed, 422 on `categoryId` — a field they did not touch and the form cannot show |
| Z-09 | a newcomer's first two parallel requests → 409 "under a different sign-in" | confirmed, `[200, 409]`. **It needed no widened window at all** — two ordinary parallel requests reproduce it, which is what the browser does on a first sign-in |
| Z-12 | vote on a just-deleted request → 409 "You have already voted" | confirmed |
| Z-01 | both last admins leave; the board reaches **zero admins** | confirmed, `[204, 204]`, `COUNT(*) WHERE role='admin' AND deleted_at IS NULL` = **0** |
| Z-02 | the daily limit is over-by-N | confirmed, `limit = 1`, ten concurrent posts, **ten rows** |
| Z-03 | a reply is accepted and then cascaded away | confirmed — 201, then the row is gone after the parent's hard delete |
| Z-04 | a live reply is left hanging from a tombstone | confirmed, `hidden_with_parent = 0` under a soft-deleted parent |
| Z-05, V-05, V-06, V-07, X-12/Z-07, S-15, S-16/Z-10, Z-08 | hold | all hold |

Two of these deserve to be read together. **Z-01 and P-14 are the same shape**:
a decision taken from a read that nothing holds still, and in both cases the
refusal that exists to prevent the bad state is the thing that does not fire.
Z-01 empties a board of admins with nothing in the application able to appoint
one — the exact dead end its own 409 message describes.

**Z-09 is the one that changes how I would rank these.** It was filed under
concurrency, and it turns out not to need any: a newcomer signing in for the
first time, with a browser that fires bootstrap and a refresh together, gets an
error telling them to ask an admin to link their accounts. No stub, no timing,
no widened window.

### Two places the plan is wrong about the code

Written down because the plan will be read as the specification and it is not
one:

- **V-01 says casting a vote is 200.** It is **201** — `votes.controller.ts`
  creates a resource and says so. The tests assert 201.
- **C-07 says deleting a comment is 204.** It is **200** with
  `{ data: { kind, repliesHidden } }`. The tests assert that.

Neither is a defect. Both are rows written from memory of the API rather than
from it, which is the same failure mode as the realm files, in a test plan.

### Order of work from here

The plan's rule, and this repository's: **failing tests first, fixes second.**
The probes are committed red. Fixing them is the next entry, and the E-14 / P-14
pair goes first because it is user-visible on a fresh board in under ten seconds.

## 2026-08-28 — Registration: the brief's first verb, nine slices late

**Asked:** the brief's first journey is "registers *or* signs in through the
identity provider", and only the second verb existed — `registrationAllowed`
was false. The fix as specified: turn it on, add a "Create an account" control
that starts the same PKCE flow against `/protocol/openid-connect/registrations`,
build no form, verify the domain-restricted refusal end to end with an actual
registration, and re-read the sign-in panel's copy now that it has two paths.

### What the verification found before it passed

The specified fix was done first and the end-to-end run was written against it:
a real GET of Keycloak's registration page, a real form POST, the callback's
code exchanged with the verifier, `/api/bootstrap` through nginx. It could not
reach the registration policy at all.

The realm had `verifyEmail: false`, so a self-registered account carries
`email_verified: false` — and `current-user.ts` refuses to provision an
unverified address, on purpose, before `provision.ts` is ever called. That rule
is written down in DECISIONS.md as the defence against exactly this: somebody
registering another person's address at a provider that does not check it. A
realm that does not verify *is* that provider. So every registrant
authenticated perfectly and was then refused as unverified with a 401 — and the
browser turned that 401 into a silent sign-out, back to a panel that said
nothing, from which "Sign in" returned them through Keycloak's open SSO session
to the same 401. Nine slices of "the registration policy is applied at
provisioning" had been true of people typed into the realm file and never of a
registration.

Two ways out were weighed. Loosening the API rule under an `open` policy was
refused: it is still what stops a stranger squatting on a colleague's address so
the colleague collides on arrival with "ask an admin to link them". The other is
for the realm to verify, which needs SMTP, which a laptop does not have — so the
compose stack and the cluster each gained **Mailpit**, a sink that accepts
everything and shows it on a web page. That is the one thing done here beyond
the fix as specified, and it is the reason the specified verification could be
performed at all. `registrationEmailAsUsername` went on with it so the form
matches how the three seeded people are set up, and the same file drives both
environments, which is why the cluster's Service is called `mailpit` and not
`feedbackhub-mailpit`.

### What the browser was doing to a refused person

A 403 from `/api/bootstrap` rendered as "FeedbackHub could not start" with a
retry button — a wrong title, and no way out. The person was still signed in
at Keycloak; the retry returned the same refusal; they could not become anybody
else. The screen now says the board has not given them an account, shows the
API's reason, and offers sign-out beside the retry. The retry is kept because
it is real: the run proved that an admin adding the domain admits the refused
person on the same token. A 401's sentence now travels to the sign-in panel
too, because "your address has not been verified" is a different instruction
from "sign in again".

### The run

42 checks through the compose stack, none failed — the table is in
`notes/handoff.md`. Open board admits; restricted board refuses with the rule
and without the list, on every route, on retry; an address inside the domain
is admitted under the same policy; the admin relents and the same token is
admitted; each account deleted itself; the policy was restored. Eight new web
tests (234 now) cover the control, the refused screen, the reason line, and
the registration URL carrying the same PKCE parameters as a sign-in.

### Things worth knowing

- The registrations endpoint is not in the discovery document. It is Keycloak's
  and not OpenID Connect's, so it is the one URL the browser derives — from the
  discovered authorization endpoint, by replacing the last segment — rather
  than discovers. It is commented as the assumption it is.
- The cluster's Keycloak was **not** restarted. `kubectl apply -k .` updated
  the ConfigMap and created Mailpit; the running pod serves the old realm until
  it is rolled. Written into `k8s/README.md` so nobody reads a green apply as
  a verified cluster.
- Keycloak's verification link continues the *same* authentication session
  when followed with the same cookies, and lands on the callback with the
  original `state`. In a different browser it would not; a reviewer who opens
  Mailpit in the same browser gets the seamless version.
- A Node below 24.15 will not run the Angular CLI at all now. The pin in
  `.node-version` is 24.19.0 and fnm honours it; a shell without fnm's
  environment does not.
