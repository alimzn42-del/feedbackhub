# Pending decisions

Decisions that have been taken but whose subject matter does not exist in the
repository yet. They live here rather than in `DECISIONS.md`, because a
decisions file that describes code nobody has written reads as if it were
assembled afterwards — which is the one thing it must not be.

Each entry moves into `DECISIONS.md` in the slice that builds the thing it
describes. Nothing here is a plan or a backlog; these are commitments already
argued out, parked until they are true.

---

## Comment moderation before publication

An admin setting, not yet designed and deliberately not yet in the schema: when
enabled, a new comment is visible to its author but not to anybody else until an
admin approves it.

No column was added for this. It follows the ruling made when `preferences` was
deferred in slice 1 — a column nothing reads or writes is dead weight, and
having migrations is precisely what lets it arrive when it is needed. The shape
it will take is a nullable `approved_at` on `comments` plus a settings table for
the toggle itself, which is one small migration.

Worth noting now because it changes a query that does not exist yet: every
listing and every count will need "visible to me" rather than "not deleted", and
that condition is easier to write once than to retrofit into three places.

*Moves to `DECISIONS.md` with the moderation slice.*

## Role changes

Reversed during design review. The original rule was that an admin may only
demote *themselves*. That left a dead end: a departed or mistaken admin would be
unremovable through the application, and the only recovery would be a manual
database edit — exactly what the audit trail exists to prevent.

The rule is now: **any admin may promote or demote any user; the operation is
refused when it would leave zero admins; every change is recorded with actor,
target, direction and timestamp.**

Demotion in a dispute is reversible, recorded and bounded, which is a smaller
exposure than the dead end was.

Nothing in the repository implements this yet — there is no role-change endpoint
and no audit table. The `users.role` column exists and the policy module knows
what an admin is; that is all.

*Moves to `DECISIONS.md` with the user administration slice.*

## The Node base image must match the pin

`.node-version` and `engines.node` both name 24.19.0 exactly, and
`docker-compose.yml` pins `mysql:8.4.6` rather than a floating `8.4` tag, so
nothing in the repository resolves a version at build time.

There is no Node image yet — the deployment slice adds one. When it does, it
pins `node:24.19.0` and not `node:24` or `node:lts`, or the three pins stop
agreeing and the CI container stops matching the development machine.

*Moves to `DECISIONS.md` with the deployment slice.*
