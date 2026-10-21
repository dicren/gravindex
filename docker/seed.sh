#!/bin/sh
#
# The one-shot that puts real data into a fresh main stack, and the guard that
# stops it doing so twice.
#
# Run by the `gravindex-seed` compose service, which depends on the API being
# HEALTHY — not merely started. That ordering is the whole trick: the backend
# applies its migrations in `DatabaseModule.onModuleInit`, before Nest binds the
# HTTP port, so "the API answers `/api/health`" already means "the schema is
# there". No separate migration step, and no second copy of the migration logic.
#
# ⚠️ This is the ONE compose service that can write to the database that ships
# to production, and it is deliberately dumb: it loads exactly one SQL file
# (`packages/backend/seed/gravindex.seed.sql`, produced by `npm run db:export`
# and git-ignored, so it exists only on the machine that made it) with `psql`.
# A clone without that file starts with an empty catalogue. It has no `--force`
# flag. There is no command anywhere in this repository that can make
# it overwrite a database that already has clips in it.
#
# Two ways out, in order:
#
#   1. Clips already present  → leave the database alone, exit 0.
#   2. Otherwise              → load the local seed, in one transaction.
#
# ⚠️ Case 1 is the important one, and it is the ONLY guard left: loading is a
# seed, not a merge, so re-running it against a populated database would
# silently discard anything written since (a vote cast, a clip cut). Skipping
# when the site already has clips is what makes `docker compose up` safe to run
# repeatedly. If you genuinely need to reload from scratch, that is now a
# deliberate `docker volume rm gravindex_db` by hand — never a one-line script.
#
set -eu

SEED_FILE=/app/packages/backend/seed/gravindex.seed.sql
API_URL="${SEED_API_URL:-http://gravindex-api:3000}"

if [ "$#" -gt 0 ]; then
  echo "seed: unknown option '$1' (this script takes no arguments)" >&2
  exit 2
fi

# ── 1. Does the site already have data? ─────────────────────────────────────
# Asked of the API rather than of postgres, because the API is what this service
# already waits on and because it needs no database client of its own beyond
# `psql`. `total` is the clip count the library page pages through.
total=$(node -e '
  fetch(process.env.SEED_API_URL + "/api/clips?page=1&limit=1")
    .then((response) => (response.ok ? response.json() : Promise.reject()))
    .then((body) => console.log(typeof body.total === "number" ? body.total : "unusable"))
    .catch(() => console.log("unreachable"));
')

case "$total" in
  0)
    echo "seed: database is empty, loading the local seed."
    ;;
  unreachable | unusable)
    # Refuse to guess. Loading blind could overwrite a populated database;
    # skipping blind could leave an empty one looking deliberate.
    echo "seed: could not read the clip count from $API_URL — not touching the database." >&2
    exit 1
    ;;
  *)
    echo "seed: the database already holds $total clips, leaving it alone."
    exit 0
    ;;
esac

# ── 2. Load ──────────────────────────────────────────────────────────────────
if [ ! -s "$SEED_FILE" ]; then
  # Not an error: a clone never has the local snapshot, and the stack is still
  # meant to come up. The catalogue fills from the feed instead.
  echo "seed: no local snapshot at $SEED_FILE, the catalogue starts empty."
  echo "seed: fill it from the feed with 'node dist/ingest/ingest.cli.js'."
  exit 0
fi

PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 --single-transaction -q -f "$SEED_FILE"
echo "seed: loaded $SEED_FILE"
