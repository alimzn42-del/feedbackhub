# Handoff

Where FeedbackHub stands as of 2026-08-25, what is deliberately missing, and
what the next person should know before touching it.

Read [README.md](../README.md) for how to run it and [DECISIONS.md](../DECISIONS.md)
for why it looks the way it does. This file is neither of those: it is the
state of play.

---

## What is built

Ten slices, schema version 12.

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
| **Authentication** | Keycloak, imported from a realm file in this repository; authorization code with PKCE; tokens verified locally; provisioning and the registration policy on first arrival |
| **Deployment** | container images for both applications, a compose file that brings the whole system up, and Kubernetes manifests behind one kustomization |

**Tests: 466** — 246 API (vitest + supertest), 220 web (Angular + vitest, jsdom).
**No test needs a running Keycloak, and none needs a database.**

Eight tables: `users`, `categories`, `statuses`, `feedback_requests`, `votes`,
`comments`, `app_settings`, `user_settings`.

Seven screens: the board (`/requests`), the create form (`/requests/new`), a
request page with its discussion (`/requests/:id`), the taxonomy admin
(`/admin/taxonomy`), the application settings (`/admin/settings`), a personal
account screen (`/account`), and the sign-in callback (`/auth/callback`) — which
renders almost nothing and exists for the moment between arriving with a code
and having a session.

There is deliberately **no seventh screen for moderation**, and deliberately
**no sign-in form** — see below.

## The parts worth knowing before you touch anything

### The seam did what it was built for

Authentication landed by changing `IDENTITY_MODE` and the body of
`resolveCurrentUser`. **Nothing in `src/policy/` moved. No service learned what
a token is. No handler gained a null check.** `req.actor` is still non-nullable
behind the middleware.

The 220 route tests changed in exactly two mechanical ways: the repository they
resolve identity through (`findByEmail` → `findByExternalId`), and a header on
each call (`request(app)` → `signedIn(request(app))`). Not one of them changed
what it asserts, because the token has never carried a role and still does not.

If a future slice finds itself editing `src/policy/` or a service to accommodate
something about identity, that is the signal something has gone wrong with the
seam — not a thing to patch locally.

### The development seam is still there, and that is deliberate

`IDENTITY_MODE` in `api/src/auth/identity-mode.ts` is `'keycloak'`, and
`'development-seam'` is still a mode this build can be compiled in. Three
reasons it was kept rather than deleted:

- `assertIdentityIsSafeFor` keeps a subject it can be tested against. A guard
  over a branch nobody can select is dead code.
- The API can be run without a container.
- The web application asks the API which mode it is in — `GET /api/auth/config`
  — and skips the entire sign-in flow when the answer is the seam, rather than
  redirecting a browser to a realm that is not running.

It is a total authentication bypass and the boot guard treats it as one: the API
refuses to start with it compiled in under `NODE_ENV=production`, and refuses to
start with both identity mechanisms configured at once.

### The test suite mints its own tokens, and fakes exactly one thing

`api/src/auth/tokens.test-support.ts`. The tests own an RSA key and sign their
own tokens; the ONLY thing replaced is the network fetch in
`api/src/auth/jwks.ts`. The signature, the issuer, the audience, the expiry and
the `kid` selection are all the real implementation running against real tokens.

**Do not "simplify" that by stubbing the verifier.** The verification path is
the part most worth covering, and a suite that stubs it passes every one of the
refusal tests in `app.authorization.test.ts` while proving none of them.

**The minting code is not compiled.** `tsconfig.build.json` excludes
`*.test-support.ts` alongside the test files, so it is absent from `dist/`
rather than present and guarded. If you add another test-support file, it
inherits that; if you rename the suffix, you have moved token-signing code into
the build.

### The realm file and the seed both write the same three ids down

