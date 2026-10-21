# CLAUDE.md — frontend

Context for `packages/frontend/`. Read the root `CLAUDE.md` first (project
purpose, HTTP API, routes, env vars); this file only covers what is specific to
this package.

> Keep in sync when the layer rules change, when the query/store layout moves,
> or when a theme token is added or renamed.

> ⚠️ **The UI is the specification of why every screen looks the way it does**
> (accepted 2026-08-18, built 2026-08-19) — what is described below is the
> frontend as it stands.
>
> ⚠️ **The UI is governed by this document, and the wire by its own tests.** The
> wire is held by its tests (root `CLAUDE.md`); the screens are held by what is
> written here.
>
> ⚠️ **The admin surface keeps its own look** — white cards, `GravPagination`,
> `GravLoading`, `useFilteredList`. That is correct, not pending. It is also why
> several pieces below are still here and still used.

## What this is

The entire UI: a **Vue 3 SPA** built with **Vite**, styled with **Vuetify 4**
under a custom *gravinero* theme, routed by **vue-router 5**, with **Pinia** for
client state and **Pinia Colada** for server state. **Strict TypeScript, `any`
banned by lint.** Version `2.0.0`.

It is organised as a **hexagon**: a framework-free `core/` (domain ·
application · infrastructure · config) and a `vue/` delivery layer, with the
dependency rule enforced by `eslint-plugin-boundaries` rather than by
discipline. The whole HTTP client is **generated from the backend's OpenAPI
document** — there is not one hand-written endpoint string in the package.

```
src/
  main.ts                one line of bootstrap; the only file allowed every layer
  core/
    domain/              entities, repository PORTS, the error taxonomy. Imports nothing
    application/         use cases, one class per file, constructor-injected ports
    infrastructure/      HTTP adapters, Zod DTOs, mappers, the generated client
    config/              composition roots: plain module-level singletons
  vue/                   views · components · stores · queries · router · theme · analytics · composables · utils
  assets/                the two images
```

**Two aliases, and they are the architecture**: `#` → `src/core`, `@` →
`src/vue`. ⚠️ Never reach across the two roots with a relative `../../`.

## The dependency rule

`eslint.config.mjs` declares six boundary elements (`domain`, `application`,
`infrastructure`, `config`, `vue`, and `main` as a single file) and one policy
table, `default: 'disallow'`:

| From | May import |
|---|---|
| `domain` | `domain` |
| `application` | `domain`, `application` |
| `infrastructure` | `domain`, `application`, `infrastructure` |
| `config` | everything under `core/` |
| `vue` | `domain`, `application`, `config`, `vue` — ⚠️ **not `infrastructure`** |
| `main` | everything |

A view that needs a use case takes the ready-made instance from
`#/config/*.config.ts`. It never constructs an adapter and never sees a URL.

A second rule, `boundaries/external`, forbids `vue`, `vue-router`, `vuetify`,
`pinia` and `@pinia/colada` **inside `core/`**. It has to stay a separate rule
even though the option is deprecated: a `to: { module: { origin: 'external' } }`
policy inside `boundaries/dependencies` is schema-valid and **silently matches
nothing** — verified by importing `@pinia/colada` into a use case and watching
it lint clean.

⚠️ **These rules fail silently when they fail.** They depend on
`import/resolver: typescript` pointing at both tsconfigs; without a working
resolver the plugin skips unresolvable imports and reports nothing, which looks
exactly like passing. `eslint.config.mjs` documents four probes to re-run
(`rm -f .eslintcache && npx eslint .`) after touching it: a `vue/` file
importing `#/infrastructure/…` must fail, a `core/` file importing
`@pinia/colada` must fail, a stray `src/probe.ts` must trip
`boundaries/no-unknown-files`, and `src/main.ts` must stay clean.

⚠️ **Any new file must land inside a declared element tree**, or
`no-unknown-files` errors.

## `core/domain`

Entities, ports and errors. Naming: `*.entity.ts`, `*.repository.ts` (a port,
not an implementation), `*.provider.ts`, `*.store.ts` (also a port),
`*.error.ts`, plus `errors/index.ts`.

Vote counts are **modelled in the types**.

- `VoteValue` is the literal `1`. ⚠️ **Not a union, and not a parameter** — the
  type is what makes "vote down" unwritable rather than merely unused, and a
  `-1` cannot be typed anywhere in this package.
- `VoteTally` is `{ up }`. `Clip extends VoteTally`, so **every** clip shape
  carries its count, including the one from `GET /clips/:id`.
- ⚠️ **There is no `hasVoteTally()` narrowing helper.** Every payload carries a
  count, and such a helper would only invite a renderer to hide the number.
- `ClipRow` is the row shape every list renders.
- `points` never reaches the domain: it is `up` under another name, and it stays
  an infrastructure detail of `?order=points`.

`applyVote(tally, outcome)` is a pure function returning
`{ up: tally.up + outcome.added }`; `VoteOutcome` is
`{ status: 'recorded', added, removed } | { status: 'already-voted' }`, which is
where the backend's 201-with-an-`error`-string stops being an HTTP detail.
⚠️ `removed` survives in the type and is always 0 — the backend still reports
the field, and declaring a narrower shape than the wire has is how the two
drift.

`TagCount` (`{ tag, count }`) is the shape of `GET /tags`; the tag filter
sorts by `count` in the browser, while the wire's guarantee remains code-point
order.

### The error taxonomy (`core/domain/errors/index.ts`)

`DomainErrorCode` is `NETWORK_ERROR | NOT_FOUND | REQUEST_ABORTED |
REQUEST_REJECTED | UNEXPECTED_RESPONSE | VALIDATION_ERROR`, one class each over
an abstract `DomainError`.

⚠️ **The UI branches on `code`, never on an HTTP status** —
`RequestRejectedError` deliberately does not carry one. An HTTP status is an
infrastructure detail and letting it leak means every view has to know the
protocol.

## `core/application`

One `*.use-case.ts` class per file, ports injected in the constructor, a single
`execute()`. Tested with stubs, no Vue and no server.

⚠️ **Reads take an optional `AbortSignal`; writes do not, and the ports do not
even declare one.** A read can be superseded — the next keystroke makes the
request in flight worthless — so the caller must be able to withdraw it. A write
cannot: cancelling a vote or a clip creation halfway leaves the server having
done something nobody can observe.

`RegisterPlayUseCase` is the one that **swallows** a `DomainError` — the play
counter is fire-and-forget and a failed count is not worth a toast. Anything
that is not a `DomainError` still propagates. ⚠️ **It is called from
`stores/queue.store.ts`**, once per clip per queue position.

`ListRelatedClipsUseCase` sits over `ClipRepository.listRelated`. It returns
rows, and an empty array is a normal answer — a clip with no tags has no related
clips and the screen simply does not draw the strip.

## `core/config`

Composition roots. Plain module-level singletons, **no container, no DI
framework, no `provide`/`inject`** — the whole graph is five files you can read
in a minute.

- `identity.config.ts` — **one** `LocalStorageVoterTokenProvider` for the app.
  ⚠️ Its memory fallback is per-instance, so two of them would hand out two
  tokens.
- `clips.config.ts`, `episodes.config.ts`, `tags.config.ts` — the repositories
  and the use cases over them. Only clips takes the identity provider.
- `auth.config.ts` — the admin session. ⚠️ It **does not import
  `identity.config.ts` and must not**: the anonymous voter token and the admin
  credential are two different things and the two never meet.

## `core/infrastructure`

Adapters. `*-http.repository.ts`, `*.dto.ts` (Zod schemas), `*.mapper.ts`, plus
`http/`, `identity/` and `generated/`.

**Every method is the same four steps, in this order**: call the generated
operation → `assertResponseOk` → parse with the feature's narrow Zod schema →
map to domain entities. A response that does not match the schema is an
`UnexpectedResponseError`, not a silently wrong screen.

### The generated client

`src/core/infrastructure/generated/` is written by `@hey-api/openapi-ts` from
`../backend/openapi.json` and is **committed** — so a contract change shows up
as a reviewable diff, and `npm install && npm run build` works without
bootstrapping a backend. It is lint-ignored and Prettier-ignored (the generator
formats it itself).

```bash
npm run openapi -w packages/backend      # regenerate the contract
npm run generate:api -w packages/frontend # regenerate the client
```

⚠️ **Never edit anything under `generated/`, and never write an endpoint path
by hand.**

### The HTTP edge (`infrastructure/http/`)

- **`api-client.config.ts`** is wired by the generator itself
  (`runtimeConfigPath` in `openapi-ts.config.ts`), so there is no "configure the
  client first" step anywhere. `baseUrl` is `VITE_API_BASE_URL` or
  `window.location.origin`, trailing slashes stripped. ⚠️ It must be
  **absolute**: the generated client concatenates and hands the result to `new
  Request()`, which under jsdom rejects a relative URL.
- **`http-transport.ts`** points the generated *fetch* client at **`ky`**
  (`@hey-api/openapi-ts` has no ky plugin, and ky is itself a fetch wrapper).
  10 s timeout, `retry: 2` — which only ever applies to idempotent requests, so
  no POST/PATCH/DELETE is retried. ⚠️ **`throwHttpErrors: false` is
  load-bearing**: otherwise every 404 becomes an exception raised in the wrong
  layer, before the adapter can classify it.
- **`translate-http-error.ts`** maps the wire onto the taxonomy. Two details
  that are easy to get wrong: `assertResponseOk` takes the **already-parsed**
  error body, because on a non-2xx the generated client has drained the stream
  and a second `response.json()` throws "body stream already read"; and
  `translateHttpError` checks **abort first**, so a cancellation is never
  reported as a network failure.

## Identity, in two flavours that must never be confused

### The anonymous voter token

The visitor's identity is never their IP address (root `CLAUDE.md`,
"Identity"). `crypto.randomUUID()`, falling back to a hand-built v4 over
`crypto.getRandomValues` — a real case, not a theoretical one: a dev server over
plain `http://` on a LAN has no `randomUUID`. Kept in **`localStorage` under
`gravindex.voter-token`**, re-read on every call rather than cached, validated
by shape on read, silently replaced if corrupt.

⚠️ **It is derived from nothing.** Not a fingerprint, not a hash of anything
about the person or the device — the moment it derives from the visitor it
becomes personal data, which is what this token exists to avoid.

⚠️ **Losing it is normal, not an error.** Cleared storage, private windows and
second browsers all produce a fresh token, and the app must behave perfectly
when that happens: it simply means a vote can be cast again. Never surface it to
the user, never try to recover it, never add a fallback identifier.

⚠️ **It must never reach GA4**, and a test fails if it does.

The header is built **only** in `ClipHttpRepository`, from a provider injected
in its constructor — nothing above that line has to know anonymous identity
exists. The API's own asymmetry survives there: `vote` refuses to send without
one (a `ValidationError`, the single one raised from infrastructure), `create`
and `addTag` **omit the header entirely** when there is none (the backend reads
absent as "anonymous", malformed as a 400), and `registerPlay` sends nothing.

### The admin JWT

