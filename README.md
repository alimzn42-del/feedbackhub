# FeedbackHub

An internal product feedback board. Employees file feature requests and product
feedback, everyone browses and upvotes, and admins triage. The point is to stop
the same suggestion arriving five times by email, and to make visible what is
actually being worked on.

**Status: slice 1.** A feedback request can be created and listed. Voting,
comments, search, filters, pinning, admin screens and authentication are not
built yet — see [Scope](#what-is-and-is-not-built) below.

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
the API. The seeded users are:

| Email | Name | Role |
|---|---|---|
| `admin@feedbackhub.local` | Robin Alvarez | admin |
| `dana@feedbackhub.local` | Dana Okafor | user |
| `sam@feedbackhub.local` | Sam Lindqvist | user |

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
| `GET /api/requests?page=&pageSize=` | paginated, sorted pinned-first then newest-first |
| `POST /api/requests` | `{ title, description, categoryId }` |
| `GET /api/categories` | the active categories, for the create form |

## What is and is not built

**Built:** the four base tables and their seed data, request creation and
listing with server-side pagination, the identity seam, the policy module with
the full set of request rules, one error shape with one middleware producing it,
and the two screens with real loading, empty and error states.

**Not built, by design:** votes, comments, search, filters, pinning, admin
screens, settings, Keycloak, and deployment beyond the database container. The
schema carries `is_pinned` because it belongs to the entity; no endpoint sets it.
