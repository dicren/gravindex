# AGENTS.md — backend

Working notes for coding agents inside `packages/backend/`. Read the root
`AGENTS.md` first (project purpose, HTTP API table, data model, env vars); this
file only covers what is specific to this package.

> Keep in sync when the module layout, the persistence setup, or any of the
> hazards below changes.

## What this is

A **NestJS 12 + MikroORM 7 (PostgreSQL)** application, version `2.0.0`. It is
three things in one process:

1. the **REST API** under the `/api` prefix, published as OpenAPI;
2. the **static host for the built SPA**, including the Open Graph meta tags it
   injects into `index.html`;
3. a **scheduled RSS ingestion job** with **no HTTP surface at all**.

Plus one CLI that is not the server: `ingest.cli.ts` (run ingestion once, by hand).

`src/main.ts` is the whole bootstrap and reads top to bottom: global prefix,
`helmet` (⚠️ **with `contentSecurityPolicy` off** — the default CSP blocks the
inline bootstrap a Vite build emits), the SPA registration, the global
`ValidationPipe`, conditional CORS, Swagger at `/api/docs`, shutdown hooks,
listen.

⚠️ **Order in `main.ts` and in `app.module.ts` is load-bearing.** `SpaModule` is
imported **last** because it owns the `index.html` catch-all and Nest matches
routes in declaration order; anything after it would 404 silently. And
`registerSpa()` is called from `main.ts` on the **Express adapter**, not from
inside the module — see "Serving the SPA" below.

## Module layout

```
src/
  main.ts  app.module.ts  openapi.ts  mikro-orm.config.ts
  constants/version.ts          APP_VERSION, a literal kept in lockstep with package.json
  common/
    dto/                        PaginationQueryDto (page/limit + defaults), PaginatedResponseDto
    http/voter-token.decorator  @VoterToken / @RequiredVoterToken
    validation/                 StrictInt, StrictBoolean, IsGreaterThan, toStringArray/dedupe, pipe options
  database/
    database.module|providers   MikroOrmModule.forRootAsync over mikro-orm.config
    entities/                   Clip · Episode · Tag · Vote · Playback · User
    migrations/                 the real migrations + MikroORM's snapshots
  api/
    health/                     GET /api/health — liveness + version, touches no database
    clips/     controller · service · clips.sql.ts · dto/ · *.testing.ts
    episodes/  controller · service · episodes.sql.ts · dto/ · episode-audio.proxy.ts
    tags/      controller · service · tags.sql.ts
  auth/                         login, the admin guard, and the /api/admin/* surface
  ingest/                       RSS feed client · parser · service · scheduler · CLI
  waveform/                     ffmpeg-driven peak extraction · service · CLI — see "Waveforms"
  spa/                          serving the built SPA and injecting the social meta tags
  scripts/                      generate-openapi.ts · hash-password.ts · download-episodes.ts
```

Every `api/*` module is the same shape: a thin controller carrying the OpenAPI
decorators, a service holding the logic, and — for the three that read — a
`*.sql.ts` of **pure functions over plain values** (no `EntityManager`, no
connection). That split is why the order whitelist, the filter builders and the
tag ordering all have suites that run in milliseconds without a database.

## Commands

Run from `packages/backend/`, or with `-w packages/backend` from the root.

| Command | What it does |
|---|---|
| `npm run dev` | `nest start --watch` |
| `npm run build` | `nest build` → `dist/` |
| `npm test` | Jest. ⚠️ Some suites need a live Postgres — see "Tests" |
| `npm run type-check` | `tsc --noEmit` |
| `npm run openapi` | Builds, then writes `openapi.json` — the file the frontend's client is generated from |
| `npm run hash-password -- 'pw'` | Prints a bcrypt hash for the hand-written first-admin `INSERT` |
| `npm run download-episodes [-- --force]` | Downloads every episode's mp3, one at a time, into the gitignored `data/episodes/` |
| `npm run waveform [-- flags]` | Measures every episode with no waveform yet. `--concurrency N` · `--force` · `--limit N` · `--ids 1,2,3` · `--delete-audio` — see "Waveforms" |
| `npm run migration:create` \| `:up` \| `:down` \| `:pending` | The MikroORM CLI |

⚠️ **`npm run build` before any migration command.** `mikro-orm.config.ts`
deliberately sets **only** `entities` (`./dist/database/entities/**/*.js`) and
no `entitiesTs`: with a `tsx`/esbuild loader there is no `emitDecoratorMetadata`,
so CLI discovery would fail where the runtime succeeds. One path means a
migration diff is computed against exactly the metadata the application uses.
With `preferTs` the migrator still *emits* TypeScript into
`src/database/migrations/`, which is what gets committed.

⚠️ **Every path in the ORM config hangs off `__dirname`, never the CWD.**
Flipping the entity glob on `NODE_ENV === 'production'` is only correct for a
process whose CWD is `dist/`; working around that by leaving `NODE_ENV` unset in
the image stops `SpaService` caching the shell, so it re-reads `index.html` on
every request. One assumption about a working directory, three consequences.

⚠️ **Nest 12 ships as ESM; this package still emits CommonJS, and that is fine.**
Nothing in `src/` changed for it: `module: node20` + `moduleResolution: node16`
type-check an ESM dependency, Node's `require(esm)` loads it at runtime (hence
`engines.node >= 24`), and with no `"type": "module"` anywhere here the emit is
still CommonJS — `node dist/main.js` keeps working. The one place it shows is
Jest: it reaches those same ESM packages through `require()`, which is why every
`test*` script carries `NODE_OPTIONS=--experimental-vm-modules` (Jest ≥ 30.4).

