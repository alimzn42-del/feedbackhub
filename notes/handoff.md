# Handoff

Where FeedbackHub stands as of 2026-08-23, what is deliberately missing, and
what the next person should know before touching it.

Read [README.md](../README.md) for how to run it and [DECISIONS.md](../DECISIONS.md)
for why it looks the way it does. This file is neither of those: it is the
state of play.

---

## What is built

Eight slices, schema version 12.

| | |
|---|---|
| **Requests** | filed, listed with server-side pagination, edited and deleted by their author |
| **Voting** | one per person per request, withdrawable |
| **Pinning** | admin only, recorded with actor and time, own shelf above the default board |
| **Comments** | threads one reply deep, edit, four-way delete, and optional approval before publication |
| **Filters** | status, category, mine and text search; three orderings, newest by default; all in the URL |
| **Request actions** | edit and delete by the author, delete and restatus by an admin |
| **Admin taxonomy** | one screen managing categories and statuses: add, rename, reorder, retire, set default |
| **Settings** | two levels, resolved on the server; one startup request; a rate limit, a registration policy, a feature flag, and account deletion |
| **Moderation** | comments held for approval, found from a count in the header, judged in the thread they were written in |
| **Language** | English and French, switched from the account screen and applied without a reload |

**Tests: 416** — 220 API (vitest + supertest), 196 web (Angular + vitest, jsdom).

Eight tables: `users`, `categories`, `statuses`, `feedback_requests`, `votes`,
`comments`, `app_settings`, `user_settings`.

Six screens: the board (`/requests`), the create form (`/requests/new`), a
request page with its discussion (`/requests/:id`), the taxonomy admin
(`/admin/taxonomy`), the application settings (`/admin/settings`), and a
personal account screen (`/account`).

There is deliberately **no seventh screen for moderation** — see below.

## The parts worth knowing before you touch anything

Slice 8 is settings, and three things landed on top of it after the first
commit: the level a settings screen resolves at, the interface translation, and
a discovery path for comment approval. They are one body of work and they are
described together here.

### A setting is defined in exactly one file

`api/src/modules/settings/settings.registry.ts`. One entry per setting holds its
validator, its default, which levels may hold it, who may see it, whether the
first paint needs it, and which control edits it.

**Adding a setting is an entry in that file and nothing else.** No migration —
the value column is JSON and a row is optional. No schema change. No second edit
in the web app, because the control and its label travel with the value.

If you find yourself adding a setting in two places, one of them is wrong.

### The default is not in the database, and that is load-bearing

Defaults live in the registry. A table with no row for a key is the normal state.
That is what makes "using the default" answerable at all: the absence of a row IS
the answer, and a row holding the default value would say somebody chose it.

**Never seed a settings row to "make the default explicit".** It would break the
reset control on both screens, in a way that looks like nothing is wrong.

### Resolution happens once, on the server

`user` → `global` → `default`, nearest wins, and every answer says which layer it
came from. The client renders from `source` and never merges. A client that
merged would be a second implementation of these rules and would disagree with
the first the day either changed.

### Adding a language is two files, and adding a setting is still one

`web/src/app/core/i18n/messages.ts` holds every string the interface writes for
itself, in both languages, with French typed against the English keys — a missing
one is a compile error. Three tests guard what the types cannot: nothing blank,
nothing left in English, and the same placeholders on both sides.

**Setting labels are the exception and are NOT in that file.** They live in the
API's registry, in both languages, beside the setting. That is deliberate: the
registry promises that adding a setting is one edit in one file, and it would be
a lie if every new setting also needed two lines in the web app before anybody
could read its label.

`profile.language` offers only languages that are actually translated. Do not add
a third to the enum without adding its catalogue — a language that falls back to
English is the setting that did nothing, which is what this replaced.

### A settings screen resolves at the level it writes

The administrative document is resolved **without** the caller's own preference
rows. Its source is `global` or `default`, never `user`.

Get this wrong — as it was first — and the screen that sets the installation's
value displays the admin's own, labelled "Your choice", over a global value that
does not exist. They then change a setting that already looked changed, and the
board does not move for anybody. There are four tests on it in
`settings.test.ts`.

The account screen keeps all three layers on purpose: there the effective value
is what the person actually gets, and being told it came from the board rather
than from them is the useful half of the answer.

### One startup request, and nothing renders without it

`GET /api/bootstrap`. The shell mounts, gates `<router-outlet>` on it, and shows
an error with a retry if it fails. **Nothing renders on hardcoded fallbacks** —
that is the point, and it is tested.