**`sessionStorage` under `gravindex.admin-token`** — it survives a reload and a
deep link and dies with the tab. ⚠️ `Authorization: Bearer` is attached **per
request** in the five admin calls, never through the generated client's shared
auth config, so a public screen physically cannot send one. The token is
deliberately **not** in a Pinia store, so it never appears in devtools state.

## The `vue/` delivery layer

### Pinia Colada lives here, and only here

⚠️ **It must never appear inside `core/`** — the lint boundary rejects it. It is
a delivery-layer concern: it caches, deduplicates and invalidates *for the UI*.
Use cases stay plain async functions over ports, testable with no Vue and no
store. The split in practice:

- **`core/application`** — the use case. Pure.
- **`vue/queries/*.query.ts`** — a Colada query wrapping it, owning the cache
  key and the loading/error state. Reads are exported as **options factories**
  (`clipListQueryOptions(query)`), not composables, so `useFilteredList` can
  hand them a filter that changes: `useQuery(() => clipListQueryOptions(f))`
  re-keys, refetches and cancels by itself.
- **`vue/composables/use-list-filters.ts`** — the filter core: URL sync,
  debounce, page reset. ⚠️ It fetches nothing; the two composables over it do.
- **`vue/composables/use-infinite-list.ts`** — that core plus a Colada
  `useInfiniteQuery`. **This is what every public list uses.**
- **`vue/composables/use-filtered-list.ts`** — that core plus a single-page
  `useQuery`. ⚠️ **Only the admin clip list still uses it**, because only the
  admin surface still paginates.
- **Plain Pinia stores** — client state with no server behind it: playback,
  **the queue**, notifications, consent, admin session.

⚠️ **`useQueueHydration` is the one read in this layer that deliberately is NOT
a Colada query.** It turns the ids in `localStorage` back into clips on a cold
load: a one-shot resolution of ids the store already owns, where a partial
failure is the normal case and must stay invisible, and where nothing renders
from the result. All three are the opposite of what a cache entry is for. The
reasoning is at the top of the file so nobody "fixes" it.

### Cancellation: `queries/abortable.ts`

⚠️ **Colada supplies cancellation but does not apply it.** It offers each query
function an `AbortSignal` and aborts it when the call goes stale; **nothing
happens unless that signal is taken and passed down.** So every read query wraps
its use case in `abortable`, the ports' read methods take an optional
`AbortSignal`, the adapters hand it to the generated client, and ky adopts it on
the `Request`.

The last hop is easy to leave out: without it, a superseded search runs to
completion. `test/e2e/specs/03-cancellation.spec.ts` measures aborted requests
precisely because **nothing on screen can show the difference** — a stale answer
still lands in its own cache key and everything looks right.

⚠️ `abortable` rethrows `signal.reason`, and that is not tidying. Colada decides
whether a rejected query becomes the entry's error state by comparing the thrown
value with the signal's own `reason`; a `RequestAbortedError` is not that value,
so without that rethrow the abandoned entry is **stored as failed** and the
visitor who comes back to that exact filter finds an error waiting, produced by
a request they cancelled themselves.

⚠️ **Reads only.** No port takes a signal on a write.

### Cache keys: `queries/query-keys.ts`

`[feature, kind, …arguments]`, matched by prefix. `clipKeys`, `episodeKeys`,
`tagKeys`, and `adminKeys` — deliberately **not** nested under `clipKeys`, since
`/admin/clips/:id` is a different endpoint returning a different shape.

⚠️ **Build every key here.** Invalidating `['clip']` when the read registered
`['clips']` fails with no error, no refetch and no symptom but stale data.

### Invalidation policy

Writes invalidate; there is **one** deliberate exception.

| Mutation | Effect |
|---|---|
| `useCreateClip` | invalidates `clipKeys.all()`, `episodeKeys.detail(id)`, `tagKeys.all()` |
| `useAddTag` | invalidates the same three — but **only** when the tag was actually added, not on `already-present` |
| `useRegisterPlay` | nothing. Reports nothing |
| `useVoteClip` | ⚠️ **invalidates nothing** — see below |
| every admin write | invalidates the whole public tree, no optimistic patching |

⚠️ **Voting patches the caches instead of refetching**, because a full refetch
on every vote is a visible responsiveness regression. `applyVoteToCaches` walks
the `clipKeys.lists()` and `episodeKeys.details()` entries and rewrites them
from the server's own reported `add`/`delete` — arithmetic on a fact, not a
prediction that could need rolling back. Two things it does on purpose:
it keeps `points` equal to `up` (the backend computes `points` per request and
never stores it, so leaving it behind would make the default sort disagree with
the number beside it), and it **patches `['clips','detail',…]` too** — the
direct consequence of `GET /clips/:id` carrying `up`. ⚠️ It also handles the
**two shapes a `['clips','list',…]` entry can hold**: a Colada infinite
`{ pages, pageParams }` on every public screen, and a single
`ClipPage` on the admin one. A patch that understands only the page shape
type-checks, passes a test written against `useClipList`, and then does nothing
at all on `/` — the screen where most votes are cast. Two tests stand on it, one
per layer.

`useDeleteAdminClip` **removes** the cache entry rather than invalidating it —
invalidating would refetch an id that is now a 404.

### The three list composables

The list layer is **split in three**, because every public list is infinite
while the admin one paginates:

| File | Who uses it |
|---|---|
| `use-list-filters.ts` | Neither directly — it is the **shared core**: filter state, URL sync, debounce, page reset, `activeFilterCount`. It fetches nothing |
| `use-infinite-list.ts` | Every public list: the library, the episodes, an episode's clips |
| `use-filtered-list.ts` | ⚠️ **The admin clip list, and nothing else** |

⚠️ **The split exists so the two cannot diverge.** The URL contract, the 500 ms
debounce and "Limpiar filtros" behave identically on both, which is the point of
the core being shared rather than the two being cousins.

What `use-infinite-list.ts` decides, all four of them:

1. **`DEFAULT_BATCH_SIZE = 24`, and `limit` is not a preference** —
   `persistLimit: false`, so `gravindex.list-limit.<id>` is not written for
   these lists. ⚠️ A `?limit=` in a shared link is still honoured, because those
   links exist.
2. **`page` is not in the URL** (`pageInUrl: false`). What people share is a
   filter, not a scroll position, and an arriving `?page=3` is ignored.
3. ⚠️ **Coming back lands where you were**, and that is *why* it is a Colada
   `useInfiniteQuery` rather than a hand-rolled accumulator: every loaded batch
   lives in one cache entry keyed by the **filter**, so returning from a clip
   re-renders all of them instead of resetting to the first 24. The scroll
   offset on top of that is the router's `scrollBehavior`.
4. **The counter is the total under the filter** — `180 cortes` — never
   "N of M loaded".

⚠️ `getNextPageParam` compares **rows loaded against `total`**, not "did the
batch come back short": a final batch that is exactly `limit` long would
otherwise cost one extra request to discover it was the last.

`InfiniteMore.vue` is the sentinel — an `IntersectionObserver` plus a real
button, because a sentinel alone is unreachable by keyboard.

Four behaviours the core carries, and they are things people rely on:

1. **URL ⇄ filter two-way sync with defaults absent from the URL** — the library
   lives at `/`, not `/?search=&order=clip.createdAt&limit=12`: what a visitor
   copies is readable and carries only what they chose.
2. **A 500 ms debounce** on filter changes (`DEFAULT_DEBOUNCE_MS`).
3. **`limit` persisted per endpoint**, under `gravindex.list-limit.<id>` — for
   the lists that still ask for it. (One shared key for every list was an actual
   bug.)
4. **Page resets to 1 when a filter changes**, or a search from page 7 lands on
   the empty page 7 of two results.

Deliberately **absent**: request cancellation and duplicate suppression. Colada
does both from the key, and adding either would be fighting it.

Two conscious behaviours, both recorded: **any external URL change is adopted**,
so Back cannot leave the address and the list disagreeing; and **returning to a
filter you already used is instant** (cache, then revalidate, instead of
blanking).

Mechanics worth knowing before editing it:

- Two internal flags. `adopting` marks "the URL is writing into state".
  ⚠️ `resettingPage` is subtler and without it the debounce **leaks a request**:
  the filters watcher resets the page before arming the timer, and the
  `flush: 'sync'` paging watcher would see no pending timer, conclude nothing is
  debounced, and commit a half-typed search. Only reproducible off page 1.
- `commit()` moves the query **and** the URL together, and swallows the failure
  object vue-router resolves a redundant navigation with.
- `snapshot()` prunes empties, so `search: ''` and "no search" are one cache
  entry rather than two.
- `readFilterValue` coerces by the **declared default's type**, not by whether
  the text looks numeric — a naive helper turns the tag `82` into the number
  `82`.
- `reset()` restores the defaults and page 1 but **keeps `limit`**: it is a
  preference, not a filter.

### Stores (`vue/stores/`)

- **`playback.store.ts`** — one audio element, see below.
- **`queue.store.ts`** — ⚠️ **the centre of gravity of the whole player.** See
  "The queue" below.
- **`notifications.store.ts`** — the toast queue. 2.5 s auto-dismiss, click to
  pin, an accessible close button. ⚠️ **Bodies are plain text, never `v-html`.**
  Markup built from API error payloads, which quote user-submitted clip titles
  and tags, would be a stored-XSS sink. The bold half survives as an optional `title`
  field rendered as its own element. `MAX_VISIBLE = 4` is a recorded deviation
  (so the queue is bounded); eviction never drops a pinned notice.
  ⚠️ **Where they are drawn is a recorded deviation too (2026-08-26):
  `NotificationHost.vue` anchors them to the TOP**, 71 px down (56 px of bar
  + 3 px of rule + 12 px of air) against the right edge, as
  `min(25rem, 100vw - 24px)` — one panel at both widths, no breakpoint. A
  bottom-anchored, edge-to-edge container is impossible with a 78 px player in
  that place: a notice at `bottom: 2.5rem` with `z-index: 1000` sat **on the play
  button**, and the
  bottom edge already carried the consent banner as well. The notice is a
  `.grav-panel` with a 2 px cap in the level's own theme colour and the level
  spelled out as a word (`Error`, `Aviso`, `Hecho`, `Info`) where a decorative
  `aria-hidden` icon would make severity a colour and nothing else.
- **`moments.store.ts`** — ⚠️ **`Mis momentos`.** The private marks somebody
  leaves on an episode while listening. See "Mis momentos" below.
- **`consent.store.ts`** — the GA4 gate. `granted | denied | unknown` in
  `localStorage` under `gravindex.analytics-consent`. ⚠️ **It has no side
  effects on Google**: it records a decision, and `start-analytics.ts` is the
  only thing that loads or unloads anything. A dismissal (Escape) stores
  nothing — a dismissal is never consent.
- **`admin-session.store.ts`** — `unknown | anonymous | authenticated |
  unverified`. ⚠️ `unverified` means "a token is held but the probe never
  answered", and the admin is **let through**: a network blink is not a logout.
  `ensureRestored()` memoizes the probe so N navigations per page load make one
  `GET /admin/me`. `noteFailure()` branches on the **error class**
  (`AdminSessionExpiredError`), not on a status — the backend's 401 and its
  ValidationPipe 400 are both `REQUEST_REJECTED`. The store never navigates.

