# Kubernetes

Sixteen objects: a namespace, config and secrets, MySQL, Keycloak, a migration
job, the API, the web tier, and one ingress.

The kustomization is at the **repository root**, not here — kustomize will not
read files above its own directory, and the realm ConfigMap is generated from
`keycloak/realm-feedbackhub-development.json` so there is one copy of the realm
rather than two. The manifests themselves live in this directory.

```bash
# Build both images into whatever the cluster pulls from.
docker build -f api/Dockerfile -t feedbackhub-api:local .
docker build -f web/Dockerfile -t feedbackhub-web:local .

kubectl apply -k .

kubectl -n feedbackhub rollout status deploy/feedbackhub-api
```

Then, once — seeding is baseline content and a decision, not a consequence of
applying manifests:

```bash
kubectl -n feedbackhub run seed --rm -i --restart=Never \
  --image=feedbackhub-api:local --image-pull-policy=IfNotPresent \
  --overrides='{"spec":{"containers":[{"name":"seed","image":"feedbackhub-api:local",
    "command":["node","scripts/seed.mjs"],
    "envFrom":[{"configMapRef":{"name":"feedbackhub-config"}}],
    "env":[{"name":"DB_PASSWORD","valueFrom":{"secretKeyRef":
      {"name":"feedbackhub-secrets","key":"DB_PASSWORD"}}}]}]}}'
```

Add the two hostnames to your hosts file, pointing at the ingress controller:

```
127.0.0.1  feedbackhub.local
127.0.0.1  auth.feedbackhub.local
```

Sign in at <http://feedbackhub.local> as `admin@feedbackhub.local` /
`feedbackhub-dev`.

---

## The shape, and why

### Only two things are reachable from outside

`feedbackhub.local` → the web tier. `auth.feedbackhub.local` → Keycloak. That
is the whole ingress.

**Mailpit has no ingress either.** The realm verifies addresses at
registration and sends the link to `mailpit:1025`; reading it in the cluster is
`kubectl -n feedbackhub port-forward svc/mailpit 8025:8025` and then
<http://localhost:8025>. A host for it would be one more ingress rule for a
piece of review scaffolding, and a real deployment has no Mailpit at all.

**The API has no ingress.** The browser reaches it same-origin through the web
tier's nginx, which is the same arrangement as the Angular CLI's dev proxy and
as docker-compose. One request path in every environment rather than an ingress
rule and an nginx `location` that can drift apart, CORS never enters into it,
and nothing outside the cluster can address the API at all.

### Keycloak gets its own host, not a path

Every token carries the address the browser signed in at, as `iss`, and the API
compares that string exactly. A realm reachable two ways issues two different
issuers and half of them are rejected.

So the host is pinned twice: in `feedbackhub-config` (which the API compares
against) and in `KC_HOSTNAME` (which decides what Keycloak mints). Change one
and change the other.

### The issuer and the address are different values

`OIDC_ISSUER_URL` is the realm's **identity** — `http://auth.feedbackhub.local/...`,
what the browser reached and therefore what every token says.

`OIDC_INTERNAL_URL` is its **address from inside the cluster** —
`http://feedbackhub-keycloak:8080/...`, where the API fetches the key set.

Only the first is ever compared to `iss`. Pointing the second somewhere wrong
makes every token fail rather than making a wrong one pass. Without the split,
the API would be resolving an ingress hostname from inside a pod to fetch a key
set from a service sitting next to it.

### Migrations are a Job, and the API waits for the fact rather than the Job

An API that migrates on boot cannot run two replicas without two processes
racing to alter the same tables, and it buries a schema failure inside a deploy.

A Job is not an ordering primitive either — nothing makes a Deployment wait for
one. So the API's init container blocks until `schema_migrations` exists, which
is the thing it actually depends on, rather than sleeping and hoping.

### Everything runs as a non-root user with a read-only root filesystem

Both applications: `runAsNonRoot`, all capabilities dropped, no privilege
escalation, `readOnlyRootFilesystem`. The API writes nothing — no uploads, logs
to stdout, its SQL is in the image. nginx needs three writable paths (its
rendered config, its cache, its temp files) and they are `emptyDir` in memory.

`runAsNonRoot` in the pod is not a duplicate of `USER node` in the Dockerfile.
The Dockerfile is a statement of intent by whoever wrote it; this is the cluster
refusing to start the pod if that intent was not carried out.

### The version pins go all the way down

