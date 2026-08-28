# Decisions

Why the code looks the way it does. Reversed decisions stay in the record with
the reason they were reversed.

## Data

**Settings live in two key/value tables, not one table and not a document.**
`app_settings` is keyed by the setting; `user_settings` is keyed by the person
and the setting. The obvious shape — one table with a nullable `user_id` where
NULL means global — cannot hold its own uniqueness, because MySQL permits many
NULLs under a `UNIQUE` key and two global rows for one setting would be legal.
Making that illegal needs a STORED generated column, and this schema has already
paid for one of those once (migration 007, where it cost a cascade). Split in
two, both primary keys are NOT NULL and the constraint is real. The scopes also
do not share columns: a global row records which admin last changed it, and a
personal row has nobody to name but its owner.

**A setting's value is a JSON column, and its default is not stored at all.**
The defaults live in `src/modules/settings/settings.registry.ts`, so a table with
no row for a key is the normal state rather than a missing one. That is what
lets a new setting arrive without a migration, and it is also what makes "using
the default" answerable: the absence of a row IS the answer. A row holding the
default would mean somebody chose it.

**`user_settings` is the only user reference in this schema that cascades.**
Everywhere else is `ON DELETE RESTRICT`, because somebody's requests, comments
and votes are other people's screens too. Preferences are the one thing that is
purely theirs, so nothing is lost by removing them with the account.

**`comments.approved_at` is stamped at insert whenever moderation is off.** It
therefore means "this comment has cleared publication" and not "an admin looked
at it". The alternative — NULL for everything written while the gate was down —
would mean switching moderation ON hid the entire history of the board
retroactively. Turning it OFF releases what is waiting, because the visibility
test asks whether the gate is up NOW as well as whether the row cleared it;
without that half, comments written during a moderated spell would be stranded
invisible the moment an admin changed their mind.

**No `approved_by`.** `deleted_by` exists because a moderator removing somebody's
words is contested and needs a name against it. Approval is the opposite act and
nobody is served by knowing which admin waved a comment through.

**Deleting an account is an UPDATE, not a DELETE.** `users.deleted_at` plus
cleared personal fields. Every foreign key to `users` stays intact and pointing
at a row that no longer says who it was. The email becomes
`deleted-<id>@removed.invalid` rather than being emptied, because the column is
NOT NULL UNIQUE and every departed account would otherwise collide on the empty
string; `.invalid` is the reserved TLD that can never resolve. `deleted_at`
exists even though the fields are already cleared, because the identity seam has
to refuse a departed account and a screen has to tell a real person called
"Deleted user" from an account that is gone.

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

**~~Default sort: `vote_count DESC, created_at DESC, id DESC`.~~ Reversed: the
board opens on `created_at DESC, id DESC` — newest first.** Vote order is still
offered and is one select away; it is no longer what the board opens on. The
original argument was that the count is the priority signal and a board that
opens on anything else buries what people asked for most. That holds for triage
and not for the daily read: on a board where most rows sit on zero votes, vote
order is close to fixed, and what has changed since yesterday is invisible.
Newest first makes the board answer "what is new" and leaves "what is wanted"
to a control that says so.

Pinned requests are a separate collection ordered by when they were pinned, most
recent first, which is what an admin expects to see after pinning something —
and which keeps a fresh pin inside the three the panel shows collapsed.

The last two keys are not decoration. Most of the board sits on zero votes, so
requests tie constantly, and without a total order two rows on equal votes are
free to swap between page 1 and page 2 while somebody is paging through.

**No index can serve the vote-count ordering, and that is accepted rather than
overlooked.** (This applied to the default board until the default became
newest; it now applies to the vote ordering when it is chosen.) The vote count is derived, so MySQL has to aggregate every row
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

The index that serves the default is `idx_requests_recent (created_at DESC, id
DESC)`, added by migration 006 in as many words “for the newest-first option
arriving with the filters slice”. `idx_requests_feed` does not serve it and
cannot: it was dropped in that same migration along with the `is_pinned` column
it led with. An earlier version of this file said it “stays”, which stopped
being true the moment the boolean went.

**Three orderings, `newest` the default.** `newest` and `oldest` are
`created_at` with `id` as the tiebreak; `votes` is the original vote ordering.
Every one is a total order, because pagination cannot survive ties that are free
to swap between pages — and several requests filed in the same millisecond is
what the seed script does, not a hypothetical.

The default is not configurable and does not follow "what you last chose". One
board, one answer to "what does this look like when you arrive".

**The shelf follows the ordering; it does not follow the filters.** Sorting
reorders what is on screen and hides nothing, so the shelf stays and is sorted
the same way — a board sorted oldest-first with a shelf on top sorted by
something else is two answers to one question. Filtering hides things, so the
shelf collapses into the results instead.

**`sort` has no schema default, and that is what makes the shelf's own order
possible.** The shelf orders by `pinned_at DESC` when no ordering was asked for
and follows the board when one was, so it has to be able to tell those apart. A
`.default()` in the query schema would answer "was one asked for?" with "yes,
always" before the service ever saw it. The default is applied in the service
instead, where only the list needs it.

An ordering equal to the default counts as "not asked for", which keeps the URL
canonical: `/requests` and the default view are the same link however the reader
got there. The cost is that explicitly choosing Newest first cannot force the
shelf out of pin order — the right trade, since that selection produces exactly
the default board.

**Filters are applied to the request table's own foreign keys, not to the joined
taxonomy's slug.** The URL carries `?status=planned`, and the service resolves
that to an id before the query runs, so `WHERE r.status_id IN (...)` can use
`idx_requests_status` rather than filtering on a column reached through a join.