### Router (`vue/router/`)

The route table is in the root `CLAUDE.md`. What lives here:

- `createAppRouter()` is a **factory** (a test needs a second router over the
  same `window.history`), and it installs the admin guard itself so test routers
  are guarded identically.
- **`admin-guard.ts`** resolves the session store *inside* the callback (Pinia
  is not installed when the router is created) and admits on `hasSession`, not
  `isAuthenticated`. It redirects to `/admin/login` carrying `redirect`.
  ⚠️ **It is not a security boundary** — the backend guard is. It only decides
  which screen to show.
- **`error-navigation.ts`** maps a `DomainError` to `error404` or
  `errorUnknown`, and always uses **`router.replace`**: with `push`, "back"
  would land on the broken id, refetch, fail, and bounce forward again — an
  inescapable history trap. It catches nothing itself; navigate-versus-toast is
  the caller's decision.
- ⚠️ `router.replace`, never `push`, is what keeps the URL and the screen in
  step.

### Analytics and consent (`vue/analytics/`)

GA4, with a **hand-rolled** consent banner (no library). ⚠️ **`VITE_GA4_ID` empty is a working configuration**: no id means no
script, no cookie and **no banner** — the normal state in dev and in this public
repo.

- Analytics loads **after** the choice, never gated after the fact.
- `gtag('config', id, { send_page_view: false })`, because otherwise the entry
  URL is counted twice.
- ⚠️ `toGtagCommand` looks absurd and is necessary: a `dataLayer` entry is only
  read as a command if it looks like an `arguments` object, and a real `Array`
  is routed to the classic `push(['method', …])` form and **silently dropped**. Verified end to end
  against `/g/collect`.
- **Only the URL is sent.** No clip, tag or episode content.
- Withdrawal actually withdraws: `ga-disable-<id>`, the script removed, `gtag`
  and `dataLayer` deleted, and the `_ga`/`_gid`/`_gat` cookies cleared across
  the host and every parent domain.

## Playback: one audio element, in a store

⚠️ **No component owns an `Audio`.** `stores/playback.store.ts` holds exactly
one element and one `currentClipId`, so "only one clip plays at a time" is
**structural**: a card cannot start its own audio, it asks `isPlaying(clip.id)`.

- `PlayableItem` is `{ kind, id, src, start, end }` — structural, deliberately
  not the domain entity, and `src` is the **episode's** remote mp3 because a clip
  has no file of its own.
- ⚠️ **`kind` is `'clip' | 'episode'` and it is required** (2026-08-25, with the
  episode map). Ids are unique only *within* a kind — clip 93 and episode
  93 both exist — so `isCurrent(93)` on a clip row would light up for an episode
  without it. `currentClipId` is `null` while an episode plays, and
  `isCurrentEpisode` / `isPlayingEpisode` are the other half.
- ⚠️ **`end <= start` means "until the file runs out"**, which is the normal
  state of a whole episode: its length arrives as `GET /episodes/:id/waveform`'s
  `to`, which is `0` for the nine unmeasured episodes and unknown on a cold boot.
  `duration` then falls back to `mediaDuration`, learned from the element's
  `durationchange`, and `handleTimeUpdate` skips its end check — a length this
  store guessed would cut an episode off mid-sentence.
- `PlaybackAudio` is a structural interface with a swappable factory, because
  jsdom does not implement `HTMLMediaElement.play()`.
- The element is a plain `let`, **not reactive**. `loadedSrc` is tracked
  separately because the DOM normalises `audio.src` to an absolute URL, and
  comparing raw strings would reload the same mp3 for every clip of one episode.
- `pendingSeek` exists because setting `currentTime` before metadata is silently
  discarded — hence a re-seek on `canplay`, armed **only** when the source
  actually changed, or a post-stall `canplay` would yank playback back to
  `start`.
- **Stopping at `clip.end` is the whole reason a clip exists**, and it happens
  in `handleTimeUpdate` — for a clip. An episode is stopped by the element's own
  `ended` event.
- ⚠️ **`play(item, at)` takes an optional position** (2026-08-26), in **seconds
  into the item** — the same unit as `elapsed`, never an absolute position in the
  episode. It applies only to an item being LOADED (calling `play()` on the one
  already in the element still means "carry on from where you paused", which is
  what `toggle()` depends on), it is refused under `MIN_RESUME_SECONDS` and at or
  past the item's own `end` — a seek past `end` would be answered by
  `handleTimeUpdate` ending the clip on the first tick, i.e. a play button that
  looks like a skip button. **The store still remembers nothing**: it takes a
  number, and the queue is what stores one.
- ⚠️ **`seek` re-arms `pendingSeek` while `loading` is true.** "Play this episode
  from 41:00" is one click on `/episode/:id`'s map, and it lands before the
  stream has metadata, where setting `currentTime` is discarded. Outside that
  window it must NOT be armed, or a post-stall `canplay` yanks playback back.
- ⚠️ **It is still not a queue, and that is what makes the queue possible.**
  Order, persistence and "what comes next" live one layer up; this store knows
  one clip. `setEndedHandler(fn)` is the whole seam — the queue registers
  `next` on it — and `handleEnded()` **rewinds first, then hands over**, or a
  slow `next` leaves the episode audible past the cut.

## The queue (`stores/queue.store.ts`)

The wished-for global player, built. `keys` + `currentIndex` + an `entries` Map
of what each key is, over the playback store.

⚠️ **A queue holds `QueuedClip | QueuedEpisode`** (`QueuedItem`),
discriminated by `kind`. A whole episode is a first-class item: it
plays through the one global player, it can sit between two clips, and the
player draws it as `Episodio completo` with a share button and **no vote and no
download** — neither exists for an episode. An episode's `end` is its measured
length, `0` when nothing has measured it (see `PlayableItem.end`), and it has no
`start` at all.

- ⚠️ **Addressed by `QueueKey`, not by id**: `c12` is clip 12, `e93` is episode
  93. Bare ids cannot say which of the two they mean, and both exist at 93.
  `clipKey` / `episodeKey` / `keyOf` / `clipIdOf` are the helpers; `contains`
  still asks about a clip and `containsEpisode` about an episode.
- ⚠️ **`localStorage` under `gravindex.queue` holds keys, the index and `at`,
  and nothing else** — no titles, no audio URLs, no vote counts. A title edited
  or a clip deleted through the admin surface would otherwise leave a stale copy
  on somebody's machine forever, and a queue is a list of public ids anyway.
  ⚠️ **`at` is the position inside the current item**, and it is worth storing
  because of the length of the things in here — the median clip runs two minutes,
  one in ten past seven, and a whole EPISODE can be a queue item — so `00:00`
  tomorrow is not a clean slate but a lost place. The half-remembering is answered by an invariant: **`at` always
  describes `keys[index]`**, written in the same call, so the queue can never
  point at one item and the position at another. See "Where you were listening"
  below.
  ⚠️ **The reader still accepts the older `{ ids: number[] }` shape** and loads
  every one of those numbers as a clip, so a stored queue is never emptied. It is
  never written again.
- `useQueueHydration` turns those keys back into items on a cold load, one
  request each — `GET /clips/:id` or `GET /episodes/:id` — **dropping a key that
  404s in silence** and keeping one whose request merely failed. See "Pinia
  Colada lives here" for why it is not a query. ⚠️ A hydrated episode comes back
  with `end: 0`: asking for its waveform too would be a second request per
  queued episode to fill in a number the browser hands over for free the moment
  it plays it. `/cola` prints `--:--` until then, which says "unknown".
- ⚠️ **`entries` is a `shallowRef` over a plain `Map`** with `triggerRef` after
  each write. The values are immutable and only ever replaced, and a deep proxy
  over a map that grows with every row rendered costs real time for no
  behaviour.
- ⚠️ **The play counter lives here**, in `playAt`, guarded by a `counted` Set so
  a clip counts once per session however it was reached — where the intent
  actually is. ⚠️ **Clips only**: there is no
  episode counter on the wire, and passing an episode id to `POST /clips/:id/play`
  would write rows against whatever clip shares the number.
- **A row queues; it does not play.** Enqueueing into an *empty* queue starts
  playback, because otherwise the first click on a fresh visit appears to do
  nothing. Everything after that lands at the end and waits.
- ⚠️ **`playNow` is the other verb, and it is not `enqueue`.** It is the
  permalink's `Escuchar`: the clip goes in at `currentIndex + 1` — interrupting
  the queue rather than throwing it away — and playback moves to it. A clip
  already queued is played **where it stands**, because reordering somebody's
  list as a side effect of pressing play would rearrange the one thing on this
  site people arrange by hand.
- **`next` does not loop** and never autoplays outside the queue: the last clip
  ending is the end. Removing the clip that is playing advances, or stops if it
  was the last.
- ⚠️ **Recorded deviation (2026-08-19): `/cola` splits the queue at
  `currentIndex`, and it is the store that draws the line.** `rows` pairs every
  resolved clip with its ABSOLUTE position in `ids` — not its position among
  what has resolved, which is what `clips` gives and why hydration's gaps would
  otherwise misalign the split. `played` is everything before `currentIndex`;
  `upcoming` is at or after it, so its first row is always the one playing.
  `QueueView.vue` tucks `played` behind a "Historial" toggle, sharing the
  header's action line with the (icon-only) share and Vaciar buttons,
  collapsed by default, so the screen opens on what is playing rather than
  scrolling it under a growing history. Row numbers stay the real position
  (`row.index + 1`), so a jump in the numbers is the tell that something is
  folded away. ⚠️ **Nothing may reorder to or past `currentIndex`** — `next()`
  only ever advances, so a clip dropped ahead of what is playing would never
  sound again on its own, indistinguishable from deleting it, and with the
  history collapsed it would vanish from view too. That rule lives in the view
  (the drag handle is absent on rows at or before `currentIndex`, the up-arrow
  disables at the boundary), not in `move()` itself, which stays the same
  unconstrained primitive `queue.store.spec.ts`'s `move(2, 0)` relies on.
- ⚠️ **Reordering is on POINTER events, not HTML5 drag-and-drop**
  (`QueueView.vue`). Native DnD fires nothing for touch, so a handle built on it
  works with a mouse and nowhere else while the hint under the list tells
  everyone to drag it. The list reorders live under the pointer — `queue.move` on every row
  crossed — so there is no drop indicator and no ghost to draw, and
  `touch-action: none` on the handle is what stops the browser claiming the
  gesture as a scroll.
- ⚠️ **The gesture is tracked on `document`, and `setPointerCapture` is not used
  at all.** Capturing on the handle looks right and is not: reordering the list
  MOVES that element in the DOM, which drops the capture silently, so the
  `pointerup` landed on whatever the finger was over, the teardown never ran, and
  the row stayed dimmed for ever. The listeners go on `document` in `startDrag`
  and come off in `endDrag`, which is also wired to `onUnmounted`.

### Where you were listening (2026-08-26)

**The queue remembers the second, not just the clip.** Closing the tab half-way
through an episode and coming back tomorrow presses play and carries on.

