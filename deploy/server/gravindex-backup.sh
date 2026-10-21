#!/usr/bin/env bash
#
# Nightly logical backup of the production database.
#
# `pg_dump` runs INSIDE the database container, so the credentials never leave
# it and the host needs no postgres client. The output is one compressed SQL
# file that `psql` can replay into an empty database (`--clean --if-exists`
# makes it replace an existing one).
#
# ⚠️ This is the only copy of the community's data that is not the live volume.
# It is deliberately a dump, not a copy of the volume: a volume copy of a
# running Postgres can be inconsistent, and a dump is something a human can
# read and restore one table from.
#
# Retention: 14 daily files. Every file is validated (`gzip -t`) before it is
# kept, so a failed dump never rotates a good one out.
#
set -euo pipefail

REPO=/opt/gravindex
COMPOSE_FILE="$REPO/docker-compose.prod.yml"
ENV_FILE="$REPO/.env"
BACKUP_DIR=/var/backups/gravindex
KEEP_DAYS=14

log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; logger -t gravindex-backup -- "$*" 2>/dev/null || true; }

[ "$(id -u)" -eq 0 ] || { echo "must run as root" >&2; exit 1; }

install -d -m 0700 "$BACKUP_DIR"

compose() {
  docker compose --project-directory "$REPO" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/gravindex-$stamp.sql.gz"
tmp="$out.partial"

# `POSTGRES_USER`/`POSTGRES_DB` are already set in the container by the compose
# file, so this reads them from there rather than re-parsing `.env`.
if ! compose exec -T gravindex-db sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' |
  gzip -9 >"$tmp"; then
  rm -f "$tmp"
  log "backup FAILED: pg_dump did not complete"
  exit 1
fi

if ! gzip -t "$tmp" 2>/dev/null; then
  rm -f "$tmp"
  log "backup FAILED: the dump is not a valid gzip stream"
  exit 1
fi

mv "$tmp" "$out"
log "wrote $out ($(du -h "$out" | cut -f1))"

find "$BACKUP_DIR" -type f -name 'gravindex-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
log "kept the last $KEEP_DAYS days, $(find "$BACKUP_DIR" -type f -name 'gravindex-*.sql.gz' | wc -l) file(s) on disk"
