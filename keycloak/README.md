# The realm

`realm-feedbackhub-development.json` is imported by the Keycloak container on
startup. There is no manual setup: no creating the client, no adding the
audience mapper, no typing users into the admin console. If something in here
had to be clicked, this file would be wrong.

---

## The passwords in this file are not secrets

**They are three fixed development passwords, published on purpose, for a realm
that only ever runs on a reviewer's laptop.** They exist so that
`docker compose up -d` is followed by a working sign-in rather than by a
question. Nothing in this repository is deployed anywhere, and this file is
named `-development` so that no deployment picks it up by accident.

A real deployment imports a realm **without** a `credentials` block and without
fixed user ids — people are invited, or come from the organisation's directory,
and their passwords are theirs. The two files would share the client, the
mappers and the audience, and nothing else.

If you are reading this wondering whether you have found leaked credentials:
you have not.

| Sign in as | Password | What they are here |
|---|---|---|
| `admin@feedbackhub.local` | `feedbackhub-dev` | admin — sees the taxonomy and settings screens |
| `dana@feedbackhub.local` | `feedbackhub-dev` | an ordinary user |
| `sam@feedbackhub.local` | `feedbackhub-dev` | an ordinary user |

The Keycloak admin console itself is at <http://localhost:8080/admin>, with the
account named by `KEYCLOAK_ADMIN_USER` / `KEYCLOAK_ADMIN_PASSWORD` in `.env`.
You should not need it.

---

## Why the user ids are written down

Each user in this file has a literal `id`. That id becomes the `sub` claim of
every token they are issued, and the same three ids are the `external_id`
column of the three seeded rows in
`api/src/db/seeds/001_baseline.sql`.

That is the join. Without it the two sets of people are unrelated: the seeded
admin exists with `external_id NULL`, the first sign-in matches nothing,
provisioning tries to create a second account for the same person, and the
insert collides with the unique constraint on `email`. The symptom is the
seeded admin being unable to sign in at all — on a board where nothing can
promote anybody, which means no admin, which means no way back.

**If you change an id here, change it in the seed in the same commit.**

Everybody else — including anyone arriving through Google — has no row until
they arrive, and is created by `api/src/auth/provision.ts` under whatever
registration policy the board is set to.

The seven extra people that `npm run demo` creates are deliberately **not**
here. They are authors of content, so the board has something on it to read;
they are not people who sign in, and giving them realm identities would buy
nothing. Nothing in this application promotes anybody, so there is no path that
needs more sign-in identities than these three: account deletion works signed in
as `dana`, and the last-admin refusal appears signed in as `admin`. A demo board
has a second admin only because `npm run demo` seeds one.

---

## Google

The realm file contains no identity providers. That is deliberate: a reviewer
cannot obtain Google OAuth credentials, and a sign-in page offering a Google
button that fails is worse than one that does not offer it. With no provider
configured, the login page shows email and password, and everything works.

To switch it on, put the credentials in `.env` and run the script:

```bash
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...

npm run auth:google
```

It is idempotent, and it refuses with a sentence rather than a stack trace if
either variable is missing. The authorised redirect URI to register with Google
is printed by the script.

**It links only on a verified email.** `trustEmail` is false and the first
broker login flow requires the account to be verified before it is linked to an
existing one, because linking on an unverified address is an account-takeover
path: register somebody else's address at a provider that does not check it,
and you are inside their account. The API asserts the same rule a second time
in `api/src/auth/current-user.ts`, where it does not depend on this file being
right.
