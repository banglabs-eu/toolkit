#!/usr/bin/env bash
# Deploy focus.bang-labs.eu from origin/main, on the Hetzner box.
#
#   ./deploy-main.sh
#
# The same shape as backend.toolkit/deploy-main.sh — read that one first; the
# refusals here are the same and for the same reasons. There is no dev/prod
# split: this is one static page and a dev copy is `python3 -m http.server`.
#
# Losing this loses nobody a block — the page keeps its own record in the
# browser, and the CLI does not go through here at all.
set -euo pipefail
cd "$(dirname "$0")"

export COMPOSE_PROJECT_NAME=focus-web-prod
PORT=8016

# --- an image built from uncommitted code cannot be reproduced or rolled
#     back. ALLOW_DIRTY=1 overrides, and tags the image -dirty so it shows.
if [ -z "${ALLOW_DIRTY:-}" ] && [ -n "$(git status --porcelain -- .)" ]; then
  echo "Refusing: web.focus has uncommitted changes. Commit, or set ALLOW_DIRTY=1." >&2
  git status --short -- . >&2
  exit 1
fi

# --- must be on main, and fast-forward it to origin/main
branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != main ]; then
  echo "Refusing: on branch '$branch', not main. Merge to main, then run this from main." >&2
  exit 1
fi
echo "==> syncing main to origin/main"
git fetch --quiet origin
if ! git merge --ff-only origin/main >/dev/null 2>&1; then
  echo "Refusing: local main has diverged from origin/main — reconcile it first." >&2
  exit 1
fi
SHA="$(git rev-parse --short HEAD)"
[ -z "${ALLOW_DIRTY:-}" ] || SHA="${SHA}-dirty"
echo "    at $SHA  $(git log -1 --format=%s)"

echo "==> building focus-web:$SHA"
IMAGE_TAG="$SHA" docker compose build --quiet
IMAGE_TAG="$SHA" docker compose up -d
docker tag "focus-web:$SHA" focus-web:latest

echo "==> health check: http://127.0.0.1:$PORT/healthz"
for _ in $(seq 1 10); do
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    echo "    ok — focus-web is up on :$PORT ($SHA)"
    exit 0
  fi
  sleep 1
done
echo "WARNING: /healthz did not answer on :$PORT within 10s." >&2
echo "  docker compose -p $COMPOSE_PROJECT_NAME logs --tail=50" >&2
exit 1