What belongs in that payload is decided by one question: would the first paint be
drawn *wrong* without it, and then visibly change. If you are tempted to add
something to it, that is the test. It replaced `GET /api/capabilities`, which is
gone rather than left as a second way to ask a third of the same question.

### The moderation gate has two directions and they are not symmetric

* Turning it **on** affects comments written from then on and nothing already on
  screen — because `approved_at` is stamped at insert whenever the gate is down.
* Turning it **off** releases whatever is waiting — because the visibility test
  asks whether the gate is up *now* as well as whether the row cleared it.

Remove either half and you get a different bug: the first hides the entire
history of the board the moment an admin tries the setting; the second strands
comments invisible forever with nothing left to approve them from.

### Moderation has exactly one discovery path, and it is the header count

Without it the feature does not work: a waiting comment sits in a thread nobody
has a reason to open. The count comes from the startup payload, links to
`/requests?pending=true`, and is refetched after every approve or reject so it
falls without a reload.

**It is absent, not zero,** when the gate is down or the reader cannot approve.
Do not "simplify" that into always sending a number — a badge showing 0 claims
there is moderation here and nothing is waiting, which is a different statement
from there being no moderation.

**There is no queue screen, and adding one would be a regression.** Comments are
approved and rejected in the thread they were written in, because judging one
needs the discussion around it. Rejecting is the ordinary delete, which records
who did it; a separate "rejected" state would be a third kind of hidden comment
with no trail the other two do not already keep.

### One SQL fragment decides who sees which comment

`APPROVED_FOR_VIEWER` in `comments.repository.ts`, imported by
`requests.repository.ts` for the comment count. **They must stay one fragment.**
Two copies disagree the first time either is edited, and the visible symptom is a
badge promising three comments above a thread that shows one. The pending
decision that parked moderation predicted exactly this.

## What is deliberately not built

- **Authentication.** The identity seam is still one function,
  `api/src/auth/current-user.ts`, and the API refuses to boot in production while
  it is compiled in. It now has a second half, `api/src/auth/provision.ts`, which
  is the same call the real provider will make on somebody's first arrival.
- **User administration.** Nothing creates, promotes, demotes or deactivates
  anybody else. This is why the last admin cannot delete their own account: there
  would be no way back. The parked decision in `notes/decisions-pending.md` says
  what that slice must do.
- **Invitations**, which is why `invite-only` is not a registration policy this
  application offers. A setting that named a rule the code cannot apply would be
  worse than its absence.
- **Sending email.** The notification preferences are recorded and consumed by
  nothing. That is stated on the screen itself rather than implied.
- **Translating what people wrote.** The interface is translated — English and
  French, both complete — but requests, comments, display names and the names of
  categories and statuses are left as their authors typed them.
- **Server-side translation.** Validation and refusal messages are English
  whatever the reader's language, so a French screen can show an English 422.
  A second catalogue on the API is what closes that, and this slice did not
  build one.
- **Avatar uploads.** No file storage; initials come from the display name.
- **Deployment beyond the database container.**

## Conventions that are load-bearing

Breaking any of these will look like a regression to a reviewer:

- **SQL lives only in `*.repository.ts`.** Nowhere else.
- **Permission rules live only in `src/policy/`.** Handlers ask; they do not
  decide. If you write `if (actor.role === 'admin')` outside that directory, it
  belongs inside it.
- **Permission is checked before the body is validated,** so a caller who may
  not act does not learn the payload schema from a 422.
- **The browser is told what it may DO, and who it is — never what it is.** Rows
  carry `canVote`, `canPin`, `canEdit`, `canDelete`, `canChangeStatus`;
  `/api/bootstrap` carries the same kind of answer where there is no row, plus
  the caller's own id, name and email because the account screen edits them.
  **There is still no role in any payload,** and no permission a client can
  derive for itself. Do not add one.
- **There is no `/me`, and there must not be.** Every route that acts on an
  account names it in the path, which is what makes "you cannot write somebody
  else's preferences" a real 403 with a test rather than a silent write to the
  wrong row.
- **Administrative settings are withheld from a non-admin, but their consequences
  are not.** Somebody whose comment will wait is told so by the endpoint that
  owns the action. Do not "simplify" that by sending the setting.
- **Counts are derived, never stored.** Votes and comments are counted on read.
  A counter column is the thing this schema has refused four times.