`keycloak/realm-feedbackhub-development.json` pins the `id` of each of the three
users, and `api/src/db/seeds/001_baseline.sql` puts the same three in
`external_id`. **They are one fact stored in two places and there is no way to
avoid that**, because one of them is Keycloak's and the other is MySQL's.

Change one and change the other in the same commit. Get it wrong and the seeded
admin authenticates perfectly, matches nothing — matching is on subject, never
on address — is sent to provisioning, and collides with `uq_users_email`. The
symptom is the only account that can reach the admin screens being unable to get
in, on a board where nothing can promote a replacement.

The demo script's seven people have **no** realm identities. They are authors of
content, not people who sign in.

### The email is the provider's; the display name is the person's

Reconciliation is one-directional and applies only to the email. The display
name is copied once, at provisioning, and the account screen owns it afterwards
— overwriting it on every request would make that screen a control that appears
to work and silently does nothing. Four tests hold both halves.

An unverified address is never provisioned and never overwrites a verified one.
That is the same rule the realm applies when linking a social identity, asserted
a second time where it does not depend on the realm being configured correctly.

### A 401 says one sentence on the wire and a named reason in the log

`UnauthenticatedReason` in `api/src/http/errors.ts`: `token.missing`,
`token.expired`, `token.malformed`, `token.signature`, `token.audience`,
`token.issuer`, and three more. **The reason is logged and never serialised.**
Telling an unauthenticated stranger that their signature was fine and their
audience was wrong describes the installation to somebody who was not let in.

**An unreachable provider is a 503 and never a 401.** The token may be perfectly
good; the API simply cannot check it. A 401 would tell every client in the
building that its session had ended, and the browser interceptor would act on it
— turning a Keycloak restart into a mass sign-out that outlasts the restart.
Both sides are tested, and the key cache means a restart usually costs nothing
at all.

### The issuer and the address of the realm are two different values

`OIDC_ISSUER_URL` is what every token says as `iss`, and the only string that
claim is ever compared to. `OIDC_INTERNAL_URL` is optional and says where to
*fetch* the key set.

They are the same value when the API is run from a terminal and different the
moment anything is containerised: the browser reaches Keycloak at
`localhost:8080` and mints tokens saying so, while the API reaches the same
server at `keycloak:8080`. An API deriving the key set URL from the issuer would
resolve `localhost` inside its own container and find nothing.

The earlier design deliberately refused a second variable, on the reasoning that
two could disagree. That was right about drift and wrong in principle — identity
and address are not the same thing — and the deployment slice is what made the
difference load-bearing. Nothing about trust moved: pointing the internal URL at
the wrong realm makes every token fail rather than making a wrong one pass.

### The API is not reachable from outside, in any environment

The browser talks to one origin. In development the Angular CLI proxy forwards
`/api`; in compose and in Kubernetes the web tier's nginx does. The API has no
published port in compose and no Ingress in Kubernetes.

That is one request path everywhere rather than an ingress rule and an nginx
`location` that can drift apart, and it is why CORS never enters into this
application — `WEB_ORIGIN` is a fallback for running `ng serve` without the
proxy and nothing else.

### Migrations are a Job, and the API waits for the fact, not the Job

An API that migrates on boot cannot run two replicas without two processes
racing to alter the same tables, and it buries a schema failure inside a deploy.
So: a one-shot compose service, and a Kubernetes Job — both using the API image,
because the migration scripts and their `.sql` files ship in it.

A Job is not an ordering primitive; nothing makes a Deployment wait for one. The
API's init container blocks until `schema_migrations` exists, which is the fact
it actually depends on rather than a sleep.

**Seeding is deliberately not part of either.** It is baseline content and a
decision, not a consequence of starting the system.

### There is no route guard, and adding one would be a regression

Nothing below the shell renders until the session resolves, because the
`<router-outlet>` does not exist until then. That covers a route added next year
— it cannot be mounted — which a per-route guard does not. A guard *and* the
gate would be one rule written twice, and the day they disagreed the wrong one
would be the one nobody was reading.