⚠️ **TypeScript is pinned to 6.x on purpose — do not chase 7.** The floor is
`@nestjs/schematics@12` (`typescript >= 6`); the ceiling is the tooling that has
not adopted the native compiler: `ts-jest` declares `< 7` and
`typescript-eslint` `< 6.1`. TypeScript 7 is also a different program with no
JavaScript API (`typescript` there exports a Go binary), so `ts-jest` and
`vue-tsc` cannot drive it at all.

## Configuration

`ConfigModule.forRoot({ envFilePath: ['.env.<NODE_ENV>', '.env', '../../.env'] })`
— the **root `.env`** is the real one; see the root `AGENTS.md`, "Environment"
for the keys. ⚠️ **Real environment variables win over the file**
(`@nestjs/config` only assigns a key that is not already in `process.env`),
which is exactly what makes the docker case — values injected, no file at all —
work with the same code. `mikro-orm.config.ts` mirrors the same list through
`dotenv` with `override: false`, because the standalone CLI never goes through
Nest and has nothing to populate `process.env` for it.

## Persistence

MikroORM 7 on PostgreSQL, **real migrations, no `synchronize`**. Five, and the
split is deliberate:

| Migration | What |
|---|---|
| `Migration20260816013825` | The schema baseline: the five content tables. Also creates the `unaccent` extension |
| `Migration20260816015549` | `user` — the admin account store, the one addition to the content tables, so it arrives as its own step |
| `Migration20260816120000` | `episode.duration`, the one column RSS ingestion adds |
| `Migration20260818140000` | Discards negative vote rows: only `+1` is a valid vote |
| `Migration20260819120000` | `episode.waveform`, the measured audio waveform |

Things the entities encode that are easy to undo by accident:

- ⚠️ **Primary keys are `serial`, not `identity`.** Clip ids are public URLs and
  episode ids ride inside `/episode/<id>-<slug>`, so explicit ids are kept
  verbatim — gaps included — and the sequences are `setval`'d past them. `identity`
  would need `overriding system value` on every statement.
- ⚠️ **`token` is nullable everywhere it exists.** A nullable token keeps rows
  without one under `vote_clip_id_token_unique` — Postgres does not collide NULLs
  in a unique constraint — while dedup binds only the rows that carry one.
  **`playback` has no identity column at all.**
- **`lazy: true`** keeps `createdAt` and `episode.description` out of every
  ordinary select. Ordering by a lazy column still works — SQL can `ORDER
  BY` what it does not select — which is what `order=clip.createdAt` needs.
- **Explicit `@Index()`** on the two foreign keys `clip.episode` and
  `playback.clip`, on both titles, and on `tag.tag`. Postgres does not index a
  foreign key on its own, so the schema has an index on each one, plus the
  titles and `tag.tag`. `vote.clip` is the deliberate exception: the unique constraint on
  `(clip_id, token)` already builds a btree whose leading column is `clip_id`,
  and a second index would be dead weight.
- **`up` and `points` are not columns and are not on the entity.** They are
  aggregated at read time and live in response DTOs — see the root `AGENTS.md`,
  "Vote counts are not a column". ⚠️ **`down` is on no payload**; the
  `vote.value` column exists, and only `1` may be written to it.
- ⚠️ **`end` is a reserved word in SQL.** Every hand-written statement touching
  it must quote it (`"end"`). Same for `"user"` in the admin table.

## The read queries

All three read modules put their SQL in a `*.sql.ts` and run it raw through
`em.getConnection().execute()`. Raw is deliberate: the results are not entity
graphs but pages carrying aggregates that are not columns, and the ORM route
would mean either N+1 round trips or hand-written SQL anyway. ⚠️ **Every
client-controlled value is a `?` binding.** The only client-influenced
*fragment* is the sort column, and it comes out of a whitelist map.

### `GET /clips` (`clips.sql.ts`)

⚠️ **Three fragments are shared, and that is the point**: `CLIP_PAYLOAD_COLUMNS`,
`VOTE_AGGREGATE_JOIN` and `TAG_ARRAY_JOIN` are exported from this file and used
by the list, by `GET /clips/:id/related` and by the episode detail. They were
extracted the day `related` was added, because a second copy of "what a clip row
looks like" is how two endpoints start disagreeing about `up`.

One round trip, three CTEs: `base` (the filtered ids plus the three sort keys),
`total` (`count(*)` over `base`), `page` (`base`, ordered and sliced). ⚠️
**`total` is LEFT JOINed to `page`, not the reverse** — `total` always has
exactly one row, so `?page=999` still answers the real total with zero clips.
`count(*) over ()` alongside the rows would have returned nothing at all, and
the UI divides `total` by `limit` to find the last page, which is how it
recovers after a filter is cleared.

A `HAVING` on the tag match would force the total to be computed a second,
different way (a full unpaginated query, `.length`). Counting distinct matches in
a correlated subquery needs no `GROUP BY`, so the total comes from the same query
as the rows.

- **`order` is a whitelist**, in two layers. `@IsIn(CLIP_ORDER_VALUES)` on the
  DTO makes an unknown value a **400** so a typo is loud;
  `resolveOrderColumn()` *still* falls back to the default rather than
  interpolating, so a caller that bypasses the pipe gets the wrong sort order,
  never arbitrary SQL. Interpolating `query.order` straight into `addOrderBy`
  would have been a GET-reachable injection point.