- **List state lives in URL query parameters.** A saved default decides where you
  land — arriving at the board fills in what the address did not ask for — and
  the URL still says where you are. Ordering and filtering are asked separately,
  and it applies once per arrival, tracked on the component instance. Do not put
  that condition back in the URL: an address with no filters is the same address
  whether it was cleared or arrived at, which is the bug this replaced.
- **Never add an endpoint that clears the default status.**
- **Never add a way to change a slug.** It is in URLs people have shared.
- **Retiring is not deleting, and statuses are not retired at all.**
- **An admin moderates; an admin does not rewrite.** `delete` and `changeStatus`
  allow admins; `editContent` does not, and neither does approval — an admin
  decides whether words are published, never what the words are.
- **Deleting an account anonymises it.** Never turn that into a DELETE: every
  foreign key to `users` is `ON DELETE RESTRICT` on purpose, and the one
  exception (`user_settings`) is the only thing in the schema that is purely
  personal.
- **A loading state that replaces the page must be guarded by "have I anything
  to show".** `AppConfig.isStarting()` is that guard for the shell — a bare
  `isLoading()` would unmount every screen on a settings save.
- **Never read a resource's `value()` unguarded.** It throws in the error state.
- **One error envelope,** produced by one middleware. `400` unparseable, `422`
  parsed and wrong, `429` too soon and carrying how long.
- **Two implementations of "is this filtered" have to agree** — `isFiltered` in
  `api/.../requests.schema.ts` and in `web/.../board-filters.ts`. `pending` is
  one of them now.

## Things that bit, and will bite again

In full in `notes/ai-log.md`. The ones from this slice:

**`whenStable()` deadlocks on an unanswered `httpResource` request.** An
outstanding resource request is a pending task, so awaiting stability before
flushing waits for a response the test never sent, and it dies at the timeout
rather than at an assertion. Flush first, then await. `HttpClient.subscribe` in a
click handler does not behave this way, which is why the same pattern works in
older specs and makes this look like a mystery.

**A root service that makes an HTTP call puts a request in every component
test.** `provideStubbedConfig()` in `core/config/app-config.testing.ts` exists so
that is one line per spec rather than a flush in every test.

**`LOCALE_ID` is fixed when the injector is created,** so a preference arriving
with the startup response cannot use it. The date pipe takes a locale as its
fourth argument.

**MySQL `UNIQUE` permits many NULLs,** so a nullable scope column cannot express
"one row per key per scope". That is why settings are two tables.

**A component and a payload type sharing a name** resolves to whatever the
auto-import finds first, and reports as "Individual declarations in merged
declaration must be all exported or all local", which says nothing useful.

The older ones still stand: Angular scopes component styles; `ngSubmit` is not a
DOM event; clearing a control is `reset()` and not `setValue('')`; tests that
start at the method cannot catch a broken button; a required `input()` has no
value in a constructor; `@if (x; as y)` shadows a component member; `affectedRows`
counts rows *changed*; MySQL refuses a CHECK on a column with a referential
action (3818) and a cascade on a foreign key involving generated columns (1215);
a filter that names nothing must be refused rather than ignored; a `WHERE` with
no conditions is a syntax error and so is `IN ()`.

## Environment

- **Node 24.19.0**, pinned in `.node-version` and `engines.node`.
- **The Angular CLI needs that version and PowerShell does not pick fnm up.**
  Apply `fnm env` to the session first, or run from a bash shell where
  `~/.bashrc` has already done it. The API workspace does not care.
- **Docker Desktop must be running.** `npm run db:up` brings MySQL back.
- **`.env` is gitignored.** Copy `.env.example`. It points
  `DEV_CURRENT_USER_EMAIL` at **`dana@feedbackhub.local`** — a regular user.
  Switch to `admin@feedbackhub.local` to see the admin screens, or point it at an
  address nobody has used to watch the registration policy decide.

## Getting to a working board

```bash
npm install
npm run db:up            # Docker Desktop must be running
npm run migrate          # takes the schema to 12
npm run seed             # the baseline the brief specifies
npm run demo             # optional: 14 requests, 7 people, votes, threads
npm run dev:api          # terminal 1
npm run dev:web          # terminal 2, needs Node 24.19
```

`npm run demo` is destructive to content and leaves users, categories and
statuses alone. It adds a second admin, which matters now: the last admin cannot
delete their own account, and with only the seeded one you cannot exercise the
path that succeeds.

## Repository