The sign-in callback is the single exception. Whether it may render is decided
from `location.pathname` and **not from the router**, because the shell has to
answer on the first paint: answer wrongly and the outlet is never mounted, the
component never constructs, and the authorization code is never redeemed. That
is a deadlock, not a flash. It is sound because arriving there is always a fresh
page load — Keycloak redirects the browser, and nothing in the application links
to it.

### There is no sign-in form, and there must never be one

The person is redirected to Keycloak. A field in this application that collected
a password would mean this application had handled one, which is the entire
thing that delegating authentication exists to avoid. There is a test asserting
the sign-in panel contains no `input[type="password"]` and no `<form>`.

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

**The sign-in screen is always in English.** The language preference arrives in
the startup payload, which needs a token, so there is nothing to read it from
before somebody signs in. Reading `navigator.language` there would be a second
source of truth about language, disagreeing with the first as soon as somebody
set a preference that differed from their browser.

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

It no longer fires at all until there is a token: the request function returns
`undefined` while the session is unresolved, which makes the token a dependency
rather than something `AppConfig` has to be told about.

What belongs in that payload is decided by one question: would the first paint be
drawn *wrong* without it, and then visibly change. If you are tempted to add
something to it, that is the test. It replaced `GET /api/capabilities`, which is
gone rather than left as a second way to ask a third of the same question.

**`GET /api/auth/config` is not a second bootstrap.** Bootstrap answers "who am
I and how is this board configured for me", every word of which presupposes an
identity. That one answers "where do I go to become somebody", which by
definition cannot be authenticated. It is the only route under `/api` in front
of the identity middleware, and it should stay the only one.

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
badge promising three comments above a thread that shows one.

## What is deliberately not built

