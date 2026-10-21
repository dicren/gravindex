#!/usr/bin/env bash
#
# The inverse of `docker/seed.sh`: snapshot the live main database — the one
# that ships to production — into the local seed at
# `packages/backend/seed/gravindex.seed.sql`.
#
#     npm run db:export
#
# ⚠️ Manual, on purpose. Nothing in this repository calls this automatically:
# it is for a human to re-run once in a while, when the maintainer wants the
# local seed to catch up with real data (new episodes ingested, votes cast,
# clips cut). The output is git-ignored: it contains third-party text and the
# community's activity, so it is never committed.
#
# ⚠️ `-t` names exactly the five content tables, as an ALLOWLIST rather than an
# exclude list: `"user"` (admin accounts, bcrypt hashes) and
# `mikro_orm_migrations` can never end up in the local seed, even if a
# future table is added and someone forgets to update an exclude list.
# `--data-only` also carries the current value of every sequence backing those
# tables (verified against a real dump — the `setval(...)` calls come out
# alongside the `COPY` blocks), so ids keep landing exactly where the source
# database left them; nothing here needs to touch a sequence by hand.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="$REPO_ROOT/packages/backend/seed/gravindex.seed.sql"

if ! docker compose exec -T gravindex-db pg_isready -U "${DB_USER:-gravindex}" -d "${DB_NAME:-gravindex}" \
  >/dev/null 2>&1; then
  echo "export-seed: gravindex-db is not up. Start it with: docker compose up -d gravindex-db" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"

docker compose exec -T gravindex-db pg_dump \
  -U "${DB_USER:-gravindex}" -d "${DB_NAME:-gravindex}" \
  --data-only \
  -t episode -t clip -t tag -t vote -t playback \
  >"$OUT"

echo "export-seed: wrote $(wc -c <"$OUT") bytes to ${OUT#"$REPO_ROOT"/}"
