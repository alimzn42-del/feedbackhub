# Request-level actions on the detail page

The comment thread is complete. What's missing is everything that acts on the **request itself**. Add it on the detail page.

---

## Owner actions

**Edit** — title, description and category. Not status, not pinned. Same validation as creation, same error mapping onto the form. Show an "edited" marker on the request when `updated_at` differs from `created_at`, consistent with how comments already do it.

**Delete** — with a confirmation step, since this destroys a discussion rather than a single remark. On success, return to the list rather than leaving the user on a dead URL. Deleting a request takes its votes and its comments with it, as already decided.

---

## Admin actions

**Change status** — the statuses come from the table, not a hardcoded list. Ordered by their configured display order.

**Pin and unpin** — recording `pinned_by` and `pinned_at`. The detail page shows who pinned it, matching the card.

An admin does not edit another person's title or description. That boundary is already in the policy module; do not widen it here.

---

## Authorization

This is the slice where a regular user first has an action they can be refused, so the route-level test that has been outstanding since slice 1 becomes writable. Include both:

- A non-owner, non-admin attempting to edit or delete a request → `403` through the route, asserting nothing was written.
- A regular user attempting a status change or a pin → `403` through the route.

Server refuses first; the interface hides second. Hiding the controls is a courtesy, not the guarantee.

Everything the interface needs to decide what to render comes from the server, in the same shape as `canVote` — the browser is not told who the actor is and does not carry a second copy of any rule.

---

## States

Every action needs its pending, success and failure states, and the failures need to be actionable: a `403` reads differently from a network error, and a `404` after someone else deleted the request while this page was open is its own case worth handling rather than a generic failure.

Keyboard reachable throughout, with visible focus. The confirmation step traps focus and closes on Escape.

---

## Not in scope here

Managing the statuses and categories themselves — that stays in the admin configuration slice. This slice only consumes the taxonomy.
