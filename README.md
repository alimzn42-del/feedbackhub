# FeedbackHub

An internal product feedback board. Employees file feature requests and product
feedback, everyone browses and upvotes, and admins triage. The point is to stop
the same suggestion arriving five times by email, and to make visible what is
actually being worked on.

**Status: slice 4.** A feedback request can be created, listed, voted on,
pinned by an admin, and discussed. The board is ordered by vote count with
pinned requests on their own shelf; each request has a page carrying its full
text and a comment thread one reply deep. Search, filters, status changes,
comment moderation and authentication are not built yet — see
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
| `GET /api/requests?page=&pageSize=` | paginated, unpinned only; most votes first, then newest |
| `GET /api/requests/pinned` | the pinned shelf; not paginated, capped at 100 |
| `POST /api/requests` | `{ title, description, categoryId }` |
| `POST /api/requests/:id/vote` | vote as the current user; `409` if already voted |
| `DELETE /api/requests/:id/vote` | withdraw your vote; safe to repeat |
| `PUT /api/requests/:id/pin` | **admin only**; records who pinned it and when |
| `DELETE /api/requests/:id/pin` | **admin only** |
| `GET /api/requests/:id` | one request in full, including its description |
| `GET /api/requests/:id/comments` | the thread, two levels, not paginated |
| `POST /api/requests/:id/comments` | `{ body, parentId? }` — a reply cannot be replied to |
| `PATCH /api/comments/:id` | **author only**; an admin cannot reword somebody |
| `DELETE /api/comments/:id` | author or admin; removes or hides, see below |
| `GET /api/categories` | the active categories, for the create form |

## What is and is not built

**Built:** six tables and their seed data; request creation and listing with
server-side pagination; voting, with the board ordered by vote count and counts
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

**Not built, by design:** search, filters, sort switching, status changes,
comment moderation before publication, admin screens, settings, Keycloak, and
deployment beyond the database container. Sorting by newest arrives with the
filters slice.
