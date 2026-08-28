# Answers — deployment questions

## 1. Frontend runtime configuration — approved, including the deviation

The split is right, and the argument for the endpoint over a static file is stronger than the answer I named. One value in one place beats two copies that can disagree, and the failure mode you describe — a token from realm A presented to an API trusting realm B, surfacing as a `401` that reads like a token bug — is exactly the kind of thing that costs an afternoon to diagnose. The same-origin nginx proxy removing CORS from the problem entirely is the right call too.

Keeping `/api/auth/config` and `/api/bootstrap` as two endpoints is correct and I want the reasoning preserved in `DECISIONS.md` in the form you put it: one asks where to go to become somebody, the other presupposes you already are. That distinction is what stops someone later "simplifying" them into one route and reintroducing the blocking chain the brief warns about.

Two things to confirm rather than assume:

- `/api/auth/config` returns only what a public OIDC client legitimately publishes — issuer, client id, and the mode. No audience internals, nothing about the verification path.
- The test asserting it is the only unauthenticated route under `/api` should fail if a second one is ever added, not merely pass today.

---

## 2. Migrations — approved, and make the init container fix

Job over container start, for the reasons you gave. `schema_migrations` is bookkeeping, not a lock, and two replicas reading version 12 and both applying 13 is a real race rather than a theoretical one.

Make the init container fix. Waiting on the table's existence is correct only on first install, and the failure it permits — the API serving queries against a schema missing columns it expects — is silent and data-shaped, which is the worst class of failure to ship. Deriving the expected version from the highest migration file in the image is right: no hardcoded number to drift, correct on every deploy, and a pod stuck in Init is a loud, diagnosable failure.

Catching this by re-reading rather than by being told is the kind of thing that belongs in `notes/ai-log.md` — a correct-looking mechanism whose correctness held only for the first deployment.

---

## 3. Committed secret values — comply with the brief

Take the dev values out of `11-secret.yaml`.

The manifests are read as a statement of approach, and "secrets are referenced by name, never committed" is the single clearest signal in that statement. A reviewer opening a manifest and finding real-looking values in `stringData` registers that before they read your comment explaining it. The convenience of one `kubectl apply` does not outweigh what the committed file says about how you handle secrets.

Two documented commands is still documented commands. Keep the one-command experience if you want it, but via a script or make target that creates the secret and then applies — the manifest itself stays clean.

**One tension worth naming rather than leaving implicit:** the development realm file with its passwords is committed, and that was my call. The line I would defend is that the realm file is local-review tooling, explicitly named as development and documented as such, while the Kubernetes secret is part of the deployment story being assessed and should model the real practice. That is a defensible distinction but not an obvious one — put it in `DECISIONS.md` so it reads as a considered boundary rather than an inconsistency someone catches.

---

## 4. Install kind and apply the manifests — yes

Do it. Three bugs in this project have been found only by running things, and the most recent — an invented Keycloak client field that broke the container while every test stayed green — is precisely the shape of failure that unapplied manifests hide. A manifest that has never met an API server is a document, not a deliverable.

Report what the API server actually rejects, and record anything it catches in the log.

---

## 5. The per-service README line

Add it. It costs a sentence and it tells a reviewer which parts of the compose file are review scaffolding rather than the deployment.