- **User administration, and anything that sanctions a person rather than a
  thing they wrote.** Nothing creates, promotes, demotes, deactivates, suspends
  or bans anybody. This is why the last admin cannot delete their own account:
  there would be no way back. **This is ruled out, not parked** — see
  [SCOPE.md](../SCOPE.md#ruled-out), which records why, and records the
  promote/demote rule that was argued out in case it is ever wanted without
  that being a commitment to build it. A second admin on a demo board exists
  because `npm run demo` seeds one, not because anything promoted them.
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
- **Avatar uploads.** No file storage; initials come from the display name.
- **A production realm.** What ships here is a development one: HTTP without a
  certificate, an in-container database, three published passwords, and
  `start-dev`. A deployment imports a realm with no `credentials` block and no
  fixed user ids, sharing the client, the mappers and the audience with this one
  and nothing else.
- **A back-end-for-frontend.** The refresh token is in `sessionStorage` and
  anything that can run script on this origin can read it. Closing that means
  httpOnly cookies and a server in front of the browser, which is infrastructure
  this application does not have. The trade is in DECISIONS.md rather than left
  as an assumption.
- **A production deployment.** The artefacts exist — images, compose, manifests
  — and every one of them is honest about being a development configuration:
  Keycloak runs `start-dev` with its database inside the container, the realm is
  the one with three published passwords, the Secret holds development values in
  plain text, and there is no TLS. Each of those is named where it appears,
  along with what a real deployment does instead.
- **Anything a cluster has to provide.** No HorizontalPodAutoscaler, no
  NetworkPolicy, no ServiceMonitor. Each needs machinery — a metrics server, a
  policy-enforcing CNI, an operator — and a manifest referring to something that
  is not installed fails in the least useful way available: silently.

## Conventions that are load-bearing

Breaking any of these will look like a regression to a reviewer:

- **SQL lives only in `*.repository.ts`.** Nowhere else.
- **Identity is established in `src/auth/current-user.ts` and nowhere else.**
  Nothing outside that file may read a header, cookie or token, and nothing
  outside it may decide what an identity is allowed to do.
- **Permission rules live only in `src/policy/`.** Handlers ask; they do not
  decide. If you write `if (actor.role === 'admin')` outside that directory, it
  belongs inside it.
- **Permission is checked before the body is validated,** so a caller who may
  not act does not learn the payload schema from a 422.
- **The role comes from the local table and never from a claim.** There is no
  realm role mapped into the token and nothing reads one. Do not add a mapper
  "for convenience".
- **The browser is told what it may DO, and who it is — never what it is.** Rows
  carry `canVote`, `canPin`, `canEdit`, `canDelete`, `canChangeStatus`;
  `/api/bootstrap` carries the same kind of answer where there is no row, plus
  the caller's own id, name and email because the account screen edits them.
  **There is still no role in any payload,** and no permission a client can
  derive for itself. Do not add one.
- **One place attaches a token to a request** — `bearer-token.interceptor.ts` —
  and it attaches it to this API only. A token is a credential for one audience.
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
  personal. It clears `external_id`, which is what makes a departed account
  unmatchable even by a token minted before they left.
- **A loading state that replaces the page must be guarded by "have I anything
  to show".** `AppConfig.isStarting()` is that guard for the shell — a bare
  `isLoading()` would unmount every screen on a settings save.
- **Never read a resource's `value()` unguarded.** It throws in the error state.
- **One error envelope,** produced by one middleware. `400` unparseable, `422`
  parsed and wrong, `429` too soon and carrying how long, `401` refusing to say
  why on the wire.
- **Two implementations of "is this filtered" have to agree** — `isFiltered` in
  `api/.../requests.schema.ts` and in `web/.../board-filters.ts`.

## Things that bit, and will bite again

In full in `notes/ai-log.md`. The ones from this slice:

**`postLogoutRedirectUris` is not a Keycloak client field, and the import dies
rather than ignoring it.** The whole realm is refused, the container restarts in
a loop, and the healthcheck reports "connection refused" — which says nothing
about the cause. Post-logout URIs go in `attributes` as
`post.logout.redirect.uris`. Every test passed the entire time this was broken;
only running it found it.

**The callback route races its own discovery.** On a page load that lands on the
redirect URI, the session's startup and the callback component begin at once,
and the code exchange needs endpoints discovery has not fetched yet.
Intermittent, which is the worst way for it to fail. The startup promise is held
and awaited in `completeSignIn`.

**Whether the callback may render cannot come from the router**, because the
shell answers on the first paint, before navigation completes — and answering
wrongly means the outlet is never mounted and the code is never redeemed.

**A mocked module must export everything the code under test imports**, not just
what the test calls. `current-user.ts` imports `findByEmail` for a branch that
never runs under `keycloak`, and removing it from the mock breaks module linking
rather than failing an assertion.

The older ones still stand: `whenStable()` deadlocks on an unanswered
`httpResource` request — flush first, then await; a root service that makes an
HTTP call puts a request in every component test, which is what
`provideStubbedConfig()` and now `provideStubbedSession()` exist for; `LOCALE_ID`
is fixed when the injector is created; MySQL `UNIQUE` permits many NULLs; a
component and a payload type sharing a name resolves to whatever the auto-import
finds first; Angular scopes component styles; `ngSubmit` is not a DOM event;
clearing a control is `reset()` and not `setValue('')`; a required `input()` has
no value in a constructor; `@if (x; as y)` shadows a component member;
`affectedRows` counts rows *changed*; MySQL refuses a CHECK on a column with a
referential action (3818); a filter that names nothing must be refused rather
than ignored.

## Environment

- **Node 24.19.0**, pinned in `.node-version` and `engines.node`.
- **The Angular CLI needs that version and PowerShell does not pick fnm up.**
  Apply `fnm env` to the session first, or run from a bash shell where
  `~/.bashrc` has already done it. The API workspace does not care.
- **Docker Desktop must be running.** `npm run up` brings MySQL and Keycloak
  back. Keycloak takes about thirty seconds on a cold start.
- **`.env` is gitignored.** Copy `.env.example`. Its identity section points at
  the local realm; the development seam is commented out below it, with what to
  change if you want to run without a container.

## Getting to a working board

```bash
npm install
npm run up               # MySQL + Keycloak; Docker Desktop must be running
npm run migrate          # takes the schema to 12
npm run seed             # the baseline the brief specifies
npm run demo             # optional: 14 requests, 7 people, votes, threads
npm run dev:api          # terminal 1
npm run dev:web          # terminal 2, needs Node 24.19
```

Then <http://localhost:4200>, and sign in as `admin@feedbackhub.local` /
`feedbackhub-dev`.

Or the whole thing in containers, with nothing on the host but Docker:

```bash
docker compose up -d --build
docker compose run --rm migrate node scripts/seed.mjs
```

Same address, same credentials. The migration is its own one-shot service and
the API waits for it to succeed.

For Kubernetes: build both images, then `kubectl apply -k .` from the repository
root. See [k8s/README.md](../k8s/README.md), including what those manifests
deliberately are not.

`npm run demo` is destructive to content and leaves users, categories and
statuses alone. It seeds a second admin, which matters for the account-deletion
path — though the demo people have no realm identities and cannot sign in.

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

## Verified against MySQL and a live Keycloak on 2026-08-25

Schema at 12. The realm was imported by the container from the file in this
repository, with no manual setup. The flow below was driven the way a browser
drives it — a real authorization request, a real login form POST, a real code
exchange with the PKCE verifier — not by asking Keycloak for a token directly.

| | |
|---|---|
| The flow completes | authorization code + PKCE against the public client, no secret anywhere |
| The issuer is the realm | `iss` is `http://localhost:8080/realms/feedbackhub` |
| The audience mapper fires | `aud` contains `feedbackhub-api`, which is what the API insists on |
| The subject is the pinned id | `sub` is the id written in the realm file, not one Keycloak invented |
| The seeded admin is MATCHED | signed in and landed on account id 1, "Robin Alvarez" — not provisioned, not collided |
| The admin screens are theirs | `canManageSettings` true, from the local row and not from a claim |
| No role in the payload | still absent, as it has been since slice 2 |
| A seeded regular user is regular | account id 2, `canManageSettings` false, administrative settings withheld |
| No token | `401` |
| A malformed token | `401` |
| A tampered signature | `401` |
| The refusal says nothing | "This token could not be verified." — no mention of which check failed |
| The log says which | `401 token.missing`, `401 token.malformed`, `401 token.signature`, each with the request id |
| A refreshed token works | renewed through the refresh grant and accepted by the API |
| A newcomer is admitted | somebody in the realm and not in the database was provisioned, named from the token |
| And arrives as a user | `canManageSettings` false; nothing in a token decides a role |
| A returning newcomer matches | second sign-in resolved to the same account, on the subject |
| A restricted board refuses | a stranger authenticated successfully and got `403` on every route |
| Refused by naming the rule | "not open for registration", with the admitted domains not disclosed |
| A policy change does not evict | an already-provisioned account kept working after the policy tightened |
| An address that moved upstream | changed at Keycloak, copied onto the same local row on the next sign-in |
| And never re-matched | same account id before and after; matching stayed on the subject |
| The display name survived it | a name the person had set locally was NOT overwritten by the provider's |
| Keycloak stopped, API warm | still `200` — the cached key set means a provider restart costs nothing |
| Keycloak stopped, API cold | `503 PROVIDER_UNAVAILABLE`, logged as `503 provider.unreachable`, **not** a 401 |
| Keycloak back | `200` again on the same API process, with no restart |

35 checks, all passing. The API's own suite ran throughout with no Keycloak at
all.

### And again, through the containers

Everything above was then re-run against `docker compose up -d --build` — the
same checks, entering at the web tier on port 4200 rather than at the API on
3000, so every request went browser → nginx → API → MySQL/Keycloak.

| | |
|---|---|
| Both images build | from the repository root, which is where the workspace lockfile is |
| The stack comes up in order | mysql healthy → migrate exits 0 → keycloak healthy → api healthy → web |
| The migration ran from the image | `scripts/migrate.mjs` and its `.sql` files ship in it |
| Seeding from the image | `docker compose run --rm migrate node scripts/seed.mjs` |
| The SPA fallback holds | `/auth/callback` and `/requests/42` both return `index.html`, not a 404 from nginx |
| The API is proxied and unpublished | reachable at `/api/...` through nginx; no host port of its own |
| Issuer and address genuinely differ | `iss` says `localhost:8080`, the key set came from `keycloak:8080`, and every token verified |
| The full sign-in flow | 18 checks, through nginx |
| Provisioning and the registration policy | 9 checks, through nginx |
| The boot guard under `NODE_ENV=production` | the API starts, because the identity mode is `keycloak` and not the seam |

27 checks through the containerised stack.

The scripts that drove this are not in the repository — they belong to the
verification, not to the application. They performed a real authorization
request, parsed the login form, POSTed credentials, followed the redirect, and
exchanged the code with the PKCE verifier, which is why the audience mapper and
the pinned subjects are proven rather than assumed.

## Still unverified

**Nobody has audited the screens in a browser** for layout, keyboard focus
order, narrow viewports or the dark scheme. `notes/` still has no visual QA
record, and this slice added a sign-in panel, a callback screen and a sign-out
control to a list that was already long.

**And the Kubernetes manifests have never been applied to a cluster.** They
render — `kubectl kustomize .` produces sixteen objects, the realm ConfigMap
included — and they have been read carefully. That is not the same as an API
server accepting the fields, and this repository's own notes are emphatic about
the difference: the one real failure in this project was an invented field in a
Keycloak realm that every test passed straight over.

There is no cluster on this machine. Docker Desktop's Kubernetes has never been
installed here, and installing a control plane was not a change to make unasked.
`kubectl apply -k . --dry-run=server` against any cluster is what closes it, and
it should be run before those manifests are trusted.

Specifically unseen by a human:

- **The sign-in screen and the redirect round trip.** Every part of it is
  asserted in a test and none of it has been watched happen. The API side of the
  same flow is verified above, but "the browser ends up back on the request they
  followed a link to" has only been proven at the unit level.
- **Silent refresh and an expiring session.** The timer is tested by asserting
  what it schedules, not by waiting five minutes.
- **`data-theme="dark"` as an explicit choice.** The dark scheme has only ever
  been exercised through an operating system setting.
- **The French interface**, and whether the longer French wording fits the
  buttons and table headers it now sits in — including the two new ones.
- **The header indicator** for moderation, and **the inline approve and reject
  controls** in a thread with a real reply underneath.

That was the first thing the last five handoffs would have done, and it is still
the first thing this one would do.

## What the next slice should be

**The browser audit above.** Not a feature.

Every feature in the brief is built. If you find yourself reaching for one that
is not, read [SCOPE.md](../SCOPE.md) first — it exists because the last few
handoffs kept proposing things that had already been ruled out, most recently
account deactivation, which is the tiered-ban feature under a different name and
has been refused twice.

## Where the history is

Everything is committed and **nothing is pushed**. Pushing needs
`gh auth switch --user alimzn42-del` first; see [Repository](#repository).

```
(this slice)  authentication against Keycloak
bd42484  bring the handoff up to date with where this actually stands
4a937d1  comment approval: a discovery path, and judging in the thread
7c6608f  a saved default filter never applied after the first visit
140aa28  translate the interface, and offer only translated languages
17882a8  resolve a settings screen at the level it writes
6fcf647  prove the saved board defaults reach the request, end to end
817b3fc  two levels of configuration, resolved on the server
f5002e7  filters and search, acting on a request, the taxonomy admin
```
