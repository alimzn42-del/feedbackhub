# Kickoff prompt — FeedbackHub

> Copy everything below into Claude Code as your first message.

---

## Context

We are building **FeedbackHub**, an internal product feedback board, as a technical assignment for a Senior Full Stack Developer position. The assignment is deliberately simple as a product — the evaluation is about engineering judgment, consistency, security, and how deliberately the work is directed. Working code is the floor, not the goal.

Read this whole message before writing anything.

### The product

Employees submit feature requests and product feedback. Everyone browses what has been submitted, upvotes requests they care about, and discusses them in comments. An admin triages: sets status, curates categories, moderates content, and configures the application.

The point is to stop the same suggestion arriving five separate times by email, and to make visible what is actually being worked on. Voting is the mechanism that replaces duplicate submissions — the vote count is the priority signal.

### Entities

**FeedbackRequest** — title, description, category, status, author, pinned flag, created/updated timestamps. Vote count and comment count are **derived**, never stored as manually incremented columns.

**Vote** — one user, one request, at most once, withdrawable.

**Comment** — free text on a request, by an author, with timestamps. Editable and deletable by its author; deletable by an admin for moderation.

**Category** and **Status** — taxonomy rows managed by admins, not enums hardcoded in the application.

### Roles

Two roles only: `user` and `admin`. Admin is cumulative — everything a user can do, plus triage, moderation, and configuration.

---

## Decisions already made — do not revisit these

These were reasoned through deliberately. If you think one is wrong, say so in one sentence and wait — do not silently implement something else.

1. **Database: MySQL 8.** Chosen over Postgres for familiarity and faster diagnosis within the assignment's timebox; over MongoDB because the data is strongly relational and the "unbounded comments per user" concern is exactly what a foreign key solves, not a reason to denormalize. Charset must be `utf8mb4`. Use `CTEs`, window functions, and the `JSON` type where they help.

2. **Authorization is built from day one; authentication is deferred.** Every endpoint enforces permissions on the server, from the very first slice. But the current user comes from a single replaceable function returning a fixed seeded user — not from a token yet. Keycloak wiring comes later as its own slice and must change only that one function.

3. **Local `users` table** with an `external_id` column (`UNIQUE`), which will later hold the identity provider's `sub`. Profile fields and preferences live here, not in the identity provider. Role is stored in this table, not read from a token claim.

4. **Permissions live in one policy module**, not scattered across handlers. Handlers ask questions; they do not contain rules. No permission library, no dynamic RBAC engine — two roles and about fifteen rules do not justify one.

5. **Unauthorized actions return `403`, not `404`.** The board is internal and every request is visible to everyone, so there is nothing to conceal by pretending a resource does not exist.

6. **No `owner` role.** The first admin comes from seed data. Any admin may promote a regular user to admin. An admin may only demote themselves, and the last remaining admin cannot demote themselves. Every role change is recorded with actor and timestamp.

### The permission rules in full

- Create request — any authenticated user
- Read requests — any authenticated user
- Edit request title/description/category — author only
- Delete request — author or admin
- Change request status — admin only
- Pin/unpin request — admin only
- Create comment — any authenticated user
- Edit comment — comment author only
- Delete comment — comment author or admin
- Vote — for yourself only, once per request, withdrawable
- Manage categories and statuses — admin only
- User preferences — the owning user
- Application settings — admin only
- Profile edit and account deletion — the owning user

An admin does **not** edit the text of another person's request or comment. Moderation means deleting or changing status, not rewriting what someone wrote.

---

## Stack constraints

- **Frontend:** Angular (required by the brief). Latest stable version, standalone components, typed reactive forms.
- **Backend:** Node.js with TypeScript.
- **Database:** MySQL 8.
- **Deployment:** containerized, environment-driven configuration, Kubernetes-ready. Deferred to a later slice — but never hardcode configuration that will need to become an environment variable.

---

## How we work

**Vertical slices, not horizontal layers.** Each slice runs from the database through the API to a working screen and ends in a commit that leaves the application in a working state. Do not build the whole schema, then the whole API, then the whole UI.

**Ask before assuming.** If something is ambiguous, ask instead of picking a plausible interpretation and moving on. A question costs a minute; a wrong assumption discovered three slices later costs an afternoon.

**Do not run ahead.** Build exactly the slice we agreed on. Do not add features from later slices because they seem convenient to include.

**Filtering, searching, sorting, and pagination are always server-side.** Never fetch a collection and filter it in the browser, not even as a temporary step.

**List state belongs in the URL.** Filters, sort, and page live in query parameters so a filtered view can be shared and survives a refresh.

### Commit convention

Real commit history is a graded deliverable — no squashing. Commits that were substantially AI-generated carry a trailer:

```
Assisted-by: Claude Code
```

Apply it honestly. A commit I wrote or heavily rewrote does not get the trailer.

### AI collaboration notes

Maintain `notes/ai-log.md` from the first commit. After each meaningful piece of work, append: what was asked, what came back, and what changed between the first output and what was kept — especially anything wrong, outdated, or rejected. This is raw working material for a required deliverable, not a polished document. Do not clean it up or make it flattering.

---

## Slice 1 — what to build now

Scope: **a feedback request can be created and listed.** Nothing else.

**Database**
- Migration setup, and migrations for `users`, `categories`, `statuses`, `feedback_requests`
- Seed data: one admin, two regular users, the four categories from the brief (Bug, Feature, Improvement, Question), and the six statuses (New, Under Review, Planned, In Progress, Done, Declined)

**Backend**
- `POST /api/requests` — validated, authorized, author taken from the current-user function
- `GET /api/requests` — pagination, and a stable sort; filters come in the next slice
- The current-user module, with its single replaceable seam clearly marked
- The policy module with the request rules
- One consistent error shape, and a single error-handling middleware that produces it
- Validation errors that name the field and say what is wrong

**Frontend**
- The Angular app shell
- A create-request form: typed reactive form, inline validation messages, disabled and pending states, error handling
- A request list showing title, description excerpt, category, status, author, and date — with real loading, empty, and error states, not spinners bolted on later
- Keyboard accessible, responsive

**Out of scope for this slice:** votes, comments, search, filters, pinning, admin screens, settings, Keycloak, Docker.

---

## Before you write code

Propose the folder structure and the schema for these four tables, and tell me:

1. Where the current-user seam sits and what its signature is
2. Your error response shape
3. Anything above that you think is a mistake

Wait for my answer before implementing.