- **Search** is accent- and case-insensitive via `unaccent()` on both sides plus
  `ILIKE`, over the clip title, the episode title and the tags. No index can
  serve a leading `%`, and none is wanted at 180 clips. `?search=` (empty)
  filters nothing.
- **Tag filtering is AND, not OR** — a clip must carry every requested tag —
  and matched **exactly**: case- and accent-sensitive, because the list the UI
  offers comes from `GET /tags`, which compares by code point.
- ⚠️ **`points` is just `up`**, emitted from the same aggregate, and it exists
  only because `?order=points` is in links people shared.

### `GET /clips/:id/related` (`buildRelatedClipsQuery`)

Up to **`RELATED_CLIPS_LIMIT` = 6** clips that share at least one tag with the
subject, ordered by **shared tags desc, then `up` desc, then id desc**, with the
subject itself excluded. Rows are exactly `GET /clips` rows — same three shared
fragments — so the frontend renders them with the same component and no second
mapper exists.

- **A clip with no tags gets an empty array, not a 404** and not a fallback to
  "recent clips". The screen simply does not draw the section. Inventing
  relatedness where there is none is worse than admitting there is none.
- **A clip id that does not exist is a 404**, the same as `GET /clips/:id`.

### ⚠️ `search` and `tags[]` are not independent, on purpose

When both are present, the tag filter only sees the tag rows the **search**
already matched — unless the search matched one of the two titles, in which case
it sees all of them. The long comment in `clips.sql.ts` is the authority; the
short version is that the search sits in the `WHERE` across
`clip.title OR episode.title OR tag.tag` over a `LEFT JOIN`ed `tag`, and only
then grouped and applied the tag filter as a `HAVING` over `GROUP_CONCAT`. The
`WHERE` runs per joined **row**, so a clip whose titles did not match kept only
the tag rows that matched the search themselves.

Measured on the real catalogue:
`?search=cine&tags[]=Monográficos` → **6** clips, not the 14 that independent
filters give; `?search=arturo&tags[]=Anécdotas` → **8**, not 13;
`?search=llamada&tags[]=Cine` → **0**, not 6. Search-only and tags-only queries
are untouched — the extra clause is only emitted when both are present.

It is reachable from the UI and answers this way, so the current answer is the
specification. Making the two filters independent — almost
certainly what a user expects — is a **product decision**, and the tests that
pin the current answers have to change in the same commit.

### `GET /episodes` and `GET /episodes/:id` (`episodes.sql.ts`)

Same `total`-left-joined shape for the list. ⚠️ **Episode search is title
only** — `GET /clips` searches titles *and* tags, this one never has — and the
editor's episode picker depends on that narrowness.

The detail query is **one** statement, however many clips the episode has: one
correlated lateral aggregate does it per row, using the **same expression** as
`clips.sql.ts` so the two endpoints cannot drift on what `up` means.

⚠️ `GET /episodes/:id` emits `up` and **never `points`** — neither does this
one. The episode's clips come back **ascending by clip id**,
which keeps the order stable and is pinned by a test.
The episode list's `id desc` tiebreak keeps ties stable; no two episodes share a
date, so it is unobservable in practice.

### `GET /tags` — ⚠️ `collate "C"` is load bearing

`select "tag" collate "C" as "tag", count(*)::int as "count" from "tag"
group by 1 order by 1`.

⚠️ **It answers `{ tag, count }`, not a bare `string[]`.** The filter sorts the
102 tags by how many clips
carry them, and counting them client-side is impossible: the list arrives
without the clips that carry them. The `::int` matters — `count(*)` is
`bigint`, which the `pg` driver hands back as a **string**, and the frontend's
Zod schema would reject it.

The query needs no `distinct`, because `group by` already collapses duplicates.

The order is **code-point order**: every capitalised tag before every lowercase one, `LLamadas` before
`Labrador labrador no es`, `Anécdotas` after `Andy Warhol`. A bare `order by
"tag"` uses the **database's** collation, and this project's Postgres is created
with `en_US.utf8` — under glibc or ICU that is a linguistic sort with accents
folded, a completely different list. The alpine image happens to agree with `C`
today only because musl ships no locale data, so leaving it implicit means the
order silently changes the day the image, the host or the `initdb` locale does.

⚠️ The collation is applied in the SELECT list, and the query orders by its
ordinal (`order by 1`), which a test pins. The same `CODE_POINT_ORDER` is used for the tag arrays in the episode
detail, and `ClipsService.toTagDtos` sorts by code point in JavaScript for the
same reason (`localeCompare` would depend on the process locale).

## The audio download proxy (`GET /episodes/:id/audio`)

⚠️ **Not a read query, and not in `episodes.sql.ts`.** Everything above this
section answers JSON built from Postgres; this one is a dumb byte pipe that
touches the database exactly once (`em.findOne(Episode, id, { fields: ['file'] })`)
and then relays bytes it never parses.

**Why it exists.** A download does not need a server-side re-encode: an MP3 is
a sequence of independent frames, so the frontend cuts a
clip by copying bytes out of small `Range` reads —
`packages/frontend/src/core/application/audio/mp3-frames.ts`. The one thing
that could not be done client-side is reaching `episode.file` at all:
gravina82.com sends no `Access-Control-*` headers, so `fetch()` from the SPA's
origin is refused before a single byte arrives. This endpoint exists solely to
make those bytes same-origin.

**The shape**, `api/episodes/episode-audio.proxy.ts` + `EpisodesController.getAudio`:

1. Look up `episode.file` by id — a 404 here is the same `NotFoundException`
   `findOne` and `getWaveform` throw.
