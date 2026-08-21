# Decisions

Why the code looks the way it does. Reversed decisions stay in the record with
the reason they were reversed.

## Data

**MySQL 8.** Chosen over Postgres for familiarity and faster diagnosis inside a
timebox, and over MongoDB because the data is strongly relational — the
"unbounded comments per user" worry is what a foreign key is for, not a reason
to denormalise. `utf8mb4` / `utf8mb4_0900_ai_ci` throughout.

**`DATETIME(3)`, not `TIMESTAMP`.** No 2038 ceiling, and no implicit timezone
conversion on read. The container runs at `+00:00`, the driver reads at `Z`, and
the API emits ISO-8601 UTC. There is one representation of an instant.

**`name` and `slug` on every taxonomy row.** `name` is the display label and
admins may rename it freely. `slug` is the stable handle that goes in URLs, so a
shared filter link survives a rename.

**Taxonomy rows are archived, not deleted.** `archived_at` retires a category or
status while existing requests keep a valid reference. Paired with
`ON DELETE RESTRICT` everywhere.

**`ON DELETE RESTRICT` on `feedback_requests.author_id`.** Deleting a user has
consequences for their content, and account deletion is a later slice. RESTRICT
means the database refuses until the application says explicitly what should
happen, rather than cascading somebody's history away by default.

**`role` is an `ENUM`, not a table.** The policy module branches on the two
literals `'user'` and `'admin'`, which makes them code. Categories and statuses
are tables precisely because no code branches on their values.

**`statuses.is_default` is guarded by a generated column plus a unique key.**
This enforces *at most one* default. It does **not** enforce *exactly one*: an
admin can clear every default and leave the table without one. That lower bound
is application logic in the statuses slice; until then, request creation fails
loudly with `SERVER_MISCONFIGURED` and says what to fix, rather than inventing a
status.

**Default sort: `is_pinned DESC, created_at DESC, id DESC`,** backed by
`idx_requests_feed`. `id` is the tiebreaker that makes the ordering a total
order — without it two rows sharing a millisecond can swap between page 1 and
page 2 under offset pagination.

> This index serves the *current* sort only. The brief also requires sorting by
> vote count, which becomes the primary key once voting lands; that count is
> derived rather than stored, so `idx_requests_feed` cannot serve it and that
> slice will need its own treatment. An earlier draft of this reasoning claimed
> the index made the sort future-proof. It does not.

