#!/usr/bin/env bash
#
# The heartbeat that healthchecks.io watches, run by
# `gravindex-heartbeat.timer` every minute.
#
# ⚠️ This is a dead man's switch, not a probe: healthchecks.io never asks
# anything of this server. WE ping IT, and only when the site is actually
# answering. Silence is the alarm — which is the whole point, because it is the
# only mechanism here that can report a server that is entirely down, a DNS
# record that moved, an expired certificate or a Caddy that never came back.
#
# The check it pings should be configured with a period of 2 minutes and a grace
# of 2 minutes, so an outage raises the email in roughly four. See
# `deploy/README.md`.
#
# ⚠️ The ping URL is a secret: anybody who has it can tell healthchecks.io that
# everything is fine. It lives in `/etc/gravindex/heartbeat.env` (0600) and is
# never echoed.
#
set -euo pipefail

PING_URL="${HEALTHCHECKS_PING_URL:-}"
HEALTH_URL="${HEALTHCHECK_URL:-https://indice.gravina82.com/api/health}"

log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; logger -t gravindex-heartbeat -- "$*" 2>/dev/null || true; }

if [ -z "$PING_URL" ]; then
  log "HEALTHCHECKS_PING_URL is not set; not pinging (the check would go red)"
  exit 0
fi

# ⚠️ Through the PUBLIC url, on purpose: it is the only check that covers DNS,
# Caddy, the certificate and the API in one request. A container-local probe
# would stay green while the site was unreachable from outside.
body=""
if ! body="$(curl -fsS --max-time 10 "$HEALTH_URL" 2>/dev/null)"; then
  log "$HEALTH_URL did not answer; skipping the ping so healthchecks.io raises it"
  exit 1
fi

case "$body" in
  *'"status":"ok"'*) ;;
  *)
    log "$HEALTH_URL answered without \"status\":\"ok\"; skipping the ping"
    exit 1
    ;;
esac

if ! curl -fsS --max-time 10 "$PING_URL" >/dev/null 2>&1; then
  log "the site is up but healthchecks.io could not be reached"
  exit 1
fi
