# AGENTS.md

Working notes for coding agents in this repository. Read this before making
changes. `packages/backend/AGENTS.md` and `packages/frontend/AGENTS.md` cover
what is specific to each package — read the relevant one too when working inside
that folder, and when two files disagree the nearer one wins.

> **What belongs in THIS file.** The index and the cross-package contract: what
> exists, where it lives, and the facts a reader of one side must know about the
> other (HTTP API, data model, URLs, env vars). Not the "why" of a mechanism —
> that belongs next to the code that executes it, or in that folder's
> `AGENTS.md`.
>
> **Keep it in sync** when a change moves something indexed here (API surface,
> data model, routes, deployment contract).

## What this project is

**Gravindex** ("Índice gravinero") is a web app that indexes and plays **clips**
(cuts) of the Spanish podcast [gravina82](https://gravina82.com). Anyone — no
login, no account — can:

- browse/search a library of clips, filter by tag, sort, and **queue** them into a
  player that follows you across the whole site;
- upvote a clip and add tags to it;
- share that queue as a link, or a single clip by its permalink;
- open an episode and cut a **new** clip from it with an in-browser editor
  (pick start/end over the episode's audio, title it, tag it, publish it).

Episodes are **not** hosted: the backend ingests episode metadata (title, cover,
publish date, the URL of the `.mp3`) from the podcast's RSS feed, and the
browser streams that remote mp3 directly, seeking to the clip's `start` and
stopping at its `end`. A "clip" is therefore just `(episode, start, end, title)`
— there is no audio file of its own anywhere.

There is also a small **admin surface** behind a username/password login, for
editing and deleting clips and tags. It is the only authenticated part of the
system.

It is a personal/community project by Dicren for the podcast's audience. Content
belongs to gravina82; the code is MIT.

## Repo layout

An **npm-workspaces monorepo** (`workspaces: ["packages/backend",
"packages/frontend"]`), one root lockfile, one root `node_modules`. Both
packages are at **`2.0.1`**.

| Path | Stack | Role |
|---|---|---|
| `packages/backend/` | NestJS 12, MikroORM 7 (PostgreSQL), Express | The `/api` REST API, the RSS ingestion job, **and serving the built SPA with injected Open Graph tags** |
| `packages/frontend/` | Vue 3, Vuetify 4, Vite, Pinia + Pinia Colada, strict TypeScript | The whole UI: library, episode list, clip permalink, clip editor, admin |

| Root file / folder | What it is |
|---|---|
| `package.json` | Private, unversioned root. `engines.node >= 24`. Fan-out scripts (`build`, `test`, `lint`, `type-check`), `dev` / `dev:backend` / `dev:frontend`, the `stack:*` and `db:*` docker helpers, `test:db:*` / `test:backend` / `test:frontend` for the disposable test stack, `test:e2e`, and **`validate`** |
| `tsconfig.base.json` | The shared strict TS baseline each package extends. Deliberately omits `module`, `moduleResolution`, `outDir`, `types` and the decorator flags — the two packages genuinely disagree on those |
| `eslint.config.mjs` | Flat config (eslint 10) with **two exports**: `base`, carrying no repo-layout paths, spread by each package; and the `default` used from the root, which ignores `packages/**`. **Bans `any` repo-wide**, and is not type-aware on purpose |
| `.prettierrc`, `.prettierignore`, `.editorconfig` | Single quotes, trailing commas, 100 columns. `.prettierignore` skips `*.md`, `openapi.json`, MikroORM's snapshots and the generated API client |
| `docker-compose.yml` | Compose project `gravindex`. `gravindex-db` (Postgres 16-alpine, ⚠️ **the database that ships to production — nothing in this repo wipes it**), `gravindex-api`, one-shot `gravindex-seed`, and a disposable `gravindex-test-db` behind a **`test`-profile** |
| `docker-compose.prod.yml` | The stack that runs on `prod.dicren.com`: the same database and API, plus Caddy for TLS, with **no published ports except 80/443**. It pulls `ghcr.io/dicren/gravindex:${IMAGE_TAG}` instead of building, and keeps a one-shot `gravindex-seed` behind a **`seed` profile** |
| `Dockerfile` | Multi-stage: `deps` → `build` (both workspaces) → `prod-deps` → `runtime`. The runtime image runs the backend, bakes `SPA_DIST_PATH` at the frontend build it copied in, and carries `psql` plus `packages/backend/seed/` for `gravindex-seed` to load (the SQL file is git-ignored, so a clone's image has none) |
| `deploy/` | Production runbook (`README.md`), the `Caddyfile`, `caddy/` (the custom Caddy image with the rate-limit module) and `server/` — the deploy, watchdog, backup, email and heartbeat scripts plus their systemd units. Installed on the server by `deploy/server/install.sh` |
| `.github/workflows/pipeline.yml` | The only workflow: lint + types + unit tests on every push/PR; on a `v*` tag, also Playwright, **two** GHCR images (the app and the custom Caddy), the SSH deploy and a GitHub Release built from the web changelog |
| `.env` / `.env.example` | The **one** environment file for everything — see "Environment". `.env` is gitignored, the template is committed |
| `test/` | `testdb/` (lifecycle for the disposable Postgres the e2e suite runs against), `e2e/` (Playwright) — see "Tests and validation" |
| `docker/seed.sh` | The `gravindex-seed` entrypoint: loads the local `packages/backend/seed/gravindex.seed.sql` into a fresh `gravindex-db`, skips if clips already exist, and exits 0 without loading when the file is absent. No `--force`, no other data source |
| `docker/export-seed.sh` | `npm run db:export` — snapshots the live `gravindex-db` into that local seed. Manual, human-run |
| `packages/backend/seed/` | The local seed (`gravindex.seed.sql`) a fresh main database loads from. Git-ignored, so only `.gitkeep` is tracked (the Dockerfile `COPY`s the directory). Generated by `db:export`, never hand-edited, never committed: it carries third-party episode text and the community's activity |

## How the two halves talk

The frontend is a **pure SPA**; it never server-renders. Its HTTP client is
**generated from the backend's OpenAPI document** (`@hey-api/openapi-ts`), so
there are no hand-written endpoint strings anywhere in it.

The API base URL is `VITE_API_BASE_URL`, and **empty — the default — means same
origin**. That is what production wants (the backend serves both the SPA and the
API) and what split dev wants too, because the Vite dev server proxies `/api` to
the backend. Set an absolute origin only to bypass that proxy, which then needs
`CORS=true` on the backend.

**The contract file is `packages/backend/openapi.json`**, and it is committed.
Regenerate it with `npm run openapi -w packages/backend`, then regenerate the
client with `npm run generate:api -w packages/frontend`. ⚠️ Changing an endpoint
without doing both leaves a client that lies about the server.

### HTTP API (all under the `/api` global prefix)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health` | Liveness + version. Touches no database |
| `GET` | `/clips` | Query: `page` (1-based), `limit` (def. 10, **max 100**), `order`, `search`, `tags` (repeatable). Returns `{ results, total }`, each row with `up` and `points` (**numbers, and the same number**), its episode and its tags |
| `GET` | `/clips/:id` | Clip + `episode` + `tags` + `up`. ⚠️ **No `points`** — see "Vote counts" below |
| `GET` | `/clips/:id/related` | Up to **six** clips sharing a tag, ordered by shared tags, then `up`, then id. A bare array of `GET /clips` rows; empty for a clip with no tags |
| `POST` | `/clips` | Body `{ start, end, title, tags: string[], episode: id }`. `X-Voter-Token` optional |
| `POST` | `/clips/:id/play` | Fire-and-forget play counter. Returns `{ id }`. **Stores no identity at all** |
| `POST` | `/clips/:id/vote/:value` | `value` is `1`, and **only** `1`. `X-Voter-Token` **required**. ⚠️ **201** — see below |
| `POST` | `/clips/:id/tag/:value` | `409 Conflict` `"Tag repeated"` if the pair already exists. `X-Voter-Token` optional |
| `GET` | `/episodes` | Query: `page`, `limit`, `search` (⚠️ **title only**), `withClips`. Rows carry `clipCount` |
| `GET` | `/episodes/:id` | Episode + `clips` + `clips.tags`, each clip carrying `up`. ⚠️ **Never `points`** |
| `GET` | `/episodes/:id/waveform` | Query: `from`, `to` (seconds, both optional), `points` (max 2000). Returns `{ from, to, points, peaks }`, `peaks` base64. ⚠️ **200 with an empty `peaks` for an episode not measured yet — never a 404 for that** |
| `GET` | `/episodes/:id/audio` | ⚠️ **Binary, not JSON.** A same-origin passthrough to `episode.file`: forwards the incoming `Range` verbatim and streams the upstream `audio/mpeg` response back untouched — no audio processing in this process. Exists only because gravina82.com sends no CORS headers; see "The UI" below for why. No `Range` serves the whole file. `502`/`504` on an upstream failure/timeout |
| `GET` | `/tags` | Flat array of `{ tag, count }`, in **code-point order** |
| `POST` | `/auth/login` | `{ username, password }` → `{ token, … }`. **200**, not 201. One failure shape for every cause |
| `GET` | `/admin/me` | Is this token still good? Bearer JWT, as all `/admin/*` |
| `GET`·`PATCH`·`DELETE` | `/admin/clips/:id` | Read / edit / hard-delete a clip (`204` on delete) |
| `PATCH`·`DELETE` | `/admin/clips/:id/tags` | Rename / remove one tag. ⚠️ The tag is a **query parameter**, never a path segment |

Interactive docs at `/api/docs` (Swagger UI).

Four facts that are pinned by tests:

- ⚠️ **A repeated vote answers HTTP `201`**, not 200 and not an HTTP error, with
  `{ add: 0, delete: 0, error: 'you have already voted' }`. It is Nest's POST
  default, never overridden, and **the frontend branches on that exact string**.
  ⚠️ Note the asymmetry: a repeated **tag** really is a `409`. The two write
  paths disagree with each other and **both behaviours are the specification**.
  ⚠️ `delete` is always `0`; the field survives only because it is part of the
  response shape.
- ⚠️ **The tag filter's wire format is `tags[]=`**, the shape of every filter
  link ever shared. The backend accepts **both** `tags` and `tags[]` and treats
  them identically; the generated client sends the canonical `tags`.
- ⚠️ **`search` and `tags[]` interact.** With a search present, a clip satisfies
  `tags[]=X` only if the search matched its title, its episode's title, or tag X
  itself: the search narrows the tag rows *before* the tag filter sees them.
  **This is deliberate**; the mechanism and the measured numbers are in
  `packages/backend/AGENTS.md`. Making the two filters independent is a
  **product decision**, not a cleanup.
- ⚠️ **`GET /tags` is code-point order**, pinned with an explicit
  `collate "C"`. Without it the result reorders under a different Postgres
  locale, and every capital-vs-lowercase and accented tag lands somewhere else.
  The library's filter re-sorts the 102 rows **by count, in the browser** —
  the wire order is the one pinned by a test.

`order` values: `points` (default), `clip.createdAt`, `episode.date`, always
descending with an id tiebreak. Anything else is a **400**: it is a whitelist and
never interpolated into SQL.

### Vote counts are not a column, and there is only one of them

`up` and `points` are **not** persisted; they are aggregated from the `vote`
table at read time and attached to the response DTO.

⚠️ **`up` is the only vote.** The endpoint answers 400 to `-1`, and the whole
product has one vote button: `up` is the number of people who pressed it.

What each endpoint carries, and why they differ:

| Endpoint | `up` | `points` |
|---|---|---|
| `GET /clips` | yes | yes — **the same number**, kept because `order=points` is in shared links |
| `GET /clips/:id` | yes | no |
| `GET /clips/:id/related` | yes | yes (they are `GET /clips` rows) |
| `GET /episodes/:id` | yes | never has |

⚠️ **`up` on `GET /clips/:id` is deliberate.** The clip permalink and the global
player both draw a vote count for a clip opened by URL, and there is no other
source for it. Anything that changes this must change both halves.

### Identity: an anonymous token

**No IP is stored anywhere.** Identity is a random UUID the client generates
once and keeps in `localStorage`, sent as the **`X-Voter-Token`** header.

- **Required on `POST /clips/:id/vote/:value`** — the dedup is a unique
  constraint on `(clip, token)`, and Postgres does not collide NULLs, so a null
  token would make every repeat vote succeed silently. Missing → 400.
- **Optional** on `POST /clips` and `POST /clips/:id/tag/:value`, where it is
  only a moderation trail. Missing → stored as NULL.
- **`playback` has no identity column at all.**
- ⚠️ It is **client-supplied and therefore spoofable**: a deduplication hint,
  never proof of who anyone is, and nothing in the admin surface may read it. It
  is also **not** a browser fingerprint (that would be *more* personal data) and
  **not** the admin JWT. Clearing storage defeats it, and that is accepted — the
  catalogue holds 227 votes. The threat that scales is automated abuse, and the
  defence for that is rate limiting, which stores nothing. ⚠️ In production
  Caddy rate-limits by client IP before the request reaches this process (see
  "Deployment"); that is a proxy concern, and nothing about it is stored here.
- ⚠️ **Losing the token is normal, not an error.** Cleared storage, private
  windows and second browsers all produce a fresh one; it just means a vote can
  be cast again. Never surface it, never try to recover it, never add a fallback
  identifier to make it stickier.
- ⚠️ **There is no IP column.** Votes, clips and tags carry the token instead,
  so the database holds no personal data. A row without a token (the column is
  nullable) does not block a repeat vote; that is noise across 227 votes.

## Data model (PostgreSQL)

MikroORM entities in `packages/backend/src/database/entities/`, schema built by
**real migrations** in `.../migrations/`. ⚠️ **`synchronize` stays off**: a
schema change is `npm run build && npm run migration:create`.

```
episode 1──n clip 1──n vote        (unique on (clip, token))
                 1──n playback     (append-only counter, no identity column)
                 1──n tag          (composite PK: clip + tag string)
user                               (admin accounts only)
```

- **episode** — `id`, `title`, `cover`, `file` (the remote mp3 URL),
  `originalUrl` (the ingestion dedup key), `date` (`timestamptz`, UTC),
  `duration` (seconds, **nullable permanently**), `waveform` (`bytea`,
  nullable — the measured audio waveform, `packages/backend/src/waveform/`;
  see that section for the format and why nothing else touches it),
  `description` (lazy, never surfaced in the UI).
- **clip** — `id`, `title`, `start`, `end` (both **seconds, integers**), FK
  `episode`, plus `token` and `createdAt` (lazy).
- **tag** — free text, no tag table of its own: a tag *is* the `(clip, tag)`
  pair. Rename and delete exist **only** in the admin surface.
- **vote** — `value` is `+1`, and **only** `+1`. One vote per `(clip, token)`.
  ⚠️ The column still allows a `-1` no endpoint accepts.
- **playback** — write-only; nothing in the app reads it back yet.
- **user** — `username`, `passwordHash` (bcrypt), `createdAt`. Nothing else: no
  email, no last-login, no IP.

⚠️ **Ids are public URLs.** `https://indice.gravina82.com/<id>` is a clip
permalink people share, and episode ids ride inside `/episode/<id>-<slug>`. The
ids are kept verbatim, gaps included: **clip ids 175 and 176 do not exist and
must keep 404ing**. Ids are never reused — deleting a clip through the admin
surface leaves its id dead, because Postgres sequences do not go backwards.

**Scale**: a small community catalogue of hundreds of episodes and clips. Small
enough that no query here needs to be clever, and small enough that a
sequential-scan search is invisible. Do not design for volume this project does
not have.

⚠️ **All 102 tags are exactly what they look like** — no leading space, no
trailing space, on any of the 382 rows. What is true is that **a tag is matched byte for byte**, so nothing may trim, fold or
case-normalise one on its way into `?tags[]=`.

## Frontend routes

| Path | Name | View |
|---|---|---|
| `/` | `home` | The library: search + tag filter + sort + an **infinite** list of clip rows |
| `/episodes/:page?` | `episodes` | Episode rows. ⚠️ The `:page?` param is vestigial and unused — the list is infinite and nothing paginates in the URL |
| `/episodes/calendario/:year?` | `episodesCalendar` | The same episode list drawn by date — `EpisodesView` renders it and branches on `route.name`, the way `/creator` renders `HomeView`. ⚠️ **The year is a PATH segment**, not a query parameter, and the filters ride in the query beside it |
| `/episode/:title` | `episode` | The episode **and** its clips: a map of the whole episode's waveform with the published clips drawn on it, one transport, and the list. ⚠️ Since 2026-08-26 it also carries **`Mis momentos`** — the visitor's own marks, over the wave and listed under it. `:title` is `"<id>-<slug>"` and **only the leading integer is parsed** |
| `/creator` | `creatorSearch` | It renders `HomeView` and opens the floating episode-search overlay over it; the route exists so a direct link and browser-back work |
| `/creator/:title` | `creator` | The clip editor. ⚠️ Takes `?start`, `?end` and `?moment` since 2026-08-26 — the window a marked moment opens it on, and which mark it came from |
| `/cola` | `queue` | The play queue: reorder, remove, share by link |
| `/about` | `about` | Static page + hand-written changelog |
| `/admin/login` | `adminLogin` | The only unguarded admin route |
| `/admin` | `adminClips` | Admin clip list, behind `meta.requiresAdmin` |
| `/admin/clips/:id` | `adminClip` | Edit/delete one clip and its tags |
| `/error/404`, `/error` | `error404`, `errorUnknown` | Real routes, with real URLs |
| `/:id` | `clip` | Clip permalink. ⚠️ Catch-all-ish: any single unmatched segment lands here |
| `/:pathMatch(.*)*` | `E404` | Renders the 404 **where it is**, without redirecting |

All views are lazy-loaded. History mode is on, so **the server must serve
`index.html` for unknown paths** — which the backend does itself.

⚠️ **`/cola` carries a public URL shape in `?c=`.** A shared queue travels as
base62 clip ids, two characters each, up to 50 clips — the format is frozen the
moment somebody sends one. It is in
`packages/frontend/src/vue/utils/queue-code.ts` with the arithmetic that fixes
its limits.

⚠️ **The queue can hold a WHOLE EPISODE**, and two consequences reach this
file. `localStorage`'s `gravindex.queue` stores **kinded keys** (`c12` a clip,
`e93` an episode) rather than bare ids, and still reads the older
`{ ids: number[] }` shape as clips so that a stored queue is not emptied.
⚠️ **It also stores `at`, the position inside the item it points at** — seconds
into that clip or episode, so closing the tab half-way through a three-hour
episode and coming back tomorrow presses play and carries on. The length of what
plays here is what makes the position worth keeping, and the invariant that keeps
it honest is that **`at` always describes `keys[index]`**, written in the same
call. Like the queue itself it never reaches the server: see
`packages/frontend/AGENTS.md`, "Where you were listening".
And **an episode cannot travel in a `?c=` link** — two base62 characters carry an
id and nothing that says which kind it is — so a shared queue carries the clips
and leaves the episode behind, which `/cola` says out loud before the link is
copied. Widening the format would break every link already in the wild; that is
the trade that was taken.

### Social previews

⚠️ **There is no reverse proxy and no `User-Agent` detection anywhere.** The
backend serves the built SPA and **injects the Open Graph / Twitter meta tags
into `index.html` itself** when the requested path is a clip (`/:id`) or an
episode (`/episode/:slug`). Everyone — browser and crawler alike — receives the
same HTML; the browser ignores the tags and boots the SPA as usual.

Crawlers and visitors receive the same HTML, so the tags are testable with `curl`
and no bot list is involved. There is no separate social-preview page; the
mechanics (escaping, where the block is inserted, why a clip that does not exist
still gets a 200) are in `packages/backend/AGENTS.md`, and the check is
`test/e2e/specs/09-meta-tags.spec.ts`.

### The PWA (2026-08-27)

The site is **installable** and **keeps itself on the newest build without ever
saying so**. Three static files join the build output and are served by the same
`express.static` as everything else in `dist/` — the backend needed no change at
all:

| URL | What |
|---|---|
| `/manifest.webmanifest` | Generated by `vite-plugin-pwa`, which also injects the `link` that points at it into the built `index.html`. `Gravina82` is the launcher label; `Índice gravinero` the full name |
| `/sw.js` | The service worker, built from `packages/frontend/src/vue/pwa/sw.ts` |
| `/icons/*.png` | Five committed PNGs — two `any`, two `maskable`, one for iOS |

⚠️ **The service worker sends every navigation to the network**, and that is a
consequence of the section above rather than a caching preference: the document
is DIFFERENT per URL because the backend injects the title and the Open Graph
tags into it, and nothing in the client puts a title back. A precached shell
answered for every route — which is what Workbox's `generateSW` does by default —
would silently retitle every shared permalink `Índice gravinero`. The precache
holds the hashed assets and is the offline branch only.

⚠️ **A new build is applied silently, and never on top of what somebody is
doing**: not while audio is playing, and not on the clip editor or the admin clip
screen, where there is unsaved work. There is no "a new version is available"
notice anywhere and there must not be one. The mechanism and the five decisions
behind it are in `packages/frontend/AGENTS.md`, "The PWA".

## Environment

**One file: the root `.env`**, gitignored, with `.env.example` as its committed
template (`cp .env.example .env`). It feeds three consumers at once —
`docker-compose.yml`'s `${...}` substitution, the backend's `ConfigModule`, and
the SPA build through Vite's `envDir`. There are no per-package env files.

⚠️ **Real environment variables win over the file** on the backend side, which
is what makes the docker case (values injected, no file at all) work with the
same code. ⚠️ And setting a variable here does **not** inject it into a
container: anything a service needs at runtime must also appear in its
`environment:` block.

| Key | Who reads it |
|---|---|
| `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_HOST`, `DB_PORT` | Compose and the backend. `DB_PORT` is the **host** port, `5433` in the template, deliberately not 5432 |
| `SERVER_PORT`, `BACKEND_PORT` | The port the API listens on locally, and the host port the container publishes. Same default (3000) on purpose, so the Vite proxy needs no configuration |
| `CORS` | Opt-in; only needed when something bypasses the Vite proxy |
| `PUBLIC_URL` | ⚠️ The absolute origin used to build `og:url`. A relative one is ignored by every crawler, and it cannot be derived from the request |
| `SPA_DIST_PATH` | Where the backend looks for the built SPA. Absent is not fatal — the API runs and warns. Baked into the image |
| `JWT_SECRET` | ⚠️ **No default; the backend refuses to boot without it.** A fallback constant is a key everyone with this public repo knows |
| `INGEST_CRON`, `INGEST_TIMEZONE`, `INGEST_FEED_URL`, `INGEST_TIMEOUT_MS` | The scheduled ingestion job. `off`/`false`/`no`/`0`/empty disables it |
| `WAVEFORM_ENABLED`, `WAVEFORM_MAX_PER_RUN`, `WAVEFORM_FFMPEG_PATH`, `WAVEFORM_TIMEOUT_MS` | The waveform top-up chained after every ingestion tick. `WAVEFORM_ENABLED` off disables it (ingestion still runs); needs `ffmpeg` on `PATH`, whose absence degrades to a per-episode warning, never a boot failure |
| `TEST_DB_PORT` | Host port for the disposable `gravindex-test-db` (profile `test`), `5434` in the template. `test:e2e` runs against it, never against `gravindex-db` |
| `VITE_API_BASE_URL` | Build-time. Empty = same origin |
| `BACKEND_URL` | Dev server only, never bundled: the Vite `/api` proxy target |
| `VITE_GA4_ID` | ⚠️ Empty is a working configuration: no id ⇒ no analytics, no cookie, **no consent banner**. That is the normal state in dev and in this public repo |

## Running it

```bash
cp .env.example .env     # set JWT_SECRET
docker compose up        # or: npm start
```

That brings up Postgres, the API (which applies pending migrations before it
listens, and serves the built SPA), and a one-shot seed container that loads
the local `packages/backend/seed/gravindex.seed.sql` if it exists and skips if
the database already has clips. The site is then on `http://localhost:3000`
and needs nothing else to start. A clone has no seed file, so
its catalogue starts empty; `node dist/ingest/ingest.cli.js` fills in the
episodes from the feed, but no clips, votes or tags come with the repository.

⚠️ **There is no script anywhere in this repo that wipes or reloads
`gravindex-db`** — it is the database that ships to production. A
`docker compose up`/`stack:up` that finds it already populated leaves it
alone, permanently; refreshing the local seed from current data is
`npm run db:export`, run by hand.

For frontend work with HMR, leave the backend in docker and run the Vite dev
server on its own (`npm run dev:frontend`, port 5173); it proxies `/api` to the
compose backend, so nothing needs configuring and CORS is not involved. Full
instructions, in Spanish, are in the `README.md` — keep the two in step.

Other useful root scripts: `stack:up|down|logs|build`, `db:up|down|logs|psql`,
`db:migrate`, `db:export`. For the disposable test stack (e2e, never the main
database): `test:db:up|down|reset|migrate|seed|psql`,
`test:backend`, `test:frontend` — see "Tests and validation".

## Tests and validation

```bash
npm run validate   # lint + type-check + unit tests + e2e
```

Two layers, and the distinction matters when one goes red:

| Layer | Command | What it is |
|---|---|---|
| **Unit** | `npm test` | **691** Jest tests (backend) + **1135** Vitest tests (frontend). ⚠️ Several backend suites need a **live Postgres**; each builds its own `gravindex_test_*` database and never touches `gravindex`. ⚠️ **No frontend unit test may reach the network** — jsdom serves from `http://localhost:3000`, which IS the dev backend, so `vitest.setup.ts` makes the default `fetch` throw. It is there because a spec once wrote 39 real rows |
| **E2E** | `npm run test:e2e` | **130** Playwright tests over the real browser: debounce, infinite scroll, request cancellation, URL filters, the queue and its share links, playback, vote/tag, the editor, the slider, the injected meta tags, ingestion, mis momentos, the calendar, two tabs |

⚠️ **e2e needs a running candidate backend and a disposable database —
neither is `gravindex-db`.** `npm run test:db:up && npm run
test:db:seed` (or `test:db:reset`) brings up `gravindex-test-db` and loads it
from the synthetic fixture `test/testdb/fixture.sql`, then `npm run test:backend` /
`npm run test:frontend` run a dedicated backend/frontend pair on `:3001`/`:5174`
pointed at it — deliberately different ports from the normal `npm run dev` loop
(`:3000`/`:5173`), so `test:e2e`'s `reuseExistingServer` can never attach to a
main-db-connected dev session by accident. `test/testdb/testdb.sh` is the
lifecycle script (`up`/`down`/`reset`/`migrate`/`seed`/`psql`); `reset`
wipes only the `gravindex_test-db` volume, by exact name, never a blanket
`docker compose down -v`.

⚠️ **Nothing in the test tree ever prints an IP.** The schema has no IP column, so
the disposable database carries no addresses at all.

The e2e suite runs single-worker with **no retries** on purpose — it writes to
the same database whose exact row counts its setup asserts, and flakiness here
is a finding to report, not a number to raise. It snapshots row counts **and
sequences** before the run and fails teardown on any drift.

## Conventions

- **Git**: commit messages are in Spanish, imperative-ish, one line.
- **Language**: **user-facing copy is Spanish**, written straight into the
  templates — there is no i18n layer and the app is not going multilingual, the
  voice is part of it. Identifiers, code comments and `AGENTS.md` files are
  **English**.
- **Versions** are kept in lockstep by hand: both `package.json`s,
  `packages/backend/src/constants/version.ts`, and the changelog in
  `packages/frontend/src/vue/views/AboutView.vue`.
- `any` is banned repo-wide by lint. Where it is genuinely unavoidable, disable
  it inline **with a comment saying why**.
- **Coding agents own testing their own changes.** Write whatever tests a
  change genuinely calls for — a regression test for a bug fix, coverage for a
  new behaviour — without waiting to be asked; match the layer to what changed
  and the surrounding file's existing style (see "Tests and validation").
  Do not add speculative tests for behaviour the change did not touch.

## The API contract

The API is a contract: every query-string shape, status code and empty-state
message is something a client may depend on, and it is governed by its own
tests. A change to it is deliberate and shows up in those tests.

⚠️ **Anything changed in passing is a deviation**, and a deviation has to be a
conscious, recorded decision. The convention is that each one carries a comment
at the code that makes it, saying so; `grep -rn "recorded deviation"` over
`packages/` is the index. Examples of what that looks like: the editor's three
handles **clamp instead of crossing**, the list views have an error branch, and
`tags=` (unbracketed) means the same filter as `tags[]=` instead of silently
matching nothing.

### Deliberate API behaviour

1. **The admin surface** — a `user` table, bcrypt hashes, a login endpoint, a
   JWT guard and a small UI to edit and delete clips and tags. It closes a real
   hole: without it an ugly cut or an abusive tag can only be removed with
   hand-written SQL. ⚠️ **The first user is inserted by
   hand** — no seed, no CLI — so the `INSERT` must carry an already-hashed
   password (`npm run hash-password -w packages/backend`). A plaintext one just
   fails to log in.
2. **Ingestion is a scheduled job with no HTTP surface.** No endpoint triggers
   it: an unauthenticated GET that fires outbound requests and writes to the
   database is exactly what this avoids. The feed is read as RSS — see
   `packages/backend/AGENTS.md`, "Ingestion".
3. **There is no IP column anywhere.** Identity is the anonymous voter token
   above, and nothing else.

Two other decisions are not API contract: **GA4** (behind a hand-rolled consent
banner, no library) and the fact that the backend serves the SPA. The UI below
is the largest change of all.

⚠️ Items 1–3 are also why `grep -rn "recorded deviation"` lists so many comments:
every screen was built once, so the UI half of that index is the UI's own
decisions. A comment there means "this differs on purpose", not "this is
unusual".

## The UI (accepted 2026-08-18, built 2026-08-19)


The public UI is the specification of why the app looks like this, and this file
plus each package's `AGENTS.md` is where it is written down.

⚠️ **The UI is governed by this document.** The **API** is still governed by its
own tests, and that has not loosened by a millimetre.

What this file has to state, all of it detailed above:

- **`GET /clips/:id` carries `up`**, `GET /episodes` carries `clipCount` (and takes
  `withClips`), `GET /tags` answers `{ tag, count }`, and `GET /clips/:id/related`
  exists.
- **Only positive votes exist** — endpoint, DTOs, payloads: `down` is on nothing.
- **`/cola` is a route** and `?c=<base62>` a public URL shape.
- **Every list is infinite**; no page number travels in a URL (`limit` is not
  persisted either — the batch size is the design's, not the visitor's).

One thing it deliberately did NOT do, a decision rather than a gap:

- **The admin surface keeps its own, unrestyled look** — white cards, Vuetify
  controls, `GravPagination`. That is correct, not pending.

⚠️ **Audio download is built (2026-08-20), without a server-side re-encode.**
A real download does not need one — no ffmpeg, no disk cache, no endpoint burning
CPU and bandwidth per request: an MP3 is a sequence of independent frames, so a
clip is cut **entirely in the browser** by copying bytes out of small `Range`
reads — no decoding, no re-encoding, no audio processing on this project's
own servers at all. See `packages/frontend/src/core/application/audio/mp3-frames.ts`.
`GET /episodes/:id/audio` exists only because gravina82.com sends no CORS headers, so
the frontend cannot `fetch()` it directly; the endpoint is a same-origin passthrough that
relays the upstream's bytes untouched. Playback is unaffected — `<audio>` still loads
gravina82.com directly.

⚠️ **The episode list can be drawn as a CALENDAR (2026-08-27), and it needed no backend
change either.** `/episodes/calendario/:year?` renders the same screen — same rail, same
three filters, same header — with the middle replaced by a strip of every month the
podcast has ever had, a year of day grids under it, and the day you pick as a floating
layer over the top. It exists because a date-ordered infinite list cannot show what this
catalogue's shape actually is: seventeen years, a stretch where the catalogue stopped
growing and the RSS feed came back, and the fact that **almost every clip was cut from
2010 and 2011**.

⚠️ **The year travels in the PATH, and that is forced rather than chosen.**
`use-list-filters.ts` rebuilds the whole query string from its own filters on every
commit, so a `?a=2011` beside them would be erased the moment somebody typed in the
search box; and declared *among* them it would be counted by `activeFilterCount` and
cleared by `Limpiar filtros`. So: filters in the query, the view in the path. Entering
**pushes** one history entry — Back returns to the list — and every year change after
that **replaces**, which is the same rule `router.replace({ query })` already applies to
every filter on this site. The three filters all apply to the calendar, `Con mis
momentos` included.

⚠️ **The whole catalogue arrives in six requests**, through a new
`ListAllEpisodesUseCase` that loops `GET /episodes?limit=100` — the endpoint's maximum.
No aggregate endpoint, no `openapi.json` change, no new declared difference: 589 rows is
~35 KB, and this is the project that says not to design for volume it does not have.
The mechanism and the five decisions behind it are in `packages/frontend/AGENTS.md`,
"The calendar".

⚠️ **`Mis momentos` (2026-08-26): a private mark on an episode, and NOT a row in the
database.** While an episode plays, one button in the player — repeated in the episode's
own transport — marks the second that is sounding; `/episode/:id` then draws those marks
in a lane over its wave and lists them under it, where each can be listened to from 20 s
before, cut into a real clip, or forgotten. The episode list gains a third `Mostrar`
state, `Con mis momentos`.

⚠️ **It needed no backend change at all, and that is the decision rather than the
shortcut.** A moment says *which episode, at which second, on which day somebody was
listening* — a listening trail, more personal than the vote this project already refuses
to attach to a person — so it lives in `localStorage` under `gravindex.moments`, the sixth
key, and nothing about it ever reaches the server. The only identity available would be
`X-Voter-Token`, which lives in that same storage, so a server copy would be exactly as
losable and would cost the database its "not one personal column" property. Losing them is
normal, like losing the token, and every screen that shows them says `solo en este
navegador`. ⚠️ Two consequences reach this file: **`Con mis momentos` is a filter the API
cannot answer**, so with it on the list is assembled in the browser out of
`GET /episodes/:id` (and the title search runs locally); and **`/creator/:id` now takes
`?start`, `?end` and `?moment`**, which is the whole path a moment has out of the browser
it lives in — cut it, publish it, and the mark keeps the clip's id so the row reads
`ya es el corte nº 137`. The mechanism and the five decisions behind it are in
`packages/frontend/AGENTS.md`, "Mis momentos".

⚠️ **The waveform behind the player is measured now (2026-08-19), and drawn only as a
fallback.** `GET /episodes/:id/waveform` serves real peaks computed offline, server-side,
from the downloaded mp3 — see `packages/backend/src/waveform/` and
`packages/backend/AGENTS.md`, "Waveforms" — so the browser still never decodes
audio itself, and `GravWave.vue` still falls
back to its original deterministic pseudo-random shape, seeded by the clip id, for any
episode that has not been measured yet or while the request is in flight.

⚠️ **The episode page plays the episode (2026-08-25), and it needed no backend
change at all.** `/episode/:id` draws the whole episode's measured waveform with
its published clips as bands over it, and the episode sounds through the **one
global player**, as a queue item beside the clips — the alternative, an audio
element owned by that screen the way the editor owns its own, was rejected
because a row on this site has no play button precisely so that there is one
transport, and because leaving the page would cut a three-hour episode off. Its
length comes from `GET /episodes/:id/waveform`'s `to`, which is the same request
the drawing needs (`GET /episodes/:id` has never carried a duration), and the
nine unmeasured episodes fall back to what the browser reports. The empty state
stopped being a 220 px slab with a white-backgrounded PNG on it; the art was
re-exported with a real alpha channel and is a watermark now. ⚠️ The joke is
unchanged, in all three places it appears.

⚠️ **The `2.0.1` changelog entry lives in `AboutView.vue`**, written by hand, and
the version is `2.0.1` in both `package.json`s and in `constants/version.ts`.

## Deployment

The stack is **two images** — the backend serving the API and the built SPA,
and a Caddy built with the rate-limit module — plus Postgres. Nothing external
is fetched at boot (see "Running it").

Production is `prod.dicren.com` (`54.37.157.210`), public at
**https://indice.gravina82.com**, running `docker-compose.prod.yml`.

**A deploy is a tag.** Pushing `v2.0.1` runs the pipeline, which tests, builds
and pushes `ghcr.io/dicren/gravindex:v2.0.1` **and**
`ghcr.io/dicren/gravindex-caddy:v2.0.1`, then SSHes into the server where the
forced-command deploy script checks out that tag, writes it into
`/opt/gravindex/.env`, pulls every image, restarts the stack, and waits for
`/api/health` **and** for the public URL to answer through Caddy. If either does
not, the script checks out the previously deployed tag and brings that back. A
push to `develop` only runs the fast tests; it never deploys.

After a successful deploy the pipeline publishes the **GitHub Release**, with
notes taken from the version's entry in the web changelog
(`packages/frontend/src/vue/views/AboutView.vue`) by
`deploy/changelog-notes.mjs`. ⚠️ A tag without a changelog entry fails the
release job on purpose; add the entry before tagging.

⚠️ The server is a deployment target, not a working copy: `/opt/gravindex` sits
on a **detached HEAD** at the deployed tag, and `deploy/server/install.sh`
updates the root-owned scripts and units separately. The full runbook — logs,
backups, restore, bootstrap, secrets — is `deploy/README.md`.

Two things worth knowing: `VITE_API_BASE_URL` is **baked in at build time**, so
an image is environment-specific unless it reads runtime config instead (the
same-origin default makes this a non-issue); and no proxy in front of it needs to
know anything about crawlers.

### What keeps it up

| Mechanism | Failure it covers |
|---|---|
| `restart: unless-stopped` | The process exits |
| `gravindex.service` + `live-restore` | The machine or the Docker daemon restarts |
| `gravindex-watchdog.timer` | The container is **alive but unhealthy** — Docker records that verdict and does not act on it |
| `gravindex-heartbeat.timer` + healthchecks.io | The whole box, the DNS record, the certificate or Caddy — the checks above all live *on* the machine and cannot report it being gone |

The heartbeat is a **dead man's switch**: it pings healthchecks.io every minute,
but only when `https://indice.gravina82.com/api/health` answers `ok`. Silence
raises an email. It is the only mechanism here that lives outside the server.

### Rate limiting

`deploy/Caddyfile` limits by client IP: `login` 5/min, `audio` 60/min, writes
30/min and `/api` 300/min. ⚠️ **Requests, not bytes** — see "Known gaps".

### Backups

A nightly `pg_dump` lands in `/var/backups/gravindex` (14 days), taken **inside**
the database container so the credentials never reach the host, and the same
file is emailed to the address in `MAIL_TO` through an authenticated SMTP relay
(`deploy/server/gravindex-send-backup.py`, configured in
`/etc/gravindex/mail.env`). ⚠️ The destination is environment-only: no backup
address is written anywhere in this repository. ⚠️ A relay is not optional: the
domain's MX is a provider and the VPS has a generic PTR, so mail sent directly
from it fails SPF. Both copies are a copy, not a backup system; neither survives
losing the VPS *and* the mailbox, which is why the local one is still the
primary.

## Known gaps

Real, deliberate, and recorded here so nobody rediscovers them as bugs:

- **Rate limiting caps requests, not bytes.** Caddy limits by client IP in
  production — `login` 5/min, `audio` 60/min, writes 30/min, `/api` 300/min, in
  `deploy/Caddyfile` — which is what stops scanners, brute force and naive
  loops. It does **not** cap bandwidth: `GET /episodes/:id/audio` still streams
  whatever the requested span weighs, and there is no cap on that span.
  ⚠️ **Closing that needs an edge (Cloudflare) or a bandwidth module**, not a
  bigger request limit. Per-IP limits are also shared by everyone behind one NAT.
- **`helmet`'s `contentSecurityPolicy` is off**, because the default blocks the
  inline bootstrap a Vite build emits. Turning it on is real work.
- **`playback` is still write-only** — nothing reads the counter back. ⚠️ It is
  written by `stores/queue.store.ts` (once per clip per queue position), not by a
  row.
- **Brave on Android plays nothing in the background until somebody turns it
  on.** `Background play` (`Ajustes → Media`) is **off by default** in Brave and
  no page can set it — it is the browser's own switch, above every API used here.
  ⚠️ Brave has also had real regressions of its own in this area
  (`brave-browser#51881`, *Media play on background stopped working on Android*),
  so "it stopped by itself" there is worth checking against the browser before
  this code. See `packages/frontend/AGENTS.md`, "Reproducción en segundo plano".
- **iOS/Safari has a ceiling, and it is not a bug here.** The system may sleep
  the whole page — MediaSession handlers included — once a phone is locked, so
  the next clip can advance on unlock rather than while the phone was in a
  pocket. Nothing a web page can ask iOS keeps it awake; only native audio apps
  do.
- **There is no audio cache, by design, so the queue stops in a tunnel.**
  Episodes are third-party mp3s streamed straight from `gravina82.com`; this
  project stores no copy — no `Cache Storage`, no blob, no re-encode — which is
  the same decision that keeps `GET /episodes/:id/audio` a byte pipe (see "The
  UI" and `packages/frontend/AGENTS.md`, "Audio download: cutting a clip
  client-side"). Losing the connection therefore loses the sound, and that is
  the trade rather than a missing layer.
- **Two tabs share one queue and one sound, and there is no remote control**
  (2026-10-27). The queue follows the tab that last wrote it — the browser's
  `storage` event, no new key, no new state — and a tab that starts sounding
  claims it over a `BroadcastChannel` so the others pause politely rather than
  playing underneath it. What stays out of scope is the rest of a "session":
  **a tab cannot press play, seek or skip in another one**, the position is still
  one number for one item (so the last listener wins it), and two writes landing
  in the same instant are still last-write-wins. See
  `packages/frontend/AGENTS.md`, "Dos pestañas".
- **Clips with `end <= start` may exist in the catalogue.** The API refuses to
  create one, but it does not retro-fix the ones already there.
- **`npm audit` still reports six high findings, and no upgrade fixes them.**
  They are one chain: `braces@3.0.3` → `micromatch@4.0.8` → `fast-glob` /
  `@boundaries/elements` → `@vue/eslint-config-typescript` /
  `eslint-plugin-boundaries`. `braces` 3.0.3 **is** its latest release, so every
  version that exists sits inside the advisory's range
  (GHSA-vfj7-8cjw-p6xm, stack exhaustion on deeply nested patterns);
  `npm audit fix --force` "solves" it by downgrading `eslint-plugin-boundaries`
  to 1.1.1, which the flat config cannot use. Only ESLint reaches it, over glob
  patterns this repo writes itself. ⚠️ Everything else `npm audit` used to
  report — `js-yaml`, and the `sprintf-js`/`argparse` pair behind it — is pinned
  out through `overrides` in the root `package.json`; revisit all of it when
  `braces` ships a patch.
- ✅ **All three** items on the README's wish list are built: the global
  persistent player with a queue, related clips on the clip view, and
  (2026-08-20) audio download — client-side, no server-side re-encode, see "The
  UI" above.
