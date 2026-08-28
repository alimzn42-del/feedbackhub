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

## Why two origins are listed, and why that is not an inconsistency

The client's `redirectUris` and `webOrigins` name both
`http://localhost:4200` (compose) and `http://feedbackhub.local` (the kind
cluster), because those are the two ways this repository can be run and a
redirect URI Keycloak has not been told about is refused outright.

It would be neater for these to come from the environment, and that was tried:
Keycloak's realm import does **not** substitute `${env.WEB_ORIGIN}`. It
validates the literal string as a URI, rejects it, and refuses to start — the
same all-or-nothing failure as any other bad field in this file. So the values
are written out.

**That makes this file environment-specific, which sits oddly next to a web
image that knows nothing about its environment at all — and the reason it is a
boundary rather than a contradiction is worth stating plainly.**

**This realm is local-review tooling, and a real deployment does not import it.**
Not a templated copy of it, not a variant with different origins — it is not
part of the deployment at all. In a real environment the client is created
through Keycloak's admin API, or from an import templated at deploy time by
whatever already holds that environment's hostnames. The realm there has no
`credentials` block, no fixed user ids, and one origin: its own.

So the two things being compared are not peers. The web image is a deployable
artefact and must not carry environment knowledge, which is why it asks the API
for the issuer and client id at runtime rather than having them baked in. This
file is a fixture that exists so `docker compose up` and `kubectl apply -k .`
are each followed by a working sign-in instead of a setup procedure. A fixture
listing the two environments it is a fixture for is doing its job; adding a
third is one entry in each list.

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

## Registration, and where the email goes

`registrationAllowed` is on, so Keycloak's own registration page exists and
the sign-in panel's "Create an account" leads to it — the same
authorization-code flow with the same PKCE parameters, against
`/protocol/openid-connect/registrations` instead of `/auth`. The brief's first
journey is "registers **or** signs in", and until this was switched on only the
second verb existed. `registrationEmailAsUsername` is on with it, so the form
asks for an email, a name and a password and not for a username of its own,
which is how the three people above are set up.

**`verifyEmail` is on, and it has to be.** The API refuses to provision an
address nobody has checked, on purpose: a realm that does not verify is exactly
the "provider that does not check" that a domain-restricted board has to be
defended against. With verification off, every new registration authenticated
and was then refused as unverified before the registration policy was ever
consulted.

Verifying needs somewhere to send the mail, so `smtpServer` points at
`mailpit:1025` — a container in the compose stack (and a Service of the same
name in the cluster, because this file names the host and this file is shared)
that accepts every message and delivers none of them. **Registering ends by
opening <http://localhost:8025> and clicking the link.** Nothing leaves the
laptop. A real deployment names its own relay here and has no Mailpit.

What this realm decides is only whether the person exists and whether the
address is theirs. Whether the board gives them an account is the registration
policy's decision, made by the API on their first request — see
`api/src/auth/provision.ts`. Under `domains`, a stranger registers
successfully, verifies successfully, and is refused with the rule and not the
list. That path has been run end to end; the record is in `notes/handoff.md`.

`resetPasswordAllowed` is still off. Nothing needed it, and it is one boolean
away now that the realm can send mail.

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