⚠️ **It is one number, and it belongs to whatever the queue was pointing at.**
Not a per-item history: `at` describes `keys[index]` and nothing else, so there
is no map to prune, no cap to pick and no state where the queue points at one
item and the position at another. Playing something else on the way back spends
it — the write that follows files this session's position under the key it
belongs to.

- **Written by the queue, watching the player.** Two watchers over
  `playback.elapsed` and `playback.playing`, both `flush: 'sync'`: a write left
  pending in a microtask is a write that may not happen if the tab closes in that
  instant, which is exactly the moment this exists for. Persistence lives in
  this store, and a playback store that wrote to storage could not be
  the four-numbers-and-a-string thing its own tests drive.
- ⚠️ **Every five seconds of AUDIO, not on a timer.** `timeupdate` fires ~4×/s
  and `localStorage` is only touched when the number would actually move by five
  — no interval to start, stop or leak. A **seek** moves it by more than five in
  one tick, so it is written at once; a **pause** skips the throttle entirely,
  because deliberately pausing is the clearest "this is where I was" anybody
  gives this app.
- ⚠️ **Nothing under `MIN_RESUME_SECONDS` (5) is written or restored.** Three
  seconds in is the beginning, not a place, and restoring it makes a clip that
  was barely started sound like it skipped its first words.
- ⚠️ **A finished item leaves no position.** `rewind()` puts `elapsed` back to
  zero before the queue advances, so the write that lands says `0` — the truth,
  since something that ran out has nowhere to be resumed from.
- ⚠️ **`livePosition()` refuses to guess.** The player may hold something the
  queue no longer points at (the editor stopped it, a removal moved the index),
  and reading `elapsed` regardless would file one item's position under
  another's key. It also returns the **unspent boot position** while nothing has
  played: without that, a single `enqueue` before pressing play would persist a
  `0` over the spot somebody came back for.
- ⚠️ **Nothing on screen announces it before play is pressed, and that is a
  decision.** A cold boot already shows the clip the queue points at — the
  player's `player__meta` reads `queue.current`, not `playback.current` — so the
  only honest place for a waiting position would be its clock, which would then
  read `00:40 / 00:00`: a position beside a length nothing has loaded yet.
  Pressing play fills both in at once. (An idle line saying `pulsa play para
  seguir donde lo dejaste` was built and removed: that line only renders with an
  EMPTY or unresolved queue, so it would have flashed during hydration and never
  been seen in the state it was written for.)
- **The editor is untouched by all of this**, for the same reason as everything
  else here: it owns its own element and never reaches this store.

### Sharing a queue: `utils/queue-code.ts`

`/cola?c=2D1j0h2s2N` — base62, **two characters per id**, no separators, in
order. ⚠️ **Compression, not encryption**: every id in it is already a public
permalink, and nothing here should try to hide anything.

- Two characters carry ids up to **3843** (`MAX_SHAREABLE_ID`) against a largest
  real id of 182 and roughly ten new clips a year. ⚠️ The parameter is named `c`
  rather than `queue` **so a future `c3=` can live beside it** and every link
  ever sent keeps working.
- **`MAX_SHAREABLE_CLIPS = 50`.** Past that it is a file pretending to be a
  link; longer queues share their first fifty.
- ⚠️ **Anything that does not decode is dropped silently**, and so is any id
  that no longer exists. A shared link is a suggestion, not a transaction —
  refusing the whole queue because one clip was deleted serves nobody.
- ⚠️ **A queued EPISODE cannot travel in one.** Two base62 characters carry an
  id and nothing that says which kind it is, and `?c=` is a public URL shape —
  so `encodeQueueCode` is fed `queue.shareableClipIds` and the episode is left
  out. `/cola` says so in as many words **before** the link is copied; a queue
  that silently arrives shorter at the other end is the failure that line
  prevents.

⚠️ **The editor deliberately does not use this store** (`utils/editor-audio.ts`).
The store clamps to `[start, end]` and stops at `end`; the editor's `end` moves
under the cursor and it must scrub the whole episode. The editor owns one
element while mounted, asks the playback store to stop on the way in, and pauses
its own on the way out — which is what keeps "one thing plays at a time" true
across the two.

## Audio download: cutting a clip client-side (2026-08-20)

⚠️ **Recorded deviation: no server-side re-encode.** A real download does not
need one: an MP3 is a sequence of **independent frames** — one decodes without
any of the others — so a clip is cut by copying bytes, never decoding or
re-encoding, entirely in this package.

```
core/application/audio/mp3-frames.ts       pure — parseFrame · findFrame · id3Length · id3Tag
core/application/clips/
  download-clip-audio.use-case.ts          orchestrates the reads and the cut
core/domain/episodes/
  episode-audio.repository.ts              port: readRange(episodeId, from, to)
core/infrastructure/episodes/
  episode-audio-http.repository.ts         adapter — its OWN Client, see below
vue/utils/save-file.ts                     the Blob-URL-and-click trick, in one place
vue/composables/use-clip-actions.ts        download(clip), wired into the four call sites
```

### `mp3-frames.ts` — why this works at all

Cutting `[start, end]` is "find where those seconds begin and end in the byte
stream, and copy the frames in between." Verified against the real catalogue
(2026-08-20): every episode sampled, 2009 to 2026, is MPEG-1 Layer III **CBR**
with no `Xing`/`Info` frame — which is what makes time→byte an exact
multiplication (`bitrate / 8`) rather than a VBR table lookup, and the cut bytes
were checked byte-for-byte identical to `ffmpeg -c copy` cutting the same span.

- ⚠️ **`findFrame` requires 4 frames to chain**, not one match. The sync pattern
  (`0xff` + three set bits) turns up by chance inside compressed audio often
  enough that a single hit is not proof of a real frame boundary.
- ⚠️ **The bitrate is read per episode, never assumed.** Measured 64/128/160/192
  kbps across the catalogue — constant within one episode, different across them.
- ⚠️ **A leading `ID3v2` tag can exceed 200 KB** (embedded cover art), so
  `DownloadClipAudioUseCase.readLayout` reads it in up to two passes: the first
  16 KB gives the tag's syncsafe size; if the first frame does not fit in what
  was already read, a second read starts right after the tag.
- ⚠️ **The cut can land up to ~50 ms late.** Resynchronising only ever searches
  forward from the exact byte the arithmetic points at. `ffmpeg -c copy` rounds
  backward instead, which is the one place a byte comparison against it diverges
  — by design, and inaudible at whole-second clip lengths.
- The Layer III **bit reservoir** means the first couple of frames of any cut —
  this one or `ffmpeg`'s — decode from an incomplete reservoir: a few tens of
  milliseconds, not audible in spoken-word audio.

### `episode-audio-http.repository.ts` — its own `Client`

⚠️ **Does not use the shared generated client instance.** Every other adapter
calls a generated operation through `httpTransport` — a `ky` instance sized for
JSON, ten seconds. A `Range` read here is up to ~1 MB, not a few hundred bytes,
so this repository builds a **second** `Client` (`createClient(createConfig({
baseUrl: resolveApiBaseUrl(), fetch: audioHttpTransport }))`), where
`audioHttpTransport` (`http-transport.ts`) is `transport.extend({ timeout:
30_000 })` — everything else (`throwHttpErrors: false`, `retry: 2`) inherited,
only the clock longer. `resolveApiBaseUrl()` is exported from
`api-client.config.ts` for exactly this, so the two clients can never resolve to
a different origin.

It still calls the **generated** operation (`episodesControllerGetAudio`) — no
URL is written by hand — with `parseAs: 'arrayBuffer'`, because the generated
response type (`Blob | File`, from the OpenAPI `format: binary` schema) is JSON-
shaped by default and would try to `JSON.parse()` raw MP3 bytes otherwise.

### The endpoint it talks to

`GET /episodes/:id/audio` (backend, `packages/backend/CLAUDE.md`) is a
same-origin passthrough to `episode.file` — it exists **only** because
gravina82.com sends no CORS headers, so this package cannot `fetch()` it
directly. The backend does no audio processing at all; it is a byte pipe.
Playback is unaffected — `<audio>` loads gravina82.com directly.

## The episode screen and its map (2026-08-25)

`/episode/:title` is the episode itself, not just a list of what was cut from
it. The map is what lets somebody listen to an episode without cutting one.

The accepted design of two (A3 + B3, of six drawn):

- **The map.** A `grav-panel` under the header holding the whole episode's
  measured waveform, the published clips drawn on it as bands, a playhead, the
  `00:00 · elapsed · 03:02:37` scale the editor already uses, a legend and one
  transport. ⚠️ **It is not decoration**: on this data the shape of an episode's
  clips is the fact a list cannot state — episode 93 has six clips in its first
  hour, ninety minutes of nothing, and five crammed into its last eight minutes.
- ⚠️ **Hover links the two halves in both directions.** A band lights its row
  and a row lights its band, through one `markedClipId` ref. The row component
  publishes no hover event and should not — it is the same row the library and
  the permalink draw — so the wrapper `div` carries it.
- ⚠️ **A click on the WAVE plays the episode from there**, starting it if it was
  not playing: "from here" is a play instruction, and asking somebody to press
  play and then find the spot again is what the map exists to replace. It relies
  on `playback.seek` re-arming `pendingSeek` while the stream is cold.
- ⚠️ **A click on a BAND plays that CLIP**, not "seek the episode to it". Every
  other control on this site that names a clip plays that clip, and a band that
  moved the episode's playhead instead would also run straight past the cut's
  end.
- ⚠️ **It sounds through the global player, as a queue item.** The rejected
  alternative was the editor's — an `<audio>` owned by the view — for two
  reasons: a row has no play button precisely because there is one transport for
  the whole site, and an episode is three hours long, so leaving the page must
  not cut it off. See "The queue" for what that cost.
- ⚠️ **The empty state is a watermark, not a slab.** It is a normal `grav-panel`
  with the drawing bleeding off the right edge under a gradient mask. ⚠️ **It
  never goes away below 720 px.** Hiding it there solves the wrong problem:
  the drawing is the GROUND of that box, and a box whose ground disappears on a
  phone is a different box. It shrinks to 120 px and drops to 0,45 opacity, and
  the mask keeps the copy's half of the panel clear. **The joke is content and stays verbatim** —
  the same sentence the library and `/cola` print. The BUTTON changed
  (`¡Crea un corte!` → `Corta el primero`), which the accepted drawing said.
- ⚠️ **The transport is one row on a phone**: the play button and the share
  button drop to their glyph alone (`ep-transport__label` hidden), the play in
  the round shape `.player__play` already uses for the same verb. ⚠️ Share is
  pinned to the panel's right margin with `margin-left: auto` at **every** width,
  not just on a phone: the two controls either side of the clock do different
  jobs, and a `gap` apart put the second one under a pointer aiming for the
  first. It lands on the same x as the end of the wave and of the scale. ⚠️ **Both then
  carry an `aria-label`** — the visible words were their accessible name, and a
  control that loses its name to a media query is announced as "botón".
- ⚠️ **The header is two rows on a phone, declared with a grid**: the cover
  beside the title, then the meta line beside the cut button. As a wrapping flex
  row it was four rows of chrome before a single word of the episode —
  `display: contents` on the headings wrapper is what lets the title and the
  meta land on different rows. The cut button drops its tail there too
  (`Cortar` rather than `Cortar un momento`, the navbar's `topbar__wide`
  pattern): at full length it took ~11 rem of a 320 px row and pushed the meta
  beside it onto two lines.
