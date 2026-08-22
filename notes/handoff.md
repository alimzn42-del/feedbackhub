# Handoff

Where FeedbackHub stands as of 2026-08-21, what is deliberately missing, and
what the next person should know before touching it.

Read [README.md](../README.md) for how to run it and [DECISIONS.md](../DECISIONS.md)
for why it looks the way it does. This file is neither of those: it is the
state of play.

---

## What is built

Four slices, 33 commits, schema version 8.

| | |
|---|---|
| **Requests** | filed, listed with server-side pagination, one page each |
| **Voting** | one per person per request, withdrawable, board ordered by count |
| **Pinning** | admin only, recorded with actor and time, own shelf above the board |
| **Comments** | threads one reply deep, edit, and four-way delete |

**Tests: 122** — 66 API (vitest + supertest), 56 web (Angular + vitest, jsdom).

Six tables: `users`, `categories`, `statuses`, `feedback_requests`, `votes`,
`comments`.

Three screens: the board (`/requests`), the create form (`/requests/new`), and
a request page with its discussion (`/requests/:id`).

## What is deliberately not built

- **Authentication.** The identity seam is one function,
  `api/src/auth/current-user.ts`, and the API refuses to boot in production
  while it is compiled in. Keycloak replaces that function body and nothing else.
- **Editing, deleting or restatusing a request.** See the gap below.
- **Filters, search, sort switching.** Sorting by newest is the filters slice.
- **Comment moderation before publication.** Argued out and parked in
  `notes/decisions-pending.md`; no column, no setting.
- **Admin screens, user administration, application settings.**
- **Deployment beyond the database container.**

## The gap worth knowing about first

Three rules in `api/src/policy/requests.policy.ts` have **no endpoint calling
them**:

```
requestPolicy.editContent  -> 0 callers
requestPolicy.delete       -> 0 callers
requestPolicy.changeStatus -> 0 callers
```

They are written, unit-tested and correct. Nothing asks them, because
`PATCH /api/requests/:id`, `DELETE /api/requests/:id` and a status endpoint do
not exist yet. A rule nobody asks is a rule nobody checks.

Two consequences to plan for:

1. **The status chips for Done and Declined have never rendered from a user
   action.** They only appear because `npm run demo` writes those statuses
   directly. Nothing in the UI can move a request between them.
2. **Deleting a request has never been exercised.** The cascades are verified at
   the database level — votes and comments both go — but no code path reaches
   them, so the `ON DELETE RESTRICT` on `author_id` has never been hit in anger.

Whoever builds that slice inherits the two route-level tests that have been
outstanding since slice 1: a non-owner refused a request edit, and a regular
user refused a status change. The harness is in
`api/src/app.authorization.test.ts` and both are a few lines each.

## Conventions that are load-bearing

Breaking any of these will look like a regression to a reviewer:

- **SQL lives only in `*.repository.ts`.** Nowhere else.
- **Permission rules live only in `src/policy/`.** Handlers ask; they do not
  decide. If you write `if (actor.role === 'admin')` outside that directory, it
  belongs inside it.
- **Permission is checked before the body is validated,** so a caller who may
  not act does not learn the payload schema from a 422.
- **The browser is never told who it is.** Every row carries `canVote`,
  `canPin`, `canEdit`, `canDelete`, decided server-side. Do not add a `/me`
  endpoint to work around a UI question; send the answer instead.
- **Counts are derived, never stored.** Votes and comments are counted on read.
  A counter column is the thing this schema has refused three times.
- **List state lives in URL query parameters.** Filtering, sorting and paging
  are server-side, always.
- **One error envelope,** produced by one middleware. `400` means unparseable;
  `422` means parsed and wrong.

## Things that bit, and will bite again

Each of these cost real time. They are in `notes/ai-log.md` in full.

**Angular scopes component styles.** A shared class defined in one component's
stylesheet silently does not apply in another — the markup matches, the styling
does not arrive, and nothing warns. `.chip` and `.vote` live in the global
sheet for this reason.

**`ngSubmit` is not a DOM event.** It is an output of `NgForm` or
`FormGroupDirective`. On a bare `<form>` with a standalone `[formControl]`,
binding it registers a listener for an event nothing raises, the browser
submits natively, and the page reloads. Use `(submit)` with `preventDefault`,
or attach a `[formGroup]`.

**Tests that start at the method cannot catch a broken button.** Twelve passing
tests missed a completely dead submit button because every one of them called
the handler directly. Anything the user clicks needs at least one test that
clicks it.

**`affectedRows` counts rows *changed*, not *matched*.** Setting a column to a
value it already holds reports zero, which reads as "no such row" if you let it.

**MySQL will refuse a CHECK on a column that carries a referential action**
(error 3818), and will refuse `ON DELETE CASCADE` on a foreign key involving
generated columns (error 1215). Both were discovered by probing, and both
changed the schema.

**Probe the exact final shape.** A constraint tested in isolation passed and
then failed on the real table, because the probe omitted the foreign key it
conflicts with.

## Environment

- **Node 24.19.0**, pinned in `.node-version` and `engines.node`. The Angular
  CLI enforces it; the API runs on older versions but do not rely on that.
- **fnm** is installed but needs shell setup. `~/.bashrc` has
  `eval "$(fnm env --use-on-cd --shell bash)"`; a *new* terminal picks it up.
- **Docker Desktop must be running.** As of this handoff it is stopped, so
  MySQL is down — `npm run db:up` brings it back, and the data volume survives.
- **`.env` is gitignored.** Copy `.env.example`. It currently points
  `DEV_CURRENT_USER_EMAIL` at `admin@feedbackhub.local`.

## Getting to a working board

```bash
npm install
npm run db:up            # Docker Desktop must be running
npm run migrate
npm run seed             # the baseline the brief specifies
npm run demo             # optional: 14 requests, 7 people, votes, threads
npm run dev:api          # terminal 1
npm run dev:web          # terminal 2, needs Node 24.19
```

`npm run demo` is destructive to content and leaves users, categories and
statuses alone. It exists because every request belonging to the person looking
at it makes most of the rules untestable — you cannot vote on your own request.

## Repository

**https://github.com/alimzn42-del/feedbackhub** — private.

Every commit is authored as `Mohammed Ali Nizam
<266457374+alimzn42-del@users.noreply.github.com>`, set per-repository. The
global git identity is a different account and was never used.

Pushing needs `gh auth switch --user alimzn42-del` first; the machine's active
`gh` account is another one. Pinning the credential username per repository does
*not* work around this — it breaks the helper into prompting for a password.

All 33 commits carry `Assisted-by: Claude Code`, which is honest: every line was
generated and none has been rewritten by hand.

## Still unverified

The screens have been exercised by hand and by 56 jsdom tests, but **nobody has
audited them in a browser for layout, keyboard focus order, narrow viewports or
the dark scheme**. `notes/` has no visual QA record. That is the first thing I
would do before showing this to anyone.