2. `EpisodeAudioProxy.open(url, range)` forwards the incoming `Range` header
   verbatim (or none, for the whole file) to `episode.file`, with
   `redirect: 'follow'` — which is what resolves the `media.blubrry.com/…` 302s
   some episodes still carry, so the frontend never sees a gravina82.com URL at
   all. `EPISODE_AUDIO_TIMEOUT_MS` (30 s) is its own constant, deliberately far
   shorter than `EPISODE_DOWNLOAD_TIMEOUT_MS` (10 min, `waveform/episode-
   download.ts`) — that one covers pulling a WHOLE mp3 to disk for the waveform
   job, this one a browser waiting on one small slice.
3. The controller (`@Res({ passthrough: true })`, so Nest still owns the
   response and a `StreamableFile` can be returned) reforwards `content-range`
   and `content-length` from the upstream, forces `content-type: audio/mpeg`
   regardless of what the upstream sent, and streams the body through
   untouched.
4. ⚠️ **`res.on('close', () => upstream.abort())`.** A closed tab or a
   cancelled download must not leave a socket open pulling bytes from
   gravina82.com for nobody. This fires on a normal completed response too —
   aborting an already-finished fetch is a no-op, so that is harmless.

**Failure mapping**: upstream 4xx/5xx → `502`, timeout → `504` (distinguished
by the `AbortSignal.timeout` firing with `name === 'TimeoutError'` — the only
way `open()` can see an abort, since the client-disconnect `abort()` is handed
to the caller only after `open()` already returned), upstream `200` (ignoring
the `Range`) → reforwarded as-is.

⚠️ **No cap on the requested span, and nothing rate-limits this endpoint.**
Deliberate — see the root `AGENTS.md`, "Known gaps". It can only ever serve
files already named in the `episode` table, which is what keeps it from being
an open proxy, but a single request can still ask for a whole episode (~90 MB).

**Tests**: `episode-audio.proxy.spec.ts` (pure unit — stubs `global.fetch`
directly, since this proxy IS the network seam, unlike `EpisodeDownloader`/
`FeedClient`, which take a fake) and `episode-audio.integration.spec.ts` (own
database, `gravindex_test_episode_audio`, via `episodes.testing.ts`'s
`createTestContext(dbName, episodeAudioProxy)` — a second, optional parameter
that overrides `EpisodeAudioProxy` at the DI level so this suite, too, never
reaches gravina82.com).

## Validation

`main.ts` registers a global `ValidationPipe` with `whitelist`,
`forbidNonWhitelisted`, `transform` and `enableImplicitConversion`. Without it, the `class-validator` decorators in the DTOs would be inert.
Requests that would store unplayable clips are refused with a 400.

- **`StrictInt`, not `@Type(() => Number)`, on every id in a path.** `Number()`
  reads `1e1` as 10, `1.5` as 1 and `0x2` as 2, so implicit conversion turns a
  malformed id into a valid one for a **different** clip. `/clips/abc` would
  reach the database as `NaN` and answer 500; `/episodes/abc`, `/episodes/0` and
  `/episodes/1.5` answer **400**.
- **`CreateClipDto` enforces the rules**: `end > start`
  (`IsGreaterThan`), non-empty bounded title, `ArrayMaxSize(50)` on tags.
- **`limit` is capped at 100.** Without a bound, `?limit=0` disabled the `LIMIT`
  clause entirely; 100 is the largest page size any screen asks for, so no
  reachable screen loses anything.
- ⚠️ **`ClipsQueryDto` declares a literal `'tags[]'` property.** The wire shape
  is `tags[]=a&tags[]=b` — the shape of every tag-filter link ever shared — and
  express 5's `simple` query parser hands that over under that literal key. Without the property, `forbidNonWhitelisted` would answer those
  URLs with a 400. It is `@ApiHideProperty()`d so the generated client sends the
  canonical `tags`, which is also accepted; **read neither field directly, call
  `resolveRequestedTags()`**.
- `toStringArray` also handles a single `?tags=Absurdo`, which arrives as a
  **string**. Filtering on it by index would select the character `'A'`, which
  matches nothing and raises no error.
- ⚠️ **`@StrictBoolean()`, not `@Type(() => Boolean)`, for `withClips`.**
  `Boolean('false')` is `true`, so implicit conversion turns every query string
  into "yes". The decorator therefore reads the **raw** `obj[key]`, not the
  `value` handed to it: class-transformer runs `@Transform` *after* implicit
  conversion, so by then the damage is done and the original is unrecoverable
  from inside the callback. It accepts `true/false/1/0` and 400s on anything
  else — a typo'd filter must not silently mean the opposite.

## Only positive votes exist

⚠️ **`POST /clips/:id/vote/-1` is a 400**, `VOTE_VALUES` is `[1]`, and `down` is
on no DTO. `points` exists and is simply equal to `up`.

- **The column stays.** The `value` column is not dropped: a destructive schema
  change buys nothing here, and the constraint that matters (only `1` may be
  written) lives at the endpoint.
- ⚠️ **`down()` is deliberately empty**, and says so. It cannot restore which
  rows were removed, or by whom, and inventing rows to make a rollback symmetric
  would be worse than admitting it is one-way.
- ⚠️ **The test fixture carries no `-1` votes either**, so a re-seed cannot put
  them back. The `vote` sequence is never rewound, and ids are never reused.

## Identity: the voter token

`common/http/voter-token.decorator.ts`. The client generates a UUID, keeps it in
`localStorage`, and sends it as **`X-Voter-Token`**. No IP is read anywhere, and
`x-forwarded-for` is not consulted.

