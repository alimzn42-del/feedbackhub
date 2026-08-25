# syntax=docker/dockerfile:1.7

# ═══════════════════════════════════════════════════════════════════════════
#                              THE API IMAGE
#
# BUILD CONTEXT IS THE REPOSITORY ROOT, not api/. This is an npm workspace:
# the lockfile and the workspace declaration live at the root, and a build from
# api/ would have neither. From the root:
#
#     docker build -f api/Dockerfile -t feedbackhub-api .
#
# THE NODE TAG IS PINNED TO THE PATCH. `.node-version` and `engines.node` both
# name 24.19.0, so this does too — never `node:24`, never `lts`, never
# `latest`. A floating tag is how a container stops matching the machine the
# tests were written on, months later, in a failure that looks like the code.
# ═══════════════════════════════════════════════════════════════════════════
FROM node:24.19.0-bookworm-slim AS base
WORKDIR /repo


# ── Dependencies ───────────────────────────────────────────────────────────
# Manifests only, so this layer is rebuilt when dependencies change and not
# when a line of source does.
FROM base AS dependencies

COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/

# `npm ci` and not `install`: the lockfile decides, and a resolution that
# differs from the one the tests ran against is a different application.
# --ignore-scripts: nothing in this dependency tree needs a postinstall, and a
# build that runs arbitrary code from a package is a build that can be
# surprised.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts


# ── Compile ────────────────────────────────────────────────────────────────
FROM dependencies AS build

COPY api/ api/

# tsconfig.build.json excludes *.test.ts AND *.test-support.ts, so the code
# that signs access tokens for the test suite is absent from what is copied
# below rather than present and guarded. See api/src/auth/tokens.test-support.ts.
RUN npm run build --workspace api


# ── Runtime dependencies ───────────────────────────────────────────────────
# A second, production-only install rather than pruning the first: `npm ci`
# from the same lockfile is reproducible, and `prune` leaves whatever it
# happened to leave.
FROM dependencies AS runtime-dependencies

RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --workspace api --include-workspace-root


# ── The image that ships ───────────────────────────────────────────────────
FROM base AS runtime

ENV NODE_ENV=production
# A Node process in a container should size its heap to the container's limit,
# not to the host's memory. Without this an OOM kill looks like a crash.
ENV NODE_OPTIONS=--max-old-space-size=384

COPY --from=runtime-dependencies /repo/node_modules ./node_modules
COPY --from=runtime-dependencies /repo/package.json ./package.json
COPY --from=build /repo/api/package.json ./api/package.json
COPY --from=build /repo/api/dist ./api/dist

# The migration and seed scripts are plain .mjs and are NOT compiled — they run
# outside the application and read the environment directly. They resolve their
# SQL relative to themselves, so the .sql files come too. This is what lets the
# same image run the migration job in Kubernetes.
COPY --from=build /repo/api/scripts ./api/scripts
COPY --from=build /repo/api/src/db/migrations ./api/src/db/migrations
COPY --from=build /repo/api/src/db/seeds ./api/src/db/seeds

WORKDIR /repo/api

# `node` (uid 1000) ships with the image. Running as root inside a container is
# a privilege nothing here needs, and Kubernetes refuses it outright under the
# runAsNonRoot in k8s/30-api.yaml.
USER node

EXPOSE 3000

# No curl or wget in a slim image, and adding one to check a health endpoint
# means shipping a shell utility so a probe can use it. Node is already here.
# Kubernetes uses its own httpGet probes and ignores this; it is for compose.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Exec form, so the process is PID 1 and receives SIGTERM directly. src/main.ts
# handles it and closes the server and the pool before exiting; a shell form
# would put /bin/sh in front and swallow the signal.
CMD ["node", "dist/main.js"]
