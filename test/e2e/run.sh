#!/usr/bin/env bash
#
# Wrapper around `playwright test` that points the whole process tree at the
# disposable `gravindex-test-db`, never at `gravindex-db` (the database that
# ships to production).
#
# ⚠️ Why this exists instead of just letting `playwright.config.ts`'s
# `webServer` entries carry DB_HOST/DB_PORT: the ingestion spec group
# (`specs/10-ingest.spec.ts`) spawns its OWN subprocesses (`ingest.cli.js`,
# `migration:up`) that inherit `process.env` directly — those are not children
# of the webServer entries, so they need DB_HOST/DB_PORT set on the OUTER
# process this script starts, not just on the backend dev server's command.
#
# Prerequisites: `npm run test:db:up && npm run test:db:seed` (or
# `npm run test:db:reset`) first — see `test/testdb/testdb.sh`.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

export DB_HOST=localhost
export DB_PORT="${TEST_DB_PORT:-5434}"
export E2E_DB_SERVICE=gravindex-test-db

cd "$REPO_ROOT"
exec npx playwright test --config test/e2e/playwright.config.ts "$@"
