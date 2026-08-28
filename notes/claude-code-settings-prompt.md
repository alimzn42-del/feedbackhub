# Settings slice

The two screens are the easy part. What the brief actually asks about is where configuration lives, how it resolves between global defaults and per-user overrides, and how the frontend obtains it without a chain of blocking requests on startup. Treat that as the substance of this slice.

---

## Two levels

**User settings** — display name, avatar or initials, theme (light/dark/system), language, default list sorting and filters, email notification preferences, account deletion.

**Application settings** — registration policy (open / invite-only / restricted to named email domains), whether comments require approval, a rate limit on submissions per user, and at least one feature flag that visibly changes application behaviour when toggled.

Application settings are admin-only, refused at the route before being hidden in the interface, and not returned to a non-admin at all — this is the one place on this board where a field is withheld rather than merely uneditable.

---

## Resolution

Some values exist at both levels. Default list sorting is the clear case: there is a global default, and a user may override it.

**The server resolves; the client consumes.** The API returns the effective value, along with whether it came from the user or from the global default — the client needs to know that to render "using the default" versus an explicit choice, and to offer a reset. Merge rules must not exist in two places.

Tell me where you propose the values live before implementing: a settings table with typed rows, a single JSON document per scope, or something else. Whichever you choose, adding a new setting later should not require a schema migration, and reading one should not require knowing its storage shape at the call site.

---

## Startup

The brief singles this out, so it is the part I will judge hardest.

The application must not issue a chain of blocking requests when it loads — application settings, then user preferences, then the taxonomy, each waiting on the last. One request returns the resolved configuration the app needs to render: effective settings, the user's identity as the app knows it, and the category and status lists that every screen already depends on.

Show me what that payload contains and why each piece is in it. Anything that can be fetched lazily after first paint should not be in it.

Handle the failure case deliberately: if that request fails, the app shows an error state it can retry from, not a blank screen or a half-configured interface running on hardcoded fallbacks.

---

## The feature flag

Pick one that visibly changes behaviour, and say why you picked it. Comment approval is the strongest candidate — it already has its column and its states from the comments slice, and toggling it produces an immediately visible difference in how a comment behaves after submission.

A flag that only hides a button is a weak demonstration. The toggle should change what the application does, and the change should be observable without a reload.

---

## Account deletion

Already decided: the person is anonymised, their content stays. Personal fields cleared, `external_id` cleared, account marked deleted, authored content rendering as a deleted user. Votes cast remain counted.

Confirmation must be deliberate — this is irreversible, and the interface should say plainly what survives and what does not before the person confirms.

---

## Rate limit on submissions

Enforced on the server, returning a clear response the interface can act on — how long until they may submit again, not a generic refusal. The limit is a setting, not a constant.

---

## Registration policy

The setting is stored and enforced now, at the point a new user is provisioned. That check lives in the application, not in the identity provider — when Keycloak lands, a person can authenticate successfully and still be refused an account here because the policy says so. Build the check now against the seam; wire the real identity in the next slice.

---

## Tests

Route-level: a regular user reading or writing application settings → `403`, asserting nothing was written. A user writing another user's preferences → `403`. Resolution: a value with no user override returns the global default flagged as such; with an override, returns the override.
