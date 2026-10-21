#!/usr/bin/env bash
#
# Lifecycle control for the disposable Postgres that `test:e2e` runs against —
# never `gravindex-db`, which ships to production and
# has no script left anywhere in this repo that can wipe it.
#
#   testdb.sh up             start the gravindex-test-db container, wait for health
#   testdb.sh down           stop it (keeps the volume)
#   testdb.sh reset          down + wipe ONLY the gravindex_test-db volume + up
#   testdb.sh migrate        run pending migrations against it
#   testdb.sh seed           migrate, then load the synthetic fixture (test/testdb/fixture.sql)
#   testdb.sh status         what is running
#   testdb.sh psql           open a psql shell on it
#
# ⚠️ `reset` NEVER touches `db`/`gravindex_db` — the volume it removes is named
# explicitly, `gravindex_test-db`, and only that. No command in this script (or
# anywhere else) runs a blanket `docker compose down -v`.
#
# Every subcommand that spawns a node/npm process (`migrate`, `seed`, `verify`)
# EXPORTS DB_HOST/DB_PORT itself before doing so, so it can never fall through
# to whatever the root `.env` happens to say and land on the main database by
# omission.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
DB_SERVICE=gravindex-test-db
VOLUME_NAME=gravindex_test-db
TEST_DB_PORT="${TEST_DB_PORT:-5434}"

dc() { docker compose --profile test "$@"; }

die() {
  echo "testdb: $*" >&2
  exit 1
}

# ⚠️ Only these two are overridden. DB_USER/DB_PASSWORD/DB_NAME are the same
# credentials the main stack uses (compose passes them to both containers), so
# they are left to come from the developer's own `.env` as usual.
export_test_env() {
  export DB_HOST=localhost
  export DB_PORT="$TEST_DB_PORT"
}

wait_healthy() {
  local tries=60 id state
  id="$(dc ps -q "$DB_SERVICE")"
  [ -n "$id" ] || die "$DB_SERVICE is not running."
  for _ in $(seq "$tries"); do
    state="$(docker inspect -f '{{.State.Health.Status}}' "$id")"
    [ "$state" = healthy ] && { echo "testdb: $DB_SERVICE healthy"; return 0; }
    [ "$state" = unhealthy ] && die "$DB_SERVICE reported unhealthy."
    sleep 2
  done
  die "$DB_SERVICE never became healthy."
}

cmd_up() {
  cd "$REPO_ROOT"
  dc up -d "$DB_SERVICE"
  wait_healthy
  echo "testdb: ready on 127.0.0.1:$TEST_DB_PORT"
}

cmd_down() {
  cd "$REPO_ROOT"
  dc rm -sfv "$DB_SERVICE" >/dev/null
  echo "testdb: stopped (volume kept; use 'reset' to reload)"
}

cmd_reset() {
  cmd_down
  docker volume rm -f "$VOLUME_NAME" >/dev/null
  echo "testdb: $VOLUME_NAME wiped"
  cmd_up
  cmd_seed
}

cmd_status() {
  cd "$REPO_ROOT"
  dc ps -a "$DB_SERVICE"
}

cmd_psql() {
  cd "$REPO_ROOT"
  dc exec "$DB_SERVICE" psql -U "${DB_USER:-gravindex}" -d "${DB_NAME:-gravindex}" "$@"
}

cmd_migrate() {
  export_test_env
  cd "$REPO_ROOT"
  npm run build -w packages/backend
  npm run migration:up -w packages/backend
}

cmd_seed() {
  cmd_migrate
  cd "$REPO_ROOT"
  dc exec -T "$DB_SERVICE" psql -U "${DB_USER:-gravindex}" -d "${DB_NAME:-gravindex}" \
    -v ON_ERROR_STOP=1 -1 -q <"$REPO_ROOT/test/testdb/fixture.sql"
  echo "testdb: loaded test/testdb/fixture.sql"
}

case "${1:-}" in
  up) cmd_up ;;
  down) cmd_down ;;
  reset) cmd_reset ;;
  migrate) cmd_migrate ;;
  seed) cmd_seed ;;
  status) cmd_status ;;
  psql)
    shift
    cmd_psql "$@"
    ;;
  *)
    awk 'NR>1 && /^#/ {sub(/^# ?/, ""); print; next} NR>1 {exit}' "${BASH_SOURCE[0]}"
    exit 1
    ;;
esac