- ⚠️ **Client-supplied, therefore spoofable.** A deduplication hint and a
  moderation trail, never proof of who anyone is. **Nothing in the admin surface
  may read it.**
- **`@RequiredVoterToken` on `/vote` only.** Its contract is unimplementable
  without one: the answer comes from the `(clip_id, token)` unique constraint,
  and Postgres does not collide NULLs, so a null token would make every repeat
  vote succeed silently. Missing → 400.
- **`@VoterToken` (optional) on `POST /clips` and `/tag`.** Missing → `null`,
  stored as NULL, like any row without a token.
- Malformed is a **400**, never a 500 and never a silent null. The shape check
  is 8-4-4-4-12 hex and deliberately *not* version/variant-strict; what it
  really enforces is the 36-character budget of the `varchar(36)` columns.

## The write endpoints

- **Vote** is **one statement**: a `previous` CTE reading the row from the same
  snapshot, plus an upsert that updates *only when the value actually changes*.
  A repeat therefore fails the `where`, updates nothing, and comes back
  `affected = 0` — which is the `{ delete: 0, error: 'you have already voted',
  add: 0 }` body, at the ordinary **201**, not an HTTP error. A read-then-write
  would let two concurrent votes both pass. ⚠️ `ALREADY_VOTED` is the exact string
  the frontend branches on.
  ⚠️ `delete` is **always 0**; the field survives only as part of the response
  shape.
- **Add tag** relies on the composite primary key instead of a preceding SELECT
  — same race, same fix. Unlike voting it really does answer **409 `"Tag
  repeated"`**; the two write paths disagree with each other and **both
  behaviours are the specification**.
- **Create clip** runs in a transaction, 404s on an unknown episode and dedupes
  the tag list (two identical tags would violate the composite PK).
- **Play** stores no identity of any kind — not an IP, not the token.
- All three write paths call `assertClipExists` first; without it a foreign-key
  violation would surface as a 500.

## Serving the SPA (`src/spa/`)

⚠️ **No reverse proxy and no `User-Agent` detection anywhere.** Everyone —
browser and crawler alike — receives the same `index.html`; the browser ignores
the meta tags and boots the SPA. There is no social-preview route; the rationale
is in the root `AGENTS.md`.

`registerSpa()` mounts two things on the Express adapter, in this order: static
assets (`index: false` — without it Express answers `/` with the raw
`index.html`, bypassing injection for the path most likely to be shared — and
`redirect: false`), then the `SpaFallback` middleware. **A real file wins over
the shell, the shell wins over a 404, and `/api` never reaches either.**

⚠️ **Why the adapter and not a controller or `MiddlewareConsumer`.** Both of
those mount *under* `setGlobalPrefix`, which would serve the site at `/api`:
Nest 12's `RouteInfoPathExtractor` rewrites a wildcard middleware path to
`['/api$', '/api/{*splat}']` when a prefix is set, and `setGlobalPrefix`'s
`exclude` is no escape hatch either — exclusions are matched as patterns against
every route, so one broad enough to cover `/{*splat}` also strips the prefix off
the whole API. The full reasoning is in `spa.middleware.ts`.

The fallback's own rules: non-`GET`/`HEAD` falls through; anything under `/api`
falls through (**including routes that do not exist** — an unknown `/api/…` must
be Nest's JSON 404, never an HTML page, or every typo'd endpoint becomes a
silent success); a dot in the last path segment is a missing asset and falls
through to an honest 404; everything else gets the shell with `Cache-Control:
no-cache`.

Meta injection (`spa-html.ts`, pure string work, no Nest and no database):

