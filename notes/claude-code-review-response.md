# Answers and corrections — proceed to slice 1 after applying these

Good proposal overall. Three things in the schema I would not have asked for and am keeping: the `slug`/`name` split, `archived_at` instead of deletion, and `ON DELETE RESTRICT` on `author_id` — the reasoning on that last one is better than the decision itself.

Six corrections below, plus answers to your open questions.

---

## 1. Your objection on role rules — accepted, you were right

The dead end is real: a departed or mistaken admin would be unremovable through the application, and a manual database edit is exactly what the audit trail exists to prevent. My earlier concern was admins demoting each other in a dispute — but that action is reversible, recorded, and blocked at the last admin, so the exposure is low and traceable.

**The rule is now:** any admin may promote or demote any user; the operation is refused when it would leave zero admins; every role change is recorded with actor, target, direction, and timestamp.

Update decision 6 accordingly.

---

## 2. Security — the current-user seam must be structurally locked

`DEV_CURRENT_USER_EMAIL` is the right development affordance, but as written it is an unauthenticated impersonation endpoint if it ever reaches a deployed environment.

**The application must refuse to boot** when `NODE_ENV=production` and the development seam is active. Not a warning, not a log line — a hard failure in `config/env.ts` at startup, before the pool is created.

This is a deliberate temporary backdoor, so close it structurally rather than by convention.

---

## 3. Correct the justification for the feed index

You wrote that pinning is included now so the sort never changes underneath pagination later. That claim is wrong, and I do not want it propagating into `DECISIONS.md`.

The brief requires sorting by vote count, which becomes the primary sort key once the voting slice lands — and it cannot be served by `idx_requests_feed`, because the count is derived rather than stored.

Keep the index and the tiebreaker exactly as proposed; the total-order argument for including `id` is correct and worth keeping. Just restate the rationale honestly: this index serves the current default sort, and vote-count sorting will need separate treatment when that slice arrives.

---

## 4. The generated-column constraint guarantees "at most one", not "exactly one"

The `is_default_uniq` trick is good and I am keeping it, but it prevents multiple defaults — it does not prevent zero. An admin can clear the default status and leave the table without one, and the next `POST /api/requests` fails.

Enforce the lower bound in application logic when statuses are edited, and correct the wording in the schema notes.

---

## 5. Tests are missing from the structure

The brief requires the README to document how to run the tests, which makes them a graded deliverable.

Slice 1 must include a working test setup and at least one test covering a policy rule — specifically that a non-author, non-admin is refused. Not full coverage; the harness in place from the first commit, because retrofitting it ten slices later is significantly harder.

---

## 6. Add a database container now

Full deployment stays deferred, but MySQL has to run from day one, and the brief asks for documented commands that bring the system up locally.

Add a `docker-compose.yml` with a MySQL 8 service only — version pinned, `utf8mb4` and collation set explicitly, credentials from `.env`. Everything else joins this file in the deployment slice.

---

## 7. Migration runner — confirm the earlier decision was applied

The tree still shows `db/migrate.ts` as a hand-written runner with its own `schema_migrations` table. To restate: **raw `.sql` migration files stay** — that reasoning was sound and a reviewer should see real DDL. But use an existing runner rather than writing one. Forty lines reimplementing a solved problem reads as effort spent in the wrong place.

---

## Answers to your open questions

**Data access layer** — `mysql2/promise` with hand-written SQL confined to repository files: agreed, for the reasons you gave. Kysely is rejected — an extra abstraction layer is not justified for four tables.

**Pagination** — offset/limit confirmed. Your reasoning about page numbers is correct and the data volume never reaches the point where keyset matters. The envelope you proposed (`data` + `page` with `page`, `pageSize`, `total`, `totalPages`) is locked from this slice; every list endpoint uses it unchanged.

**Validation** — Zod, mapped to the `details` array as described. No objection.

**`preferences` JSON on `users`** — defer it to the preferences slice. A column nothing reads or writes is dead weight, and having migrations is precisely what lets it arrive when it is needed. Good catch on the inconsistency, and the right instinct to ask rather than add it unprompted.

**400 vs 422** — keep them distinct. `400` means the body could not be parsed; `422` means it parsed and a field is invalid. The frontend genuinely handles these differently: one is a client bug, the other renders on the form. Record this in `DECISIONS.md`.

---

## Before you start

Log the following in `notes/ai-log.md` as part of the first commit, honestly and without softening:

- The role-rule dead end: your objection, and that it overturned a decision I had already locked.
- The pinning-index justification: accepted output whose stated reasoning was wrong, caught by reading the rationale rather than the result.
- The `is_default` constraint: correct implementation, overstated guarantee.

Then build slice 1 as scoped.
