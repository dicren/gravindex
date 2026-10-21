#!/usr/bin/env bash
#
# Deploy one tag to production, with a health check and a rollback.
#
# Installed as `/usr/local/bin/gravindex-deploy` and the ONLY thing the
# `deploy` user's SSH key is allowed to run:
#
#     ssh deploy@prod.dicren.com v2.0.0
#
# The tag arrives in `SSH_ORIGINAL_COMMAND` (sshd sets it for a forced
# command), is validated against a semver-shaped whitelist, and is used to
# check out the matching tag of the clone at /opt/gravindex. The image for that
# tag was already built and pushed to GHCR by GitHub Actions.
#
# Sequence: fetch → checkout → record the tag in `.env` → pull → up -d → wait
# for `/api/health` through the container healthcheck → on failure, check out
# the previously deployed tag and bring that back.
#
# ⚠️ The checkout is detached HEAD on purpose. The server is a deployment
# target, not a working copy: nothing is ever developed there, and `-f` is what
# makes a retried deploy start from a clean tree.
#
# ⚠️ Everything runs under `flock`: a second deploy (or the watchdog, which
# takes the same lock) waits instead of racing the first one.
#
set -euo pipefail

REPO=/opt/gravindex
STATE=/var/lib/gravindex
COMPOSE_FILE="$REPO/docker-compose.prod.yml"
ENV_FILE="$REPO/.env"
IMAGE=ghcr.io/dicren/gravindex

log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; logger -t gravindex-deploy -- "$*" 2>/dev/null || true; }
die() { log "ERROR: $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "must run as root"

# `ssh host v2.0.0` sets SSH_ORIGINAL_COMMAND; `ssh host` (no argument) leaves
# it empty and is useless here. Strip whitespace and validate before it reaches
# a git command.
TAG="${1:-${SSH_ORIGINAL_COMMAND:-}}"
TAG="${TAG//[[:space:]]/}"

[ -n "$TAG" ] || die "usage: <tag> (for example v2.0.0)"
[[ "$TAG" =~ ^v?[0-9]+(\.[0-9]+){1,2}(-[0-9A-Za-z][0-9A-Za-z.-]*)?$ ]] ||
  die "refusing tag '$TAG': not a version tag"

install -d -m 0755 "$STATE"
exec 9>"$STATE/deploy.lock"
flock -w 120 9 || die "another deploy is still running"

cd "$REPO" || die "$REPO does not exist"

PREV="$(cat "$STATE/deployed-tag" 2>/dev/null || true)"

compose() {
  docker compose --project-directory "$REPO" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

# `IMAGE_TAG` is interpolated from `.env`, so the value has to be persisted:
# exporting it for this shell alone would leave a reboot pointing at the old
# image.
set_image_tag() {
  if grep -q '^IMAGE_TAG=' "$ENV_FILE"; then
    sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$1/" "$ENV_FILE"
  else
    printf 'IMAGE_TAG=%s\n' "$1" >>"$ENV_FILE"
  fi
}

wait_healthy() {
  local id status
  for _ in $(seq 1 72); do
    id="$(compose ps -q gravindex-api 2>/dev/null || true)"
    if [ -n "$id" ]; then
      status="$(
        docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || echo none
      )"
      case "$status" in
        healthy) return 0 ;;
        unhealthy) return 1 ;;
      esac
    fi
    sleep 5
  done
  return 1
}

log "deploying $TAG (previous: ${PREV:-none})"

git fetch --tags --force --prune origin || die "git fetch failed"
git rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null || die "tag '$TAG' does not exist on the remote"

log "checking out tags/$TAG"
git checkout -f "tags/$TAG" || die "git checkout failed"

set_image_tag "$TAG"

# Fail before touching the running stack if the checked-out compose file is not
# valid with this `.env`. A missing variable is a silent empty string otherwise.
compose config -q || die "docker-compose.prod.yml does not validate"

log "pulling $IMAGE:$TAG"
compose pull gravindex-api || die "docker pull failed"

log "starting the stack"
compose up -d --remove-orphans || die "docker compose up failed"

if wait_healthy; then
  printf '%s\n' "$TAG" >"$STATE/deployed-tag"
  log "deployed $TAG"
  # Old images pile up at roughly 1 GB per tag; a week is enough to roll back.
  docker image prune -f --filter 'until=168h' >/dev/null 2>&1 || true
  exit 0
fi

log "the new API never became healthy — last 80 log lines follow"
compose logs --tail=80 gravindex-api || true

if [ -z "$PREV" ] || [ "$PREV" = "$TAG" ]; then
  die "no previous tag to roll back to; the stack is left as it is"
fi

log "rolling back to $PREV"
git checkout -f "tags/$PREV" || die "rollback checkout failed"
set_image_tag "$PREV"
compose up -d --remove-orphans || die "rollback compose up failed"

if wait_healthy; then
  log "rollback to $PREV succeeded"
else
  log "rollback to $PREV ALSO failed"
fi

# Non-zero either way: the deploy itself did not succeed.
exit 1