**https://github.com/alimzn42-del/feedbackhub** — private.

Every commit is authored as `Mohammed Ali Nizam
<266457374+alimzn42-del@users.noreply.github.com>`, set per-repository. The
global git identity is a different account and was never used.

Pushing needs `gh auth switch --user alimzn42-del` first; the machine's active
`gh` account is another one. Pinning the credential username per repository does
*not* work around this — it breaks the helper into prompting for a password.

Every commit carries `Assisted-by: Claude Code`, which is honest: every line was
generated and none has been rewritten by hand.

## Verified against MySQL on 2026-08-23

Schema at 12. All three of this slice's migrations were applied, reversed and
re-applied. The API was run as four different identities at once — a regular
user, an admin, a stranger from an unadmitted domain, and a newcomer from an
admitted one — because most of these rules are about the difference between them.

| | |
|---|---|
| Resolution, all three layers | no rows → `default`; an admin's global → `global`; the person's own → `user`, beating the global |
| Reset falls to the layer below, not to the registry | dana reset her sort and landed on the admin's `oldest`, not on `newest` |
| Application settings are withheld | absent from a regular user's `/api/bootstrap`; `403` on read and on write |
| Preferences are the owner's | `403` writing another account's, admin included, with nothing written |
| The registration invariant | `domains` with an empty list refused by name; both keys together accepted in one write |
| The registration policy refuses | a stranger from an unadmitted domain got `403` on every route, before any handler |
| The registration policy admits | a newcomer from an admitted domain was provisioned as an ordinary user, named from the local part |
| The rate limit | limit of 1: first `201`, second `429` with `Retry-After: 86400` and the same number in the body |
| Approval holds a comment | author sees her own marked pending; another account sees neither the comment nor it in the count |
| Counts agree with the thread | same request, same moment: `commentCount` 1 to the author, 0 to everybody else |
| Approving is admin-only | `403` on approving as a regular user; `409` on approving twice |
| Turning approval off releases | the held comment appeared for everybody, without being approved |
| Turning it back on keeps history | the approved one stayed visible; only the never-approved one was held again |
| Anonymisation | `204`; the account's comment still reads, bylined "Deleted user"; its preference row is gone |
| The last admin is refused | `409` naming the reason, with nothing anonymised |
| The waiting count | `3` for an admin, absent from a regular user's payload, absent for everybody with the gate down |
| The count is a real filter | `/requests?pending=true` returned the two requests carrying a held comment; `403` for a regular user |
| The control travels with the comment | admin: `canApprove` true on the held one; its author: `isPending` true, `canApprove` false |
| Approving in the thread | comment stops being pending, the count falls to `2`, and that request leaves the filter |
| Settings labels follow the reader | the same document came back as "Colour scheme" and as "Thème de couleurs" |

## Still unverified

**Nobody has audited the screens in a browser** for layout, keyboard focus
order, narrow viewports or the dark scheme. `notes/` still has no visual QA
record, and this body of work added two screens, a generic setting control, a
second confirmation dialog, a header indicator and inline moderation controls.

Four things in particular have never been looked at by a human:

- **`data-theme="dark"` as an explicit choice.** The dark scheme has only ever
  been exercised through an operating system setting. The tokens are shared, so
  it should be identical — should.
- **The French interface.** Every string is translated and three tests say the
  catalogue is complete, but nothing has checked whether the longer French
  wording fits the buttons and table headers it now sits in. That is the usual
  way a translation breaks a layout.
- **The header indicator**, which is the only discovery path moderation has: it
  is asserted in a test and has never been seen in place.
- **The inline approve and reject controls**, in a thread with a real reply
  underneath.

That was the first thing the last four handoffs would have done, and it is still
the first thing this one would do.

## Where the history is

Everything is committed and **nothing is pushed**. Pushing needs
`gh auth switch --user alimzn42-del` first; see [Repository](#repository).

```
4a937d1  comment approval: a discovery path, and judging in the thread
7c6608f  a saved default filter never applied after the first visit
140aa28  translate the interface, and offer only translated languages
17882a8  resolve a settings screen at the level it writes
6fcf647  prove the saved board defaults reach the request, end to end
817b3fc  two levels of configuration, resolved on the server
f5002e7  filters and search, acting on a request, the taxonomy admin
```

The three `fix`/`test` commits are worth reading as a pair with the feature they
follow: each one is a rule that was wrong in a way that looked like the feature
simply not working, which is the failure mode this slice kept producing.
