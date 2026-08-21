# Pending decisions

Decisions that have been taken but whose subject matter does not exist in the
repository yet. They live here rather than in `DECISIONS.md`, because a
decisions file that describes code nobody has written reads as if it were
assembled afterwards — which is the one thing it must not be.

Each entry moves into `DECISIONS.md` in the slice that builds the thing it
describes. Nothing here is a plan or a backlog; these are commitments already
argued out, parked until they are true.

---

## Comment deletion: four rules, one table

The `comments` table exists. Nothing reads or writes it yet, so the rules that
govern it are parked here rather than in `DECISIONS.md`.

| Actor | Has replies | The comment | Its replies |
|---|---|---|---|
| Author | no | **hard delete** — the row goes | — |
| Author | yes | **soft** — tombstone | **soft**, hidden with it |
| Admin | no | **soft** — "an admin removed this" | — |
| Admin | yes | **soft** | **soft**, hidden with it |

A reply can never have replies, so the second row never applies to one: an
author deleting their own reply is always a hard delete, and an admin deleting
a reply is always soft. The rules are the same for both; the depth limit
collapses the table for replies rather than needing a separate set.

The author-with-replies cell was contested — one reading of the requirement had
it hard deleting. The `parent_id` cascade would have turned that into the
permanent destruction of every reply underneath: other people's words removed
because the person above them changed their mind. Soft won.

**"Has replies" means any reply rows exist, including already-hidden ones.**
Hard-deleting a comment whose replies were previously hidden would cascade those
rows away and take an admin's moderation record with them.

**Three explanations for a hidden comment; two of them derivable.**
Author-removed and admin-removed are told apart by `deleted_by = author_id`.
Hidden-with-parent is not derivable: when an author removes their own comment
the replies are stamped with that author's id, which does not match the reply
author's, so a naive check accuses an ordinary user of moderating somebody and
tells the reply author an admin removed their words when nobody did. The
`hidden_with_parent` column records that case; the other two stay derived,
because `deleted_by = author_id` is a fact about the data rather than a second
copy of one.

*Moves to `DECISIONS.md` with the comments slice.*

## Comment counts are derived, never stored

The vote half of this shipped in slice 2 and has moved to `DECISIONS.md`. The
comment half stays here: the table exists but nothing counts it yet.

No counter column, so nothing can drift out of sync with the rows it counts.
When the comment endpoints land the count comes from a join, not from an integer
somebody remembered to increment — and it will have to exclude hidden rows,
which is exactly the sort of condition a stored counter gets wrong.

*Moves to `DECISIONS.md` with the comments slice.*

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
