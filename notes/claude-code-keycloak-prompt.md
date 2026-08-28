# Authentication slice — Keycloak

This is the slice the seam was built for. The measure of whether the earlier decision paid off is simple: `auth/current-user.ts` changes, and nothing that calls it does.

---

## What must not change

The `Actor` shape, the middleware, `req.actor` being non-nullable behind it, and every policy function. If this slice edits files in `policy/` or in any module's service layer, something was wrong with the seam and I want to know what rather than have it quietly patched.

---

## The provider

Keycloak as a container in the existing compose file, pinned, alongside MySQL.

**The realm is imported from a file in the repository.** No manual setup in the admin console — not creating the client, not the mappers, not the social provider, not the test users. A reviewer runs the documented command and gets a working sign-in. If any step requires clicking through the Keycloak UI, the "documented commands bring the system up locally" requirement is not met.

**Sign-in methods:** email/password, plus one social provider. Google is the obvious choice.

**The practical problem with the social provider:** a reviewer cannot obtain Google OAuth credentials. Configure it from environment variables, and make its absence degrade cleanly — the sign-in page shows email/password and works completely without it, rather than presenting a button that fails. Document in the README what to set to enable it.

---

## The frontend

Standard OpenID Connect authorization code flow with PKCE. A public client — no client secret in the browser, ever.

The application does not implement a sign-in form. The person is redirected to Keycloak, authenticates there, and returns. Building a form that collects a password would violate the brief outright.

Handle the full lifecycle: silent token refresh, expiry during an open session, sign-out that ends the Keycloak session and not just the local one, and returning to the page the person was on rather than dumping them at the root.

Guarded routes must not flash their content before the identity resolves.

---

## The backend

Verify the token signature locally against the JWKS, fetched once and cached with sensible refresh. Do not call Keycloak per request.

Verify what actually matters: signature, issuer, audience, expiry. A token that is well-formed but issued for a different client is not valid here.

Rejections are distinguishable: a missing token, an expired one, and a malformed one should not all read the same in the logs.

---

## Provisioning and the registration policy

First sign-in with an unknown `sub` creates the local row — display name and email copied from the token, role defaulting to `user`, `external_id` set.

**The registration policy applies at this moment, and it is enforced here rather than in Keycloak.** Someone can authenticate successfully and still be refused an account: an open policy provisions them, a domain-restricted policy checks the email domain and refuses otherwise. The refusal must be legible — a person told to contact an admin, not an unexplained failure after a successful login.

Role continues to come from the local table, never from a token claim.

Returning users are matched on `external_id`. An email that changed upstream updates the local copy; it never re-matches an account.

---

## The tests

There are 376 tests running against the seam, and they must keep running without a live Keycloak. Tell me how you propose to do that — a signing key generated in the test setup, or the seam retained as a test-only identity mode — before implementing. I do not want the suite quietly rewritten to hit a real provider.

The production boot guard stays. Whatever mechanism the tests use must be equally unable to run outside a test environment.

New route-level tests: no token → `401`; expired token → `401`; valid token for an unprovisioned user under a restrictive registration policy → refused with a clear reason.

---

## Seed data

The seeded users must map onto Keycloak identities so the existing seed remains usable — an admin and two regular users who can actually sign in, with credentials in the README. A reviewer should be able to sign in as the admin and see the admin screens within a minute of the system coming up.

---

## Before you start

Tell me your plan for the test suite and how the realm import handles the seeded users. Wait for my answer.