- ⚠️ **`gravinaBehindrecortadopeke.png` carries an alpha channel.** An opaque
  `#f6f6f6` ground is invisible on white cards and a literal white rectangle on
  the dark panel. No gradient fixes that; the file has to carry the alpha.

## Mis momentos (2026-08-26)

**A moment is a private draft of a clip.** While an episode is playing, one
button marks the second that is sounding; the episode's own page then draws
those marks over its wave and lists them underneath, where each one can be
listened to, cut into a real clip, or forgotten. The episode list gains a third
`Mostrar` state for the episodes that carry any.

⚠️ **It is entirely client-side, and that is the decision.** No table, no
endpoint, no `openapi.json` change. A moment
says *which episode, at which second, on which day somebody was listening* —
a listening trail, and more personal than the vote this project already refuses
to attach to a person (root `CLAUDE.md`, "Identity"). The only identity
available would be `X-Voter-Token`, which lives in the same `localStorage`, so
a server copy would be exactly as fragile and would cost the database its
"not one personal column" property.

⚠️ **Losing them is normal**, like losing the voter token: a private window, a
second browser and cleared storage all start empty. Every screen that shows them
says `solo en este navegador` rather than pretending otherwise.

Where the pieces live:

- **`stores/moments.store.ts`** — `gravindex.moments`, the sixth key. A moment is
  `{ episodeId, at, markedAt, clipId? }`, and the file also owns the four numbers
  the screens derive from one: `REACTION_LAG_SECONDS` (4), `LISTEN_LEAD_SECONDS`
  (20), `CUT_WINDOW_SECONDS` (40) and `MIN_GAP_SECONDS` (10), plus the caps (200
  in total, 50 per episode, dropping the oldest by `markedAt`).
- **`composables/use-moment-actions.ts`** — marking and forgetting, with the copy
  both screens raise. Playing and cutting stay in the views: one needs the
  `QueuedEpisode` the screen already built, the other is a navigation.
- **`GlobalPlayer.vue`** — the button, as **one more pill**, first in the row.
- **`EpisodeView.vue`** — the lane, the list, and the same button in the
  transport.
- **`EditorView.vue`** — `?start`, `?end` and `?moment`.
- **`EpisodesView.vue`** / **`EpisodeRowItem.vue`** — the filter and the count.

Five things that are decisions rather than details:

1. ⚠️ **`at` already carries the reaction lag.** Nobody presses the button while
   the funny thing is happening — they press two to eight seconds later — so
   `mark()` stores the playhead minus four seconds and everything downstream
   reads a number that already points at the right place. Storing a *window*
   instead was rejected: the margins are screen decisions that can be retuned
   tomorrow, and a stored window freezes them in every visitor's browser.
2. ⚠️ **The button is in the PLAYER, and repeated in the episode's transport.**
   The player is the one that must carry it, because an episode keeps sounding
   when the visitor walks off its page — that is the whole reason an episode
   goes through the queue. The transport's copy exists because that is the
   screen you are looking at while it plays. ⚠️ Below 720 px only the first pill
   survives, so `Marcar este momento` is written **first** in the DOM: on a
   phone an episode keeps the mark and a clip keeps the vote.
3. ⚠️ **Marks are drawn in their own 18 px lane, above the wave**, never on it.
   The wave already carries the published clips as bands and, on episode 99, six
   of the seven cuts are inside twenty minutes — a pin inside a band is two
   controls fighting for one click. ⚠️ A pin needs a **scale**, so on an episode
   with no measured waveform and nothing playing there are no pins and only the
   list, exactly as there are no bands.
4. ⚠️ **A pin plays the episode from 20 s before the mark**; it does not open a
   menu. Every other control on that screen that names a position plays it, and
   the row underneath carries the three-way choice. Deleting lives in the row
   only: it is the surface that exists at every state and the one a thumb can
   hit.
5. ⚠️ **The mark survives the clip cut from it**, carrying its `clipId`, and the
   row then reads `ya es el corte nº 137` instead of offering to cut the same
   second twice. A clip the admin surface later deletes leaves the mark behind,
   which goes back to offering `Cortar` — that is again the truth.

⚠️ **`Con mis momentos` is the one filter the server cannot answer**, so with it
on `EpisodesView` stops calling `GET /episodes` and assembles the page out of
`GET /episodes/:id`, one per marked episode, sorted by date and paginated in
memory; the title search folds accents and runs in the browser. The three states
are exclusive because the control already was, and crossing them would mean
merging a server-paginated list with a local one. A watcher refetches while the
filter is on if the marks change, because that page is a cache entry whose key
never sees them.

## The calendar (2026-08-27)

`/episodes/calendario/:year?` — the episode list drawn by date. Same view, same rail,
same three filters; only the middle of the screen changes, and `EpisodesView` branches on
`route.name`. It is the pattern `/creator` already uses over `HomeView`: a route that
exists so the back button and a direct link work.

```
vue/components/EpisodeCalendar.vue      the year, the open day, the layer, the scroll
vue/components/CalendarRibbon.vue       208 months in one strip that does not scroll
vue/components/CalendarMonth.vue        one month, as a grid of days
vue/components/CalendarDayPanel.vue     the day, as a popover or a sheet
vue/composables/use-episode-calendar.ts the query and the bucketing
core/application/episodes/list-all-episodes.use-case.ts
vue/queries/marked-episodes.ts          shared with the list — see below
```

Five things that are decisions rather than details:

1. ⚠️ **The year is a PATH segment, and it had to be.** `use-list-filters.ts` rebuilds
   the WHOLE query string from its own filters on every commit
   (`router.replace({ query: urlQuery() })`), so a `?a=2011` added beside them would be
   erased the moment somebody typed in the search box. Declared *among* them instead, it
   would be counted by `activeFilterCount` in the mobile `Filtros · N` badge and cleared
   by `Limpiar filtros` — neither of which is true of a year. So: **filters in the query,
   the view in the path**. Entering **pushes** one entry, so Back leaves for the list;
   every year change **replaces**, which is the rule every filter on this site already
   follows. Walking through eight years must not cost eight presses of Back.
2. ⚠️ **Bucketed by the LOCAL date, never UTC.** `utils/format-date.ts` prints episode
   dates in the visitor's own zone, deliberately, so a UTC bucket would
   put some of the oldest episodes on a different day from the one their own row prints —
   two answers to the same question on the same screen. `buildCalendar` is exported and
   tested on its own for exactly this.
3. ⚠️ **Six requests, not a new endpoint.** `ListAllEpisodesUseCase` loops
   `GET /episodes?limit=100` — the API's `MAX_LIMIT` — until it has `total`. An aggregate
   endpoint would be cheaper on the wire and would cost a contract and a regenerated
   client; 589 rows is ~35 KB. ⚠️ It
   is not a list screen and must not become one: everything a visitor scrolls still goes
   through `ListEpisodesUseCase` and `use-infinite-list.ts`.
4. ⚠️ **`Con mis momentos` works here too, through the SAME helper the list uses.**
   `queries/marked-episodes.ts` is the shared helper behind
   `EpisodesView`'s `fetchMinePage`: the list slices a page out of what it returns
   and the calendar takes the lot. Two screens quietly disagreeing about what "mis momentos" means
   is what sharing it prevents.
5. ⚠️ **The day is a floating layer, on both sizes, and never a slice of the calendar.**
   A list dropped between two rows of months splits the year in two and pushes the later
   months off the screen; a phone-wide panel is worse, because most days here hold exactly
   one episode and a whole screen with one row in it reads as a screen that failed to
   load. So a popover pinned to its day when there is room, and a bottom sheet over a
   scrim when there is not — clear of the player, which is the site's one transport.
   Inside it is `EpisodeRowItem`, whole.
6. ⚠️ **Coming back from an episode lands on the calendar as it was left**, on both sizes:
   the same day open, at the same scroll position, kept in `history.state` under
   `gravindexCalendar`. Not in the URL — what somebody shares is "the calendar, by 2011",
   while which day they had open is what the Back button owes them, and a `?dia=` beside
   the filters would be erased by the filter core's own `router.replace` anyway. ⚠️ **The
   position is restored by this component, not by the router**: `scrollBehavior` hands the
   saved offset back while the screen is still empty — six requests unanswered, twelve
   grids undrawn — so the browser clamps it to the top of a short page.

Six traps, all of which cost something to find:

- ⚠️ **A silent year still draws its twelve columns.** The strip is a TIME axis: collapse
  2010 to nothing because nobody published and the years stop being evenly spaced, which
  is the one thing the drawing is for. Only the two ends stop where the data does.
- ⚠️ **The window over the selected year is ONE measured rectangle**, not a tint on each
  of its twelve months: they sit a pixel or two apart, so a per-column highlight comes out
  striped and reads as twelve marks instead of one span. Measured because the columns
  share the width with `flex: 1 1 0` and the year groups are weighted by how many months
  they hold — where a year lands is the layout's answer.
- ⚠️ **`EpisodeRowItem` needed a container query.** Its narrow layout was a
  `@media (max-width: 720px)`, and inside a 23 rem popover on a 1400 px desktop that says
  "wide" — leaving the title about ten characters. The panel declares
  `container-type: inline-size` and the row now carries **both** rules; every other caller
  declares no container, so the media query keeps doing the work there. They cannot be
  merged: `@media` and `@container` are different at-rules. Change them together.
- ⚠️ **There is only one `top: 0`.** `FilterRail`'s phone header is sticky; so is the
  calendar's year stepper, and two sticky bars at the same offset simply overlap. The rail
  takes a `stickyHead` prop and the calendar is the only caller that passes `false`:
  inside the calendar the control somebody reaches for again and again is the year, not
  the search, and a second bar costs a fifth of what is left on a 660 px screen after the
  nav and the player.
- ⚠️ **The sheet needs scroll room reserved under the last month, or the feature fails
  silently at the bottom of the year.** The sheet is fixed over the last ~250 px, so
  December — the last thing on the page — cannot be lifted above it: the page runs out of
  scroll first and the day somebody just tapped stays hidden behind the panel describing
  it. `EpisodeCalendar` measures the sheet and pads the grid by its height BEFORE
  computing the scroll.
- ⚠️ **The panel closes when the year moves AWAY from its day, not whenever the year
  moves.** `‹ ›` crossing from December into January changes the year *because* of the
  open day; a blanket close there shuts the panel on the very press meant to advance it.
- ⚠️ **Pulling the panel into view is the PARENT's call, never the panel's own.** It was
  a watcher inside `CalendarDayPanel` for one round, and it then fought the position being
  restored from history — a smooth scroll still in flight when the exact offset landed,
  twenty pixels off every time. The panel places itself; `EpisodeCalendar` decides when a
  scroll is helping.
- ⚠️ **What has to end up on screen is the MONTH, not the panel.** Keeping the popover
  out from under the header was not enough on its own: it left the month it belongs to
  half off the bottom, so the layer was legible and the thing it described was not.
  `bringIntoView` fits the two **together** where they both fit, and gives the month the
  space when they do not — its name and its first weeks are what say which month this is.
  ⚠️ It lives in `EpisodeCalendar`, never in the panel: the panel is one of the two boxes
  being fitted rather than the subject, and only the parent knows when a scroll would be
  fighting a position being restored from history.
