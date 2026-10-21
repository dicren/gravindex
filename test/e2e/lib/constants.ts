// Everything the behaviour suite needs to know about *where* it runs and *what
// it is allowed to leave behind*.
//
// ⚠️ Local by construction. Nothing here may ever point at
// `indice.gravina82.com` or any other server that is not this machine — see the
// repo's `AGENTS.md`. The one media host that appears at all (`media.example.com`,
// which serves the fixture's mp3s and cover images) is **intercepted, never
// requested**: `lib/media.ts` answers for it.

import { resolve } from 'node:path';

// ⚠️ `__dirname`, not `import.meta.url`. The repository root has no
// `"type": "module"`, so Playwright transpiles these files to CommonJS and
// `import.meta` is a syntax error at load time — the config fails before a
// single test is collected.
export const REPO_ROOT = resolve(__dirname, '..', '..', '..');

/**
 * The Vite dev server, which proxies `/api` to the backend. ⚠️ `5174`, not
 * Vite's usual `5173` — this suite runs `npm run test:frontend`, its own
 * instance pointed at the disposable test database, deliberately on a port a
 * normal `npm run dev` session never binds. See `test/testdb/`.
 */
export const APP_URL = (process.env.E2E_APP_URL ?? 'http://localhost:5174').replace(/\/+$/, '');

/**
 * The backend, hit directly for the two things the dev server cannot do: the
 * API calls this suite makes on its own behalf, and the server-rendered
 * `index.html` that carries the social meta tags (the dev server serves the raw
 * one, with no injection at all — which is exactly why the meta-tag group must
 * not go through it). ⚠️ `3001`, the dedicated `npm run test:backend` instance
 * — never `3000`, which may be someone's regular main-db-connected dev server.
 */
export const API_URL = (process.env.E2E_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

/**
 * Every row this suite creates carries one of these so the cleanup can find it
 * again without guessing. ⚠️ Nothing is ever deleted by "recently created" or by
 * id range — for the same reason: a
 * heuristic like that eventually eats real data.
 *
 * ⚠️ No `_` and no `%` in it, deliberately: the marker goes straight into a
 * `LIKE` pattern, where `_` matches ANY single character. A marker such as
 * `__e2e__` would make `title like '__e2e__%'` mean "any two characters, then
 * `e2e`, then any two" — a delete that could reach a real clip.
 */
export const WRITE_MARKER = 'e2e-marker';

/**
 * The anonymous voter token prefix. ⚠️ It is not anybody's: the token is
 * deliberately personal-data-free, so no request carries a person in it. The
 * shape is the 8-4-4-4-12 hex the backend validates, and the leading `e2e00000`
 * segment is what makes `token like 'e2e00000-%'` a safe delete — every
 * row without a token has a NULL token.
 */
export const TOKEN_PREFIX = 'e2e00000-0000-4000-8000-';
export const TOKEN_SQL_PREFIX = 'e2e00000-';

export function voterToken(suffix: string): string {
  const hex = suffix.padStart(12, '0').slice(-12);
  return `${TOKEN_PREFIX}${hex}`;
}

/**
 * The pristine row counts of the fixture, asserted before AND after every run.
 *
 * ⚠️ The teardown asserts these too, and a single stray row from this
 * suite would silently poison every comparison it makes. That is why the
 * teardown fails loudly instead of tidying quietly.
 *
 * ⚠️ **`vote` is 227.** Every vote is positive, so the fixture carries no
 * negative rows.
 */
export const PRISTINE_COUNTS: Readonly<Record<string, number>> = {
  episode: 395,
  clip: 180,
  tag: 382,
  vote: 227,
  playback: 3648,
};

/**
 * The episode the interactive groups work on: 11 clips, the most in the
 * catalogue, so there is always a second card to prove "only one plays at a
 * time" with.
 */
export const TEST_EPISODE_ID = 93;

/** Scratch database for the ingestion group. ⚠️ Never `gravindex`: that one
 *  holds the real community data and this group inserts rows of its own. The
 *  `gravindex_test_` prefix is what keeps it recognisable as throwaway. */
export const INGEST_DATABASE = 'gravindex_test_e2e_ingest';
