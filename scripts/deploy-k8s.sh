#!/usr/bin/env bash
#
# One command, and no credential in the repository.
#
#     ./scripts/deploy-k8s.sh
#
# The Secret the manifests refer to is created here rather than committed —
# see k8s/11-secret.example.yaml for its shape and for what a real deployment
# supplies instead. Everything else is `kubectl apply -k .`.
#
# Values come from the environment, with development defaults, so this script
# is also the local-review path:
#
#     DB_PASSWORD=... KEYCLOAK_ADMIN_PASSWORD=... ./scripts/deploy-k8s.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

NAMESPACE=feedbackhub
API_IMAGE=${API_IMAGE:-feedbackhub-api:local}
WEB_IMAGE=${WEB_IMAGE:-feedbackhub-web:local}

# Development defaults. A real deployment does not run this script — it
# materialises the same Secret from a secret manager and runs `kubectl apply -k .`
# against manifests that are byte-identical to these.
DB_PASSWORD=${DB_PASSWORD:-feedbackhub}
DB_ROOT_PASSWORD=${DB_ROOT_PASSWORD:-feedbackhub-root}
KEYCLOAK_ADMIN_PASSWORD=${KEYCLOAK_ADMIN_PASSWORD:-admin}

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "Building images"
docker build -f api/Dockerfile -t "$API_IMAGE" .
docker build -f web/Dockerfile -t "$WEB_IMAGE" .

# kind runs its own containerd; images built on the host are not visible to it
# until they are loaded in. Harmless and skipped when kind is not in use.
if command -v kind >/dev/null 2>&1 && kind get clusters 2>/dev/null | grep -qx feedbackhub; then
  say "Loading images into the kind cluster"
  kind load docker-image "$API_IMAGE" "$WEB_IMAGE" --name feedbackhub
fi

say "Namespace"
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

# --dry-run piped to apply, so re-running updates the Secret instead of failing
# on one that already exists.
say "Secret (created here, never committed)"
kubectl -n "$NAMESPACE" create secret generic feedbackhub-secrets \
  --from-literal=DB_PASSWORD="$DB_PASSWORD" \
  --from-literal=DB_ROOT_PASSWORD="$DB_ROOT_PASSWORD" \
  --from-literal=KEYCLOAK_ADMIN_PASSWORD="$KEYCLOAK_ADMIN_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -

say "Manifests"
kubectl apply -k .

# Generous, and deliberately so. On a cold cluster the mysql and keycloak
# images are pulled inside the node, which took thirteen minutes the first time
# this was run — long enough that a 5-minute wait reported a failure while the
# deployment was in fact working. Waiting on the backing services first also
# means the message on screen says which thing is slow.
say "Waiting for MySQL (first run pulls the image inside the node)"
kubectl -n "$NAMESPACE" wait --for=condition=ready pod \
  -l app.kubernetes.io/name=mysql --timeout=900s

say "Waiting for Keycloak"
kubectl -n "$NAMESPACE" rollout status deploy/feedbackhub-keycloak --timeout=900s

say "Waiting for the migration job"
kubectl -n "$NAMESPACE" wait --for=condition=complete job/feedbackhub-migrate --timeout=600s

say "Waiting for the application"
kubectl -n "$NAMESPACE" rollout status deploy/feedbackhub-api --timeout=600s
kubectl -n "$NAMESPACE" rollout status deploy/feedbackhub-web --timeout=600s

# Baseline content, and a decision rather than a consequence of deploying —
# which is why it is a step here and not part of the manifests. The seed file
# is idempotent, so re-running this is safe.
say "Seeding the baseline"
kubectl -n "$NAMESPACE" delete pod feedbackhub-seed --ignore-not-found >/dev/null 2>&1
kubectl -n "$NAMESPACE" run feedbackhub-seed \
  --image="$API_IMAGE" --restart=Never --attach --rm --quiet \
  --overrides="$(cat <<JSON
{"spec":{"containers":[{"name":"feedbackhub-seed","image":"$API_IMAGE","imagePullPolicy":"IfNotPresent",
"command":["node","scripts/seed.mjs"],
"envFrom":[{"configMapRef":{"name":"feedbackhub-config"}}],
"env":[{"name":"DB_PASSWORD","valueFrom":{"secretKeyRef":{"name":"feedbackhub-secrets","key":"DB_PASSWORD"}}}]}]}}
JSON
)"

say "Up."
cat <<'NEXT'
  Add these to your hosts file, pointing at the ingress controller:

      127.0.0.1  feedbackhub.local
      127.0.0.1  auth.feedbackhub.local

  Then http://feedbackhub.local — admin@feedbackhub.local / feedbackhub-dev
NEXT