- ⚠️ **The visible band is measured off `.topbar`, never off `--v-layout-top`.** That
  variable is Vuetify's, and this site's header is a plain sticky element
  (`AppHeader.vue`) rather than a `<v-app-bar>` — so it is EMPTY, reading it
  gives a band starting at 0, and the popover slides under 59 px of header. The player's
  own top edge is the other end, rather than `innerHeight - height`: the two agree only
  while it sits exactly at the bottom.
- ⚠️ **`stickyHead` needs `withDefaults` to say `true` out loud.** Vue casts an ABSENT
  Boolean prop to `false`, not `undefined`, so a `props.stickyHead === false` test with no
  default quietly unpinned the phone search header on **every** screen — including the two
  that never mention the prop. `12-overlay-and-mobile.spec.ts` now asserts the sticking,
  not just the existence.
- ⚠️ **The mobile filter sheet is placed against its header's MEASURED bottom**, not a
  hard-coded `top: 116px` — the nav bar's 59 plus the header's 58, true only at the
  very top of an unscrolled page. And the header **pins itself whenever the sheet is
  open**, whatever `stickyHead` says: a filter panel you can scroll away from, leaving its
  own search box and its own `Filtros` button behind, is a panel with no way back.
- ⚠️ **The year stepper is `z-index: 1`, and it must stay under `FilterRail`'s sheet
  (`z-index: 2`).** Being positioned is already enough to sit over the month grids;
  anything higher puts the year row on top of the filters panel it is supposed to be
  under.
- ⚠️ **`Lista de episodios` is visually hidden below 720 px** (`EpisodesView`), on both
  views. It says nothing somebody who just tapped `LISTA DE EPISODIOS` in the nav does not
  know, and it cost a whole line above the controls — two, once the calendar added its
  year stepper. It stays in the document: a screen with no `h1` is a screen with no title.
  With it gone the row has somewhere to spread: the count at one end, the view switch at
  the other, the way the wide layout already reads.

Two inputs beyond the buttons, and the distinction between them matters:

- **Arrow keys** step a day while the panel is open, listened for on the window because
  the focus may be back on the day cell — the popover is not modal and does not trap. ⚠️ A
  keystroke aimed at an `input`, a `textarea` or a `contenteditable` is never stolen: the
  search box is on the same screen and `←` there means "move the caret".
- **A press anywhere else** closes the popover, in the wide layout. Nothing dims the page
  there — the calendar behind it stays live — so a click into it has to mean something.
  ⚠️ A press on a day cell is left alone: that cell's own click either opens another day
  or closes this one, and closing here first would turn the second into a
  close-then-reopen. On a phone there is no outside; the scrim has its own handler.
- **A sideways swipe** on the sheet does the same, in the compact layout only. ⚠️ It is
  the one gesture on this screen and it **duplicates two visible buttons** — which is what
  separates it from the ribbon drag that was designed and removed, where nothing announced
  the gesture and it fought the vertical scroll for the same finger. `touch-action: pan-y`
  keeps the list inside scrolling, and the `click` a swipe ends on is swallowed once, or
  letting go over `Cortar` navigates to the editor.

## The clip editor and the three-handle slider

Vuetify's range slider tops out at two thumbs, so the timeline is a custom
control. **All the maths is pure functions in `utils/slider-logic.ts`**;
`ThreeHandleSlider.vue` is a thin rendering shell.
Three findings from the standalone prototype are baked in:

1. **Zoom needs no remount.** `min`/`max` are reactive props and positions are a
   computed, so the same DOM nodes re-render — and a test asserts the track is the
   same node before and after.
2. **Handle collision was a deadlock, not a tie-break.** A tie among *collapsed*
   handles goes to the one with room in the direction of the press, or `start`
   could never be pulled back out of a three-way cluster.
3. ⚠️ **`setPointerCapture` throws in Chrome** when the pointer id is not
   active — invisible to jsdom, and it aborted the very first tap. Wrapped, with
   a regression test.

⚠️ **Recorded deviation: the handles clamp, they do not cross.** With three
handles a swap is undefined, so `start <= playhead <= end` holds by
construction, mid-drag included. The saved cut is identical, and
`test/e2e/specs/08-slider-clamp.spec.ts` asserts it mid-gesture.

⚠️ **Times are seconds, not `hh:mm:ss` strings.** Formatting a negative time as
`--:--:--` would turn into `NaN` and could save a clip at `NaN` seconds.
What *is* preserved, and asserted end to end, is that what gets published is
parsed back out of what the screen was displaying.

⚠️ **The timecodes are `<input>`s, and the screen is grouped** map, track, times,
tools and form. What each piece costs:

- **Each number sits between the four buttons that move it** —
  `−10 −1 [tiempo] +1 +10` — so there are no separate `.ed-times` boxes across the
  panel and no `.ed-nudges` grid. ⚠️ **`±5` is not one of them**: the pair is the
  pair the keyboard offers.
- ⚠️ **The property above is strict.** `cutSeconds` parses the
  field's text and then refuses to answer unless it equals the model, so a value
  the cut declined — a start typed past the end — cannot be published while it is
  still on screen. Leaving the field snaps it back to the model, which is the
  feedback.
- ⚠️ **`.ed-end` centres with `justify-content`, never with `1fr` spacer tracks.**
  Grid auto-placement fills tracks in source order, so the spacers swallowed the
  first button and the `+1` inherited the wide middle track. Same trap
  `ClipRowItem` documents from the other direction.
- ⚠️ **`zoomIn` clamps the window to contain the cut.** `ThreeHandleSlider`
  reclamps any value outside its window (`reclampToRange`), so a window closing
  past `start` would MOVE the handle, eating the cut one press at a time.
  `zoomToCut` and `zoomOut` cannot hit this; `Acercar` needs the guard for the
  same reason.
- **The `<v-slider>` speed control is four fixed steps**, and the tooltips show
  only while a handle is dragged, hovered or focused — at rest three of them
  stood over the episode map.
- ⚠️ **The bar is three `.ed-bar__row`s in the DOM, and `display: contents`
  flattens them into one line on a wide screen.** The rows are *what sounds ·
  where the playback is · what is on screen*, which is why "ir a" is not a group
  of its own — its two jumps move the playhead exactly like the four seeks, so
  they are that row's bookends. Every control fits on one line on a desktop.
- ⚠️ **`--ed-slider-pad-y/-x`, `--ed-wave-h`, `--ed-handle-h` on `.ed-track`.**
  The waveform behind the slider and the dashed boxes over it are positioned by
  hand against the slider's own padding — "a bar halfway along the waveform
  really is halfway along the window" only holds while the numbers agree. As
  literals in three rules, the narrow layout breaks the agreement the moment it
  changes the padding. Override the variables, never the derived
  values.

### The editor on a phone (2026-08-22)

⚠️ **Measured on a 390 × 844, and the number that mattered was not the total.**
The screen came to **1769 px** against **707 usable** (844 − 56 header − the
81 px `App.vue` reserves for the fixed player), and the fold landed *inside* the
Inicio/Dura/Fin block — so every button that moves the cut was below it. Cutting
meant dragging a handle, scrolling down to nudge, scrolling back up to look.

It is **1192** now, and the whole cutting half ends at **~682**, i.e. above the
fold with the title field already showing. Four things did it, and three of them
were only found by measuring in a browser:

| | Before | After |
|---|---|---|
| Inicio/Dura/Fin | 291 | 182 |
| The transport bar | 204 | 145 |
| Header (no cover, title capped at two lines) | 181 | 54–77 |
| The track's tooltip gutter | 166 | 106 |

⚠️ **Three traps, all caught by measuring the built page, not by reading the CSS:**

1. **`order` is doing the work in `.ed-end`.** Source order is
   `heading · −10 · −1 · [tiempo] · +1 · +10 · marcar`. Dropped into four columns
   unchanged, the full-width timecode is forced onto its own row between the
   button pairs and the block came out **taller than the stacked version** it
   replaced — 427 px against 291.
2. **`.ed-dur` sits between the two ends in the DOM.** In two columns that put it
   on a row of its own *between* them, so Inicio and Fin landed on separate rows:
   335 px, the two-column layout drawn as one column. It is `order: 1`.
3. ⚠️ **`:deep(.ths)` matches nothing.** `ths` is `ThreeHandleSlider`'s ROOT,
   which already carries `.editor__timeline` — a scoped rule reaches a child's
   root directly, and a descendant selector reaches past it into nothing.

⚠️ **The title is capped with `max-height`, not `-webkit-line-clamp`.** Chrome's
newer standard `line-clamp` computes `display` to `flow-root` and the clamp
silently did nothing — the title still measured three lines while
`getComputedStyle().webkitLineClamp` reported `"2"`. The longest title in the
catalogue is 79 characters and its third line is what put the last row of the bar
back under the fold.

⚠️ **Targets are 42 px here** (`.ed-step`, `.ed-chip`, `.ed-primary`) against the
wide layout's 2.1 rem. 33,6 px is under the 44 a finger wants, and that — not the
height — is what made the screen hard to *use* rather than merely tall.

⚠️ **`.ed-primary` drops its measured fixed width for `width: auto`** and grows
to fill its row. The "one width for both states" rule survives for free, because
the row does not change when the label does.

⚠️ **It fits by about 25 px, and that is not much.** A narrower phone eats it. If
it turns out not to be enough in the hand, the next move is splitting the screen
into two steps — cut, then publish — not shaving another ten pixels off this.
**Nothing here has been tested with an actual thumb.**

## The gravinero theme

The identity is a **custom Vuetify theme**, not Material defaults.

⚠️ **`theme/gravinero-theme.ts` is the one place a gravinero hex may be
written**, and `theme/__tests__/gravinero-theme.spec.ts` fails if a component
grows a literal colour or if `gravinero.css` drifts from it. The values were
measured with `getComputedStyle`, not guessed. The anchors:
`red #9a1d0d` (primary — titles, tags), `brown #dcc08e` (nav hover/active,
chevrons, icons), the dark horizontal stage gradient
`#1d1d1d → #323232 → #1d1d1d`, white cards on `#4a4a4a` ink, the dark-inset
`.control-graviner` form controls, and the `2px 2px 1px #000` title shadow.

⚠️ **The theme is a whole family of tokens rather than per-component
CSS**, and the same rule holds: they go in `gravinero-theme.ts` or nowhere.
They exist because the UI puts content **on the stage** — a white card never
needed ink for a dark ground, because everything sat on one.

