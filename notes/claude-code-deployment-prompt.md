# Deployment slice — containers and manifests

The brief lists Dockerfiles, a compose file and Kubernetes manifests as graded deliverables, and says a local distribution — kind, k3d, minikube — is entirely acceptable because what is being assessed is the manifests and the configuration approach, not a cloud deployment.

Everything built so far has been pointing at this: pinned versions, environment-driven configuration, the boot guard, secrets never compiled in. This slice is where that discipline becomes visible in one place.

---

## Dockerfiles

**API** — multi-stage: build with dev dependencies, ship production dependencies and `dist/` only. Non-root user. The pinned Node version, matching `.node-version` and `engines` exactly — never a floating tag. A healthcheck that reflects actual readiness rather than the process merely being alive.

**Web** — build the Angular bundle, serve it from a static server. The final image contains no Node toolchain and no source.

**The configuration problem for the frontend, which I want solved deliberately rather than by accident:** the Angular bundle is built once but must run against different API URLs, issuers and client IDs per environment. Compiling those into the bundle at build time defeats environment-driven configuration and forces a rebuild per environment. Tell me your approach — a small runtime configuration file served alongside the bundle and fetched before bootstrap is the usual answer, but say what you propose and why, and how it interacts with the single bootstrap request already in place.

Both images need a sensible `.dockerignore`. Neither may contain the development realm file, the test key material, or anything from `.env`.

---

## Compose

Complete the existing file so one documented command brings up MySQL, Keycloak, the API and the web app, with migrations and seed applied, and the board usable.

Dependency ordering must be on health, not on start — the API waiting for MySQL to accept connections and Keycloak to be ready, not merely for the containers to exist.

All configuration from the environment, with `.env.example` documenting every variable the system reads. No credential is a literal in the compose file.

State plainly in the README which compose services are for local review only.

---

## Kubernetes manifests

Enough to deploy the application and be read as considered. At minimum: deployments and services for API and web, configuration separated from secrets, an ingress or equivalent entry point, probes wired to the same endpoints the containers use, resource requests and limits, and the migration job run as a job rather than at container start.

**That last point matters and I want it reasoned about, not assumed:** running migrations on container start breaks the moment there is more than one replica, because they race. Say how you handle it.

Secrets are declared as Kubernetes secrets, referenced by name, with no values committed. Show what a real deployment would supply.

The manifests should make the environment boundary obvious: what changes between local and a real cluster should be values, not structure.

---

## The boot guard, in this context

`NODE_ENV=production` with a development identity mode must still refuse to start — and that refusal should now be visible in the deployment story, since the container is the thing that would carry it. Confirm it holds inside the built image, not only in the test suite.

---

## README

The deployment section of the README lands with this slice, not later: prerequisites, the commands, what comes up, the seeded credentials, how to reach Keycloak, and what to change for a real environment.

---

## Before you start

Tell me your approach to frontend runtime configuration and to migrations under multiple replicas. Wait for my answer on both.