`mysql:8.4.6`, `quay.io/keycloak/keycloak:26.4.2`,
`node:24.19.0-bookworm-slim`, `nginxinc/nginx-unprivileged:1.29-alpine`. Never
`latest`, never a bare major. A floating tag is how a deployment stops matching
the machine the tests were written on, months later, in a failure that looks
like the code.

---

## What this is not

**It is not a production deployment, and several things say so out loud.**

- **Keycloak runs `start-dev`** with its database inside the container. It
  loses everything when the pod is rescheduled — which is survivable only
  because the realm is re-imported from a ConfigMap on every start, and is
  exactly wrong anywhere real. Production runs `start --optimized` against an
  external database, with TLS.
- **The realm is the development one**, with three published passwords and
  fixed user ids. A real deployment imports a realm with no `credentials` block
  at all.
- **Mailpit is the realm's SMTP server.** It accepts every message and delivers
  none, which is what makes registration's email verification workable on a
  review cluster. The Service is named `mailpit` rather than
  `feedbackhub-mailpit` because the realm file names the host and the realm
  file is shared with compose. A real deployment drops `k8s/31-mailpit.yaml`
  from the kustomization and names its relay in the realm's `smtpServer`.
- **`k8s/11-secret.yaml` holds development values in plain `stringData`.** It
  is written that way deliberately rather than base64-encoded, because base64
  is not encryption and writing it as though it were teaches people to read a
  Secret as protected. A real deployment removes that file from the
  kustomization and creates the same three keys from a secret manager; nothing
  else changes, because the Deployments refer to the Secret by name and never
  to its contents.
- **There is no TLS.** Adding a `tls:` block whose certificate nobody has
  created produces an ingress that silently serves nothing, which is worse than
  an obviously plain-HTTP development one. With cert-manager it is an
  annotation and a `tls:` block naming the two hosts.
- **There is no HorizontalPodAutoscaler, no NetworkPolicy and no
  ServiceMonitor.** Each of those needs something the cluster has to provide —
  a metrics server, a CNI that enforces policy, an operator — and a manifest
  referring to machinery that is not there fails in the least useful way
  available: silently.

## Verification status

**Applied to a real cluster, and signed into.** kind v0.30.0, Kubernetes
v1.34.0, ingress-nginx.

| | |
|---|---|
| `kubectl apply -k . --dry-run=server` | every object accepted by the API server |
| Full apply | 16 objects created; MySQL, Keycloak, 2× API, 2× web all Running |
| Migration Job | `Complete`, `succeeded: 1`, schema at 12 |
| The API's init container | logged `ENOTFOUND` → `ER_NO_SUCH_TABLE` → `schema at 12; this image expects 12`, then let the pod start |
| The boot guard in-cluster | API booted under `NODE_ENV=production` against the cluster issuer |
| Ingress | `/` and `/auth/callback` both 200 through the controller; the SPA fallback holds |
| The API through the web tier | `/api/auth/config` 200, `/api/requests` 401 — and no Ingress of its own |
| Keycloak on its own host | discovery issuer exactly matches what the API compares `iss` to |
| A real sign-in | authorization code + PKCE end to end: 9 checks, the seeded admin **matched** onto row 1, no role in the payload |
| Mailpit (2026-08-28) | `kubectl apply -k . --dry-run=server` accepted the Service, the Deployment and the re-generated realm ConfigMap; then applied for real — see the note below |

**The cluster's Keycloak has not been restarted since the realm gained
registration.** `kubectl apply -k .` updated the ConfigMap and created Mailpit,
but Keycloak imports the realm at pod start, so the running pod still serves
the realm without registration until it is rolled
(`kubectl -n feedbackhub rollout restart deploy/feedbackhub-keycloak`) or the
deploy script is run again. The registration path itself was verified end to
end through the compose stack, not the cluster — the record is in
`notes/handoff.md`.

One warning, from the API server rather than from the manifests:
`spec.SessionAffinity is ignored for headless services` on the MySQL Service.
It is emitted against a field Kubernetes defaults in itself, and is cosmetic.

**What applying it caught that rendering did not:** the realm's `redirectUris`
named only `http://localhost:4200`, so sign-in at the cluster hostname was
refused with `Invalid parameter: redirect_uri`. A rendered manifest cannot
show that — the manifests were all correct; the thing they mounted was not.
See `notes/ai-log.md`.

### Still untested

**A redeploy that adds a migration while replicas are running.** Both branches
of the init container have been run inside the real image against a real MySQL,
so the logic is covered; the *sequence* is not. Nobody has yet deployed at
version 12, added migration 13, and watched new pods hold in `Init` while the
old ones keep serving. That is the case this init container exists for and the
one case it has not met.