| Token | What it is |
|---|---|
| `stageInkMuted #a49c93` | A row's second line and its icons. ⚠️ **4,7:1 against `#323232`**, the lightest point of the gradient. **Do not darken it** |
| `stageInkFaint #8b837a` | Timecodes and counters. Below the text minimum on purpose — supporting detail only, never a sentence |
| `stagePanel #232120` | A raised panel on the stage. ⚠️ **Not `panel`**, which is the light `#f5f5f5` of the admin surface |
| `stagePanelDeep` / `stagePanelSide` | An inset inside one (the editor's track) / the mobile filter sheet |
| `playerGround #6d1409` | Behind the pollitos band — the photograph has white between the birds, so the ground shows through |
| `onBrown #6b1a0c` | Ink on a brown fill: the queue pill, the play glyph |
| `hairline` / `hairlineStrong` | The rule between two rows, and a button outline: the same brown at two opacities |

`BODY_FONT_STACK` and `MONO_FONT_STACK` join `--grav-font-title` — and the same
pairing rule applies, since `gravinero.css` re-declares them.

### Three tag controls, and which is which

⚠️ **They are not variations of one widget; the split is by what the
surrounding chrome does with a tag.** A single component with eight boolean props
doing two jobs is what this avoids.

| Component | Where | Shape |
|---|---|---|
| `TagFilter.vue` | the library's rail and the mobile sheet | All 102 with counts, selected pinned above a dashed rule. **Filters**, so it can never invent one |
| `TagPicker.vue` | the editor's form | The same dark list and counts, plus an "inventar el tag «x»" row. **Writes a draft**, so it must be able to. ⚠️ Below 720 px it is a **band of chips** instead — see below |
| `TagAutocomplete.vue` | `ClipTagList` only | A `v-combobox`: one line, opened on demand inside a row, where a full list does not fit |

⚠️ **There is no `TagSelector.vue`.** A wrapper around `TagAutocomplete` for the
editor would put a white teleported menu on the dark stage — see the trap above.
`TagPicker` has no overlay at all, which is why it is not a fourth variation.

⚠️ **Only `TagAutocomplete` still opens a menu**, and it needs `.grav-menu`.

⚠️ **`TagPicker`'s narrow form is chosen with `useCompactLayout`, not a media
query**, and that is this app's rule rather than a preference: drawing both and
hiding one with CSS puts all 102 tags in the document twice — invisible to
somebody looking, very audible to a screen reader, and double the `Tab` stops.
The band offers the eight most used and `+ los N` opens the same long list;
typing filters the band **in place**, because on a phone a floating menu and the
virtual keyboard compete for the same half of the screen.

⚠️ **Six chassis primitives live in `gravinero.css`, not in components**:
`.grav-field`, `.grav-panel`, `.grav-mono`, `.grav-seg`, `.grav-list` and
`.grav-scroll-brown`. A control that looks like a gravinero control uses one;
re-implementing the same inset border in a scoped block is how eight controls
end up with eight slightly different focus rings.

⚠️ **`button:not([class*='v-'])`, not `button`.** Vuetify 4 ships its component
CSS inside `@layer`, and an **unlayered** rule beats a layered one at any
specificity — so a plain `button { background: none }` reset silently stripped
the fill from every `v-btn` in the app, the admin login included. Two tests in
`gravinero-theme.spec.ts` stand on that now. The same trap applies to the stage
link colour, which is scoped to prose (`.v-main :where(p, li, td) a`) rather
than to every anchor, or a row title turns red.

⚠️ **The theme is deliberately mixed**: `dark: true` with a dark `background`,
but a **white `surface`** — white cards on a dark gradient stage, which is the
**admin surface only**. Three consequences a newcomer will hit:

- `border-color` is overridden to black, because Vuetify's dark default is white
  and would draw the card-footer hairline white-on-white.
- `.v-card`, `.v-list` and `.v-table` rebind `--v-theme-on-background` to
  `--v-theme-on-surface`: Vuetify 4's `text-*-emphasis` utilities are hard-wired
  to `on-background`, which here is the **opposite** tone, so captions inside
  cards would render white-on-white too.
- `gravinero.css` re-declares the same values as `--grav-*` custom properties
  because CSS cannot import from TS. ⚠️ **Change the two in pairs.**

`GravWave.vue` draws the waveform behind the player. ⚠️ **Measured when the
caller has one, drawn otherwise (2026-08-19).** `GET /episodes/:id/waveform`
computes real peaks offline, server-side, from the downloaded mp3
(`packages/backend/src/waveform/`) — the browser still never decodes audio
itself. An optional `peaks: readonly number[]` prop carries them in; when it
is empty (an episode not measured yet, or the query still loading) the
component falls back to its own deterministic pseudo-random shape, seeded by the
clip id, so a clip always looks like itself in that case too.
`GlobalPlayer.vue` (`points: 128`, guarded by `enabled` so an idle player asks
for nothing, and **no `from`/`to` at all when what is playing is a whole
episode**), `ClipView.vue` (`points: 160`, the clip's own `[start, end]`),
`EditorView.vue` (`points: 160`, the zoomed window, debounced 300 ms against
`WAVEFORM_ZOOM_DEBOUNCE_MS` so a drag gesture does not fire a request per
pointer frame) and `EpisodeView.vue` (`points: 2000`, the whole episode) each
ask their own `episodeWaveformQueryOptions` window — a distinct cache entry per
window, so scrubbing the editor's zoom never refetches what the permalink
already has.

⚠️ **`EpisodeView` asks for the MAXIMUM and averages down** (`utils/waveform-bars.ts`,
2026-08-25), and that is not premature: the endpoint returns the PEAK of each
bucket, so over a three-hour episode at the ~320 bars a panel fits, every bar
summarises half a minute and saturates. Measured on episode 93, asking for 300
points gives a **median of 255 out of 255** — a rectangle. 2000 points averaged
to 320 bars brings the median to 212 and the shape back. ⚠️ **Only for the
whole-episode case**: a clip's slice is already the right resolution and
smoothing it would flatten what distinguishes one cut from the next.

⚠️ **`GET /episodes/:id/waveform`'s `to` is also where an episode's LENGTH comes
from.** `GET /episodes/:id` has no duration field (the column exists and is not
surfaced), so the request `EpisodeView` makes for the drawing is the same one
that lets it place the clip bands, write `03:02:37` in the header and hand the
queue a length. `to` is `0` for the nine episodes nothing has measured; the
screen says `midiendo el episodio…` and draws no bands rather than inventing a
scale.

⚠️ **The rule along the top of the player is the progress bar, and it seeks —
below 720 px, and there only** (2026-08-19, narrowed 2026-08-22,
`GlobalPlayer.vue`). On a phone it is a track at 30 %, a fill scaled by
`playback.elapsed / playback.duration`, and a 10 px handle, and — the waveform
being hidden at that width — the **only** place the position is either drawn or
changed.

⚠️ **Above 720 px the fill and the handle are `display: none` and the rule is
back to being a plain brown line.** The waveform beside it already draws the
position and already seeks on a click, so the rule was a second control for one
number: something more to explain and an extra `Tab` stop. ⚠️ It is a media
query rather than `useCompactLayout`, deliberately — the composable exists for
duplicated *trees* (102 tag checkboxes in the document twice), and one input
that `display: none` takes out of the tab order and the accessibility tree
anyway does not need `matchMedia`, a resize listener, or a wide-layout fallback.
The proof is in a browser: `test/e2e/specs/05-playback.spec.ts` clicks the
waveform on a 1440 px viewport and drags the rule on a 390 px one.

⚠️ **The handle is a native `<input type="range">`, not a `v-slider`**, and that
is a decision. A 3 px rule flush with the top edge of a 78 px band is not a shape
Vuetify's slider takes without fighting its own wrapper, its density and its
layered CSS; `appearance: none` plus two vendor pseudo-elements is the whole
implementation, and arrow-key seeking comes free.

⚠️ **The component is TWO boxes, and the split exists for the handle.**
`.player-dock` is the fixed shell and clips nothing; `.player` is the band inside
it and clips its own overflow, because the caricatures bleed off its right edge.
The progress bar is the band's **sibling**, laid over its top three pixels — drawn
as a child, the top half of a dot centred on the rule is cut off, which is how it
shipped for an afternoon. Anything moved back inside `.player` loses it again.

⚠️ A `scrubbing` ref holds the value during a drag: bound straight to `progress`,
a `timeupdate` already in flight reports the pre-seek position and yanks the
handle backwards for a frame.

⚠️ **WebKit lays `::-webkit-slider-thumb` against the TOP of the runnable track,
not its middle.** Without a `margin-top` of `(track − thumb) / 2` the dot sits
3 px high, which on a 3 px rule is the whole bar — and it shipped that way for a
round. The two sizes are `--seek-grab` / `--seek-dot` on the input and the offset
is a `calc()` over them, so changing either cannot leave the other stale (custom
properties do inherit into the slider pseudo-elements — verified in a browser).
⚠️ **Firefox centres `::-moz-range-thumb` itself** and must not get the offset.

⚠️ **Nothing in a clip row may change size or position because its state
changed** (`ClipRowItem.vue`), and this is one finding the owner's review found
in three places at once:

- The action bar is a **grid of fixed tracks**
  (`2.7rem | 2.7rem | 28px | 28px | 7.9rem`), never `auto`. As a flex row a
  three-digit vote count or a longer duration moved everything beside it.
- The queue button has **three states of one width** and is never absent —
  `Cola`, `En la cola`, and `Reproduciendo`/`En pausa` on the row the player is
  on. It never disappears: disappearing takes 7.9 rem out of that row and slides
  its icons out of the column they share with the rest of the list.
- The two icon actions **carry a box, in brown** (28 px, `hairlineStrong`, a 5 %
  white wash, glyph at 17 px). 28 px inside a 46 px row costs no height, and
  ⚠️ the brown is not decoration either — the share glyph genuinely
  disappears in `stageInkMuted` at this size, which is how it was reported.
- ⚠️ **Share is `mdi-link-variant`, a chain, and it must not go back to
  `mdi-share-variant`.** Three reasons: the
  button copies a permalink, so a chain says what it does; the chain is a solid
  glyph where the share tree is three dots joined by hairlines; and **content
  blockers' social lists hide elements whose class contains `share`**, which from
  the outside looks exactly like "the icon does not exist" — reported by the
  owner, invisible in a clean browser, and not reproducible in any test we can
  write. The accessible name stays `Compartir` in words.
- ⚠️ **There is no `sonando ahora` line above the title.** It would be the one
  thing in a row that changes its HEIGHT — the playing row stands 16 px taller
  than the rest, so the list shifts every time a clip advances. Reserving the
  line on all 180 rows would cost that height everywhere. **Do not put a badge
  above the title.**
- The bar is **two groups**, split by a `minmax(0.5rem, 1fr)` spacer track that
  needs an inert `.i-row__gap` element to hold it open — grid auto-placement
  fills tracks in source order, so six tracks want six children. It is a hair on
  a desktop, where every pixel taken from the title wraps somebody's meta line,
  and the whole slack on a phone.

`glitch.css` is the CSS-only error-page effect, with **both keyframe tables
baked in as literal numbers** — a Sass loop would buy nothing. `transitions.css`
carries the route fade. Both honour `prefers-reduced-motion`.

⚠️ **The title font is loaded from Typekit** (`index.html`), and that is a
licence decision, not an oversight: league-gothic is SIL OFL 1.1 at source, but
Adobe's terms forbid self-hosting the files `use.typekit.net` delivers. The
clean swap is `@fontsource/league-gothic` from npm. `--grav-font-title` already
lists both family names plus a real fallback chain, so that swap needs no CSS
change.

⚠️ **There is no CSS purge step and no `sass` in the lockfile**: every
stylesheet here is plain CSS, and a class name built at runtime has to survive
the build untouched.

## The PWA (2026-08-27)

Installable, and **always on the newest build without ever saying so**.
`vite-plugin-pwa` builds the manifest and compiles the worker; everything about
*when* a new version takes over is this package's own code.

```
src/vue/pwa/sw.ts                 the service worker (its own tsconfig — see below)
src/vue/pwa/start-app-updates.ts  the update policy, mounted from App.vue
public/icons/*.png                five committed icons
```

Five decisions, and each of them is the answer to something that broke or would
have:

1. ⚠️ **Navigations go to the network, always.** Not for freshness — because the
   document is different per URL. `packages/backend/src/spa/spa-html.ts` rewrites
   the `<title>` and the `og:*` tags per clip and per episode, and **nothing in
   this package sets `document.title`**, so a precached shell answered for every
   route would quietly retitle every shared permalink `Índice gravinero`. It
   would also fail invisibly: client-side navigation never touches the backend,
   so the bug would only appear on a cold open of a shared link — the one case
   the injection exists for. This is why the plugin runs in `injectManifest` and
   not `generateSW`, whose `navigateFallback` does exactly that by default.
2. ⚠️ **The navigation route is registered BEFORE the precache, and passes
   `directoryIndex: ''`.** Workbox tries routes in registration order, and
   `PrecacheRoute` appends `index.html` to any URL ending in `/` — so `/` matches
   the precached shell even though `/` is not in the manifest. The other way
   round, the home page, the commonest entry point there is, would stop updating
   on entry. Two tests stand on this, one per layer.
3. ⚠️ **The worker never calls `skipWaiting()` on its own.** The page decides,
   with a message, and only when a reload costs nothing:
   `isSafeToReload` refuses while `playback.playing` or `playback.loading`, and on
   the `creator` and `adminClip` routes. ⚠️ **Neither half covers the other**: the
   editor owns its own audio element (`utils/editor-audio.ts`), so
   `playback.playing` is `false` while it is sounding and only the route check
   protects the unpublished cut; and somebody can be listening from `/about`,
   where there is nothing to save. ⚠️ It is by route **name**, because `/creator`
   (`creatorSearch`, the library with an overlay over it) and `/creator/:title`
   (the editor) share a path prefix and mean opposite things.
4. ⚠️ **No `virtual:pwa-register`, and `injectRegister: null`.** Its `updateSW()`
   couples "activate the new worker" with "reload now", and this app needs those
   apart. Registering by hand also keeps the plugin out of the Vitest module
   graph entirely — no virtual module to alias, no plugin to mock.
5. ⚠️ **`sw.ts` has its own `tsconfig.sw.json`**, referenced from `tsconfig.json`
   and excluded from `tsconfig.app.json`. It needs `lib: WebWorker`, which cannot
   share a program with `DOM`: the two declare `self`, `fetch` and `caches` as
   different things. **No spec may import it**, or the conflict comes back
   through `tsconfig.vitest.json`.

Two more things worth knowing:

- ⚠️ **Nothing may be imported into `sw.ts` from the app.** The plugin builds it
  with this config's aliases, so `@/stores/…` resolves happily and would pull Vue
  and Pinia into a service worker — and `eslint-plugin-boundaries` cannot object,
  because it classifies by element and a worker belongs to none. The e2e suite
  asserts the built worker's size instead.
- ⚠️ **`includeManifestIcons` defaults to `true` and quietly beats
  `globIgnores`.** The plugin force-adds every icon named in the manifest to the
  precache, so the ignore for `icons/` silently only caught the Apple one and
  410 kB of launcher icons rode along on every first load — found by reading the
  built `sw.js`, not from any warning, and not from the plugin's own size report,
  which is printed before it adds them.
- ⚠️ **The precache drops four fifths of the icon font.** `@mdi/font` ships as
  eot/ttf/woff/woff2 and the build emits all four: 3,3 MB of a 5,2 MB build, none
  of which any browser that can run a service worker will ever request. The
  `globIgnores` in `vite.config.ts` leave 76 entries and 1,9 MB. Nothing would
  have warned: every one of those files is under Workbox's 2 MiB threshold.

⚠️ **There is no visible surface at all.** No banner, no toast, no button, no
`beforeinstallprompt` handler. If a user ever sees a word about an update,
something is wrong.

## Copy

⚠️ **All user-facing copy is Spanish, written straight into the templates.**
There is no i18n layer and there will not be one: the empty states are jokes,
not placeholder strings, and `AboutView.vue` is content copied **verbatim,
typos included**. Treat it as content, not as text to improve.

The one recorded exception in the other direction: `domain-error-notice.ts`
writes two new Spanish strings, because printing `ex.toString()` would put
English into a Spanish UI.

Recorded deviations each carry a comment at the code that makes them;
`grep -rn "recorded deviation" src/` is the index. The substantial ones are the
slider clamp, real error routes with real URLs, the notification cap and the loss
of `v-html`, and the list views having an error branch.

⚠️ **That index is mostly the UI**, because every public screen was built
once: a comment there means "this differs on purpose", not "this is unusual".
The screens' authority is this document.

⚠️ **The `2.0.0` changelog entry lives in `AboutView.vue`**, written by hand and
kept in step with the version in both `package.json`s and `constants/version.ts`.

## Tests

`npm test` → **1041 Vitest tests**, jsdom, no browser and no
server. That is exactly what the hexagonal split buys: `core/domain` and
`core/application` test against stubs, `core/infrastructure` against a stubbed
`fetch`, and `vue/` with `@vue/test-utils` over a real Vuetify instance
(`mount-with-vuetify.ts`).

`vitest.config.ts` merges the Vite config so aliases and `__APP_VERSION__` exist
in tests. ⚠️ Its `defineConfig` **must** come from `vitest/config` — Vitest 4 no
longer augments Vite's, and `vue-tsc` rejects the wrong one. ⚠️ Vuetify is in
`server.deps.inline`, because its per-component CSS side-effect imports cannot
go through Node's loader.

⚠️ **`vitest.setup.ts` makes the default `fetch` throw, and it is not
belt-and-braces.** jsdom serves from `http://localhost:3000` — the same origin
as the dev backend — so a component that fires a request in a test does not
fail, it **succeeds against the real database**. The queue store counts a play
the moment a clip starts, and mounting the player in a spec wrote **39 rows into
the fixture database**, surfacing much later as a failing row-count assertion
with nothing in it pointing back here. A spec that genuinely exercises
HTTP replaces `globalThis.fetch` itself; the guard is reinstalled before the
next one.

Behaviour that only a browser can prove — the debounce, infinite scroll,
cancellation, the URL contract, playback and the queue, the slider mid-gesture,
the injected meta tags — lives in the repo-level Playwright suite (`test/e2e/`).
See the root `CLAUDE.md`.

## Traps

- **`@` is `src/vue`**, so `@/assets/logo.png` does not exist. The images are at
  `src/assets/` and are imported relatively.
- **Views outlive their route** under `<RouterView>` with `mode="out-in"`.
  `EditorView`, `EpisodeView` and `ClipView` therefore read their id through a
  **ref fed by a guarded watcher**, not a computed over `route.params`: a
  computed turns into `NaN` mid-fade and bounces the visitor to `/error/404` on
  their way out.
- **`parseInt`, not `Number`**, for `"<id>-<slug>"` — `Number('63-x')` is `NaN`.
  `buildEpisodeUrl`'s slug algorithm is **frozen**: those URLs are shared links.
- **The header's height is a prop, not CSS.** Vuetify measures it for
  `--v-layout-top`; changing it in a stylesheet leaves the variable stale and
  content slides under the bar. `AppHeader.vue` is 56 px, and `GravNavbar.vue`
  is deleted.
- ⚠️ **One layout in the DOM at a time**, via `use-compact-layout.ts` and
  `matchMedia` at **720 px** — the design's single breakpoint, the same number
  everywhere. The filter rail and the mobile sheet hold the *same* controls, so
  rendering both and hiding one with CSS puts all 102 tag checkboxes in the
  document twice: invisible to a sighted visitor, very audible to a screen
  reader, and double the `Tab` stops. ⚠️ Absent `matchMedia` falls back to the
  **wide** layout, the one that degrades gracefully.
- ⚠️ **The site credit lives in the filter rail**, not a footer. With an
  infinite list and a fixed player there is no bottom of the page to reach, so
  the one line naming who owns the content moved where it can be seen — in both
  layouts, which is why `FilterRail.vue` renders it twice in source and once in
  the DOM.
- **`@mdi/font` must be imported alongside the `mdi` icon set.** Forgetting it
  renders empty 24 px boxes and type-checks perfectly.
- **`TagAutocomplete` is `multiple` even where one tag is submitted.** A
  single-value combobox rewrites `model-value` on every keystroke: typing
  `brinate` fired seven submissions and wrote `?tags=b&tags=r&…`.
- ⚠️ **A Vuetify menu is TELEPORTED to `<body>`, so `.control-graviner` cannot
  reach it.** `surface` in this theme is `#ffffff` (the admin card) and a
  `<v-list>` is a surface, so `TagAutocomplete`'s dropdown opened as a white
  rectangle on the dark stage while its field was correctly painted — for
  months, in two places. The only hook that travels with an overlay is
  `contentClass`, hence `:menu-props="{ contentClass: 'grav-menu' }"` and a
  **global** `.grav-menu` rule in `gravinero.css`. Never try to fix an overlay
  from a scoped block.
- **`TagPicker` replaces its array rather than mutating it**, because a
  `v-model` target is watched deeply elsewhere in this app.
- ⚠️ **The `Relacionados` order is the server's.** Nothing re-sorts or truncates
  it: most clips carry one tag, so resolving relatedness with
  `GET /clips?tags[]=` in the browser would rank by whatever the default sort
  produced. Six rows, or no section at all.
- ⚠️ **The service worker's caches are not a seventh storage key.** They hold
  the build's own assets, never anything about a visitor, and they are dropped
  and rebuilt with every deploy. See "The PWA".
- **Six storage keys across two Storage objects**: `gravindex.voter-token`,
  `gravindex.analytics-consent`, `gravindex.list-limit.<id>`,
  `gravindex.queue` and `gravindex.moments` in `localStorage`,
  `gravindex.admin-token` in `sessionStorage`. ⚠️ Every read wraps the **property access** in a `try`, not
  just the call — Safari's "block
  all cookies" and sandboxed iframes throw on the access itself.
- **Accent folding is for matching only.** `fold-accents.ts` exists so a local
  filter behaves like the API's accent-insensitive search; ⚠️ **never store or
  send the folded form** — tags are matched byte for byte by the backend.
  (⚠️ Every tag row is exactly what it looks like: **none of the 382 rows has
  surrounding whitespace**. Nothing trims, because there is nothing to trim — but
  nothing may normalise either.)
- **`format-date.ts` is hand-rolled on purpose**, with a capitalised Spanish
  month table and the local zone. `Intl` would render lower-case months in the
  *browser's* locale, which is not what the site says.
