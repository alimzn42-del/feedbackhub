# Decisions

Why the code looks the way it does. Reversed decisions stay in the record with
the reason they were reversed.

## Data

**MySQL 8.** Chosen over Postgres for familiarity and faster diagnosis inside a
timebox, and over MongoDB because the data is strongly relational — the
"unbounded comments per user" worry is what a foreign key is for, not a reason
to denormalise. `utf8mb4` / `utf8mb4_0900_ai_ci` throughout.

**`DATETIME(3)`, not `TIMESTAMP`.** No 2038 ceiling, and no implicit timezone
conversion on read. The container runs at `+00:00`, the driver reads at `Z`, and
the API emits ISO-8601 UTC. There is one representation of an instant.

**`name` and `slug` on every taxonomy row.** `name` is the display label and
admins may rename it freely. `slug` is the stable handle that goes in URLs, so a
shared filter link survives a rename.

**Taxonomy rows are archived, not deleted.** `archived_at` retires a category or
status while existing requests keep a valid reference. Paired with
`ON DELETE RESTRICT` everywhere.

**`ON DELETE RESTRICT` on `feedback_requests.author_id`.** Deleting a user has
consequences for their content, and account deletion is a later slice. RESTRICT
means the database refuses until the application says explicitly what should
happen, rather than cascading somebody's history away by default.

**`role` is an `ENUM`, not a table.** The policy module branches on the two
literals `'user'` and `'admin'`, which makes them code. Categories and statuses
are tables precisely because no code branches on their values.

**`statuses.is_default` is guarded by a generated column plus a unique key.**
This enforces *at most one* default. It does **not** enforce *exactly one*: an
admin can clear every default and leave the table without one. That lower bound
is application logic in the statuses slice; until then, request creation fails
loudly with `SERVER_MISCONFIGURED` and says what to fix, rather than inventing a
status.

**Pinning records who and when, and the boolean is gone.** `is_pinned` was
replaced by `pinned_at` and `pinned_by` rather than supplemented by them.
Keeping all three would mean two columns describing one fact, free to disagree
the first time something writes one and forgets the other — the same argument
that keeps a vote counter out of this schema. Pinned is now derived:
`pinned_at IS NOT NULL`.

Rows pinned before the columns existed keep their time and report a null actor.
Nobody recorded who pinned them, and inventing an admin would be worse than
admitting it.

**The board is split rather than sorted together.** Pinned requests live in
their own panel and are excluded from the list below, so a request appears in
exactly one place. The previous arrangement — pinned first inside one ordered
list — put them at the top of page 1 only and shifted everything else along,
which made the pagination subtly wrong. Splitting removes the interleaving and
both queries get simpler.

**Comment counts are derived, never stored,** and count only what a reader can
open. A hidden comment stays in the table for the audit trail but is not part of
the number — which is exactly the sort of condition a stored counter gets wrong
the first time somebody moderates something.

**Vote counts are derived, never stored.** There is no counter column anywhere
in this schema. The total is produced by counting the vote rows when the board
is read, so nothing can claim a number the rows disagree with. A counter would
have to be incremented on cast, decremented on withdraw, and repaired after
every crash, every cascade and every manual fix — three chances to drift in
exchange for a saving this board will never need.

**The votes primary key IS the "one user, one request, at most once" rule.**
`PRIMARY KEY (request_id, user_id)` — enforced by the database rather than by
an application check a future code path could forget. `request_id` leads
because InnoDB clusters on the primary key and the board aggregates by request
on every page load; the reverse lookup is served by `idx_votes_user`.

**Casting a vote is `INSERT IGNORE`, not check-then-insert.** Reading first
leaves a window where two concurrent requests both see "no vote" and both try
to write. Letting the primary key refuse the duplicate is the only version
without a race; `affectedRows` then says whether anything happened.

**`ON DELETE CASCADE` on `votes.request_id`** — the one place this schema does
not use RESTRICT. A vote has no meaning without its request, and deleting a
request is already permitted for its author and for admins; refusing that
because somebody voted would be the wrong answer. `votes.user_id` stays
RESTRICT, so account deletion still has to decide for itself in its own slice.

**Default sort: `vote_count DESC, created_at DESC, id DESC`,** over unpinned
requests only. Pinned ones are a separate collection ordered by when they were
pinned, most recent first, which is what an admin expects to see after pinning
something.