**A filter value that names nothing is refused, not ignored.** `?status=planed`
is a `422` naming the value, in the same shape as an unknown category on create.
Ignoring it would return the unfiltered board, which is indistinguishable from a
filter that matched everything — the user reads a wrong answer as a right one.
Unknown parameter *names* are refused for the same reason, which the strict
query schema was already doing.

**Slug resolution deliberately includes archived rows.** Archiving retires a
category or status from the choices offered for a new request; it does not
retire the requests already carrying it. A link shared before the archiving must
still open, so the lookup that resolves a filter ignores `archived_at` while the
lookup that populates the options does not.

**Search is `LIKE '%term%'` over title and description, not `FULLTEXT`.** The
leading wildcard means no index serves it, so it is a scan of the matching set —
accepted for the same reason the vote-count sort is: an internal board is
thousands of rows, not millions. `FULLTEXT` is the escape hatch, and it changes
what matching means (words, not substrings), so it is a decision to take on
purpose rather than a swap to make quietly. The term's `%` and `_` are escaped,
so a search for "100%" searches for the text.

**Several values per filter, combined as OR within a filter and AND across
them.** `?status=planned,done&category=bug` is planned or done bugs. Both
spellings arrive as the same list: `?status=planned,done` is what somebody
types, `?status=planned&status=done` is what a form produces.

**~~The pinned shelf takes no filters.~~ Reversed: the shelf belongs to the
default board, and collapses into the results once anything is filtered.**

The original rule kept the shelf on screen unfiltered at all times. It was
coherent — pinning is absolute, and a filter that could hide a pinned request
makes "pinned" mean less than it says — but it left a shelf sitting above a
filtered list showing requests that contradict the filter, and a sentence
apologising for it. A caption explaining why the screen disagrees with itself is
a sign the screen is wrong.

The rule now:

| | |
|---|---|
| Nothing filtered | Shelf above the board. The list excludes pinned rows, and so does the total. |
| Anything filtered | No shelf. Pinned rows that match are in the results, ranked first, badged. The total counts them. |

Pinning is still absolute: a pinned request that matches the filter is at the
top of the matches, and one that does not match is not on screen because it does
not match — which is the honest answer, and the same answer the list gives for
everything else.

**Sorting is not filtering, and that boundary is load-bearing here.** Reordering
the board hides nothing from it, so the shelf stays. Only status, category,
mine or a search term collapse it. The server and the browser each decide this,
so both apply the same rule — `isFiltered` in `requests.schema.ts` and in
`board-filters.ts` — and they have to agree: a shelf on screen while the list
also holds the pinned rows would show them twice.

**The browser stops asking for the shelf when it has nowhere to put it.** The
pinned resource returns no request at all on a filtered board, rather than
fetching a collection in order to hide it.

