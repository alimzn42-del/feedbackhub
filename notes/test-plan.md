# Test plan

A hard one. Written against the code as it stands at `a470344` (slice 10,
schema 12), and aimed at what the existing suite structurally cannot see.

The 473 tests are good at what they do — route-level authorization through the
real Express app, policy rules, config guards, component states, real tokens
against the real verifier. But **none of them touches MySQL, none of them talks
to Keycloak, none of them runs in a browser, and none of them runs two things at
once.** Every row in this plan is there because at least one of those four
absences hides it. Where the existing suite already proves a thing, the row says
so and moves on.

Each row has an id, a layer (below), what to do, and what must be true. Where I
have read the code and expect a row to **fail today**, it is marked `⚠ probe`
and collected again in [§17](#17-probes-i-expect-to-fail-today) with the file
and the line of reasoning, so nobody has to rediscover it.

---

## 0. Layers, and what each one needs

| Layer | What runs | Needs | Tooling |
|---|---|---|---|
| **L0** | the existing suite: `npm test` | nothing | vitest, supertest, jsdom |
| **L1** | the API against a **real MySQL**, tokens minted by the suite's own key | `npm run up` (mysql only), `migrate`, `seed` | vitest + supertest with `DB_*` pointed at the container; the JWKS stub from `tokens.test-support.ts` stays |
| **L2** | the API against **real MySQL and real Keycloak**, tokens obtained by driving the login form | `npm run up`, the realm imported | a script that does the authorization request, POSTs the form, follows the redirect, exchanges the code with PKCE — the handoff describes one that was written and not committed; write it again and commit it under `scripts/verify/` this time |
| **L3** | the **browser**, end to end, through nginx | `docker compose up -d --build` + seed | Playwright against `http://localhost:4200`, axe-core for the accessibility rows |
| **L4** | the **cluster** | kind + ingress-nginx, `./scripts/deploy-k8s.sh` | kubectl, curl |
| **L5** | **concurrency**: many requests at once, against L1 or L2 | as L1/L2 | `Promise.all` over supertest, or autocannon; MySQL `SLEEP()` injected via a repository stub only where a window has to be widened to be observed |

A row at L1 or above is a row the current suite cannot pass or fail. That is
the whole reason for the tiering: **L0 green is the floor and says nothing
about L1–L5.**

Preconditions used below, by name:

- **Fresh** — `npm run db:reset && npm run migrate && npm run seed`. Three
  people, four categories, six statuses, no settings rows, no requests.
- **Demo** — Fresh, then `npm run demo`. Adds four people including a second
  admin (none of whom can sign in), 14 requests, votes, threads.
- **Gate up / gate down** — `comments.requireApproval` true / false, written
  through `PATCH /api/settings` as the admin, never by SQL.
- **admin / dana / sam** — the three seeded identities; `newcomer` — an account
  that exists in the realm and not in the database (create it in the Keycloak
  admin console or via the admin API, with a verified email).

---

## 1. Tokens: what a bearer has to prove

L0 already refuses: no token, non-bearer scheme, expired, malformed, wrong
audience, wrong issuer, unpublished key, unknown `kid`, no `sub`/`email`, and
answers 503 when the key set cannot be fetched. These rows go past that.

| id | layer | do | must be true |
|---|---|---|---|
| T-01 | L1 | `alg: none` with the signature segment empty | 401; log reason `token.malformed`; wire message names no check |
| T-02 | L1 | HS256 token signed with the realm's **public** key as the HMAC secret | 401 (`JOSEAlgNotAllowed` → `token.malformed`); never verifies |
| T-03 | L1 | `aud: ["feedbackhub-api", "other-client"]` (array containing ours) | 200 — jose accepts any match; assert this deliberately so a future "exact match" change is a decision |
| T-04 | L1 | `azp: feedbackhub-web` and **no** `aud` | 401 `token.audience` |
| T-05 | L1 | `exp` = now − 1s, `OIDC_CLOCK_TOLERANCE_SECONDS` unset | 401 `token.expired` |
| T-06 | L1 | same token, `OIDC_CLOCK_TOLERANCE_SECONDS=5` | 200; and `=301` refuses to **boot** (schema max 300) |
| T-07 | L1 | `nbf` = now + 60s | 401 `token.not-yet-valid` |
| T-08 | L1 | `email: "DANA@FeedbackHub.LOCAL"` on dana's `sub` | 200 as dana; nothing written (email compared lowercased) |
| T-09 | L1 | `email_verified: "true"` (string, not boolean) on a newcomer | 401 `token.unusable` — the check is `=== true`; assert that a truthy string does not provision |
| T-10 | L1 | `Authorization: bearer <token>` (lowercase), and `Bearer\t<token>` (tab) | both 200 — RFC 7235 scheme is case-insensitive; whitespace split is `\s+` |
| T-11 | L1 | `Authorization: Bearer` with nothing after it | 401 `token.missing`, not `malformed` |
| T-12 | L1 | a token whose header segment is 20 KB | 431 from Node's header limit, **not** a 500 from the app; envelope not required (never reaches Express) but the connection closes cleanly |
| T-13 | L2 | rotate the realm's RSA key in Keycloak (add a new provider with higher priority), mint a token with the new `kid` while the API's cache holds only the old one | first request 401 `token.signature` *or* 200 after jose's refetch — **record which**, and how long the cooldown is. This is the window every deploy of Keycloak hits |
| T-14 | L2 | token from the realm's **service account** (`feedbackhub-api` confidential client, client-credentials grant) | 401 `token.unusable` — no email; "there is no machine caller in this API" is a test, not a comment |
| T-15 | L2 | `GET /api/anything-that-does-not-exist` with no token | **401**, not 404 — the identity middleware runs before routing, so an unauthenticated caller cannot enumerate routes |
| T-16 | L2 | stop Keycloak with the API **warm** (has fetched keys once) | every request still 200 for the token lifetime (300s) |
| T-17 | L2 | stop Keycloak, restart the API **cold**, present a valid token | 503 `PROVIDER_UNAVAILABLE`, log `provider.unreachable`; the browser (L3) shows "unavailable" and does **not** sign out |
| T-18 | L2 | after T-17, start Keycloak, repeat with no API restart | 200 |

## 2. Provisioning, registration policy, reconciliation, leaving

L0 covers: provisioning when open, role never from the provider, email
reconciled onto the subject's row, display name not overwritten, policy
refusal, unverified never provisioned / never overwrites. These rows put a real
`UNIQUE` key and a real second sign-in under it.

| id | layer | do | must be true |
|---|---|---|---|
| P-01 | L2 | `newcomer` signs in on an open board | row created, `role='user'`, `external_id = sub`, `display_name` from `name`, else `preferred_username`, else the local part of the email |
| P-02 | L2 | `newcomer` signs in twice | one row; second sign-in resolves to the same `id` |
| P-03 | L2 | admin sets `registration.policy=domains`, `allowedDomains=["feedbackhub.local"]` in **one** PATCH; a `@example.com` newcomer signs in | authenticates at Keycloak, 403 on every `/api` route; the message names the rule and **not** the domains |
| P-04 | L2 | same policy; a newcomer at `sub.feedbackhub.local` | 403 — matching is exact, not suffix. Assert deliberately: subdomains are not admitted |
| P-05 | L2 | same policy; dana (already provisioned) signs in | 200 — the policy decides admission, never eviction |
| P-06 | L2 | tighten the policy **while** dana is signed in, then dana refreshes her token | 200 — a provisioned account is not re-checked |
| P-07 | L2 | change dana's email at Keycloak to `dana2@feedbackhub.local`, sign in | same `id`; `users.email` updated; display name untouched |
| P-08 | L2 ⚠ probe | change dana's email at Keycloak to **`sam@feedbackhub.local`** (an address another local row holds), sign in as dana | expected: a 409 naming the collision. `reconcile()` in `current-user.ts` calls `updateEmail` with no duplicate handling, so `ER_DUP_ENTRY` reaches the error middleware as an opaque **500** — see §17 |
| P-09 | L2 | delete the local row for `sam` by SQL (simulating the id-drift the README warns about), sign in as sam | 409 "already uses that email address under a different sign-in" — the `uq_users_email` branch of `provision()`; never a 500 |
| P-10 | L1 | `PATCH /api/users/:id { displayName }` for 1 char, 120 chars, 121 chars, `"   "` | 200, 200, 422 `displayName`, 422 |
| P-11 | L1 | `PATCH /api/users/:id { displayName, role: "admin" }` | 422 naming `role` — refused, not dropped (L0 has this; keep it at L1 because the L1 harness is where an accidental write would show) |
| P-12 | L1 | sam deletes his account (`DELETE /api/users/:id`), then inspect SQL | 204; `deleted_at` set, `external_id` NULL, `email = 'deleted-<id>@removed.invalid'`, `display_name = 'Deleted user'`; `user_settings` rows for sam gone; his requests, comments and votes **all still present**; `chk_users_deleted_has_no_external_id` holds |
| P-13 | L1 | after P-12, `GET /api/requests` as dana | sam's requests render with author "Deleted user"; his votes still counted |
| P-14 | L2 ⚠ probe | after P-12, reuse sam's **still-valid** access token (it has up to 300s left) for `GET /api/bootstrap` | the token verifies; `findByExternalId` finds nothing (external_id is NULL); `emailVerified` is true; `provision()` runs; the placeholder email freed the real one — so a **new account is created for the same subject**, id N+1. SCOPE says a returning person gets a new account; it does not say *the same session* should. The web app triggers exactly this itself — see E-14. Server-side fix candidates: refuse provisioning for a subject whose anonymised row is younger than the token lifetime, or have `anonymise` keep a hash of the subject to refuse it for a grace period; the honest minimum is the client signing out first |
| P-15 | L1 | admin deletes own account on **Fresh** (one admin) | 409, message says why; nothing anonymised |
| P-16 | L1 | admin deletes own account on **Demo** (second admin exists) | 204. Then note: the remaining admin has **no realm identity** and cannot sign in. Record this as a known state of a demo board; it is not a defect in the rule, it is a demo-data consequence worth a sentence in the README |
| P-17 | L1 | admin `DELETE /api/users/<dana>` | 403 "only delete your own"; nothing anonymised |
| P-18 | L2 | register a new user through Keycloak's own registration page **without** verifying the email (realm has `verifyEmail: false`, so the flag will be false), sign in | 401 `token.unusable` "has not been verified"; no row |

## 3. The authorization boundary, adversarially

L0 proves each route asks the policy and 403s in the envelope. These rows try
to get around the policy rather than through it.

| id | layer | do | must be true |
|---|---|---|---|
| A-01 | L1 | `POST /api/requests` with `authorId: <admin id>` in the body | 422 unknown field; the created row (if the test then sends a clean body) has `author_id` = caller |
| A-02 | L1 | `PATCH /api/requests/:id` as dana on sam's request, with a body that is **invalid** | 403, not 422 — permission before validation, proven with a real row |
| A-03 | L1 | `PUT /api/requests/999999/status` as dana | 403, not 404 — admin-only rules refuse before lookup; ids are not enumerable |
| A-04 | L1 | `PUT /api/requests/999999/pin` as dana / as admin | 403 / 404 |
| A-05 | L1 | `PATCH /api/users/<dana>/settings` as admin | 403; nothing written |
| A-06 | L1 | `GET /api/users/<dana>/settings` as sam | 403 |
| A-07 | L1 | `PATCH /api/users/<dana>` as admin | 403 |
| A-08 | L1 | `GET /api/categories?scope=all` as dana | 403; `GET /api/categories` still 200 |
| A-09 | L1 | `GET /api/requests?pending=true` as dana | 403 — refused, not ignored; **no** rows read (assert no repository call under a spy at L0, and at L1 assert the 403 body has no `data`) |
| A-10 | L1 | `PUT /api/comments/:id/approval` as the comment's **author** (a regular user) | 403 |
| A-11 | L1 | `PATCH /api/comments/:id` as admin on dana's comment | 403 "only the author" — the rule most likely to be "fixed" by mistake; at L1 so it is proven against a real row |
| A-12 | L1 | `PATCH /api/requests/:id` as admin on dana's request | 403 |
| A-13 | L1 | `GET /api/bootstrap` as each of admin, dana | **no** `role` key anywhere in the payload (deep search); `capabilities` differ; `settings` for dana contains none of the four admin-visibility keys |
| A-14 | L1 | `GET /api/settings` as dana | 403 |
| A-15 | L1 | `PATCH /api/settings` as dana with a valid body | 403; `app_settings` unchanged |
| A-16 | L1 | `PATCH /api/users/<self>/settings { "registration.policy": "open" }` | 422 naming the key as wrong-level; not written |
| A-17 | L1 | `PATCH /api/settings { "profile.theme": "dark" }` as admin | 422 wrong-level |
| A-18 | L1 | `DELETE /api/requests/:id/vote` — there is no route that names another user's vote; try `DELETE /api/votes/1`, `DELETE /api/requests/:id/vote?userId=2` | 404 envelope / 422 unknown parameter. "Vote for yourself only is structural" is a test, not a comment |

## 4. Requests: filing, editing, deleting, triage, and the limit

| id | layer | do | must be true |
|---|---|---|---|
| R-01 | L1 | title of 4 / 5 / 160 / 161 chars; description 19 / 20 / 5000 / 5001 | 422 / 201 / 201 / 422; 422 / 201 / 201 / 422. Each 422 has `details[]` with `field`, and **all** failing fields at once |
| R-02 | L1 | title `"     hello    "` (5 non-space chars after trim) | 201, stored trimmed |
| R-03 | L1 | description of 5000 **emoji** (4-byte) | 201; round-trips byte-identical; `excerpt` is cut at 240 **characters**, not bytes, and never splits a surrogate pair |
| R-04 | L1 | `categoryId` as `"3"` (string), `3.0`, `-1`, `"bug"` | 201 (coerced), 201, 422, 422 |
| R-05 | L1 | `categoryId` of a **retired** category | 422 `categoryId` NOT_FOUND — next to the field, not a 404 |
| R-06 | L1 | clear every `is_default` by SQL, then `POST /api/requests` | 500 `SERVER_MISCONFIGURED` with the message naming what to fix; no row inserted |
| R-07 | L1 | `PATCH` with only `{ title }` | 422 — all three fields required (the edit schema is the create schema) |
| R-08 | L1 | `PATCH` with `{ title, description, categoryId, status: 2 }` | 422 naming `status` |
| R-09 | L1 | edit → `edited_at` set; then admin pins → `edited_at` unchanged; admin changes status → unchanged; `updated_at` moved on all three | proven with SQL, not the DTO |
| R-10 | L1 ⚠ probe | file a request in "Question", admin retires "Question", author edits **only the title** sending the same `categoryId` | `findActiveId` excludes archived → 422 on `categoryId`. The author cannot correct a typo without moving the request to a category they did not choose, and the edit form cannot even show the current one. Product gap — decide, then test the decision |
| R-11 | L1 | `DELETE` as author; inspect SQL | 204, empty body; `votes` and `comments` for it gone (CASCADE); second `DELETE` → 404 |
| R-12 | L1 | `PUT /status` to the **same** status | 200; `edited_at` unchanged |
| R-13 | L1 | `PUT /status` with an archived status id (archive one by SQL — there is no route) | 422 `statusId` |
| R-14 | L1 | `submissions.perUserPerDay=1`; dana files one, then another | 201; **429** with `Retry-After` header (integer ≥ 1) and `retryAfterSeconds` in the body; `code: RATE_LIMITED` |
| R-15 | L1 | at the limit, send a body that is **also invalid** | 429, not 422 — the limit is checked before the category lookup and before validation would matter; assert the order deliberately |
| R-16 | L1 | at the limit, send a body with an invalid **category** | 429 (same reason) |
| R-17 | L1 | set the one filed request's `created_at` to `NOW() - INTERVAL 23 HOUR 59 MINUTE` by SQL | still 429, `retryAfterSeconds` ≈ 60 |
| R-18 | L1 | set it to `NOW() - INTERVAL 24 HOUR 1 MINUTE` | 201 — the window is rolling |
| R-19 | L1 | admin raises the limit to 2 with the API **running** | dana's next post is 201 — read on every submission, no restart |
| R-20 | L1 | a 422 body (title too short) sent 50 times under `limit=1` | never 429 — validation failures do not consume quota (they never reach the service) |
| R-21 | L1 | a `DELETE`d request then re-filed: does the deleted one count toward the limit? | it does not exist, so no. Assert: file, delete, file → 201 under `limit=1` |
| R-22 | L1 | skew: set the MySQL container clock 10 minutes ahead of the API (`date` inside the container, or `SET TIMESTAMP` on the session) | `retryAfterSeconds` is computed from `oldestInWindow` (DB time) minus `Date.now()` (API time). Record the drift in the answer; decide whether the API should ask the DB for `NOW()` |

## 5. The board: paging, filtering, searching, sorting, the shelf

L0 proves the query schema and that the service passes the right filters to a
stubbed repository. **The SQL has never run.** Every row here is against real
rows.

| id | layer | do | must be true |
|---|---|---|---|
| B-01 | L1 | Demo; `?page=1&pageSize=5` through `?page=3` | rows disjoint; union is every unpinned request; `page.total` constant; `totalPages = ceil(total/5)` |
| B-02 | L1 | `?page=<totalPages+1>` | 200, `data: []`, `page.total` still correct — the past-the-end second `COUNT(*)` path |
| B-03 | L1 | `?page=0`, `?page=-1`, `?page=1.5`, `?page=abc`, `?pageSize=0`, `?pageSize=101` | all 422 with the field named; `?pageSize=100` is 200 |
| B-04 | L1 | `?page=2.0` | 200 (Number("2.0") is an integer) — assert so it is a decision |
| B-05 | L1 | seed 30 requests in the **same millisecond** (a multi-row INSERT), sort `newest`, page through at `pageSize=7` | no duplicates, no gaps — the `id DESC` tiebreak is real |
| B-06 | L1 | the same at `sort=votes` with all rows on 0 votes | same |
| B-07 | L1 | `sort=votes`; while paging, another user votes on a page-3 row that moves it to page 1 | a duplicate or a gap **may** appear. Record it; DECISIONS accepts this. The test documents the accepted behaviour rather than asserting stability |
| B-08 | L1 | `?q=100%` where one title contains `100%` and another `100 percent` | only the first matches — `%` escaped |
| B-09 | L1 | `?q=a_b` vs titles `a_b` and `aXb` | only `a_b` |
| B-10 | L1 | `?q=\` (a single backslash, URL-encoded), `?q='; DROP TABLE users; --` | 422 (1 char) / 200 with zero or literal matches; `users` still exists |
| B-11 | L1 | `?q=` 100 chars / 101 chars; `?q=%20%20ab%20%20` | 200 / 422 / 200 searching `ab` |
| B-12 | L1 | `?q=Élan` against a title `elan` | collation is `ai_ci`: **matches**. Assert so the behaviour is written down |
| B-13 | L1 | `?q=` an emoji that appears in one description | matches |
| B-14 | L1 | `?status=planned,done&category=bug` on Demo | every row is (planned OR done) AND bug; `total` agrees with a hand `COUNT` |
| B-15 | L1 | `?status=planned&status=planned,done` | same result as `planned,done`; slug asked once (dedup) |
| B-16 | L1 | `?status=Planned` (capital) | 200 — lowercased in preprocess |
| B-17 | L1 | `?status=planed` | 422, `details[0].message` names `"planed"`; `?status=planed,dun` names both |
| B-18 | L1 | retire "Question" (has requests); `?category=question` | 200 with those requests — slug resolution includes archived; `GET /api/categories` no longer offers it |
| B-19 | L1 | `?mine=true` as dana | only dana's; `?mine=TRUE`, `?mine=yes` → 422; `?mine=1` → 200; `?mine=` → treated as absent |
| B-20 | L1 | `?authorId=1`, `?author=1`, `?category[]=bug` | 422 unknown parameter, every one |
| B-21 | L1 | 21 comma-separated status slugs | 422 (max 20) |
| B-22 | L1 | `?sort=votes&sort=newest` | 422 (array to an enum) |
| B-23 | L1 | Demo, unfiltered: pinned rows absent from `data` **and** not in `total`; `GET /api/requests/pinned` holds exactly them, ordered `pinned_at DESC` | proven against SQL |
| B-24 | L1 | `?sort=oldest` with no filter | list oldest-first; shelf (`/pinned?sort=oldest`) oldest-first too; `?sort=newest` explicitly → shelf **stays in pin order** (equal to default counts as "not asked") |
| B-25 | L1 | `?category=bug` where one pinned request is a bug and another is not | the bug one is in `data`, **first**, `isPinned: true`, and in `total`; the other is absent |
| B-26 | L1 | `GET /api/requests/pinned?category=bug` | 422 unknown parameter |
| B-27 | L1 | pin **101** requests | `/pinned` returns 100, reports `total: 101`; L3 panel says it is not showing everything |
| B-28 | L1 | `commentCount` on every row vs the thread's visible count, for admin / author / other, gate up and gate down (2×3 = 6 readings) | equal in all six — the one-fragment rule proven, not trusted |
| B-29 | L1 | `excerptTruncated` true only when description > 240 chars; `excerpt` never contains a trailing partial multi-byte char | SQL-level |

## 6. Votes

| id | layer | do | must be true |
|---|---|---|---|
| V-01 | L1 | dana votes on sam's request; again | 200 `voteCount 1, hasVoted true`; 409 |
| V-02 | L1 | dana withdraws; again | 200 `hasVoted false`; 200 (idempotent) |
| V-03 | L1 | sam votes on his own | 403; no row |
| V-04 | L1 | vote on a request deleted a moment ago | 404 |
| V-05 | L5 | **50 users** vote on one request at once | `voteCount 50`; 50 rows |
| V-06 | L5 | dana sends 10 votes on one request at once | exactly **one** 200 and nine 409s; one row — `INSERT IGNORE` under the PK, with `affectedRows` deciding |
| V-07 | L5 | dana sends 5 votes and 5 withdrawals interleaved | ends consistent: the row either exists or not, and `hasVoted` in the last response matches SQL |
| V-08 | L1 | delete a vote row by SQL | next read shows the count down by one — derived, never cached |
| V-09 | L1 | anonymise a voter | their vote still counted |
| V-10 | L3 | vote on the board: count moves before the response; server refuses (make the request author by SQL between load and click) → rolls back and explains; a vote cast in **another tab** → the first tab shows the server's number, not its guess + 1 | Playwright with a paused route |

## 7. Pinning

| id | layer | do | must be true |
|---|---|---|---|
| N-01 | L1 | admin pins; SQL shows `pinned_at`, `pinned_by = admin`; DTO shows `pinnedBy.displayName` | proven both sides |
| N-02 | L1 | admin re-pins after 2s | `pinned_at` moved; not a 409; shelf order changes accordingly |
| N-03 | L1 | unpin | both columns NULL |
| N-04 | L1 | set `pinned_by = NULL` by SQL on a pinned row (the pre-migration case) | list row `pinnedBy: null`, `isPinned: true`; L3 panel does not invent an actor |
| N-05 | L1 | admin A pins, admin A is anonymised (needs Demo) | `pinnedBy.displayName` is "Deleted user"; FK RESTRICT never fires (it is an UPDATE) |
| N-06 | L3 | pin from the detail page: the row is disabled during the call; both collections refetch; no optimistic move | the request appears in the shelf and leaves the list only after the response |

## 8. Comments: threads, the deletion matrix, and the gate

L0 proves the matrix against a stubbed repository and the DTO shape. These rows
prove it against the `comments` table's own cascade and against real
visibility SQL.

| id | layer | do | must be true |
|---|---|---|---|
| C-01 | L1 | body `""`, `"   "`, 1 char, 5000, 5001 | 422 / 422 / 201 / 201 / 422 |
| C-02 | L1 | body `"<script>alert(1)</script>"` | stored verbatim; L3 renders it as text (`pre-wrap`), never executes |
| C-03 | L1 | `parentId` on a comment of a **different** request | 422 `parentId` NOT_FOUND |
| C-04 | L1 | reply to a reply | 422 TOO_DEEP |
| C-05 | L1 | reply to a removed comment | 422 GONE |
| C-06 | L1 | `parentId: "abc"`, `0`, `-1` | 422 each |
| C-07 | L1 | **author, no replies**: delete | 204; row **gone** from SQL |
| C-08 | L1 | **author, with a reply**: delete | row kept, `deleted_at`, `deleted_by = author`; reply `deleted_at` set, `hidden_with_parent = 1`; thread shows tombstone `deletedReason: 'author'` and reply `'with-parent'` |
| C-09 | L1 | **admin, no replies**, somebody else's | soft; `deletedReason: 'moderator'`; body and author `null` on the wire |
| C-10 | L1 | **admin, with replies** | as C-08 with `deleted_by = admin`; replies `'with-parent'` |
| C-11 | L1 | admin deletes **their own** reply-less comment | hard — acting as author |
| C-12 | L1 | dana's comment gets a reply from sam; sam hard-deletes his reply (author, no replies); dana deletes her comment | hard (reply count 0 — the hidden-reply rule counts **rows**, and that row is gone) |
| C-13 | L1 | dana's comment gets a reply from sam; **admin** hides sam's reply; dana deletes her comment | **soft** — the hidden reply still counts, so the moderation record survives |
| C-14 | L1 | delete an already-removed comment; edit a removed one; admin edits dana's | 403 / 403 / 403 |
| C-15 | L1 | `chk_comments_deletion`: try `UPDATE comments SET deleted_at = NOW()` alone by SQL | the CHECK refuses — the trail cannot be half-written |
| C-16 | L1 | delete the **request** | every comment row gone (CASCADE), including hidden ones — the trail goes with the request, by decision; assert it so it is one |
| C-17 | L1 | **gate up**: dana comments on sam's request | 201, `isPending: true`; `approved_at` NULL |
| C-18 | L1 | gate up: thread as dana / sam / admin | dana sees it (`isPending`), sam does not, admin sees it with `canApprove: true`; `awaitsApproval: true` for everybody |
| C-19 | L1 | gate up: `commentCount` on the list row for dana / sam / admin | 1 / 0 / 1 |
| C-20 | L1 | gate up: `GET /api/bootstrap` as admin / dana | `pendingComments: 1` / key **absent** |
| C-21 | L1 | admin approves; approves again; dana approves; approve a removed one | 200 / 409 / 403 / 409 |
| C-22 | L1 | after approval, bootstrap count | 0 → key present with 0? **No**: the count is sent while the gate is up regardless of value; assert `pendingComments: 0` here, and absence only when the gate is down or the reader is not an admin |
| C-23 | L1 | admin **rejects** (DELETE) the waiting comment | soft, `deletedReason: 'moderator'`; dana's thread shows "an admin removed this"; count falls |
| C-24 | L1 | gate up, comment waiting; admin turns the gate **down** | sam now sees it; `commentCount` for sam is 1 |
| C-25 | L1 ⚠ probe | after C-24 (gate down, comment released but `approved_at` still NULL): the thread as admin | `isPending: true` and `canApprove: true` on a comment everybody can read — the DTO derives both from `approved_at IS NULL`, not from the gate. L3 would show a "waiting" badge and an Approve button on a published comment |
| C-26 | L1 ⚠ probe | after C-24, turn the gate **up again** | the released comment is **hidden again** from sam — it was never stamped. DECISIONS: "turning it on affects comments written from then on and nothing already on screen". This violates that on the second toggle |
| C-27 | L1 ⚠ probe | gate down after a moderated spell; `GET /api/requests?pending=true` as admin | requests carrying never-stamped comments are listed as "waiting" while nothing is waiting. Same root cause as C-25/26 |
| C-28 | L1 | gate up; a comment by the **admin** | `approved_at` NULL too — admins are not exempt from their own gate; `isPending: true` on their own comment, `canApprove: true`. Decide whether that is intended; today it is what the code does |
| C-29 | L1 | gate up; dana comments, then dana's account is anonymised | the comment stays pending, author "Deleted user"; admin can still approve or reject it |
| C-30 | L3 | the thread says a comment will wait **before** the box is used; the posted comment stays on screen marked waiting; the header count links to `/requests?pending=true`; approving in the thread makes the count fall with no reload | Playwright, two browser contexts (admin + dana) |

## 9. Taxonomy administration

| id | layer | do | must be true |
|---|---|---|---|
| X-01 | L1 | create `{ name: "Bug", slug: "bug" }` again; `{ name: "bug", slug: "bug2" }` | 422 `name`; **422 `name`** — collation `ai_ci` makes "Bug"/"bug" the same key. Assert; it is the correct behaviour and easy to lose with a collation change |
| X-02 | L1 | create `{ name: "Bugs ", slug: " Bugs-2 " }` | 201; slug stored `bugs-2` (trimmed, lowercased); name trimmed |
| X-03 | L1 | slug `"in--progress"`, `"-x"`, `"x-"`, `"é"`, 61 chars; name 61 chars | 422 each, before the database sees it |
| X-04 | L1 | `PATCH /:id { name, slug }` | 422 naming `slug` |
| X-05 | L1 | `PUT /order` omitting one id; duplicating; including 999999; empty | 422 / 422 / 422 / 422; `sort_order` unchanged |
| X-06 | L1 | retire "Question", then `PUT /categories/order` with the **active** ids only | **422 `INCOMPLETE`** — `allIds()` in `categories.repository.ts:161` reads every row, archived included, so a retired category keeps its place in the order and the admin screen (which shows retired rows rather than hiding them) must send it. Assert both halves: active-only is refused; the full set including the archived id is accepted |
| X-07 | L1 | `PUT /categories/order` with the correct set, reversed | `sort_order` = index; `GET /api/categories` returns in that order; L3 create form offers them in that order |
| X-08 | L1 | archive "Question" with 3 requests | 200; `archived_at` set; the 3 requests still carry it and still render its name; `GET /api/categories` omits it; `?scope=all` shows it with `requestCount: 3` |
| X-09 | L1 | restore; archive twice; restore twice | 200; idempotent 200s (or 409 — assert which and keep it) |
| X-10 | L1 | `PUT /api/statuses/:id/archive` | 404 envelope — there is no such route |
| X-11 | L1 | `PUT /statuses/:id/default` for each status in turn; after each, `SELECT COUNT(*) FROM statuses WHERE is_default = 1` | always exactly 1 |
| X-12 | L5 | 20 concurrent `PUT /default` on different statuses | after all settle, exactly one default; every response 200; no 500 from the unique key — the clear-then-set transaction holds under contention |
| X-13 | L1 | migrate a **fresh** schema with **no seed**; `POST /api/statuses` | first status is the default; second is not |
| X-14 | L1 | `DELETE /api/categories/:id`, `DELETE /api/statuses/:id` | 404 — nothing deletes a taxonomy row |
| X-15 | L1 | rename "Bug" to "Defect"; a shared link `?category=bug` | still resolves; the chip shows "Defect" |
| X-16 | L3 | reorder with the keyboard only (Tab to the row's buttons, Enter); rename inline; retire with the confirmation; a duplicate name lands **against the field of the right table** | Playwright, admin |

## 10. Settings: resolution, writes, and the two screens

L0 covers resolution with stubbed stores, the wrong-level refusal, the domains
pairing, null-as-reset, and the "resolve at the level you write" rule. These
put JSON rows in a real table.

| id | layer | do | must be true |
|---|---|---|---|
| S-01 | L1 | Fresh; `GET /api/bootstrap` | every setting `source: 'default'`; `app_settings` and `user_settings` empty |
| S-02 | L1 | admin `PATCH /api/settings { "board.defaultSort": "votes" }`; bootstrap as dana | `source: 'global'`, `value: 'votes'` |
| S-03 | L1 | dana `PATCH /users/<dana>/settings { "board.defaultSort": "newest" }` (equal to the built-in default) | `source: 'user'` — an explicit choice that happens to match is still a choice |
| S-04 | L1 | dana resets with `null` | row **deleted**; `source: 'global'` again |
| S-05 | L1 | `PATCH /api/settings { "board.defaultSort": null }` on a key with no row | 200, still no row (reset of nothing is not an error) |
| S-06 | L1 | write `'{"bad": true}'` into `app_settings` for `board.defaultSort` by SQL | bootstrap serves the **default**, `source: 'default'`; nothing throws |
| S-07 | L1 | `PATCH /api/settings { "submissions.perUserPerDay": 0 }`, `1001`, `"5"`, `5.5` | 422 / 422 / **422** / 422 — the registry schema is `z.number().int()` with no coercion, so a numeric string is refused. Assert it; the L3 number control must therefore send a number, not the input's string value |
| S-08 | L1 | `{ "registration.allowedDomains": ["Example.COM", " a.b "] }` | stored `["example.com", "a.b"]` |
| S-09 | L1 | `{ "registration.allowedDomains": ["-bad-", "no", "toolong…(254)"] }` | 422 with one `details` entry per bad element, naming the index |
| S-10 | L1 | policy is `domains` with domains stored; `PATCH { "registration.allowedDomains": null }` alone | **422 `REQUIRED`** on `registration.allowedDomains` — `validate()` folds a reset into the after-state as the registry fallback (`[]`) and `assertRegistrationIsCoherent` runs over that, so emptiness by reset is caught the same as emptiness by value. Also: `PATCH { "registration.policy": null }` alone while domains are stored → 200 (open needs no domains) |
| S-11 | L1 | `PATCH { "board.defaultCategories": ["question"] }` after "question" is archived; and the reverse — store it first, **then** archive | **422** on the write (`assertDefaultFiltersExist` uses `listActive`); but a default stored **before** the retirement survives it and still applies on arrival, because the board's slug resolution includes archived rows (B-18). The write is stricter than the read on purpose; assert both so the asymmetry is a decision |
| S-12 | L1 | `PATCH` with 21 slugs | 422 |
| S-13 | L1 | `PATCH {}` | 422 "name at least one setting" |
| S-14 | L1 | `PATCH { "not.a.setting": 1 }` | 422 naming the key |
| S-15 | L5 | two admins PATCH **different** keys at the same instant | both land — set semantics, not document semantics |
| S-16 | L5 | two admins PATCH the **same** key with different values | one wins; `updated_by` names the winner; no 500 |
| S-17 | L1 | admin has a personal `board.defaultSort = oldest`; `GET /api/settings` | `board.defaultSort.source` is `default` or `global`, **never** `user` |
| S-18 | L1 | `GET /api/users/<self>/settings` as dana with `profile.language = fr` | labels and descriptions in French, including for `both`-scope keys; as admin with `fr`, `GET /api/settings` labels in French |
| S-19 | L1 | anonymise an admin who wrote `app_settings.updated_by` | row survives; FK RESTRICT never fires |
| S-20 | L3 | `/admin/settings` shows "Set for everybody" wording; `/account` shows "Your choice" / "Following the board default"; the account reset goes back to the **board** value, not the built-in | Playwright |

## 11. Bootstrap, language, theme

| id | layer | do | must be true |
|---|---|---|---|
| I-01 | L1 | `GET /api/bootstrap` payload keys | exactly `user, capabilities, settings, taxonomy` (+ `pendingComments` only for an admin with the gate up); `settings` keys are exactly the `firstPaint: true` ones the caller may read |
| I-02 | L1 | `taxonomy.categories` excludes archived; `taxonomy.statuses` in `sort_order` | SQL-level |
| I-03 | L3 | kill the API, load the app | error with a retry; **no board drawn on defaults**; start the API, press retry → board |
| I-04 | L3 | set `fr` on `/account` | the navigation, the board, the filter bar, empty states, the dialog and the settings labels re-render in French **without a reload**; `<html lang="fr">`; dates in French; the sign-in screen remains English |
| I-05 | L3 | a request titled in English on a French board | title untouched |
| I-06 | L3 | an API 422 on a French screen | the server sentence is English, rendered next to the field — the documented seam |
| I-07 | L3 | theme `dark` → `data-theme` (or equivalent) on `<html>` and `color-scheme: dark`; `system` → attribute **removed**; OS dark + `system` → dark | Playwright `emulateMedia` |
| I-08 | L3 | French strings in the narrowest control they sit in (the filter bar select, the reorder buttons, the dialog buttons) at 360 px | nothing clipped or overflowing; this is the standing debt from every handoff |

## 12. The HTTP contract

| id | layer | do | must be true |
|---|---|---|---|
| H-01 | L1 | `POST /api/requests` with body `{"title": ` (truncated JSON) | **400** `BAD_REQUEST`, envelope, `requestId` present and equal to `X-Request-Id` |
| H-02 | L1 ⚠ probe | body of 300 KB valid JSON | expected **413** in the envelope. `express.json({limit})` raises a `PayloadTooLargeError` (`type: 'entity.too.large'`), which is not a `SyntaxError` and not an `AppError` → the middleware's unknown-error branch → **500 `INTERNAL`** |
| H-03 | L1 | `Content-Type: text/plain` with a JSON body | 422 "title required" (the parser skipped it). Acceptable; assert it, or map to 415 and assert that |
| H-04 | L1 | `X-Request-Id: <128 chars>` / `<129 chars>` | echoed / replaced with a UUID |
| H-05 | L1 | `X-Request-Id` containing a control character (`\x01`), a tab, `é` as UTF-8 bytes | Node's parser answers a bare **400** for the control character before Express sees it (verified on Node 24: `\x01` → 400, tab and both spellings of `é` → echoed). So: 400 with no envelope for control chars — acceptable, assert it; the others are echoed back unchanged and land in the log line verbatim. Decide whether a log-line id should be restricted to `[A-Za-z0-9-]` — today it is not |
| H-06 | L1 | trigger a real unknown error (e.g. drop the `votes` table, then vote) | 500 `INTERNAL`, message generic, `requestId` present; the log line has the stack; the wire has **no** SQL text |
| H-07 | L1 | `GET /api/requests/abc`, `/api/requests/1.5`, `/api/requests/-1`, `/api/requests/99999999999999999999` | 422 each, field `id` |
| H-08 | L1 | `GET /api/requests/pinned/` (trailing slash), `/api/requests/pinned?sort=` | 200 / 200 (empty sort absent) — and `pinned` is never read as an id |
| H-09 | L1 | `OPTIONS /api/requests` with `Origin: http://evil.example` | no `Access-Control-Allow-Origin`; with `Origin: <WEB_ORIGIN>` → allowed. Through nginx (L3) the origin is the same, so CORS never appears at all — assert **no** ACAO header on same-origin |
| H-10 | L1 | every response | helmet's headers present (`X-Content-Type-Options`, `X-Frame-Options`/CSP frame-ancestors, no `X-Powered-By`) |
| H-11 | L1 | `HEAD /health`, `GET /health` with a garbage token | 200, unauthenticated |
| H-12 | L1 | 429 response | `Retry-After` is an **integer** string; body `retryAfterSeconds` equals it |
| H-13 | L1 | every 4xx/5xx | one shape: `{ error: { code, message, details?, requestId } }`; `details` only on 422; no other top-level key ever |
| H-14 | L1 | SIGTERM the API with a request in flight (a repository stub that sleeps 2s) | the in-flight request completes 200; the process exits 0 within `terminationGracePeriodSeconds`; the pool closes |

## 13. The session, in a real browser

L0 proves the state machine with stubbed HTTP. These rows drive Keycloak.

| id | layer | do | must be true |
|---|---|---|---|
| E-01 | L3 | press Sign in | redirected to the realm's authorization endpoint with `code_challenge`, `code_challenge_method=S256`, `state`, and **no** `code_verifier` in the URL; `scope` includes `openid email profile` |
| E-02 | L3 | open `/requests/7` signed out, sign in | lands on `/requests/7` |
| E-03 | L3 | press Cancel on the Keycloak form | back on the app, signed out, **no** "could not be completed" message |
| E-04 | L3 | after a successful sign-in, press the browser **Back** button onto `/auth/callback?code=…` | no second exchange (network shows one `token` POST); no error banner; still signed in |
| E-05 | L3 | tamper `state` in the callback URL | "could not be completed"; signed out; no token request |
| E-06 | L3 | reload the page | still signed in; one `refresh_token` grant in the network log; the access token **never** appears in `sessionStorage` or `localStorage`; the refresh token is in `sessionStorage` only |
| E-07 | L3 | open a **new tab** to the app | redirects to Keycloak and returns **without** a password prompt (SSO session); the new tab has its own refresh token |
| E-08 | L3 | **duplicate** the tab (Chrome copies `sessionStorage`) and let both sit past the refresh point | both refresh with the same token. If the realm's *Revoke Refresh Token* is on, the second fails and one tab signs out — check the realm setting and assert the observed behaviour |
| E-09 | L3 | wait ~240 s with the tab open | a `refresh_token` grant fires at `expires_in − 60`; no request ever 401s first |
| E-10 | L3 | wait > 30 min idle (`ssoSessionIdleTimeout: 1800`) | the next refresh fails; the app shows signed-out **gracefully**, no error dialogs, no stuck spinner |
| E-11 | L3 | admin console → Sessions → sign out dana everywhere; dana's tab makes a request | 401 → interceptor expires the session → sign-in offered; the failed request's page state is not lost silently (check what a half-typed comment does) |
| E-12 | L3 | Sign out | redirected through Keycloak's end-session; signing in again **asks for the password**; `sessionStorage` empty |
| E-13 | L3 | T-17 from the browser: Keycloak down, API cold | "identity provider could not be reached" state, retry button; **not** the sign-in screen; when Keycloak returns, retry works with no reload |
| E-14 | L3 ⚠ probe | delete own account from `/account` (as sam), then watch the network and `SELECT * FROM users` | after the 204 the app must end the session at Keycloak before any further `/api` request is made. **It does not**: [account.ts:159](../web/src/app/features/settings/account/account.ts#L159) calls `config.reload()`, which refetches `GET /api/bootstrap` with sam's still-valid token; P-14 then runs on the server — `external_id` no longer matches, the address was freed by the placeholder, `email_verified` is true — and a **new account is provisioned for the person who just deleted theirs**. Sam presses Delete and lands on the board still signed in, as a fresh id, named from the token. Expected instead: `session.signOut()` (end-session at Keycloak), no `/api` call after the 204, next page is Keycloak's; `users` has one sam row, anonymised |
| E-15 | L3 | the bearer interceptor | `Authorization` on `/api/*` only; **absent** on `/api/auth/config`, on the discovery document, and on the token endpoint |
| E-16 | L3 | the sign-in screen | no `<form>`, no `input[type=password]` (L0 has this; keep it at L3 against the built bundle) |
| E-17 | L3 | `redirect_uri` for the compose stack vs the realm's `redirectUris` | matches exactly; on the kind cluster (`http://feedbackhub.local/auth/callback`) too — a mismatch is Keycloak's "Invalid parameter: redirect_uri" page, which no test sees |

## 14. The data layer, on its own

| id | layer | do | must be true |
|---|---|---|---|
| D-01 | L1 | `migrate` 0→12, `migrate:down` ×12 to 0, up to 12 again | every `.undo` runs; the schema is byte-comparable (`SHOW CREATE TABLE` diff) to a fresh 0→12 |
| D-02 | L1 | edit one character in `005.do.votes.sql` after it has run, run `migrate` | postgrator refuses on checksum; nothing applied |
| D-03 | L1 | `seed` twice | row counts unchanged; `ON DUPLICATE KEY UPDATE` restores a renamed seed category's name — assert that consequence deliberately |
| D-04 | L1 | `demo` twice | same counts; users/categories/statuses untouched; content replaced |
| D-05 | L1 | `DELETE FROM users WHERE id = 2` by SQL with content present | refused (RESTRICT) from `feedback_requests`, `comments`, `votes`, `app_settings.updated_by`, `feedback_requests.pinned_by` — each in turn |
| D-06 | L1 | `INSERT` a second `is_default = 1` status | refused by the generated-column unique key |
| D-07 | L1 | `INSERT INTO users (…, external_id, deleted_at)` with both set | refused by `chk_users_deleted_has_no_external_id` |
| D-08 | L1 | `INSERT INTO comments (parent_id = <comment on request 1>, request_id = 2)` | refused by the composite FK — a reply cannot cross requests, even by SQL |
| D-09 | L1 | store `created_at` for a request, read it through the API | ISO-8601 ending in `Z`; equal to the SQL value interpreted as UTC (`--default-time-zone=+00:00` in both compose and `k8s/20-mysql.yaml:61`) |
| D-10 | L1 | run the API against MySQL with **no** `--default-time-zone` (a plain `mysql:8.4.6`) on a host at UTC+3 | the rate-limit window and `pinned_at` ordering are off by three hours. This is what the flag prevents; the test documents that the flag is load-bearing |
| D-11 | L1 | `EXPLAIN` the default list (`newest`) and `?status=planned` | `idx_requests_recent` / `idx_requests_status` used; `sort=votes` is a filesort (accepted, documented) |
| D-12 | L1 | 20 000 requests (generated), `?sort=votes&page=1` and `?q=zz` | response times recorded, not asserted — the DECISIONS "thousands, not millions" claim gets a number next to it |

## 15. Deployment artefacts

| id | layer | do | must be true |
|---|---|---|---|
| K-01 | L3 | `docker run --rm feedbackhub-api:local find / -name "*.test-support.*" -o -name "*.test.*"` | nothing — the token-minting code is absent from the image, not guarded |
| K-02 | L3 | `docker run --rm feedbackhub-api:local id -u` / web image | `1000` / `101` |
| K-03 | L3 | `docker run --read-only feedbackhub-api:local node dist/main.js` (with DB env) | starts; `--read-only` with `scripts/migrate.mjs up` and `seed.mjs` also succeed |
| K-04 | L3 | build an API image with `IDENTITY_MODE = 'development-seam'`, run it with `NODE_ENV=production` | refuses to start with the named message; exit ≠ 0 |
| K-05 | L3 | `docker compose up -d --build` from nothing | order: mysql healthy → migrate exit 0 → keycloak healthy → api healthy → web up; `docker ps` shows **no** host port on api |
| K-06 | L3 | `docker compose down && up` (no `-v`) | data intact; the realm is **re-imported** and its signing keys are new — a token from before is now 401 `token.signature` and the browser signs out. Documented; assert it so the doc stays true. `stop`/`start` keeps the keys |
| K-07 | L3 | `curl -i localhost:4200/auth/callback`, `/requests/42`, `/nope` | `index.html`, `Cache-Control: no-store`; `/main.*.js` → `immutable`; `/health` → nginx's own JSON; `/api/health` → the API's 401 (identity first) |
| K-08 | L3 | `curl localhost:4200/api/requests` with a 2 MB body | nginx's default `client_max_body_size` (1 MB) answers **413 with an HTML page**, not the API's envelope. Decide: raise nginx to ≥ 256 KB and let the API answer, or accept and make the client handle non-JSON 413 |
| K-09 | L3 | response headers through nginx | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, no `Server` version; `X-Request-Id` passes through; gzip on JSON > 1 KB |
| K-10 | L3 | `docker compose run --rm migrate node scripts/seed.mjs` twice | idempotent |
| K-11 | L4 | `kubectl kustomize . \| kubeconform` (or `kubectl apply -k . --dry-run=server`) | valid; the realm ConfigMap is generated from `keycloak/realm-feedbackhub-development.json`, and `kubectl get cm` shows it matches the file byte-for-byte |
| K-12 | L4 | `git grep -n "stringData\|password:" k8s/` | only `11-secret.example.yaml`; `kubectl get secret feedbackhub-secrets` exists only after the script |
| K-13 | L4 | `git grep -nE ":latest|node:24[^.]|mysql:8\.4[^.]"` | nothing floating |
| K-14 | L4 | fresh cluster, `./scripts/deploy-k8s.sh` | API pods sit in `Init:0/1` until the Job completes, then Ready; `kubectl logs -c wait-for-schema` shows "schema at 12; this image expects 12" |
| K-15 | L4 | add a `013.do.noop.sql` migration, build a new API image, `kubectl set image` **without** re-running the Job | new pods stuck in Init; **old pods keep serving** (`maxUnavailable: 0`); rollout does not complete; `kubectl rollout undo` recovers |
| K-16 | L4 | then run the Job with the new image | schema 13; the new pods start |
| K-17 | L4 | `kubectl drain` the node holding both API pods (single-node kind: use `kubectl delete pod` on both at once instead) | PDB `minAvailable: 1` refuses the drain; a double delete still leaves service available after reschedule |
| K-18 | L4 | `kubectl delete pod -l app.kubernetes.io/name=keycloak` | Keycloak comes back with **new signing keys** (in-container DB); every signed-in browser gets 401 → signed out; the API recovers on its next JWKS refetch (T-13). Record the outage window. This is the strongest argument in the repo for an external Keycloak DB, and it deserves a measured number |
| K-19 | L4 | `kubectl delete pod -l app.kubernetes.io/name=mysql` | data intact after restart (PVC); API pods go **not** unready (health is process-only) but requests 500 during the gap — record the window; `INTERNAL` envelope, no stack on the wire |
| K-20 | L4 | `kubectl exec` into a web pod: `touch /usr/share/nginx/html/x` | refused (read-only root FS); nginx has written its rendered config to `/etc/nginx/conf.d` (emptyDir) with `feedbackhub-api:3000` substituted |
| K-21 | L4 | the issuer | `curl http://auth.feedbackhub.local/realms/feedbackhub/.well-known/openid-configuration` → `issuer` equals the ConfigMap's `OIDC_ISSUER_URL` **exactly** (scheme, host, no trailing slash); a token's `iss` equals both |
| K-22 | L4 | `curl http://feedbackhub.local/api/requests` and `curl <api pod ip>:3000` from outside the cluster | the first proxies (401); the second is unreachable — no Ingress, no NodePort |
| K-23 | L4 | two API replicas: sign in, then `kubectl delete pod` one API pod mid-session | no user-visible failure; the surviving pod has its own JWKS cache |
| K-24 | L4 | API memory: `NODE_OPTIONS=--max-old-space-size=384` vs `limits.memory: 512Mi` | the heap cap is below the cgroup cap (assert by reading both — a drift here is an OOM kill that looks like a crash) |

## 16. Concurrency and race probes — the "hard" list

Each of these is a window between a read and a write that the code makes
without a lock or a transaction. Widen the window with a repository stub that
awaits a promise the test controls (or `SELECT SLEEP(1)` injected at L1), fire
two callers, release, and read the table.

| id | layer | window | do | must be true | prediction |
|---|---|---|---|---|---|
| Z-01 | L5 ⚠ probe | `users.service.ts deleteAccount`: `countOtherAdmins` → `anonymise`, no transaction, no lock | Demo (two admins); both delete themselves at the same instant | at least one 409; **≥ 1 admin remains** | both read "one other admin", both proceed → **zero admins**. The exact dead end the 409 exists to prevent. Fix: `SELECT … FOR UPDATE` on the admin rows inside the anonymise transaction, then re-count |
| Z-02 | L5 ⚠ probe | `requests.service.ts assertNotRateLimited`: count → insert | `limit=1`; dana sends 10 `POST /api/requests` at once | at most 1 × 201, 9 × 429 | all ten see `filed: 0` → **ten rows**. DECISIONS chose service-level enforcement knowingly, but not this consequence; either accept over-by-N in writing or serialise per author (`SELECT … FOR UPDATE` on the author row, or a unique `(author_id, minute_bucket)` guard) |
| Z-03 | L5 ⚠ probe | `comments.service.ts remove`: `countReplies` → `hardDelete` | dana deletes her reply-less comment while sam's reply to it is being inserted | either the reply is refused (parent gone → 422 GONE) or the delete becomes soft | count sees 0 → hard delete → `fk_comments_parent … ON DELETE CASCADE` **destroys sam's just-inserted reply**; or sam's insert lands after the delete → FK violation → opaque **500**. Two different bugs from one window |
| Z-04 | L5 ⚠ probe | `comments.service.ts create`: parent checks → insert | sam replies while an admin hides the parent | 422 GONE or the reply arrives already `hidden_with_parent`? | the reply is inserted **visible** under a hidden parent (soft delete of replies ran before the insert). Thread shows a live reply hanging from a tombstone; `softDeleteReplies` never revisits |
| Z-05 | L5 | `comments.repository.ts approve`: single conditional `UPDATE` | two admins approve one comment at once | exactly one 200, one 409 | holds — `affectedRows` decides. Assert it so it stays atomic |
| Z-06 | L5 | votes | V-05..V-07 | see §6 | holds — PK + `INSERT IGNORE` |
| Z-07 | L5 | statuses default swap | X-12 | exactly one default | holds — transaction |
| Z-08 | L5 | `taxonomy.service.ts` reorder: read set → validate → write, vs a concurrent create | admin A reorders while admin B creates "Docs" | "Docs" lands **last**; no two rows share a `sort_order` | expected to hold: the insert takes `MAX(sort_order) + 1` (`categories.repository.ts:125`) and the reorder writes `0..n-1`, so the newcomer sits above the range either way. There is no unique key on `sort_order` (the repository says so), so this is the test that would notice if a future change broke that arithmetic; ties fall back to `name` |
| Z-09 | L5 ⚠ probe | provisioning: `findByExternalId` miss → `insert` | `newcomer`'s first two requests race (the browser fires bootstrap and the discovery-driven refresh nearly together on first sign-in) | one row; the loser gets the same actor | second insert hits `uq_users_email` → the `ConflictError` branch fires → **409 "under a different sign-in"** on a first arrival that is nothing of the kind. Fix: on `uq_users_email` with the **same** `external_id`, re-read and return the row |
| Z-10 | L5 | settings: two admins, same key | S-16 | last write wins, no 500 | holds — single-row upsert |
| Z-11 | L5 ⚠ probe | email reconciliation vs a concurrent provision of the same address | P-08 in parallel with a newcomer at the old address | no 500 | same root cause as P-08 |
| Z-12 | L5 ⚠ probe | `votes.service.ts cast`: `findAuthorId` → `INSERT IGNORE` | dana votes as sam deletes the request, between the two statements | 404 | `INSERT IGNORE` turns the FK violation into a **warning**, `affectedRows` is 0, and the service reads 0 as "already voted" → **409 "You have already voted"** on a request that no longer exists. Not a 500, but a wrong sentence. Fix: distinguish `affectedRows 0` with a warning count from a genuine duplicate, or re-check existence on 0 |

## 17. Probes I expect to fail today

Collected from the rows above, with the reasoning, so they can be turned into
failing tests first and fixes second — in that order, per the collaboration
record's own rule.

| id | where | what | why I think so |
|---|---|---|---|
| Z-01 | [users.service.ts](../api/src/modules/users/users.service.ts) `deleteAccount` | two last-admins can both leave | `countOtherAdmins` and `anonymise` are two statements with no lock; the count is not inside the transaction that writes |
| Z-02 | [requests.service.ts](../api/src/modules/requests/requests.service.ts) `assertNotRateLimited` | the limit is over-by-N under concurrency | count then insert, no serialisation per author |
| Z-03 / Z-04 | [comments.service.ts](../api/src/modules/comments/comments.service.ts) `remove`, `create` | a reply can be cascaded away, or inserted live under a tombstone, or FK-500 | `countReplies` → `hardDelete` and parent-check → `insert` are unguarded; the FK cascade is what turns the race into data loss |
| Z-09 | [provision.ts](../api/src/auth/provision.ts) | a newcomer's first two parallel requests → 409 | the `uq_users_email` branch cannot tell "same subject, raced" from "different subject, collided" |
| P-08 | [current-user.ts](../api/src/auth/current-user.ts) `reconcile` | provider moves an email onto an address another row holds → 500 | `updateEmail` has no duplicate handling |
| C-25 / C-26 / C-27 | [comments.service.ts](../api/src/modules/comments/comments.service.ts) `toDto`, [comments.repository.ts](../api/src/modules/comments/comments.repository.ts) `countPending`, `requests.repository.ts` `pendingOnly` | gate down releases without stamping; the second gate-up re-hides; `isPending`/`canApprove`/`?pending=true` report waiting on published comments | all three derive from `approved_at IS NULL` alone; DECISIONS' "turning it off releases" is implemented in the *read* and not in a write. The one-line fix is `UPDATE comments SET approved_at = NOW(3) WHERE approved_at IS NULL AND deleted_at IS NULL` when the setting flips to false — which is a decision (it makes release irreversible) and belongs in DECISIONS.md either way |
| H-02 | [error-handler.ts](../api/src/http/error-handler.ts) | 256 KB+ body → 500 not 413 | `isJsonParseFailure` only recognises `SyntaxError`; `entity.too.large` falls to the opaque branch |
| Z-12 | [votes.service.ts](../api/src/modules/votes/votes.service.ts) `cast` | voting on a request deleted a moment ago answers 409 "already voted" | `INSERT IGNORE` swallows the FK violation as a warning; `affectedRows 0` is read as a duplicate |
| **E-14 / P-14** | [account.ts:159](../web/src/app/features/settings/account/account.ts#L159), [provision.ts](../api/src/auth/provision.ts) | **deleting your own account immediately creates you a new one** | the screen calls `config.reload()` after the 204, which refetches bootstrap with the still-valid token; anonymisation has freed the email and cleared `external_id`, so provisioning has no reason to refuse. The client never signs out. This is the one row here I would fix before anything else — it is user-visible on a Fresh board in under ten seconds |
| R-10 | `requests.service.ts` `update` | an author cannot edit a request whose category was retired without changing category | `findActiveId` on edit; the edit form cannot offer the retired value |
| K-08 | [nginx.conf.template](../web/nginx.conf.template) | 413 arrives as nginx HTML, not the envelope | no `client_max_body_size`; default 1 MB is above the API's 256 KB, so it will not fire for the API's limit — but it fires first for anything larger, with a non-JSON body the client does not expect |
| K-18 | [k8s/30-keycloak.yaml](../k8s/30-keycloak.yaml) | a Keycloak pod restart signs everybody out | in-container database → new realm keys on every start. Documented as development-only; the test puts a number on it |
| X-06, S-07, S-10, S-11, Z-08, H-05 | taxonomy and settings services, header handling | verified while writing this plan; **not** expected to fail | each was a suspicion that reading the code (or, for H-05, running Node) resolved. They stay as rows because the behaviour is real and untested, not because it is wrong |

## 18. Accessibility and visual QA — the debt named in every handoff

"Nobody has audited the screens in a browser" has been the next thing worth
doing for five handoffs. These are the rows that close it.

| id | layer | do | must be true |
|---|---|---|---|
| Q-01 | L3 | axe-core on each of the seven screens, both languages, both themes | zero critical/serious; each moderate triaged in `notes/` |
| Q-02 | L3 | Tab through the board from the top | order: header → shelf (if any) → filter bar → cards in reading order → pager; every focusable thing has a visible focus ring in both themes |
| Q-03 | L3 | the confirmation dialog, by keyboard only | opens on Cancel; Tab and Shift+Tab wrap; Escape closes; focus returns to the button that opened it (L0 proves this in jsdom; prove it in Chromium and Firefox) |
| Q-04 | L3 | reorder buttons with a screen reader (NVDA on Windows) | announces "Move Bug up", not "button" |
| Q-05 | L3 | the page-range summary and the vote button | announced via `aria-live` / accessible name, in French too |
| Q-06 | L3 | 360 × 640, 768 × 1024, 1280 × 800, 200 % zoom | no horizontal scroll; the shelf scrolls within its own height when expanded; the filter bar wraps; forms usable |
| Q-07 | L3 | `prefers-reduced-motion` | no animated skeletons or transitions that matter |
| Q-08 | L3 | contrast of the status/category chips and the "waiting" badge in dark | ≥ 4.5:1 |
| Q-09 | L3 | a 5000-char comment and a 160-char title with no spaces | wraps; no overflow; `pre-wrap` keeps the line breaks |
| Q-10 | L3 | the sign-in screen, the "unavailable" screen and the bootstrap-failed screen | all three readable, focus lands on the primary action, and none of them is a blank page |

Record the outcome as `notes/visual-qa.md` with screenshots per screen × theme
× language, so the next handoff can say it was done rather than that it should
be.

---

## 19. Exit criteria

- L0 green (already true).
- Every L1 row green against MySQL 8.4.6, in CI, with the database as a service
  container — the suite gets a second `vitest` project with a `globalSetup` that
  migrates and seeds.
- Every `⚠ probe` row has been **run**, its result written in
  `notes/ai-log.md` in the usual raw form, and either (a) fixed, with the row
  now a regression test, or (b) accepted, with the reason in DECISIONS.md.
  Neither "expected to fail" nor "probably fine" is an end state.
- L2 sign-in verification is a committed script, not a description of one.
- L3 Playwright covers E-01..E-17, C-30, S-20, X-16, V-10, I-03..I-08.
- L4 rows K-11..K-24 run once per change to `k8s/` or either Dockerfile, and
  the numbers from K-18 and K-19 are written down.
- `notes/visual-qa.md` exists.

## 20. What this plan deliberately does not do

- It does not test what SCOPE.md rules out (no rows for banning, invitations,
  email, avatars, translating content, a BFF). A test for a feature that must
  not exist is X-10 and X-14: the route is a 404.
- It does not load-test beyond D-12. The board is "thousands, not millions";
  one measurement is worth more than a benchmark suite.
- It does not stub the verifier, ever. Every layer above L0 uses either the
  suite's own RSA key with the JWKS fetch replaced (L1) or real Keycloak
  (L2+). The handoff's warning stands.
