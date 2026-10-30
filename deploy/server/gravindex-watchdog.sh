#!/usr/bin/env bash
#
# Health watchdog, run by `gravindex-watchdog.timer` every minute.
#
# Docker restarts a container whose process EXITS — that is what
# `restart: unless-stopped` buys. It does NOT restart a container that is still
# alive but no longer serving: a deadlocked event loop, a request handler stuck
# on a socket, a process that answers nothing while its PID is up. The
# container's healthcheck notices (it stops being `healthy` and becomes
# `unhealthy`), but Docker itself only records the verdict.
#
# This closes that gap: if the API's healthcheck says unhealthy, restart it.
# It also reconciles a missing or stopped container, which covers a Docker
# daemon restart that came back with the stack down (the systemd unit normally
# handles boot; this is the second pair of eyes).
#
# ⚠️ It takes the same `flock` as the deploy script, so it never restarts a
# container in the middle of a rollout, and a rollout never fights it.
#
set -euo pipefail

REPO=/opt/gravindex
STATE=/var/lib/gravindex
COMPOSE_FILE="$REPO/docker-compose.prod.yml"
ENV_FILE="$REPO/.env"

log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; logger -t gravindex-watchdog -- "$*" 2>/dev/null || true; }

[ "$(id -u)" -eq 0 ] || { echo "must run as root" >&2; exit 1; }

# A deliberate `systemctl stop gravindex` is a decision, not an outage: do not
# undo it. The timer is enabled separately, so it keeps running — this check is
# what makes it respect the unit's state.
if ! systemctl is-active --quiet gravindex.service; then
  log "gravindex.service is inactive; leaving the stack alone"
  exit 0
fi

install -d -m 0755 "$STATE"
exec 9>"$STATE/deploy.lock"
flock -n 9 || { log "a deploy holds the lock, skipping this pass"; exit 0; }

cd "$REPO" || exit 1

compose() {
  docker compose --project-directory "$REPO" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

for service in gravindex-db gravindex-api; do
  id="$(compose ps -aq "$service" 2>/dev/null || true)"

  if [ -z "$id" ]; then
    log "$service has no container; reconciling the stack"
    compose up -d --remove-orphans >/dev/null 2>&1 || log "compose up failed"
    continue
  fi

  running="$(docker inspect -f '{{.State.Running}}' "$id" 2>/dev/null || echo false)"
  if [ "$running" != "true" ]; then
    log "$service is not running; starting it"
    docker start "$id" >/dev/null 2>&1 || log "could not start $service"
    continue
  fi

  health="$(
    docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || echo none
  )"
  if [ "$health" = "unhealthy" ]; then
    log "$service is unhealthy; restarting it"
    docker restart "$id" >/dev/null 2>&1 || log "could not restart $service"
  fi
done