**Migrations are plain `.sql` run by [postgrator](https://github.com/rickbergfalk/postgrator).**
A reviewer should read real DDL, not a builder's approximation, and CTEs and
window functions are used directly anyway. postgrator owns the version table,
ordering and checksums; `api/scripts/migrate.mjs` only wires it to a mysql2
connection.

**Retiring writes `archived_at`; nothing deletes a taxonomy row.** The rows are
pointed at by `ON DELETE RESTRICT` foreign keys, and a category is a label a
request keeps for as long as it exists. Retirement removes it from the choices
offered — the create form, the edit form, the filter bar — and leaves every
existing reference intact and rendering. The usage count is shown next to the
action to inform it, never to block it: a category with fifty requests can be
retired, and that is precisely the case retirement exists for.

**Statuses have no retirement, and the asymmetry is the point.** A category is a
label a request carries; a status is a position it is sitting in. Retiring a
status would leave requests in a state that is no longer offered, with no answer
to "what happens to them". There is no archive route for statuses and no column
behaviour to go with it.

**Exactly one default status, enforced in two halves.** The schema's generated
column and unique key give AT MOST one — they cannot express at least one. The
application supplies the lower bound with two rules: the only endpoint that
touches the default is "make this one the default", which clears the old one
inside the same transaction, and the first status created in an empty table
becomes the default. There is deliberately no endpoint that clears a default
without naming its replacement, because that is the only request that could
leave the table in the state where filing anything fails.

The clear-then-set order is forced rather than chosen: the unique key permits
one row with the marker, so setting the new default before clearing the old one
collides. The swap therefore passes through zero defaults, which is exactly why
it is a transaction — nothing else can observe that instant, and a failure
between the two statements rolls back.

## Authorization and identity

**The seam was the whole bet, and it paid.** Authentication landed by changing
one constant and the body of one function. Nothing in `src/policy/` moved, no
service learned what a token is, no handler gained a null check, and `req.actor`
is still non-nullable behind the middleware. The 220 route tests changed in two
mechanical ways — the repository they resolve identity through, and a header on
each call — and not one of them changed what it asserts.

**The development seam was retained, not deleted.** It is a second identity mode
that still cannot start in production, and keeping it does three things:
`assertIdentityIsSafeFor` keeps a subject it can be tested against, the API can
be run without a container, and the boot guard stays a live rule rather than
dead code guarding a branch nobody can select. The web application asks the API
which mode it is in and skips the sign-in flow entirely when the answer is the
seam — better than redirecting a browser to a realm that is not running.

**Verification is local, and four things are checked.** Signature, issuer,
audience, expiry — with a closed algorithm list. The audience check is the one
easiest to leave out and the one most worth having: a token minted for a
different client of the same realm carries a perfect signature from an issuer
this API trusts, and without it every other client of that realm would be a way
in. Calling Keycloak per request was never considered: it would put an outage in
front of every call and a round trip inside every one that survived.

**A 401 says one sentence on the wire and a named reason in the log.** Telling
an unauthenticated stranger that their signature was fine and their audience was
wrong describes the installation to somebody who has not been let into it. An
operator, meanwhile, cannot tell a clock skew from a client pointed at the wrong
realm from somebody probing, if all three are one line reading `401`. So the
reason is a stable token — `token.expired`, `token.audience` — and it is only
ever logged.

**A provider that cannot be reached is a 503 and not a 401.** The caller may be
holding a perfectly good token; the API is simply unable to check it. Answering
401 would tell every client in the building that its session had ended, and this
application's own interceptor would act on it — turning a provider restart into
a mass sign-out that outlasts the restart. The cached key set means most
restarts cost nothing at all, which is the other half of the same reasoning.

**The role still comes from the local table and never from a claim.** The token
establishes WHICH user this is; it does not establish what they may do. There is
no realm role mapped into the access token, and nothing in the identity path
reads one — so no realm misconfiguration can promote anybody.

**The email is the provider's field; the display name is the person's.** The
name is copied once, at provisioning, and the account screen owns it from then
on: overwriting it on every request would make that screen a control that
appears to work and silently does nothing. The email is the opposite — nothing
in this application edits it, so a difference can only mean the provider moved
and the local copy is stale. It is reconciled onto the row the SUBJECT names,
and an address that changed upstream can never re-point a token at a different
account.

**An unverified address is never provisioned, and never overwrites a verified
one.** Without that, an installation restricted to a domain could be entered by
registering somebody else's address at a provider that does not check it. The
realm is configured to link only on a verified email; this asserts the same rule
where it does not depend on the realm being configured correctly.

**The seeded users' subjects are pinned in the realm file.** Matching is on
`external_id` and never on an address, so the two sets of people have to agree
about what those subjects are. Letting Keycloak generate them would mean the
seeded admin authenticates, matches nothing, is sent to provisioning, and
collides with the unique constraint on `email` — the one account that can reach
the admin screens unable to get in, on a board that cannot promote a replacement.

**`GET /api/auth/config` is the only route under `/api` without a token, and it
is not a second `/api/bootstrap`.**

Bootstrap answers *"who am I, and how is this board configured for me"* — every
word of which presupposes an identity, which is why it is authenticated. This
answers *"where do I go to become somebody"*, which by definition cannot be.
**One is the question you ask before you are able to ask the other.** They are
not two ways of asking one thing, and folding them into a single route would
either make the sign-in configuration require a token that does not exist yet,
or make the startup payload readable by strangers.

Two tests hold it. One asserts the payload is exactly `{mode, issuer, clientId}`
with `toEqual`, so it fails if a field is ever *added* — nothing about the
verification path belongs in it, not the audience, not the key set, not the
clock tolerance. An unauthenticated caller learns where to go and who to say
they are, and nothing about how they will be checked when they come back.

The other asserts the *structure*: exactly one router is mounted in front of
the identity middleware. A behavioural test can only 401 the paths it happens
to name and would never notice a new unauthenticated route being added, so this
counts the layers instead. Mounting a second one makes the count two and fails.

**The frontend's runtime configuration comes from that endpoint rather than
from a file baked into the image.** The three values that vary per environment
are not one problem:

- *The API URL does not vary.* `API_BASE_URL` is the relative path `/api`; the
  browser always talks to its own origin and the web tier's nginx proxies to
  wherever the API is. The one environment-specific value is that upstream,
  substituted into the nginx config at container start. No API URL is ever
  compiled into the bundle, and CORS never arises anywhere in this application.
- *The issuer and client id* are fetched at runtime from `/api/auth/config`.

A static `config.json` templated into the web image was the obvious
alternative and is worse for one reason: the API already holds the issuer and
audience *because it verifies against them*, so a file for the browser is a
second copy of the same fact. When those two drift, the browser gets a token
from realm A and presents it to an API trusting realm B, and the symptom is a
401 that reads like a token bug. With the endpoint they cannot disagree. It
also costs nothing — a config file is equally an HTTP fetch before bootstrap —
and it composes with the development seam, which a static file cannot: the
endpoint answers `mode: 'development-seam'` and the browser skips the sign-in
flow entirely, because that is a property of the API build rather than of the
deployment.

**A settings screen resolves at the level it WRITES, not at the level the
person experiences.** The administrative document is resolved with the caller's
own preferences left out entirely: its source is `global` or `default` and can
never be `user`, because there is no such thing as a personal value for the whole
installation. This was wrong first: an admin who had chosen an ordering for
themselves saw their own choice on the screen that sets everybody's, labelled as
theirs, over a global value that did not exist — the screen displayed one thing
and saved another. The account screen keeps all three layers, because there the
effective value IS what the person gets.

**The three settings that exist at both levels appear on both screens, and each
screen says which level it is setting.** The duplication is the feature the brief
asks for; identical wording on both was the defect. The administrative screen
says "Set for everybody" and names the fact that a personal choice beats it; the
account screen says "Your choice" or "Following the board default", and its reset
goes back to the board rather than to the built-in default.

**Application settings are withheld from a non-admin, not merely uneditable.**
This is the one place on this board where a field is hidden rather than refused
on write. How the installation is run — who may register, how often anybody may
post — is not a fact every account is owed. It is not a secrecy guarantee and
does not try to be: a setting whose effect is visible is visible.

**A moderated comment is judged in the thread it was written in, and there is no
queue.** A list of comments taken out of their discussions cannot be judged:
"that is not what I meant" is fine or not depending entirely on what it answers.
So approve and reject sit beside the words, and the comment carries `canApprove`
the way every row carries `canVote` — the thread offers the control without ever
being told who is reading.

**Rejecting is deleting, deliberately not a second mechanism.** A rejected
comment is a removed one: it records which admin removed it, and its author is
told an admin did. A separate "rejected" state would be a third kind of hidden
comment keeping no trail the other two do not already keep.

**Discovery is a count in the header, and it is the only path there is.** Without
one, a waiting comment sits in a thread nobody has a reason to open and the
setting that held it back does nothing at all — the feature was non-functional
before this. The count travels in the startup payload, links to the board
filtered to requests carrying waiting comments, and is refetched after a decision
so it falls without a reload.

**The indicator is ABSENT, not zero, when the question does not apply** — the gate
is down, or the reader cannot approve. A badge showing 0 and a header with
nothing in it are different statements, so the server omits the field rather than
sending a number.

**`?pending=true` is admin-only and refused rather than ignored.** A filter that
quietly did nothing would tell a regular user that no comments are waiting, which
is a wrong answer to a question they were not allowed to ask. It narrows the
board, so it counts as filtering in both implementations of that rule.

**But the CONSEQUENCE of a withheld setting still reaches the person it affects.**
Comment moderation is admin-only, and somebody whose comment will wait is told
so before they write it and after they post it — as an answer about their own
action, from the endpoint that owns it (`awaitsApproval` on the thread,
`isPending` on the comment), never as the setting. This is the same rule as
`canVote`: the browser is told what will happen, not what the configuration says.

**The browser is now told WHO it is, and still never WHAT it is.** The bootstrap
payload carries the caller's id, name and email, because the settings screen
edits them and every write about somebody names the account in its path. There
is still no role in any payload, and no permission a client can derive for
itself. This is a deliberate narrowing of the rule as it was written in slice 2 —
the half that mattered was never "the browser knows nothing about itself", it was
"the browser cannot work out what it may do".

**Preferences are the person's own, and an admin is not an exception.** Same
shape as `editContent` on a request: an admin moderates, an admin does not
rewrite. There is no administrative reason to choose somebody else's colour
scheme, and the day there is a reason to act on another account it will be user
administration with its own audit trail.

**There is no `/me`.** Every route that acts on an account names it in the path.
An endpoint that acted on "whoever is calling" could not tell an attempt to
change somebody else's preferences from an ordinary save — it would answer 200
and write the wrong row's neighbour. Naming the target makes the answer 403, and
that refusal has a test.

**The registration policy is enforced in this application, not in the identity
provider.** Authenticating and being admitted are two different decisions.
`src/auth/provision.ts` is the second one, and it is the same call the real
provider will make when Keycloak lands: a person will be able to present a
perfectly valid token and still be refused an account here.

**`invite-only` is not one of the registration policy's values.** There is no
invitation to check against — no table, nothing that mints one — so the setting
would name a rule the application cannot apply and would in practice mean
"closed" while claiming to mean something else. It arrives with invitations or
not at all.

**The last admin cannot delete their own account.** A 409, not a 403: they are
allowed to, and the state of the world is what stands in the way. Nothing in this
application promotes anybody, so a board that reaches zero admins can never have
one again without an UPDATE by hand — the dead end every other rule here exists
to avoid.

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

**An edit stamps `edited_at`; pinning and status changes do not.** The obvious
implementation of an “edited” marker is `updated_at <> created_at`, and it is
wrong here: `updated_at` is `ON UPDATE CURRENT_TIMESTAMP(3)`, so pinning a
request or moving it to Done moves it too. A request would then be marked as
edited by its author because an admin triaged it — a claim about somebody's
words that nobody made. The comments table already keeps an explicit
`edited_at`; migration 009 mirrors it.

**`GET /api/capabilities` answers what the caller may do, never who they are.**
Every list item already carries its own answers — `canVote`, `canEdit`, `canPin`
— because there is a row to hang them on. A whole screen has no row, and the
navigation still has to decide whether to offer it. This is the same rule asked
once for the application rather than per item, and it is no more the guarantee
than the per-row flags are: the endpoints behind it refuse on their own, the
admin route renders that refusal, and this endpoint lying would cost a menu item
and nothing else.

## HTTP

**One request at startup: `GET /api/bootstrap`.** It replaces
`GET /api/capabilities`, which answered a third of the same question and has been
removed rather than left as a second way to ask it. What is in the payload is
decided by one test — would the first paint be drawn WRONG without it, and then
visibly change. The user, the capabilities, the settings that decide how the page
looks, and the two taxonomy lists every screen already needed. Notification
preferences, the administrative settings document and the `?scope=all` taxonomy
are not in it: they change nothing until somebody opens the screen that fetches
them.

**Which settings are in the startup payload is declared on each setting.** A list
in the bootstrap controller would be a second place to remember when a setting is
added.

**429 is its own error, and it carries the wait.** `retryAfterSeconds` in the
body and `Retry-After` in the header — the header because that is what the
standard says and what anything that is not this client will look for, the body
because a screen should not have to read headers to write a sentence. A 429 and
not a 403: the caller is permitted to do this and would succeed if they waited.

**The submission limit is enforced in the service, not as route middleware.**
Middleware counting HTTP calls would have to know which routes count as "a
submission" from the outside, and would refuse a request that was about to fail
validation anyway. The service is the one place that knows a request was actually
filed.

**A settings write sends only the keys it changes, and the whole set lands in one
transaction.** Not a document: two admins with the screen open would each send a
whole document and the second would silently undo the first. A set rather than
one key per request, because some of these settings constrain each other —
restricting registration to a list of domains and naming the domains is one
decision, and sending it as two requests could leave the board admitting nobody
in between.

**`null` in a settings patch means reset, and reset is not writing the default.**
It removes the stored row so the layer below answers again. No setting in the
registry is nullable, so nothing is ambiguous about it.

**A stored setting is validated on the way out as well as in.** The value column
is JSON and a row may have been written by an older build of the registry under
rules this one has since tightened. A value that no longer validates falls
through to the next layer rather than being served.

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

**`GET /api/statuses` exists because the filter bar needs the names.** The
board never told the browser what statuses there are — the chips only ever
rendered the one on each row — so filtering by status had nothing to offer as
options. It is read-only, unpaginated and archived-excluded, exactly like
categories. Managing statuses is still a later slice.

**"Mine" is a flag, not an author parameter.** There is no `?authorId=`, and
there will not be one: the browser is never told who it is, so it could not name
an author id even if it wanted to, and the server answers `mine=true` from the
identity seam. A caller naming an author is refused as an unknown parameter
rather than quietly honoured.

**`PATCH` for the edit, `PUT` for the status.** The edit is a PATCH because the
status, the pinning and the authorship are all part of the resource and none of
them is the author's to send — so the payload is never a complete
representation. The status is a sub-resource with a PUT, like pinning, so the
verb carries the intent and the admin-only rule sits on one route rather than
inside a handler that also does other things.

**Deleting answers `204`, and the cascades do the work.** The votes and comments
are both `ON DELETE CASCADE` on `request_id`, so one statement is the whole
operation and nothing can half-succeed. There is no body, because the resource
being described is gone.

**Editing requires all three fields rather than accepting any one.** The only
caller sends the whole form; per-field optionality would add combinations
nothing exercises, and a rule nobody asks is a rule nobody checks. The
validation is the create schema itself, so a value that was never valid to file
cannot become valid to save.

**A permission that needs the row loads the row first, and still checks before
validating the body.** “Only the author may edit” cannot be answered without
knowing who wrote it. So the handler loads the subject — the author id and
nothing else — asks the policy, and only then parses the body. A 404 for a
request that does not exist falls out of that same lookup, before any of it. The
admin-only rules keep the simpler shape: they depend on the caller alone, so
they refuse before anything is looked up at all.

**`?scope=all` is a second representation, not a second endpoint.** The default
listing is what a selector needs: active rows, name and slug. The managed one
carries the display order, the retirement state and the usage counts, and is
refused to anybody who cannot act on them. One collection with two
representations beats `/api/admin/categories`, which would be the same rows at a
different URL and one more place for the two to drift.

**A duplicate name is `422` with a field, not `409`.** Both are defensible. The
caller here is a form, and the answer belongs against the input that caused it,
in the same envelope every other field error already arrives in — a 409 would be
correct about the state of the world and useless to the screen. It is detected
by letting the unique key refuse the write and reading the constraint name off
the driver's error, not by SELECTing first: a check-then-insert leaves a window
where two admins both see "no such name" and both proceed.

**The slug is immutable, and that is an absence rather than a rule.** There is no
endpoint that changes one. `PATCH` takes a name and `.strict()` refuses a slug by
name, so an attempt is answered instead of silently dropped. The slug travels in
URLs as a filter; changing it breaks links people have already shared, which is
the entire reason the tables carry both a name and a slug.

**Reordering sends the whole order, in one transaction, and the position is the
index.** A per-row "move up" endpoint is two writes for one gesture, and two
requests that can half-succeed leave the list in an order nobody chose. The
whole list also makes the invariant checkable: an order that omits a row, names
one twice, or names something that is not there is refused, because each of
those is a client bug and none of them should be papered over with a guess.

**Bounded taxonomy collections are not paginated.** `GET /api/categories`
returns `data` with no `page` block: there are no pages to describe.

**List rows carry an `excerpt`, not the full description.** Twenty full
descriptions is up to 100KB the card never renders, and truncating in the
browser would mean sending it anyway. The excerpt is cut in SQL.

## Frontend

**The shell renders around the startup request; it is not a
`provideAppInitializer`.** An initializer that blocks bootstrapping has nowhere
to put a retry — the application does not exist yet, so a failure is a blank page
with a message in the console. The shell mounts, gates its own outlet on the
resource, and a failed startup is a screen with a button on it. Nothing renders
on hardcoded fallbacks, because nothing renders at all until the server has
answered.

**A saved preference decides where you LAND; the URL still says where you are.**
Arriving at the board fills in the parts of the address you did not ask for and
spells them out, so the view stays shareable, survives a refresh, and means the
same thing to somebody whose defaults are different. `replaceUrl`, so Back does
not walk through a redirect nobody asked for.

**The two questions are asked separately: did you ask for an ORDERING, and did
you ask to NARROW the board.** Whichever you did not ask for, your preference
answers. Sorting is not filtering — the same distinction the pinned shelf already
draws — so somebody who arrived on `?sort=oldest` still gets their default
filters.

**Reversed.** This first fired only on a completely bare address, which was
wrong in a way that looked exactly like the feature not working: the redirect
itself makes the address non-bare. Somebody whose default ordering was `oldest`
landed on `/requests?sort=oldest`, and from then on every arrival at that address
carried a `sort`, so the board was never "bare" again and a default STATUS chosen
afterwards could never take effect. The setting saved, the payload carried it,
and the board ignored it.

**It applies once per arrival, tracked on the component instance rather than in
the URL.** Angular rebuilds this component when you come to the board from
another screen and reuses it while you stay — paging, filtering, clearing — so
the instance is exactly the line between "I have just got here" and "I am working
on the board". That is what keeps a board somebody deliberately cleared from
being re-narrowed a moment later, which the URL alone cannot express: an address
with no filters is the same address whether it was cleared or arrived at.

**The colour scheme is applied to the document element, and `system` removes the
attribute rather than writing a third value.** The stylesheet's own
`prefers-color-scheme` query is then what decides: one mechanism, not two that
have to agree. `color-scheme` is set alongside it so scrollbars and form controls
the application does not style follow too.

**The language translates the interface, and only languages that are actually
translated are offered.** It was previously a preference that set the document
language and the date locale and nothing else — which, to anybody who tried it,
was a setting that did nothing. English and French are both complete; German was
removed rather than left in a list where choosing it would have changed nothing.

**A runtime message catalogue, not Angular's `$localize`.** Angular's own i18n is
a build-time mechanism: one compiled bundle per locale, chosen by the URL or the
server. It produces smaller bundles and it cannot do the thing this application
needs — change language because somebody picked one from a list, without a
reload, on a preference that arrives from the API after startup. The catalogue is
`web/src/app/core/i18n/messages.ts`, and the French half is typed against the
English keys so a missing one is a compile error rather than an English word in
the middle of a French sentence.

**What is not translated is what people wrote.** Requests, comments, display
names and the names an admin gave the categories and statuses are content in
whatever language their author used. Translating them would mean inventing words
nobody said.

**The settings screens' labels come from the API, not from the catalogue.** They
live in the registry, in both languages, next to the setting they describe —
which is the one exception to the client owning its own words, and it exists to
keep the registry's promise honest: adding a setting is ONE edit in ONE file, and
it would not be if every new setting also needed two lines in another repository
before anybody could read it. The server picks the language from the caller's own
preference, which it has already resolved in order to answer with it.

**The locale is passed to the date pipe rather than provided as `LOCALE_ID`,**
which is fixed when the injector is created — before the person's choice has
arrived — so changing it takes effect without a reload.

**Server messages are still English.** Validation and refusal messages are
written once each, next to the rule that raises them, and translating them means
a second catalogue on the server. It is a visible seam: a French screen can show
an English 422. Named here rather than left to be discovered.

**Which control edits a setting is sent by the server.** A screen that decided
per key would be a second list of the settings, in another language, in another
repository, and a setting added without that second edit would silently never
appear.

**The account deletion dialog says what survives before it asks.** Somebody who
expects deletion to erase their comments and finds them still there was misled by
an interface too brief to be honest.

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

**A filter change navigates, and always to page 1.** The URL is the state, so
changing a filter is a navigation and not a field being set. It returns to page
1 because page 4 of one filtered board is rarely page 4 of another, and staying
put would land the reader past the end — where an empty page reads as "nothing
matched".

**Defaults are left out of the URL.** `/requests` and
`/requests?page=1&sort=votes` are the same board, and only one of them is a link
worth sharing. One function builds the query parameters for the pager links, the
filter navigation and the list request alike, so a pager link cannot quietly
drop the filters the list is showing.

**"Nothing has been filed" and "nothing matches these filters" are different
screens.** Both are an empty list; only one of them should offer "be the first
to file one", and offering it while eleven requests sit one click away behind a
filter is wrong. The filtered one offers Clear all filters instead.

**~~The search box submits; it does not filter as you type.~~ Reversed: it
searches as you type.** The original reasoning was that navigating per keystroke
puts a history entry behind every letter and sends a request for every prefix.
Both costs are real; neither needs submit-to-search to avoid.

It waits 300ms for typing to stop, so a word is one request rather than one per
letter, and Enter or the button still searches immediately. The list passes
`replaceUrl` when the search term is the only thing that changed, so those
navigations replace each other and Back leaves the board instead of walking
backwards through `d`, `da`, `dar`. A one-character term is held rather than
sent, because the server refuses it with a 422 and the user is still typing.

Three consequences worth naming:

- **The box holds a draft in a `linkedSignal` seeded from the URL,** so Back, a
  shared link and Clear all leave it showing what is actually being searched
  for. The re-seed is now guarded against the box's own search coming back: the
  navigation it triggers changes the source, and re-seeding on that would
  overwrite whatever was typed in the meantime.
- **Changing another filter flushes a search still waiting out its debounce,**
  rather than dropping it. Ticking a box a moment after typing should not
  silently discard the term.
- **A refetch that already has rows keeps them on screen, dimmed,** instead of
  replacing them with skeletons. Skeletons are for a first load. Emptying and
  refilling the list on every pause in typing makes a working board look like it
  is thrashing.

**Every derived signal over a resource is guarded by `hasValue()`.** Reading
`value()` while a resource is in its error state throws. That was survivable
while those signals were only read inside a branch the error state skipped; the
filter bar renders above the list and reports the total whatever the list is
doing, which turned a latent trap into a crash. A derived signal that throws
depending on where it is read from is not worth keeping.

**The confirmation dialog is written out rather than using `<dialog>`.** The
native element traps focus and closes on Escape for free, which is the entire
requirement — and a test could then only assert that `showModal()` was called,
which proves the call site exists and nothing about whether focus can escape.
The trap is the feature, so it is code with tests on it: Tab and Shift+Tab both
wrap, Escape closes, focus starts on Cancel rather than the destructive button,
and it returns to whatever opened the dialog.

**A refetch does not tear the page down.** The detail page shows its loading
state only when it has nothing to show; a plain `isLoading()` there unmounted
the whole article on every reload, taking the comment thread with it and making
it refetch a discussion that had nothing to do with the pin that caused it.

**Resources depend on the narrowest signal that decides them.** The status list
is fetched when `canChangeStatus` is true; deriving that as its own boolean
rather than reading it off the request object stops every successful action from
refetching a taxonomy that cannot have changed.

**Reordering is buttons, not drag and drop.** Not as a fallback — as the
interface. A drag-only implementation is unusable from a keyboard, unusable by
anybody who cannot hold a pointer steady, and awkward on a phone. Two buttons
per row are none of those things, they carry the row's name in their labels so a
screen reader says which row is moving, and they are also the version that can
be tested by pressing them.

**The admin route exists for everybody and refuses for most.** Hiding it from
the navigation is a courtesy; the screen renders the server's own 403 when
somebody types the URL. The alternative — a route guard that redirects — would
put a copy of the rule in the browser and make the interface the thing that
decides, which is the opposite of how every other permission on this board
works.

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

**There is no route guard, and adding one would be a second copy of a rule that
already holds.** Nothing below the shell renders until the session resolves,
because the `<router-outlet>` does not exist until then. That is stronger than a
guard per route — it covers a route added later, because that route cannot be
mounted rather than because somebody remembered to list it — and it is one
mechanism rather than two that can disagree. The sign-in callback is the single
exception, and it renders without a session because it is the thing that
produces one.

**The access token lives in memory; the refresh token lives in
`sessionStorage`.** In memory alone, every reload signs the person out, and
people work around applications that appear broken. `localStorage` would put a
longer-lived credential in a wider place — shared across every tab of the origin
and surviving the browser closing. `sessionStorage` is scoped to one tab and
dies with it, and a new tab redirects and returns without anybody typing
anything, because the provider's own session is still open.

The honest limit is that anything which can run script on this origin can read
it. Closing that means a back-end-for-frontend holding tokens in an httpOnly
cookie — a piece of infrastructure this application does not have, and one that
would change what "the browser talks to the API" means. It is written down here
rather than left as an assumption.

**Renewal happens before expiry, not after a failure.** Reacting to a 401 works
and is still the fallback in the interceptor, but on its own it means one request
per session lifetime fails first — and when that request is a POST somebody
typed, retrying it is a decision rather than a detail.

**Signing out ends the session at Keycloak, not only here.** Clearing local state
alone leaves the provider's SSO session open, so the next sign-in returns
immediately without asking for anything: a sign-out that undoes itself, on the
shared machine where it mattered most.

**A realm's identity and a realm's address are two different values, and
containers are where that stops being pedantry.** `OIDC_ISSUER_URL` is the exact
string every token carries as `iss` and the only thing that claim is compared
against. `OIDC_INTERNAL_URL` is optional and says where to fetch the key set.

They are the same value when the API runs from a terminal and differ the moment
anything is containerised: the browser reaches Keycloak at `localhost:8080` and
mints tokens saying so, while the API reaches the same server at `keycloak:8080`.
Deriving the key set URL from the issuer would have the API resolving `localhost`
inside its own container.

The authentication slice deliberately refused a second variable, reasoning that
two values can disagree. That was right about drift and wrong in principle. The
property it was protecting survives anyway: `iss` is compared to the issuer and
only to the issuer, so pointing the internal URL at the wrong realm makes every
token fail rather than making a wrong one pass.

**The API is not reachable from outside the deployment, in any environment.**
The browser talks to one origin: the CLI proxy forwards `/api` in development,
and the web tier's nginx does in compose and in Kubernetes. The API has no
published port and no Ingress.

One request path everywhere, rather than an ingress rule and an nginx `location`
that can drift apart — and CORS never enters into this application at all.
`WEB_ORIGIN` is a fallback for `ng serve` without the proxy and nothing else.

**Migrations are a job, and the API waits for the schema VERSION rather than for
the job.** An API that migrates on boot cannot run two replicas without two
processes racing to alter the same tables — `schema_migrations` is bookkeeping,
not a lock, and both can read version 12 and both try to apply 13. It also
buries a schema failure inside a deploy, where it reads as "the application will
not start" rather than "migration 13 failed".

A Job is not an ordering primitive either — nothing makes a Deployment wait for
one — so the API's init container blocks until the database is at the version
the image was built against.

**The version, not the table.** The first draft waited for `schema_migrations`
to exist, which is correct exactly once: on a first install. On every later
deploy the table is already there, so the API would start against the old schema
and serve queries for columns that do not exist yet — a silent, data-shaped
failure, which is the worst class to ship. The expected version is derived from
the highest migration file *in the image*, so there is no number to keep in step
with the migrations directory, and a pod stuck in `Init` is a loud and
diagnosable failure instead.

Seeding is in neither: it is baseline content and a decision, not a consequence
of starting the system.

**Kubernetes Secrets are referenced by name and their values are never
committed — while the development realm's passwords are.** That is a boundary
rather than an inconsistency, and it is worth stating because it does not read
as one at a glance.

The realm file is **local-review tooling**. It is named `-development`, it
documents itself as such in `keycloak/README.md`, and its three passwords exist
so that `docker compose up` is followed by a working sign-in rather than a
question. Nothing deploys it.

The Kubernetes Secret is **part of the deployment story being assessed**, and a
manifest is read as a statement of approach. A reviewer opening one and finding
real-looking values in `stringData` registers that before they read any comment
explaining why it was fine — and "secrets are referenced by name, never
committed" is the single clearest signal that file can send. The convenience of
one `kubectl apply` does not outweigh what the committed file says about how
credentials are handled.

So: `k8s/11-secret.example.yaml` shows the shape and is never applied,
`scripts/deploy-k8s.sh` creates the real Secret and then applies, and the
Deployments are byte-identical whether the values come from that script, from
External Secrets, from a SealedSecret or from SOPS. What changes between local
and a real cluster is values, not structure.

**`runAsNonRoot` in the pod is not a duplicate of `USER node` in the
Dockerfile.** The Dockerfile is a statement of intent by whoever wrote it; the
pod's security context is the cluster refusing to start the container if that
intent was not carried out. Both applications also run with a read-only root
filesystem and every capability dropped — the API writes nothing at all, and
nginx's three writable paths are memory-backed `emptyDir`s.

**The kustomization is at the repository root, not in `k8s/`.** kustomize will
not read files above its own directory, and the realm ConfigMap is generated
from `keycloak/realm-feedbackhub-development.json` so that the cluster's realm
and the compose realm cannot drift apart. The alternatives were a second copy of
the realm — the exact failure this repository refuses everywhere else — or a
documented flag that turns the restriction off, which people forget.

**The endpoints come from the provider's discovery document, not from string
concatenation.** The paths beneath a realm are Keycloak's, and assembling them
in the browser would put knowledge of one provider's URL shape into the client.
The API derives only the JWKS URL that way, and deliberately takes no second
variable for it: a `OIDC_JWKS_URL` that could disagree with `OIDC_ISSUER_URL`
would be a verifier checking one realm's keys while insisting on another realm's
`iss`.

## Scope

**The test suite mints its own tokens, and replaces exactly one thing.** The
420-odd tests had to keep running without a live Keycloak: a suite that stands
up a container and performs real logins is slow, dependent on a network, and
able to fail for reasons unrelated to the code under test, which destroys the
thing a suite is for. So the tests own an RSA key and sign their own tokens, and
the ONLY thing stubbed is the network fetch of the public keys. The signature,
the issuer, the audience, the expiry and the `kid` selection all run through the
real implementation. The alternative — retaining the seam as a test-only
identity mode — would have been simpler and would have left verification, the
part most worth covering, untested.

**The code that signs those tokens is not compiled.** `tsconfig.build.json`
excludes `*.test-support.ts` alongside the test files, so it is absent from
`dist/` rather than present and guarded. There is no environment variable that
switches it on and no identity mode it corresponds to. Absent beats guarded: a
guard is a runtime claim about a code path that exists.

**Google is added by a script rather than shipped in the realm file.** A
reviewer cannot obtain Google OAuth credentials, and a realm import is a static
document that cannot omit a provider when they are missing. An identity provider
configured with an empty client id is not degradation — it is a Google button
that leads to an error. So the realm ships without one, the sign-in page shows
email and password, and one documented command adds it when there is something
real to configure. No step of it is a walk through the admin console.

**The realm has no volume, so it is re-imported whenever the container is
created.** The file in the repository stays the only description of what the
realm is, and a reviewer cannot end up looking at one that drifted from it. The
cost is that anything added at runtime — including the Google provider — is
discarded by `docker compose down`, and the script is re-runnable for exactly
that reason. A `stop`/`start` keeps the container's own filesystem, so a restart
costs nothing and existing tokens stay valid.

**The demo people have no realm identities.** They are authors of content, so
the board has something to read; they are not people who sign in. The three
seeded users cover what a reviewer needs to exercise: account deletion signed in
as an ordinary user, and the last-admin refusal signed in as the admin. Nothing
in this application promotes anybody — a second admin exists only because
`npm run demo` seeds one — so there is no path that requires more sign-in
identities than these three.

**Comment moderation before publication was built in the settings slice, not
the moderation slice it was parked for.** It was the strongest available
demonstration of a feature flag — it changes what the application DOES rather
than what it shows — and the alternatives all amounted to hiding a control. The
parked note had been written on the assumption it would arrive on its own; it
arrived attached to the setting that switches it on, which is where the shape it
predicted (a nullable `approved_at` plus a settings table) turned out to belong.

**The Node base image matches the pin, exactly.** `.node-version` and
`engines.node` both name 24.19.0, `docker-compose.yml` pins `mysql:8.4.6` and
`quay.io/keycloak/keycloak:26.4.2`, and the API image is built `FROM
node:24.19.0-bookworm-slim` — never `node:24`, never `node:lts`, never `latest`.
Nothing in this repository resolves a version at build time. A floating tag is
how a container stops matching the machine the tests were written on, months
later, in a failure that looks like the code.

This was a commitment made before there was an image to make it about, and the
deployment slice is where it became true.

**What lives in a parked-decisions file, and why that file no longer exists.**
Decisions taken before their subject matter exists used to sit in
`notes/decisions-pending.md`, on the reasoning that a decisions file describing
code nobody has written reads as though it were assembled afterwards. In
practice it became somewhere for settled questions to be quietly re-opened, and
for scope to be proposed as though parked meant planned. Its entries are now
here and in [SCOPE.md](SCOPE.md), which draws the line the other way: a decision
about something ruled out belongs with the ruling, not in a queue.

**Email notification preferences are recorded and nothing sends mail.** Normally
this schema's rule is that a column nothing reads should not exist yet. It
survives here because these are not columns: nothing exists until somebody sets
one, an unset preference is answered from the registry, and removing them later
is deleting an entry from one file. Recording an intention that costs nothing to
hold is different from carving out a column to hold it in.

**Avatars are not built.** The brief offers "avatar or initials"; there is no
file storage in this application and adding one for a profile picture is a slice
of its own. Initials are derived from the display name, which is what the board
already shows.

**Slice 7 is the admin configuration slice those two reads were waiting for.**
The management endpoints now exist for both taxonomies, and the earlier notes
below stand as the record of why the reads arrived first.

**`GET /api/statuses` was added in slice 5 for the same reason `GET
/api/categories` was added in slice 1** — the agreed screen cannot be built
without reading admin-managed data. Filtering by status requires offering the
statuses by name, and a hardcoded list in the browser would drift the moment an
admin renamed one. Managing statuses remains a later slice; this is only the
read the agreed screen requires.

**`GET /api/categories` was added beyond the agreed slice 1 scope.** The agreed
scope includes a create-request form with a category, and categories are
admin-managed data rather than an application enum — so the form cannot be built
without reading them. Managing categories remains a later slice; this is only
the read that the agreed screen requires.