**Migrations are plain `.sql` run by [postgrator](https://github.com/rickbergfalk/postgrator).**
A reviewer should read real DDL, not a builder's approximation, and CTEs and
window functions are used directly anyway. postgrator owns the version table,
ordering and checksums; `api/scripts/migrate.mjs` only wires it to a mysql2
connection.

## Authorization and identity

**Authorization from day one, authentication deferred.** Every endpoint enforces
permissions now. The current user comes from one function, `resolveCurrentUser`,
which today returns a seeded user named by an environment variable. The Keycloak
slice rewrites that function body and changes nothing else.

**The seam is locked structurally, not by convention.** `IDENTITY_MODE` in
`api/src/auth/identity-mode.ts` records which implementation is compiled in, and
`api/src/config/env.schema.ts` asserts on it at boot. `NODE_ENV=production` with
the development seam present is a hard boot failure before the connection pool
is created — the seam authenticates nobody and grants a chosen identity to every
caller, so reaching production with it must be impossible rather than
discouraged.

**Local `users` table with a `UNIQUE external_id`,** which will later hold the
identity provider's `sub`. Role is read from this table, never from a token
claim. Nullable until authentication exists; MySQL permits many NULLs under a
UNIQUE key, so the constraint is correct from day one.

**All permission rules live in `api/src/policy/`.** Handlers ask questions; they
do not contain rules. No permission library and no dynamic RBAC engine — two
roles and roughly fifteen rules do not pay for one.

Unit tests over the policy prove the rules are written correctly. They cannot
prove a handler asks — an endpoint that forgets to check keeps every one of them
green. So authorization is also tested through the real Express app, asserting
that each route consults the policy with the acting user and that a denial
becomes a 403 in the standard envelope. See `api/src/app.authorization.test.ts`,
which also records what slice 1 cannot yet cover.

**Permission is checked before the body is validated.** A caller who may not
perform an action should not learn the payload schema from a 422 enumerating
every field and its constraints. The controller asks the policy first; the
service asks again, because the service rather than the controller is the
boundary any future caller crosses. The duplication is deliberate and costs a
comparison.

**Unauthorized actions return `403`, never a disguised `404`.** The board is
internal and every request on it is visible to everyone, so pretending a
resource does not exist conceals nothing and only makes the client's job harder.

**An admin does not edit another person's text.** Moderation is deletion or a
status change. `requestPolicy.editContent` refuses admins deliberately, and the
test says so, because it is the rule most likely to be "fixed" by mistake later.

## HTTP

### Error shape

One envelope, produced by one middleware:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The submitted values are not valid.",
    "details": [
      {
        "field": "title",
        "code": "TOO_SHORT",
        "message": "The title must be at least 5 characters."
      }
    ],
    "requestId": "8f3c-..."
  }
}
```

- The HTTP status carries the class; `code` is the stable string clients switch
  on; `message` is human-readable and always safe to render.
- `details` appears on validation failures only. It is an ordered array rather
  than a field-to-message map because one field can fail two ways at once and
  the order reported is the order shown.
- `field` uses dot/bracket paths so it maps straight onto a form control.
- `requestId` is generated per request, returned in `X-Request-Id`, and is the
  join key to the server log.

**Deliberate errors expose their message; unknown errors never do.** Anything
that is an `AppError` was written to be read by a caller. Anything else is a bug
and becomes an opaque 500 — logged in full server-side, disclosed as nothing.

**`400` and `422` are distinct.** `400` means the body could not be parsed;
`422` means it parsed and a field is invalid. The client handles them
differently: one is a bug in the caller, the other renders next to an input.

**Unknown fields are rejected, not ignored.** `status` and `author` are not the
client's to set, and silently dropping them would hide the attempt.

### Responses

**Every success response has a `data` key.** Collections add `page` with
`page`, `pageSize`, `total`, `totalPages`. Fixed from this slice; every list
endpoint uses it unchanged.

**Offset pagination, not keyset.** The UI shows page numbers and a total, which
keyset cannot express, and this board will never hold enough rows for
deep-offset cost to matter.

**The total comes from `COUNT(*) OVER ()` in the same query as the page.**
Window functions are evaluated before `LIMIT`, so one round trip returns both.
`SQL_CALC_FOUND_ROWS` is deprecated in MySQL 8. The one exception is a page past
the end, which returns no rows and therefore no window result; that case costs a
second `COUNT(*)`.

**Bounded taxonomy collections are not paginated.** `GET /api/categories`
returns `data` with no `page` block: there are no pages to describe.

**List rows carry an `excerpt`, not the full description.** Twenty full
descriptions is up to 100KB the card never renders, and truncating in the
browser would mean sending it anyway. The excerpt is cut in SQL.

## Frontend

**Angular 22, standalone components, signals, typed reactive forms.**

**Node is pinned in the repository.** Angular 22 requires Node 24.15.0 or newer
and the development machine had 24.12.0. Rather than deviating from "latest
stable Angular" or changing the machine's Node globally, `.node-version` pins
24.19.0 for this repository. `engines.node` in the root package.json names the
same exact version, and docker-compose pins `mysql:8.4.6` rather than a floating
`8.4` tag, so nothing in the repository resolves a version at build time.

**The API base URL is relative (`/api`), not an environment file.** The CLI
proxy forwards it in development and a reverse proxy serves it in a deployment,
so there is no absolute URL to configure and no build-time value to get wrong.
It is an injection token rather than a constant so a different origin can be
supplied later without editing every service.

**List state lives in URL query parameters,** bound to component inputs by
`withComponentInputBinding()`. A filtered view can be shared and survives a
refresh. Paging is always sent to the server; nothing is filtered in the
browser.

**Loading, empty and error are distinct rendered states, not a spinner.** The
list also distinguishes "nothing has been filed" from "this page number is past
the end", because they need different offers to the user. Skeletons mirror the
real card geometry so the layout does not jump.

**Server field errors attach to the control they name.** A rule the browser
cannot check — "that category no longer exists" — lands next to the input. Only
failures that name no field, or name a field the form does not have, fall back
to the banner.

## Scope

**`GET /api/categories` was added beyond the agreed slice 1 scope.** The agreed
scope includes a create-request form with a category, and categories are
admin-managed data rather than an application enum — so the form cannot be built
without reading them. Managing categories remains a later slice; this is only
the read that the agreed screen requires.
