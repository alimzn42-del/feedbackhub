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
controls. The seeded users are:

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
  src/auth/              the identity seam — one replaceable function
  src/policy/            every permission rule, and nowhere else
  src/http/              error taxonomy, error middleware, validation mapping
  src/modules/*/         routes → controller → service → repository
                         (SQL appears only in *.repository.ts)
web/                     Angular, standalone components, typed reactive forms
  src/app/core/api/      API types and error mapping
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
| `GET /api/capabilities` | what the caller may do that is not attached to a row |
| `GET /api/categories` | the active categories, for the create form and the filter bar |
| `GET /api/statuses` | the active statuses, for the filter bar |

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

**Built:** six tables and their seed data; an admin screen managing the two
taxonomies; request creation, editing, deletion and status changes; listing with server-side pagination, filtering, search and
sort switching; voting, with the board ordered by vote count and counts
derived rather than stored; admin pinning, recorded with actor and time, shown
on a shelf above the board and excluded from the list; comment threads one reply
deep; the identity seam; the policy module; one error shape with one middleware
producing it; and three screens with real loading, empty and error states.

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

**Not built, by design:** comment moderation before publication,
application-wide settings (registration policy, rate limits, feature flags),
user administration, Keycloak, and deployment beyond the database container.
