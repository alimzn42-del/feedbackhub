# Pending decisions

Decisions that have been taken but whose subject matter does not exist in the
repository yet. They live here rather than in `DECISIONS.md`, because a
decisions file that describes code nobody has written reads as if it were
assembled afterwards — which is the one thing it must not be.

Each entry moves into `DECISIONS.md` in the slice that builds the thing it
describes. Nothing here is a plan or a backlog; these are commitments already
argued out, parked until they are true.

Comment moderation before publication left this file in slice 8. It was built
attached to the setting that switches it on rather than in a moderation slice of
its own, and the shape predicted here — a nullable `approved_at` on `comments`
plus a settings table for the toggle — is the shape it took.

---

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

## What a deactivated account means to the identity provider

Created by the authentication slice, and not answered by it.

Deleting your own account here anonymises the row and clears `external_id`, so
the token that used to match it matches nothing and the person cannot get back
in — through this application. **Their Keycloak identity is untouched.** They can
still authenticate, and on a board with `registration.policy` set to `open` they
will simply be provisioned a fresh account on their next visit, under the same
address, with a new local id.

That is arguably correct: an account here is not the same thing as an identity at
the provider, and this application has no business disabling somebody's
organisational login. It is also arguably a delete that does not delete.

The user administration slice has to decide it, because deactivating *somebody
else* raises the same question with higher stakes — a deactivated colleague who
can re-provision themselves by signing in again has not been deactivated.

Three shapes, none chosen:

1. **Nothing changes.** Deletion is local, re-registration is expected, and the
   registration policy is the control. Cheapest, and honest only if the interface
   says so.
2. **A tombstone the provisioning check consults.** A refused-subject list, so a
   departed or deactivated person is refused at `provision()` rather than being
   given a new row. Keeps the identity provider out of it and keeps the rule
   where every other admission rule already lives.
3. **Disable the user in Keycloak through its admin API.** Correct for
   deactivation by an admin, wrong for self-deletion, and it makes this
   application an administrator of the organisation's directory — which is a much
   larger claim than a feedback board should make.

Shape 2 is where the rest of this codebase points: admission is decided here, by
`api/src/auth/provision.ts`, and never by the provider.

*Moves to `DECISIONS.md` with the user administration slice.*
