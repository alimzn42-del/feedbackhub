# Pending decisions

Decisions that have been taken but whose subject matter does not exist in the
repository yet. They live here rather than in `DECISIONS.md`, because a
decisions file that describes code nobody has written reads as if it were
assembled afterwards — which is the one thing it must not be.

Each entry moves into `DECISIONS.md` in the slice that builds the thing it
describes. Nothing here is a plan or a backlog; these are commitments already
argued out, parked until they are true.

---

## Comment counts are derived, never stored

The vote half of this shipped in slice 2 and has moved to `DECISIONS.md`. The
comment half stays here: there is no comments table yet.

No counter column, so nothing can drift out of sync with the rows it counts.
When comments land the count comes from a join, not from an integer somebody
remembered to increment.

*Moves to `DECISIONS.md` with the comments slice.*

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