The last two keys are not decoration. Most of the board sits on zero votes, so
requests tie constantly, and without a total order two rows on equal votes are
free to swap between page 1 and page 2 while somebody is paging through.

**No index can serve this ordering, and that is accepted rather than
overlooked.** The vote count is derived, so MySQL has to aggregate every row
before it can order any of them — `LIMIT` cannot help, because the twenty rows
to return are not known until all of them are sorted. The measured plan on the
development data is a filesort over the full set, with the vote-count CTE
materialised and joined on an auto-generated key, and every other join an index
lookup. Cost therefore grows with the size of the board rather than with the
page.

That is the price of not storing a counter, and at this size it is not worth
paying anything to avoid: an internal feedback board is thousands of rows, not
millions. The escape hatch, if it is ever needed, is a summary table refreshed
on write — which is a counter by another name and should be resisted until
there is a measurement saying otherwise, not a suspicion.

`idx_requests_feed` no longer serves the default sort. It stays because it
still serves the `is_pinned, created_at` prefix, which the "newest first"
option will use when the filters slice adds it.

**Migrations are plain `.sql` run by [postgrator](https://github.com/rickbergfalk/postgrator).**
A reviewer should read real DDL, not a builder's approximation, and CTEs and
window functions are used directly anyway. postgrator owns the version table,
ordering and checksums; `api/scripts/migrate.mjs` only wires it to a mysql2
connection.

## Authorization and identity

**Authorization from day one, authentication deferred.** Every endpoint enforces
permissions now. The current user comes from one function, `resolveCurrentUser`,
which today returns a seeded user named by an environment variable. The Keycloak
slice rewrites that function body and changes nothing else.

**The seam is locked structurally, not by convention.** `IDENTITY_MODE` in
`api/src/auth/identity-mode.ts` records which implementation is compiled in, and
`api/src/config/env.schema.ts` asserts on it at boot. `NODE_ENV=production` with
the development seam present is a hard boot failure before the connection pool
is created — the seam authenticates nobody and grants a chosen identity to every
caller, so reaching production with it must be impossible rather than
discouraged.

**Local `users` table with a `UNIQUE external_id`,** which will later hold the
identity provider's `sub`. Role is read from this table, never from a token
claim. Nullable until authentication exists; MySQL permits many NULLs under a
UNIQUE key, so the constraint is correct from day one.

**All permission rules live in `api/src/policy/`.** Handlers ask questions; they
do not contain rules. No permission library and no dynamic RBAC engine — two
roles and roughly fifteen rules do not pay for one.

Unit tests over the policy prove the rules are written correctly. They cannot
prove a handler asks — an endpoint that forgets to check keeps every one of them
green. So authorization is also tested through the real Express app, asserting
that each route consults the policy with the acting user and that a denial
becomes a 403 in the standard envelope. See `api/src/app.authorization.test.ts`,
which also records what slice 1 cannot yet cover.

**Permission is checked before the body is validated.** A caller who may not
perform an action should not learn the payload schema from a 422 enumerating
every field and its constraints. The controller asks the policy first; the
service asks again, because the service rather than the controller is the
boundary any future caller crosses. The duplication is deliberate and costs a
comparison.

**You cannot vote on your own request.** The vote count is the signal that
replaces the same suggestion arriving five times by email. An author voting for
their own request tells nobody anything — they filed it, so of course they want
it — and every request would start at one. This is the first rule in the
application that refuses anybody, and it is refused end to end in the tests
rather than by making the policy deny artificially.

**Pin and unpin are admin-only, and refuse before looking anything up.** The
existence check runs after the permission check, so a caller who may not pin
cannot use the endpoint to discover which ids are real — the answer is 403
whether the request exists or not. This is the first rule in the application
that refuses based on *who you are* rather than on what you are acting upon,
which makes it the one that proves the admin boundary end to end.

**Re-pinning is not a conflict.** It refreshes who and when, which is what
makes the panel ordering mean anything. Unlike a duplicate vote there is no
state to disagree with, so no 409.

**"Vote for yourself only" is structural, not checked.** The vote resource is
`/requests/:id/vote`, singular and scoped to the caller. There is no
`/votes/:voteId`, and no user field in the URL or the payload, so there is
nowhere to name a different voter. The user id comes from the identity seam,
the same way authorship does. A rule that cannot be expressed cannot be
violated, which beats a rule that has to be remembered.

**The server decides whether you may vote, per row.** Every list item carries
`canVote`, computed by the policy module. The browser is never told who it is
and never reimplements the rule, so there is no second copy of it to disagree
with the first.

**Deleting a comment removes it or hides it, and which one is a judgement.**

| Actor | Has replies | The comment | Its replies |
|---|---|---|---|
| Author | no | removed outright | — |
| Author | yes | hidden, tombstoned | hidden with it |
| Admin | no | hidden | — |
| Admin | yes | hidden | hidden with it |

Hard deleting a comment that has replies would cascade and destroy words written
by other people because the person above them changed their mind, so it does not
happen. An admin deleting their *own* comment counts as the author rather than a
moderator. A reply can never have replies, so an author removing their own reply
is always the first row — the depth limit collapses the matrix instead of
needing a second one.

"Has replies" counts every reply row, including already-hidden ones: hard
deleting a comment whose replies were previously moderated would cascade those
rows away and take the record of that moderation with them.

**A removed comment's words do not leave the server.** The row is kept for the
trail, not for the reader, so `body` and `author` come back null rather than
being hidden by the browser.

**Three explanations for a hidden comment; two of them derived.** Author-removed
and admin-removed are told apart by `deleted_by = author_id`, which is a fact
about the data. Hidden-with-parent is not derivable — a reply hidden alongside
its parent carries the parent-remover's id, which does not match its own
author's — so it is recorded in `hidden_with_parent` and nothing else is.

**An admin cannot edit somebody else's comment,** for the same reason they
cannot edit somebody else's request. Moderation is removal, not authorship.

**Thread depth is enforced in the service, not the schema.** The constraint
exists in MySQL and was built and tested — a generated column marking roots, a
unique key on `(id, is_root)`, a composite foreign key into it — and it cannot
coexist with `ON DELETE CASCADE`, which MySQL refuses on generated-column
foreign keys. Losing the cascade would let comments outlive their request
whenever code forgot, so the cascade stayed and the depth rule moved up a layer.
See `007.do.comments.sql`.

**Unauthorized actions return `403`, never a disguised `404`.** The board is
internal and every request on it is visible to everyone, so pretending a
resource does not exist conceals nothing and only makes the client's job harder.

**An admin does not edit another person's text.** Moderation is deletion or a
status change. `requestPolicy.editContent` refuses admins deliberately, and the
test says so, because it is the rule most likely to be "fixed" by mistake later.

## HTTP

### Error shape

One envelope, produced by one middleware:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The submitted values are not valid.",
    "details": [
      {
        "field": "title",
        "code": "TOO_SHORT",
        "message": "The title must be at least 5 characters."
      }
    ],
    "requestId": "8f3c-..."
  }
}
```

- The HTTP status carries the class; `code` is the stable string clients switch
  on; `message` is human-readable and always safe to render.
- `details` appears on validation failures only. It is an ordered array rather
  than a field-to-message map because one field can fail two ways at once and
  the order reported is the order shown.
- `field` uses dot/bracket paths so it maps straight onto a form control.
- `requestId` is generated per request, returned in `X-Request-Id`, and is the
  join key to the server log.

**Deliberate errors expose their message; unknown errors never do.** Anything
that is an `AppError` was written to be read by a caller. Anything else is a bug
and becomes an opaque 500 — logged in full server-side, disclosed as nothing.

**`400` and `422` are distinct.** `400` means the body could not be parsed;
`422` means it parsed and a field is invalid. The client handles them
differently: one is a bug in the caller, the other renders next to an input.

**Unknown fields are rejected, not ignored.** `status` and `author` are not the
client's to set, and silently dropping them would hide the attempt.

**A second vote is `409`; a second withdrawal is not.** Casting twice conflicts
with a state that already exists, and reporting success would be a lie. But
withdrawing a vote that is not there achieved exactly what the caller wanted,
so it returns the current state rather than an error. The UI toggles between
`POST` and `DELETE` based on what it is showing, so neither case arises in
normal use — they are for two tabs, a retry, or a stale page.

### Responses

**Every success response has a `data` key.** Collections add `page` with
`page`, `pageSize`, `total`, `totalPages`. Fixed from this slice; every list
endpoint uses it unchanged.

**Offset pagination, not keyset.** The UI shows page numbers and a total, which
keyset cannot express, and this board will never hold enough rows for
deep-offset cost to matter.

**The total comes from `COUNT(*) OVER ()` in the same query as the page.**
Window functions are evaluated before `LIMIT`, so one round trip returns both.
`SQL_CALC_FOUND_ROWS` is deprecated in MySQL 8. The one exception is a page past
the end, which returns no rows and therefore no window result; that case costs a
second `COUNT(*)`.

**Bounded taxonomy collections are not paginated.** `GET /api/categories`
returns `data` with no `page` block: there are no pages to describe.

**List rows carry an `excerpt`, not the full description.** Twenty full
descriptions is up to 100KB the card never renders, and truncating in the
browser would mean sending it anyway. The excerpt is cut in SQL.

## Frontend

**Angular 22, standalone components, signals, typed reactive forms.**

**Node is pinned in the repository.** Angular 22 requires Node 24.15.0 or newer
and the development machine had 24.12.0. Rather than deviating from "latest
stable Angular" or changing the machine's Node globally, `.node-version` pins
24.19.0 for this repository. `engines.node` in the root package.json names the
same exact version, and docker-compose pins `mysql:8.4.6` rather than a floating
`8.4` tag, so nothing in the repository resolves a version at build time.

**The API base URL is relative (`/api`), not an environment file.** The CLI
proxy forwards it in development and a reverse proxy serves it in a deployment,
so there is no absolute URL to configure and no build-time value to get wrong.
It is an injection token rather than a constant so a different origin can be
supplied later without editing every service.

**List state lives in URL query parameters,** bound to component inputs by
`withComponentInputBinding()`. A filtered view can be shared and survives a
refresh. Paging is always sent to the server; nothing is filtered in the
browser.

**Loading, empty and error are distinct rendered states, not a spinner.** The
list also distinguishes "nothing has been filed" from "this page number is past
the end", because they need different offers to the user. Skeletons mirror the
real card geometry so the layout does not jump.

**Pinning is deliberately NOT optimistic, unlike voting.** A vote changes a
number in place, so guessing is cheap and reversible. A pin moves a request
between two collections — guessing means rendering it in both or in neither
until the server answers. The row is disabled while the call is in flight and
both collections refetch together when it lands.

**The pinned panel shows three and expands to a scrolling shelf.** Pinning is
unlimited by decision, so the panel cannot assume the list is short: expanded,
it scrolls within a viewport-relative height rather than pushing the board off
the screen. The endpoint is capped for the same reason, and the panel says so
when there are pinned requests it is not showing rather than silently
truncating.

**The panel is presentational and emits intent.** Voting and unpinning from it
are the same operations the list performs, so they live in one place there.
Two copies of an optimistic update are two chances for them to disagree.

**Deleting a comment is deliberately NOT optimistic, unlike voting.** A vote
changes a number in place. A delete can remove a row, replace it with a
tombstone, or hide several replies with it — three shapes, decided by rules the
browser does not hold. It waits, then reloads the thread.

**Voting is optimistic, and the board does not re-sort under the pointer.**
The count moves on click and rolls back if the server refuses. The response is
then applied verbatim rather than assumed to match the guess, so a vote cast in
another tab corrects the number instead of compounding it.

What deliberately does not happen is re-ordering. The board is sorted by vote
count, so a vote can change a card position — moving it out from under the
cursor mid-click would be hostile, and would make voting for several things in
a row a game of chase. The new order arrives on the next load.

**Server field errors attach to the control they name.** A rule the browser
cannot check — "that category no longer exists" — lands next to the input. Only
failures that name no field, or name a field the form does not have, fall back
to the banner.

**Comments are plain text and are rendered as such.** `white-space: pre-wrap`
keeps the line breaks somebody typed; nothing they typed is interpreted. There
is no markdown, and therefore no HTML to sanitise.

## Scope

**`GET /api/categories` was added beyond the agreed slice 1 scope.** The agreed
scope includes a create-request form with a category, and categories are
admin-managed data rather than an application enum — so the form cannot be built
without reading them. Managing categories remains a later slice; this is only
the read that the agreed screen requires.
