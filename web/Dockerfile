# syntax=docker/dockerfile:1.7

# ═══════════════════════════════════════════════════════════════════════════
#                              THE WEB IMAGE
#
# BUILD CONTEXT IS THE REPOSITORY ROOT, for the same reason as the API image:
# the lockfile and the workspace declaration are there.
#
#     docker build -f web/Dockerfile -t feedbackhub-web .
#
# WHAT IS NOT IN HERE: any knowledge of the identity provider. The realm, the
# client id and the API's own address are asked for at runtime, from
# GET /api/auth/config — so there is no build argument, no environment file
# baked into a bundle, and no image that is only correct for one deployment.
# That was decided when the endpoint was written and this is where it pays.
# ═══════════════════════════════════════════════════════════════════════════
FROM node:24.19.0-bookworm-slim AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/

RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts

COPY web/ web/

# The production configuration: optimisation, output hashing, budgets. A build
# that breaches the budgets fails here rather than shipping.
RUN npm run build --workspace web


# ── The image that ships ───────────────────────────────────────────────────
#
# nginx-unprivileged rather than the stock nginx image: it listens on 8080 and
# runs as uid 101 with no capability to bind a low port, which is what lets the
# pod assert runAsNonRoot without a patched config.
FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime

# Where the API is, resolved at container start by the image's own envsubst
# pass over /etc/nginx/templates. Compose overrides it with `api:3000`;
# Kubernetes with the Service name. The default is the compose one because
# that is the case somebody runs by hand.
ENV API_UPSTREAM=api:3000

COPY web/nginx.conf.template /etc/nginx/templates/default.conf.template

# Angular 22 emits into dist/<project>/browser — the server directory beside it
# is for SSR, which this application does not use.
COPY --from=build /repo/web/dist/web/browser /usr/share/nginx/html

EXPOSE 8080

# wget is in the alpine base, so this costs nothing to add. Kubernetes uses its
# own httpGet probes; this is for compose.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/health || exit 1
