# Scope

What this application is for, what it does, and what it will not do.

This file exists because scope questions kept being re-opened — a thing is ruled
out, and three slices later a handoff proposes it as the obvious next step.
**A question settled here does not get re-asked.** If something below looks
wrong, the way to change it is to change this file deliberately, not to
rediscover it.

- [DECISIONS.md](DECISIONS.md) is *how* and *why* the built things are built.
- This is *what* is in and what is out.
- [README.md](README.md) is how to run it.

---

## What it is

An internal product feedback board. Employees file feature requests and product
feedback, everyone browses and upvotes, and admins triage. The point is to stop
the same suggestion arriving five times by email, and to make visible what is
actually being worked on.

Two roles: **user** and **admin**. There is no third, and no per-resource
permission model.

## What is in scope, and built

| | |
|---|---|
| Filing requests | title, description, category; edited and deleted by their author |
| Browsing | server-side pagination, filtering by status and category, text search, three orderings, "mine" |
| Upvoting | one per person per request, withdrawable, counts derived on read |
| Discussion | comment threads one reply deep, edited by their author |
| Pinning | admin only, recorded with actor and time, its own shelf above the board |
| Admin triage | change a request's status; delete a request; delete a comment |
| Curating the taxonomy | add, rename, reorder and retire categories; add, rename, reorder statuses and set the default |
| Configuration | two levels — installation and personal — resolved on the server, including a feature flag, a rate limit and a registration policy |
| Comment approval | the feature flag: comments held until an admin approves them, judged in the thread |
| Account | display name, preferences, and deleting your own account |
| Language | English and French, applied without a reload |
| Authentication | Keycloak: email/password and one social provider, with the realm imported from this repository. Registering and signing in both happen on Keycloak's pages; this application has no form for either |
| Deployment artefacts | container images for both applications, a complete compose file, and Kubernetes manifests |

### What "an admin moderates" means here, exactly

**Delete comments. Change statuses. Curate categories.** That is the whole of
it, and it is the definition the brief gives.

It does not extend by analogy. Moderating comments does not imply moderating
people; deleting a comment does not imply suspending its author; curating
categories does not imply curating who may post in them. Every proposal that has
tried to widen it has been a variant of the same rejected feature — see below.

An admin also **does not rewrite**. `delete` and `changeStatus` allow admins;
`editContent` does not, and neither does approval. An admin decides whether words
are published, never what the words are.

---

## Ruled out

These are not "later". They are decided, and the reasoning is recorded so it does
not have to be had again.

### Banning, suspending, deactivating, or tiering accounts

**Ruled out twice, and it keeps coming back wearing a different coat.**

The recurring proposal is some ladder of sanctions applied to a person rather
than to a thing they wrote — a tiered ban, a suspension, a read-only mode, an
admin deactivating an account. They are one feature. Naming the newest variant
"user administration" or "deactivation" does not make it a different one.

Why it is out:

- **The brief defines moderation as acting on content**, not on people. A
  feedback board for colleagues inside one company is not a public forum with a
  hostility problem; the sanction it needs for a bad comment is deleting the
  comment, which exists.
- **It needs machinery nothing else here needs** — a sanction state on the user,
  an expiry, an appeal path, an audit trail that survives the sanction, and an
  answer for what the identity provider should do about somebody the board has
  disowned. None of that is a small addition to a two-role model.
- **It is the wrong layer.** The organisation's directory decides who works
  here. A feedback board deciding who may hold an account is that board claiming
  to administer the company's people.

The one control this application does have over who gets in is the
**registration policy**, which decides admission at first arrival and nothing
after it. That is deliberate and it is the whole of it.

### User administration: creating, promoting or demoting other people

Not in the brief, and not built. Nothing in this application creates, promotes
or demotes anybody. Consequences that follow from that, and are correct:

- The first admin is the one the seed creates.
- The last remaining admin cannot delete their own account — a `409`, because a
  board that reached zero admins could never have one again.
- More than one admin exists on a demo board because `npm run demo` seeds a
  second one, not because anything promoted them.

**If it were ever built**, the rule was argued out during design review and
stands: any admin may promote or demote any user; the operation is refused when
it would leave zero admins; every change is recorded with actor, target,
direction and timestamp. That reversed an earlier rule under which an admin
could only demote *themselves*, which left a dead end — a departed or mistaken
admin unremovable through the application, recoverable only by editing the
database by hand, which is exactly what an audit trail exists to prevent.

Recording that rule is not a commitment to build it.

### Invitations

There is no invitation — no table, nothing that mints one — so `invite-only` is
not a value the registration policy offers. A setting naming a rule the code
cannot apply would mean "closed" while claiming to mean something else. It
arrives with invitations or not at all.

### Sending email

Notification preferences are recorded and consumed by nothing, and the screen
says so rather than implying otherwise. There is no mail transport, no queue and
no template.

### Avatar uploads

The brief offers "avatar or initials". There is no file storage in this
application, and adding one for a profile picture is a slice of its own.
Initials are derived from the display name.

### Translating what people wrote

The interface is translated — English and French, both complete. Requests,
comments, display names and the names an admin gave the categories and statuses
are left as their authors typed them. Translating them would mean inventing
words nobody said.

The API's own validation and refusal messages are English whatever the reader's
language, so a French screen can show an English 422. A second catalogue on the
API is what closes that.

### A back-end-for-frontend

The browser holds its own tokens. Moving them into httpOnly cookies behind a
server of their own is a real improvement and a real piece of infrastructure,
and it is not in this brief. The trade is recorded in
[DECISIONS.md](DECISIONS.md) rather than left as an assumption.

---

## Settled, so it does not get re-asked

Short answers to questions that have come back more than once.

**Deleting an account clears `external_id`, and a returning person gets a new
account rather than recovering the old one.** That is the intended meaning of a
deletion request, not an oversight, and it is not a question the identity
provider needs to be consulted about. See
[DECISIONS.md](DECISIONS.md#deleting-an-account-is-an-update-not-a-delete).

**The registration policy is applied by this application, not by Keycloak.**
Authenticating and being admitted are different decisions and only one of them
is the provider's. Somebody can present a perfectly valid token and still be
refused an account.

**The role comes from the local `users` table and never from a token claim.**
There is no realm role mapped into the access token and nothing reads one.

**There is no queue screen for comment approval**, and adding one would be a
regression. A comment out of its discussion cannot be judged.

**There is no `/me` endpoint**, and there must not be. Every route that acts on
an account names it in the path.

**Counts are derived, never stored.** A counter column has been refused four
times.

**Retiring is not deleting, and statuses are not retired at all.** A category is
a label a request keeps; a status is a position requests are sitting in, and
retiring one would strand them.

---

## Where this leaves the work

Everything in the "in scope" table is built. What is left is not a feature — it
is the standing debt named at the end of every handoff:

**Nobody has audited the screens in a browser.** Layout, keyboard focus order,
narrow viewports, the dark scheme as an explicit choice, and whether the longer
French wording fits the controls it now sits in. `notes/` still has no visual QA
record.

That is the next thing worth doing, and it has been the next thing worth doing
for five handoffs.