- Routes matched are `/:id` (clip) and `/episode/<id>-<slug>` (**only the
  leading integer is parsed**, like the SPA's own route). Ids are bounded to 9
  digits so `/99999999999999999` cannot make the driver raise "integer out of
  range" on what is just a wrong URL.
- ⚠️ **Everything injected is escaped.** Titles are submitted by anonymous
  visitors: a `"` closes the `content` attribute and a `<` opens a tag.
- ⚠️ **A comment is content.** All the patterns run against a copy in which
  every comment character is masked with NUL, and the cuts are applied to the
  original. This is not hypothetical: a prose mention of `<title>` inside
  `index.html`'s own comments once matched the `<title>` pattern, ran on to the
  real closing tag, ate the comment's `-->`, and the unterminated comment
  swallowed the `<body>`. It broke only for humans, and only on a direct load of
  a shared link.
- ⚠️ **Inserted after the `<meta charset>`**, not straight after `<head>`: the
  spec only honours a charset found in the first 1024 bytes, and the block is
  bigger than that on its own.
- The generic tags the build ships are **replaced**, not sat beside — duplicated
  `og:title`s are read inconsistently and "whichever wins" is not a contract.
- ⚠️ `twitter:*` uses `property=`, not `name=`. That looks wrong against the
  Twitter Cards docs and is deliberate: the author chose it, and the tests pin
  it.
- **A clip that does not exist still gets the untouched shell and a 200** —
  rendering the 404 is the SPA's decision. The built `index.html` carries no
  social tags of its own, so a dead permalink previews as the bare site name.
- `og:url` is absolute, from **`PUBLIC_URL`**; it cannot be derived from the
  request, because behind a proxy `Host` is whatever reached the last hop.
- The shell is cached in memory: read once under `NODE_ENV=production`,
  revalidated by `mtime` otherwise (a `stat` is not a read, and it is what makes
  a frontend rebuild visible without restarting the API). **A missing build is a
  warning, never a boot failure**, and is retried per request so a build
  appearing next to a running API starts being served.

## The admin surface (`src/auth/`)

The one addition to the content tables. `POST /api/auth/login` is the only public
route and the only place a credential is accepted; everything else lives under
`/api/admin/*` behind a **class-level `@UseGuards(AdminGuard)`**, so "did I
remember to protect this one?" is a question nobody has to ask.

- ⚠️ `/api/admin/*` is a **separate surface**, not extra verbs on `/api/clips`.
  The public routes are a published contract; these are free to have a sane shape. `AdminService` reaches the tables through the
  `EntityManager` and imports nothing from `api/clips` — sharing a service would
  mean every change to the public contract has to keep an unversioned admin screen working.
- **bcrypt (cost 10) + `@nestjs/jwt`.**
  `JWT_SECRET` has no default and the backend refuses to boot without one: a
  fallback constant is a key everyone with this public repository knows.
- **`ADMIN_TOKEN_TTL = '12h'`**, a literal rather than a config lookup (the
  `expiresIn` type is a template-literal union a plain `string` is not
  assignable to). There is no refresh flow and no revocation list — logging in
  again is the recovery story, and **the guard re-reads the account on every
  request**, so deleting the `user` row kills every live token.
- ⚠️ **Login answers one shape for every failure** — unknown username, wrong
  password, a plaintext hash — and takes the **same time**: a per-process
  `decoyHash` is compared against when the username does not exist, because an
  early return would answer in under a millisecond and enumerate accounts. Do
  not "optimise" it away.
- ⚠️ **`hidden: true` on `User.passwordHash` is the load-bearing guard, not
  `@ApiHideProperty()`.** The decorator only removes the field from the OpenAPI
  *spec*; MikroORM's `toJSON()` would still emit the hash whenever a populated
  `User` rides along. `hidden: true` is the only guard that holds.
- ⚠️ **The first user is inserted by hand.** No seed, no CLI, no bootstrap
  migration. `npm run build && npm run hash-password -- 'the password'` prints
  the digest; the `INSERT` must quote `"user"` (reserved word). A plaintext
  password just fails `bcrypt.compare` and answers the same 401.
- ⚠️ **Deleting a clip is not a `DELETE` on one row.** `vote`, `playback` and
  `tag` all reference it `on delete restrict`, so `AdminService.deleteClip` is a
  transaction that removes dependents first. **Hard, not soft**: a soft delete
  would only work if every public query in three modules remembered to filter the
  flag, and it would leave orphan votes that any aggregate would silently include.
- ⚠️ **Deleted ids are never reused**, and that is required, not incidental.
  Postgres sequences do not go backwards, which is exactly the behaviour that
  leaves the two gaps the catalogue already has (ids 175 and 176).
- The tag to delete is a **query parameter, never a path segment**: tags are
  free text and one containing a `/` would silently become a different route.
- `StrictIntPipe` here too — there is no reason for the admin surface to be the
  lenient one.

## Ingestion (`src/ingest/`) — the RSS feed

⚠️ **This module has no HTTP surface and must never grow one.** It runs from
`IngestScheduler` (cron) or `ingest.cli.ts` (a human with a shell), and from
nothing else. An HTTP ingestion endpoint would be an unauthenticated GET that
fires outbound requests and writes to the database.

**A feed is a contract; a theme's CSS classes are not**, which is why the
catalogue comes from the podcast's RSS feed rather than from scraping the site's
HTML.

⚠️ **New episodes are a set difference, never a subtraction of counts.** `feed
count − table count` can agree with the real answer while the two sets disagree:
a feed can drop links the database still holds and add others at the same time.
Compare the stored `originalUrl` values with the feed's links. Pinned by
`test/e2e/specs/10-ingest.spec.ts`.

Mapping: `enclosure/@url` → `file`, `link` → `originalUrl` (**the dedup key**,
so the existing rows still match), `pubDate` → `date`, `title`,
`description`, `itunes:duration` → `duration` in seconds.

- ⚠️ **`cover` has no per-entry answer.** `itunes:image` is channel-level only,
  so every new episode gets the podcast artwork (falling back to a hard-coded channel URL). Existing rows keep the per-episode cover they already have
  — the feed could only replace it with something strictly worse.
- ⚠️ **`duration` is the ONLY field ingestion ever writes on an existing row**,
  and only when that row has none. `title`, `file`, `date` and `description` may
  have been corrected by hand, and a nightly job silently reverting that is a
  surprise nobody debugs twice. Refreshing any of them is a product decision.
- **`duration` stays nullable permanently**: some rows have none, and
  feed entries often ship no `itunes:duration`.
- **Dedup happens twice** — against the database in one `IN (…)` round trip for
  the whole feed (a `count()` per entry would be a query per entry), and within the
  document, because idempotency has to survive a feed repeating a link.
- **`run()` never rejects.** An unhandled rejection inside a cron tick takes the
  process down, and a briefly unreachable feed is an ordinary Tuesday; it
  returns an `IngestSummary` with an `error` instead. `ingestXml()` — the half
  with no network — does throw, and is what the fixture-driven tests drive.
- Re-entrancy is guarded in the service *and* by cron's `waitForCompletion`,
  because the CLI does not go through cron at all.
- ⚠️ The scheduler registers the job **imperatively** through
  `SchedulerRegistry`, not with `@Cron('…')`: a decorator argument is evaluated
  at module import, before `ConfigModule` has read any `.env`, so a decorated
  schedule could only ever be a hard-coded constant. `INGEST_CRON` accepts
  `off`/`false`/`no`/`0`/empty to disable; an invalid expression logs at error
  level and leaves ingestion off rather than stopping the site from booting.
- **One outbound request per run**, with a timeout and an identifying
  `User-Agent` pointing at the public repository. gravina82.com is a third
  party's server.
- The feed's `category` values are WordPress tags, not clip tags, and are
  deliberately **not** wired into the `tag` table.

## Waveforms (`src/waveform/`) — measured, not drawn (2026-08-19)

The real audio waveform behind the player, the clip permalink and the
editor's zoomed track. ⚠️ **No HTTP surface of its own**, same rule as
`ingest/`: it runs from `IngestScheduler` (chained after every ingestion
tick) or `waveform.cli.ts` (a human, locally). The READ side —
`GET /episodes/:id/waveform` — lives in `api/episodes/` instead, because it
is a plain `select`; it has no reason to depend on this module.

```
waveform/
  waveform.constants.ts     WAVEFORM_POINTS_PER_SECOND · SAMPLE_RATE · EPISODES_DIR · …
  waveform-peaks.ts         pure: bucketPeaks · normalizePeaks · downsamplePeaks · sliceBounds
  waveform-analyzer.ts      the one file that spawns ffmpeg — WaveformAnalyzer
  episode-download.ts       shared with scripts/download-episodes.ts — EpisodeDownloader
  waveform.sql.ts           pure query builders for the read endpoint and the pending list
  waveform.service.ts       WaveformService — orchestrates the two above, writes the columns
  waveform.module.ts
  waveform.cli.ts           the initial backfill
```

### The format

One **unsigned byte per `1 / WAVEFORM_POINTS_PER_SECOND` seconds** of audio —
10 points/second, so a two-hour episode is ~72 KB — stored in
`episode.waveform` (`bytea`, nullable, `lazy: true`). A byte is the loudest
sample's magnitude inside its 100 ms window, normalized so that the
`WAVEFORM_NORMALIZATION_PERCENTILE`th-loudest window in the episode lands at
255. ⚠️ **Percentile, not the true maximum** — a single microphone pop or a
clipped intro sting would otherwise flatten every ordinary spoken passage
into a thin band near zero, on a podcast recorded over eight years on
whatever hardware was on hand that week.

`GET /episodes/:id/waveform` (`api/episodes/episodes.service.ts`,
`getWaveform`) resamples a `[from, to]` slice down to `points` (default 160,
capped at 2000) by taking the **maximum** of each output window, never the
average — averaging peaks is what would flatten the very spike a waveform
exists to show. It is **two round trips**, deliberately: the byte range
worth asking Postgres for depends on how long the stored column IS
(`buildWaveformTotalQuery`), and there is no way to know that without asking
first; at this project's scale (a few dozen KB at most) two small round
trips cost nothing next to sending the whole column across the socket for a
request that only wanted a few seconds of it. ⚠️ **An episode that exists
but has not been measured yet answers `200` with `points: 0` and
`peaks: ''`, never a `404`** — the same "empty, not missing" choice
`GET /clips/:id/related` makes for a clip with no tags.

### `WaveformService` — locate, measure, persist

`processEpisode(episode, options)`:

1. Is `data/episodes/<id>.mp3` already on disk (the same file
   `download-episodes.ts` populates, and the same `EPISODES_DIR` constant
   both use)? Use it, and leave it there — `--delete-audio` is opt-in.
2. Otherwise download it to a temp file (`EpisodeDownloader`, the same
   `downloadOne` `download-episodes.ts` uses) and **always** delete that temp
   file afterwards, success or failure — it is never the shared cache, only a
   file that was already there before the call is.
3. `WaveformAnalyzer.analyze` spawns `ffmpeg -v error -nostdin -i <file> -map
   0:a:0 -ac 1 -ar 8000 -f s16le -`, buffers the WHOLE decoded PCM (⚠️
   deliberately — this project's whole catalogue is measured once, offline,
   a handful at a time, never in a request path; "do not design for volume
   this project does not have"), buckets and normalizes it.
4. Writes `waveform`, and **backfills `duration` only when it was empty** —
   exactly `IngestService`'s own rule for that column, so a value the RSS
   feed already supplied is never overwritten by a measured one.

⚠️ **Never rejects.** A bad mp3, a network failure or a missing `ffmpeg`
binary comes back as `{ status: 'failed', error }`, so one episode's problem
never stops a batch — the same contract `IngestService.run` keeps, for the
same reason: a cron tick has nobody to catch it.

`WaveformAnalyzer` and `EpisodeDownloader` are thin `@Injectable()` wrappers
around otherwise-plain functions, kept behind DI for exactly the reason
`FeedClient` is: `WaveformService` can be unit-tested with a fake analyzer
and a fake downloader, no real ffmpeg process and no real network —
`waveform.service.spec.ts` writes a real temp file through the fake
downloader and asserts it is gone afterwards, which is what makes the
cleanup assertion real rather than trivially true.

### The backfill (`waveform.cli.ts`)

`npm run waveform [-- flags]` — `--concurrency N` (default: CPU count minus
one), `--force`, `--limit N`, `--ids 1,2,3`, `--delete-audio`. ⚠️ **Local
analyses run concurrently; downloads never do** — the same politeness rule
`download-episodes.ts` and `FeedClient` follow, gravina82.com is a third
party's server, so episodes not yet on disk are fetched one at a time on
their own serial lane before the concurrent local-analysis pool starts.
Idempotent without `--force`: a Ctrl-C costs nothing, re-running only
measures what is still missing.

### Chained after ingestion (`ingest/ingest.scheduler.ts`)

`IngestScheduler.onModuleInit` registers one job whose tick runs
`IngestService.run()` and then, unless `WAVEFORM_ENABLED` says otherwise,
`WaveformService.processPending({ max: WAVEFORM_MAX_PER_RUN })`
(`DEFAULT_WAVEFORM_MAX_PER_RUN = 5`). ⚠️ **Deliberately small** — the feed
can bring a large batch of new episodes in one run (see "Ingestion" above),
and downloading and decoding all of them in the first nightly tick after
that would turn one cron run into
hours of outbound traffic. `IngestModule` imports `WaveformModule` for
exactly this injection; `WaveformService` itself has no opinion on whether
it is enabled — that gate lives entirely in the scheduler (and, mirrored,
in `ingest.cli.ts`'s `main()`, which chains the same capped top-up unless
run with `--skip-waveforms`). A deliberate bulk catch-up after a large
ingest is `waveform.cli.ts`'s job, not this one's — it downloads
concurrently and resumes, which the capped chain does not.

### ffmpeg

Invoked by path (`WAVEFORM_FFMPEG_PATH`, default `ffmpeg`, resolved through
`PATH`), installed in the Dockerfile's `runtime` stage alongside `psql`. ⚠️
**Its absence is not a boot failure** — `WaveformAnalyzer` rejects with "could
not run…", `WaveformService` turns that into `{ status: 'failed' }`, and
`WaveformService.processPending` logs a warning and moves on to the next
episode. The same degrade-gracefully rule `SPA_DIST_PATH`'s absence follows.

### `db:export` and this column

`npm run db:export` does pick it up, because `docker/export-seed.sh`'s
`pg_dump --data-only` dumps every column of the five content tables verbatim — it
has no per-column allowlist, only a per-table one. Once every episode is measured
(~27 MB across 580 rows, measured 2026-08-19), running `db:export` after that point
will embed that much extra binary data into the local
`packages/backend/seed/gravindex.seed.sql`. That is a real size trade-off for
whoever next re-exports the seed, not something this module tries to work around —
`export-seed.sh` is explicitly a human, manual, occasional command, and deciding
whether the local seed should carry waveforms is that human's call to make with the
size in front of them.


## Tests

`npm test` runs Jest over `src/**/*.spec.ts`. Three kinds, and the distinction
matters when one fails:

| Kind | Files | Needs |
|---|---|---|
| Pure unit | `*.sql.spec.ts`, `dto/*.spec.ts`, `spa-html.spec.ts`, `feed-parser.spec.ts`, `auth.service.spec.ts`, `bearer.spec.ts`, `waveform-peaks.spec.ts`, `episode-audio.proxy.spec.ts` (stubs `global.fetch` directly) | Nothing |
| App-level, no database | `spa.e2e.spec.ts` (real Nest app over HTTP with the `EntityManager` stubbed), `health`, `ingest.service`/`scheduler`, `waveform.service.spec.ts` (fake analyzer, fake downloader) | Nothing |
| Integration | `clips|episodes|tags.integration.spec.ts`, `admin.e2e.spec.ts`, `ingest.persistence.spec.ts`, `episode-waveform.integration.spec.ts` and `episode-audio.integration.spec.ts` (each in its own database — the endpoints live in `EpisodesController`) | ⚠️ **A live Postgres** |

⚠️ **`waveform-analyzer.spec.ts` is the one file in the whole suite that needs
`ffmpeg` rather than Postgres** — it synthesizes a real tone and real silence
with `ffmpeg -f lavfi` in a temp dir and asserts what `analyzeAudioFile`
measures from them. It skips itself (not fails) when `ffmpeg` is not on
`PATH`, the same degrade-gracefully rule the running application follows.

⚠️ **Each integration suite builds its own database** (`gravindex_test_clips`,
`…_episodes`, `…_tags`, `…_ingest`, `…_e2e_ingest`, `…_episode_waveform`,
`…_episode_audio`) from the **real migrations**, and the name is a constant, deliberately **not** read from
`DB_NAME` — it must not be able to point at the real database by inheriting an
environment variable. They never touch `gravindex`. Their harnesses live in
`*.testing.ts` and wire the app the way `main.ts` does (global prefix, the same
`ValidationPipe` options), so the two cannot drift.

Beyond this package: a Playwright **behaviour e2e** suite drives the real
browser. See the root `AGENTS.md`, "Tests and validation" — that suite, not this
file, is what pins behaviour.

## Known debt and deliberate gaps

- **Nothing rate-limits anything.** Abuse control belongs in whatever proxy
  fronts the app, and there is none — the backend serves the SPA itself. A conscious gap, not an oversight
  to close here. ⚠️ **`GET /episodes/:id/audio` inherits this with no cap of its
  own** — a single request can ask for a whole episode (~90 MB) — see "The audio
  download proxy" above.
- **`helmet`'s CSP is off** because the default blocks Vite's inline bootstrap.
  Turning it on is real work, to be done with the built `index.html` in front of
  you.
- **`playback` is still write-only.** Nothing reads it back.
- **Clips with `end <= start` may exist in the catalogue.** The API refuses to
  *create* one, but it does not rewrite existing rows.
- **The runtime image carries everything** — the API, the SPA build, `psql` and
  `ffmpeg` — so there is no separate container to deploy — see the root
  `AGENTS.md`, "Deployment".
