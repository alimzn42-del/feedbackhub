# FeedbackHub

An internal product feedback board. Employees file feature requests and product
feedback, everyone browses and upvotes, and admins triage. The point is to stop
the same suggestion arriving five times by email, and to make visible what is
actually being worked on.

**Status: slice 7.** A feedback request can be created, listed, voted on,
pinned, discussed, filtered, searched, sorted, edited, deleted and moved
between statuses — and the categories and statuses themselves are now managed
from an admin screen. Comment moderation, application settings and
authentication are not built yet — see
[Scope](#what-is-and-is-not-built) below.

## Requirements

| | |
|---|---|
| Node.js | **24.19.0** — pinned in [`.node-version`](.node-version) |
| Docker | for the MySQL 8.4 container |

The repository pins its Node version rather than relying on whatever is
installed. With [fnm](https://github.com/Schniz/fnm) or
[nvm](https://github.com/nvm-sh/nvm) the pin is picked up automatically:

```bash
fnm use          # or: nvm use
```

## Running it

```bash
cp .env.example .env     # every setting the app reads, with working defaults
npm install

npm run db:up            # start MySQL 8.4 (docker compose)
npm run migrate          # create the schema
npm run seed             # one admin, two users, categories and statuses
                         # (no settings rows: the defaults live in code)

npm run demo             # optional: a populated board to click around
npm run dev:api          # http://localhost:3000
npm run dev:web          # http://localhost:4200   (in a second terminal)
```

Open <http://localhost:4200>. The web dev server proxies `/api` to the API, so
the browser talks to both same-origin.

### Tests

```bash
npm test                 # API and web
npm test --workspace api # API only  (route-level authorization, policy rules, config guards)
npm test --workspace web # web only  (component states, form validation)
```

### Other commands

```bash
npm run demo             # a populated board: 14 requests, 7 people, votes, threads
npm run migrate -- 2     # migrate to a specific schema version, either direction
npm run migrate:down     # undo the most recent migration
npm run db:reset         # destroy the database volume and start clean
npm run db:down          # stop MySQL, keep the data
```

## Acting as a different user

Authentication is deliberately deferred; authorization is not. Every endpoint
enforces permissions from this slice onward, against an identity supplied by a
single replaceable function — [`api/src/auth/current-user.ts`](api/src/auth/current-user.ts).

To act as somebody else, change `DEV_CURRENT_USER_EMAIL` in `.env` and restart
the API — worth doing, since admins and regular users now see different
controls. Pointing it at an address **nobody has used** exercises the
registration policy instead: an open board provisions the account on the spot,
a restricted one refuses by name. The seeded users are:

| Email | Name | Role |
|---|---|---|
| `admin@feedbackhub.local` | Robin Alvarez | admin |
| `dana@feedbackhub.local` | Dana Okafor | user |
| `sam@feedbackhub.local` | Sam Lindqvist | user |

`npm run demo` adds four more, including a second admin, so the rules that
depend on *who* you are can actually be exercised:

| Email | Name | Role |
|---|---|---|
| `priya@feedbackhub.local` | Priya Raman | admin |
| `marcus@feedbackhub.local` | Marcus Bell | user |
| `lena@feedbackhub.local` | Lena Fischer | user |
| `omar@feedbackhub.local` | Omar Haddad | user |

This is a development backdoor and is treated as one: the API **refuses to
start** if it is still compiled in when `NODE_ENV=production`. See
[`api/src/config/env.schema.ts`](api/src/config/env.schema.ts).

## Layout

```
api/                     Node + TypeScript + Express
  src/config/            the only module that reads process.env
  src/db/migrations/     plain .sql, run by postgrator
  src/db/seeds/          idempotent baseline data
  src/auth/              the identity seam, and the provisioning check behind it
  src/policy/            every permission rule, and nowhere else
  src/http/              error taxonomy, error middleware, validation mapping
  src/modules/*/         routes → controller → service → repository
                         (SQL appears only in *.repository.ts)
  src/modules/settings/  the setting registry: one entry per setting, holding
                         its validator, default, scope, visibility and control
web/                     Angular, standalone components, typed reactive forms
  src/app/core/api/      API types and error mapping
  src/app/core/config/   the startup payload, and everything drawn from it
  src/app/features/      one directory per screen
notes/ai-log.md          raw working log of the AI collaboration
DECISIONS.md             what was decided and why
docker-compose.yml       MySQL only; the rest joins in the deployment slice
```

## API

Every response carries a `data` key. Collections add a `page` block. Errors use
a single envelope; see [DECISIONS.md](DECISIONS.md#error-shape).

| | |
|---|---|
| `GET /health` | liveness, no identity required |
| `GET /api/requests` | paginated, unpinned only; filtered, searched and sorted — see below |
| `GET /api/requests/pinned?sort=` | the pinned shelf; not paginated, capped at 100; the default board only |
| `POST /api/requests` | `{ title, description, categoryId }` |
| `POST /api/requests/:id/vote` | vote as the current user; `409` if already voted |
| `DELETE /api/requests/:id/vote` | withdraw your vote; safe to repeat |
| `PUT /api/requests/:id/pin` | **admin only**; records who pinned it and when |
| `DELETE /api/requests/:id/pin` | **admin only** |
| `GET /api/requests/:id` | one request in full, including its description |
| `PATCH /api/requests/:id` | **author only**; title, description and category |
| `DELETE /api/requests/:id` | **author or admin**; takes its votes and comments with it |
| `PUT /api/requests/:id/status` | **admin only**; `{ statusId }` |
| `GET /api/requests/:id/comments` | the thread, two levels, not paginated |
| `POST /api/requests/:id/comments` | `{ body, parentId? }` — a reply cannot be replied to |
| `PATCH /api/comments/:id` | **author only**; an admin cannot reword somebody |
| `DELETE /api/comments/:id` | author or admin; removes or hides, see below |
| `PUT /api/comments/:id/approval` | **admin only**; lets a waiting comment through |
| `GET /api/categories` | the active categories |
| `GET /api/statuses` | the active statuses |
| `GET /api/bootstrap` | everything the application needs to draw itself — see below |
| `GET /api/settings` | **admin only**; the application settings |
| `PATCH /api/settings` | **admin only**; a partial patch, `null` resets a key |
| `GET /api/users/:id/settings` | **yourself only**; the full preference document |
| `PATCH /api/users/:id/settings` | **yourself only**; a partial patch |
| `PATCH /api/users/:id` | **yourself only**; `{ displayName }` |
| `DELETE /api/users/:id` | **yourself only**; anonymises — see below |

### Startup, and where configuration lives

The application makes **one** request before it draws anything:

```
GET /api/bootstrap
{ data: {
    user:         { id, email, displayName },        // never a role
    capabilities: { canManageCategories, canManageStatuses, canManageSettings },
    settings:     { "profile.theme": { value, source, editable }, ... },
    taxonomy:     { categories: [...], statuses: [...] }
} }
```

Each piece is there because the first paint would be drawn **wrong** without it
and would then visibly change: the colour scheme, the language, the ordering and
filters the board opens on, and the two taxonomy lists the filter bar and both
forms need. Notification preferences, the administrative settings document and
the `?scope=all` taxonomy are deliberately absent — nothing paints from them, so
the screens that need them fetch them when they open.

If it fails, the application says so and offers a retry. It does not draw a board
on guessed defaults: the outlet is not mounted until the server has answered.

**Settings resolve on the server, across three layers**, nearest wins:

| source | means |
|---|---|
| `user` | a row in `user_settings` — you chose this |
| `global` | a row in `app_settings` — an admin chose it for everybody |
| `default` | the registry's fallback — nobody has ever chosen |

The client is told which layer it got, because "using the default" and an
explicit choice that happens to match are different states and only one of them
has anything to reset. The merge exists in exactly one place; a client that
merged too would be a second implementation of the same rules.

**A setting is defined in one file** — `api/src/modules/settings/settings.registry.ts`
— which holds its validator, its default, the levels it may live at, who may see
it, whether it is needed at first paint, and which control edits it. **Adding a
setting is an entry in that file and nothing else: no migration, no schema
change, and no second edit in the web app.**

Administrative settings (registration policy, comment approval, the submission
limit) are **withheld** from a non-admin rather than sent and made read-only.
Their consequences are not withheld: somebody whose comment will wait is told so
by the endpoint that owns the action, never by being handed the setting.

### Language

English and French. The interface is translated at runtime from
`web/src/app/core/i18n/messages.ts`, so changing the setting on `/account`
re-renders the page in the other language without a reload — which is why this is
a catalogue rather than Angular's build-time `$localize`.

Only languages that are actually translated are offered: a third in the list that
fell back to English would be a setting that appears to do nothing.

Not translated: what people wrote (requests, comments, display names, and the
names an admin gave the categories and statuses), and the API's own validation
and refusal messages — so a French screen can still show an English 422.

Setting labels are the exception to the client owning its words: they come from
the API's registry, in both languages, so adding a setting stays one edit in one
file.

### The feature flag

`comments.requireApproval`. When it is on, a new comment is visible to its author
and to admins and to nobody else until an admin approves it, from the thread it
was written in. It changes what the application *does* rather than what it
shows, and the change is visible without a reload.

Turning it **on** affects comments written from then on and nothing already on
screen; turning it **off** releases whatever is waiting. Comment counts follow
the same visibility rule as the thread — they are the same SQL fragment, so a
badge cannot promise three comments above a thread showing one.

**Finding what is waiting.** A count in the header, admin only, linking to
`/requests?pending=true` — the requests that carry a waiting comment. It comes
from the startup payload and is refetched after a decision, so it falls without a
reload. It is absent entirely when approval is off or the reader cannot approve:
a badge showing 0 would be a different claim from a header with nothing in it.

**Deciding.** In the thread, beside the words — approve, or reject. There is no
queue screen, because a comment out of its discussion cannot be judged. Rejecting
is the ordinary delete: it records which admin did it, and the author is told an
admin removed it.

### The submission limit

`submissions.perUserPerDay`, counted over a rolling 24 hours rather than a
calendar day. Over it, `POST /api/requests` answers `429` with
`retryAfterSeconds` in the body and `Retry-After` in the header — how long until
they may post again, not a generic refusal. The limit is a setting, so changing
it is not a deploy.

### Deleting an account

Anonymisation. The person's name, email and `external_id` are cleared, the
account is marked deleted and can never sign in again, and their preferences are
removed. **Their contributions stay** — requests and comments render as written
by a deleted user, and votes they cast stay counted. The interface says all of
this before it asks, and again in the confirmation.

The last remaining admin is refused, with a `409`: nothing in this application
promotes anybody, so a board that reaches zero admins could never have one again.

### Who may create an account

`registration.policy` is `open` or `domains`, checked in
`api/src/auth/provision.ts` when somebody arrives with no local row. That check
lives in this application and not in the identity provider: when Keycloak lands,
a person will be able to authenticate perfectly and still be refused an account
here. Point `DEV_CURRENT_USER_EMAIL` at an address nobody has used to see it —
an open board admits you, a restricted one refuses by name.

`invite-only` is deliberately not offered. There are no invitations to check
against, so it would mean "closed" while claiming to mean something else.


### Managing the taxonomy

Admin only, refused at the route. `?scope=all` is a second representation of the
same collection: the display order, the retirement state and how many requests
use each row.

| | |
|---|---|
| `GET /api/categories?scope=all` | every category, with usage counts |
| `POST /api/categories` | `{ name, slug }` — the slug is set once and never again |
| `PATCH /api/categories/:id` | `{ name }`. Sending a slug is refused by name |
| `PUT /api/categories/order` | `{ ids }` — the whole order, in one transaction |
| `PUT /api/categories/:id/archive` | retire: stops being offered, keeps existing requests |
| `DELETE /api/categories/:id/archive` | restore |
| `GET /api/statuses?scope=all` | every status, with usage counts and which is the default |
| `POST /api/statuses` | `{ name, slug }` |
| `PATCH /api/statuses/:id` | `{ name }` |
| `PUT /api/statuses/order` | `{ ids }` |
| `PUT /api/statuses/:id/default` | move the default. There is no endpoint that clears one |

**Retiring is not deleting.** A retired category disappears from the create
form, the edit form and the filter bar; requests already carrying it keep
rendering it, and the filter link by its slug still works. It can be restored.

**Statuses are never retired.** A category is a label a request keeps; a status
is a position requests are sitting in, and retiring one would strand them. There
is no archive route for statuses, and there will not be one.

### Filtering, searching and sorting the board

Every one of these is a query parameter on `GET /api/requests`, because list
state lives in the URL: a filtered board is a link, and it survives a refresh.

| | |
|---|---|
| `page`, `pageSize` | 1-based; `pageSize` defaults to 20 and is capped at 100 |
| `status=planned,done` | status **slugs**, not ids, so a link survives a rename |
| `category=bug,feature` | category slugs, same treatment |
| `mine=true` | only the caller's own requests, answered from the identity seam |
| `q=dark mode` | matches title and description; 2–100 characters. The box searches as you type, 300ms after typing stops |
| `sort=newest\|oldest\|votes` | defaults to `newest`. Also applies to the shelf — see below |

Several values for one filter can be sent either way: `?status=planned,done` and
`?status=planned&status=done` mean the same thing. Values are combined with AND
across filters and OR within one, so `?status=planned&category=bug` is planned
bugs.

A slug that names nothing is **refused** with `422`, naming the value — not
silently ignored, which would return the unfiltered board and look like it
worked. Unknown parameters are refused for the same reason: a typo in a filter
name is not a filter.

**Sorting applies to the shelf; filtering removes it.** With no `sort`, the
shelf is ordered by when things were pinned, most recent first, so a fresh pin
is in the three the panel shows before it is expanded. Ask for an ordering and
the shelf follows it, as its own group above the board. Sorting never hides the
shelf, because reordering hides nothing.

**Where pinned requests are depends on whether the board is filtered.** With no
filter applied they are a separate collection — `GET /api/requests/pinned`, the
shelf above the board — and `GET /api/requests` excludes them from both the rows
and the total. As soon as any filter or search is applied the shelf is gone, and
the pinned requests that match are in the results, ranked first and badged, and
counted in the total. Sorting alone is not filtering and keeps the shelf.

## What is and is not built

**Built:** eight tables and their seed data; two admin screens — the taxonomies,
and the application settings; a personal account screen
with preferences and account deletion; one startup request that configures the
whole application; request creation, editing, deletion and status changes;
listing with server-side pagination, filtering, search and sort switching;
voting, with counts derived rather than stored; admin pinning, recorded with
actor and time; comment threads one reply deep, with optional approval before
publication; a submission rate limit and a registration policy, both settings
rather than constants; the identity seam and the provisioning check behind it;
the policy module; one error shape with one middleware producing it; and six
screens with real loading, empty and error states, in English or French.

**Deleting a comment** does one of two things, and which one is a judgement the
server makes rather than the browser:

| Actor | Has replies | The comment | Its replies |
|---|---|---|---|
| Author | no | removed outright | — |
| Author | yes | hidden, tombstoned | hidden with it |
| Admin | no | hidden, "an admin removed this" | — |
| Admin | yes | hidden | hidden with it |

Hard deleting a comment with replies would cascade and destroy words written by
other people, so it does not happen. A reply can never have replies, so an
author removing their own reply is always the first row.

**Every rule in the policy module now has an endpoint asking it.** The three
that had none — `editContent`, `delete` and `changeStatus` — are reached by the
routes above, and the two route-level authorization tests outstanding since
slice 1 are written: a non-owner refused an edit, and a regular user refused a
status change.

**Not built, by design:** user administration — nothing creates, promotes,
demotes or deactivates anybody else, which is why the last admin cannot leave;
invitations, which is why `invite-only` is not a registration policy this
application offers; avatar uploads, there being no file storage; sending email,
so the notification preferences are recorded and consumed by nothing;
translation of the interface copy, the language setting covering the document
language and date formatting only; Keycloak; and deployment beyond the database
container.
