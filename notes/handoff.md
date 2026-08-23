# Handoff

Where FeedbackHub stands as of 2026-08-22, what is deliberately missing, and
what the next person should know before touching it.

Read [README.md](../README.md) for how to run it and [DECISIONS.md](../DECISIONS.md)
for why it looks the way it does. This file is neither of those: it is the
state of play.

---

## Read this first: three slices are not committed

The last commit is `1782d59`, the handoff written at the end of slice 4. Slices
**5, 6 and 7 exist only in the working tree** — 33 modified files and 18
untracked paths, including a migration.

```bash
git status --short        # 51 paths
git log --oneline | head  # 34 commits, none of them this work
```

Nothing here is half-finished: the suite is green, both workspaces build, and
the API has been exercised against a real MySQL. It is simply uncommitted, and
the untracked list is where the new modules live — `api/src/modules/taxonomy/`,
`web/src/app/features/admin/`, `web/src/app/shared/`, migration 009. A `git
clean` would take the slice with it.

Committing needs `gh auth switch --user alimzn42-del` first; see
[Repository](#repository).

## What is built

Seven slices, schema version 9.

| | |
|---|---|
| **Requests** | filed, listed with server-side pagination, edited and deleted by their author |
| **Voting** | one per person per request, withdrawable |
| **Pinning** | admin only, recorded with actor and time, own shelf above the default board |
| **Comments** | threads one reply deep, edit, and four-way delete |
| **Filters** | status, category, mine and text search; three orderings, newest by default; all in the URL |
| **Request actions** | edit and delete by the author, delete and restatus by an admin, from the detail page |
| **Admin taxonomy** | one screen managing categories and statuses: add, rename, reorder, retire, set default |

**Tests: 309** — 156 API (vitest + supertest), 153 web (Angular + vitest, jsdom).

Six tables: `users`, `categories`, `statuses`, `feedback_requests`, `votes`,
`comments`. Slice 6 added a column (`feedback_requests.edited_at`); slice 7
added none.

Four screens: the board (`/requests`), the create form (`/requests/new`), a
request page with its discussion (`/requests/:id`), and the taxonomy admin
(`/admin/taxonomy`).

## What is deliberately not built

- **Authentication.** The identity seam is one function,
  `api/src/auth/current-user.ts`, and the API refuses to boot in production
  while it is compiled in. Keycloak replaces that function body and nothing else.
- **Comment moderation before publication.** Argued out and parked in
  `notes/decisions-pending.md`; no column, no setting.
- **Application-wide settings** — registration policy, rate limits, the feature
  flag. Explicitly the next slice, and explicitly not this one.
- **User administration.** Nothing creates, edits or deactivates a user. The
  `ON DELETE RESTRICT` on `feedback_requests.author_id` is waiting for that
  slice to decide what deleting a person means.
- **Deployment beyond the database container.**

Every rule in `requestPolicy` now has an endpoint asking it. There is no longer
a rule that nothing calls, which is what the last two handoffs led with.

## What each recent slice added

### Slice 5 — filters, search, sorting

- `GET /api/statuses` — new module, mirrors categories.
- `GET /api/requests` takes `status`, `category`, `mine`, `q`, `sort`. Slugs, not
  ids. Several values per filter, comma-separated or repeated.
- **The board opens on `newest`,** not vote count. That reversed the original
  default; DECISIONS.md keeps both entries.
- `GET /api/requests/pinned` takes `sort` and refuses everything else. **`sort`
  is optional all the way through with no schema default**, because the shelf
  has to tell "no ordering asked for" (use pin order) from "this ordering asked
  for" (follow it). Adding a `.default()` to that field silently breaks the
  shelf's ordering; the default is applied in the service instead.
- A filter value that names nothing is a `422` naming the value, never ignored.
- `web/.../data/board-filters.ts` is the only place that knows how list state is
  spelled in a URL. Pager links, filter navigation and the list request are all
  built from `toQueryParams`, so they cannot drift.
- **The pinned shelf belongs to the default board only.** Filter or search and
  the shelf disappears, the matching pinned rows join the results ranked first
  with their badge, and the total counts them. Sorting is not filtering and
  keeps the shelf. Also a reversal; also kept in DECISIONS.md.
- **Two implementations of "is this filtered" have to agree** — `isFiltered` in
  `api/.../requests.schema.ts` and in `web/.../board-filters.ts`. If they
  disagree, pinned rows appear twice on one screen or vanish from both. Change
  one, change the other.
- **The search box searches as you type**, 300ms after typing stops. Three
  things make that behave: a debounce, `replaceUrl` on search-only navigations,
  and keeping stale rows on screen instead of skeletons. Remove any one and it
  looks like a regression — a request per letter, a Back button that walks
  through every prefix, or a list that flickers on every keypress.

### Slice 6 — acting on a request

- `PATCH /api/requests/:id` (author), `DELETE /api/requests/:id` (author or
  admin), `PUT /api/requests/:id/status` (admin). All three refuse before the
  body is validated.
- **Migration 009 adds `edited_at`.** Do not derive "edited" from
  `updated_at <> created_at`: `updated_at` is `ON UPDATE CURRENT_TIMESTAMP`, so
  pinning or restatusing moves it and a request would read as edited by an
  author who did nothing.
- Every row carries `canEdit`, `canDelete` and `canChangeStatus` alongside
  `canVote` and `canPin`. `RequestPermissionFlags` in `requests.schema.ts` names
  the set, so adding another does not mean hunting down hand-written `Omit`s.
- A confirmation dialog lives in `web/src/app/shared/confirm-dialog/`. It
  implements its own focus trap on purpose — see DECISIONS.md.

### Slice 7 — the taxonomy admin screen

- `/admin/taxonomy`, one screen with both tables. The route exists for
  everybody; the screen renders the server's 403 for anybody who is not an
  admin. There is no route guard, deliberately.
- `?scope=all` on both taxonomy endpoints — a second representation carrying the
  display order, retirement state and usage counts, refused to non-admins.
- `GET /api/capabilities` — what the caller may do when there is no row to hang
  the answer on. It exists for the navigation link and nothing else, and it
  never says who the caller is.
- **Two invariants live in the application because the schema cannot hold
  them:** exactly one default status, and a reorder that names every row exactly
  once. Both have tests that name them.
- Reordering is buttons, not drag. That is the interface, not a fallback.

## Conventions that are load-bearing

Breaking any of these will look like a regression to a reviewer:

- **SQL lives only in `*.repository.ts`.** Nowhere else.
- **Permission rules live only in `src/policy/`.** Handlers ask; they do not
  decide. If you write `if (actor.role === 'admin')` outside that directory, it
  belongs inside it.
- **Permission is checked before the body is validated,** so a caller who may
  not act does not learn the payload schema from a 422.
- **The browser is never told who it is.** Rows carry `canVote`, `canPin`,
  `canEdit`, `canDelete`, `canChangeStatus`; `GET /api/capabilities` answers the
  same kind of question where there is no row. Do not add a `/me` endpoint to
  work around a UI question; send the answer instead.
- **Counts are derived, never stored.** Votes and comments are counted on read.
  A counter column is the thing this schema has refused three times.
- **List state lives in URL query parameters.** Filtering, sorting and paging
  are server-side, always. Nothing is narrowed or reordered in the browser — it
  holds one page and cannot see the rest.
- **Never add an endpoint that clears the default status.** The schema enforces
  at most one and cannot enforce at least one; the only thing keeping the lower
  bound is that every route touching it names a replacement. A
  `DELETE /api/statuses/:id/default` would look symmetrical and would break
  request creation the first time somebody used it.
- **Never add a way to change a slug.** It is in URLs people have shared. The
  absence is the feature; `PATCH` refuses one by name rather than ignoring it.
- **Retiring is not deleting, and statuses are not retired at all.** If you find
  yourself adding `archived_at` behaviour to statuses, read the note in
  DECISIONS.md first — the asymmetry is deliberate.
- **An admin moderates; an admin does not rewrite.** `delete` and `changeStatus`
  allow admins, `editContent` does not. Tested end to end in both directions.
- **A loading state that replaces the page must be guarded by "have I anything
  to show".** A bare `isLoading()` unmounts the subtree on every refetch, taking
  child components and their requests with it.
- **Never read a resource's `value()` unguarded.** It throws while the resource
  is in its error state. Every derived signal over one checks `hasValue()`
  first.
- **One error envelope,** produced by one middleware. `400` means unparseable;
  `422` means parsed and wrong.

## Things that bit, and will bite again

Each of these cost real time. They are in `notes/ai-log.md` in full.

**Angular scopes component styles.** A shared class defined in one component's
stylesheet silently does not apply in another — the markup matches, the styling
does not arrive, and nothing warns. `.chip`, `.vote` and every `.button` variant
live in the global sheet for this reason.

**`ngSubmit` is not a DOM event.** It is an output of `NgForm` or
`FormGroupDirective`. On a bare `<form>` with a standalone `[formControl]`,
binding it registers a listener for an event nothing raises, the browser submits
natively, and the page reloads. Use `(submit)` with `preventDefault`, or attach
a `[formGroup]`.

**Clearing a form control is three things, not one.** `setValue('')` leaves the
control **dirty**, so an emptied box immediately fails `required` and shows a
validation message — which is how a successfully posted comment came to be told
to "write something first". `reset()` sets the value, marks it pristine and
marks it untouched together.

**Tests that start at the method cannot catch a broken button.** Twelve passing
tests missed a completely dead submit button because every one of them called
the handler directly. Anything the user clicks needs at least one test that
clicks it — and that test should look at what is on screen afterwards, not only
at what was sent. The comment bug above survived a test that clicked the button
but never read the result.

**A required `input()` has no value in a constructor.** Seed a form from one in
`ngOnInit`; the compiler will tell you, at build time and not before.

**An `@if (x; as y)` alias shadows a component member of the same name.** A
required input bound to `y` silently resolved against the component's own
`request` resource instead of the row.

**`affectedRows` counts rows *changed*, not *matched*.** Setting a column to a
value it already holds reports zero, which reads as "no such row" if you let it.

**MySQL will refuse a CHECK on a column that carries a referential action**
(error 3818), and will refuse `ON DELETE CASCADE` on a foreign key involving
generated columns (error 1215). Both were discovered by probing, and both
changed the schema.

**Probe the exact final shape.** A constraint tested in isolation passed and
then failed on the real table, because the probe omitted the foreign key it
conflicts with.

**A filter that names nothing must be refused, not ignored.** Returning the
unfiltered board is indistinguishable from a filter that matched everything, and
the reader takes a wrong answer for a right one. This is why the slug lookups
exist at all; do not "simplify" them into a slug comparison in the WHERE clause.

**A `WHERE` with no conditions is a syntax error, and so is `IN ()`.** Both
appear the moment every clause in a builder is optional. Ask what the string
looks like when every branch is false.

## Environment

- **Node 24.19.0**, pinned in `.node-version` and `engines.node`. The Angular
  CLI enforces it; the API runs on older versions but do not rely on that.
- **The Angular CLI needs that version and PowerShell does not pick fnm up.**
  `npm test --workspace web` fails with a version error in a plain PowerShell
  session even though `fnm list` shows 24.19.0 as default. Apply `fnm env` to
  the session first, or run it from a bash shell where `~/.bashrc` has already
  done it. The API workspace does not care.
- **Docker Desktop is running and MySQL is up** as of this handoff, with the
  schema at version 9 and migration 009 applied. `npm run db:up` brings the
  container back if it stops; the data volume survives.
- **`.env` is gitignored.** Copy `.env.example`. It currently points
  `DEV_CURRENT_USER_EMAIL` at **`dana@feedbackhub.local`** — a regular user, not
  an admin. The admin screen and every admin control are correctly invisible in
  that state. Switch to `admin@feedbackhub.local` to see them.

## Getting to a working board

```bash
npm install
npm run db:up            # Docker Desktop must be running
npm run migrate          # takes the schema to 9
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

All 34 commits carry `Assisted-by: Claude Code`, which is honest: every line was
generated and none has been rewritten by hand. The three uncommitted slices are
the same.

## Verified against MySQL on 2026-08-22

Migration 009 is applied; the schema is at version 9. Slices 5, 6 and 7 were run
against the real database, not only against mocked repositories.

| | |
|---|---|
| `IN (:ids)` expands to a value list | 7 rows across two status slugs. It relies on `pool.query`, not `pool.execute` |
| `LIKE` metacharacters are escaped | `?q=%` matched **0** of 11 rows; unescaped it would have matched all 11. `_` likewise |
| A page past the end counts the FILTERED set | `?status=new&page=99` reported total 6, not the board's 11 |
| An unknown slug is refused | 422 naming the value, before any rows are read |
| The shelf takes `sort` and refuses filters | pin order put a fresh pin first; `?sort=oldest` reordered it; `?status=done` was a 422 |
| A filtered board folds the shelf in | the pinned row came back first among the matches and was counted in the total |
| A status change does NOT stamp `edited_at` | `updated_at` moved, `edited_at` did not — the exact case migration 009 exists for |
| The delete cascade, through the endpoint | a request with a vote and a comment: `204`, and votes, comments and the row all gone |
| The default status swap | moved to Planned and back to New. Clear-then-set inside one transaction is the only order the unique key permits |
| A reorder is all-or-nothing | four categories rewritten in one call; an order naming three of them refused |
| Retiring keeps what points at it | a category with two requests vanished from `GET /api/categories` while both requests went on rendering it, and its slug filter still matched them |
| Duplicates are named per field | `uq_categories_name` and `uq_categories_slug` came back as `422`s naming the field and the value |

**The one result that did not match the prediction.** An earlier handoff said to
check that `EXPLAIN` shows `idx_requests_status` in use for a status filter. It
does not: the optimizer picks `idx_requests_pinned` and applies the status
filter as a where-condition. `idx_requests_status` is in `possible_keys`, so the
column is a candidate — but on 11 rows the choice between them is not evidence
of anything, and recording it as a win would be dishonest. Every join is an
`eq_ref` on a primary key, the vote-count CTE is joined on an auto-generated
key, and the ordering is a filesort, all as documented.

Worth re-running on a board of realistic size before anyone claims the filtering
scales.

## Still unverified

**Nobody has audited the screens in a browser** for layout, keyboard focus
order, narrow viewports or the dark scheme. `notes/` still has no visual QA
record, and there is now a great deal of new interface: the filter bar, the
manage panel on the detail page, the confirmation dialog, the edit form and two
admin tables. The confirmation dialog's focus trap and the reorder buttons have
unit tests that press real keys, which is not the same as somebody tabbing
through the screen.

That was the first thing the last two handoffs would have done, and it is still
the first thing this one would do.
