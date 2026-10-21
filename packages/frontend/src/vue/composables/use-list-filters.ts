import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import { useRoute, useRouter, type LocationQuery, type LocationQueryRaw } from 'vue-router';

/**
 * Filter state, its two-way sync with the URL, and the debounce — everything a
 * list needs EXCEPT the request itself.
 *
 * ⚠️ **Two composables are built on this, and the split follows the list.**
 * `use-filtered-list.ts` adds a paginated `useQuery` and serves the admin clip
 * list; `use-infinite-list.ts` adds a `useInfiniteQuery` and serves every
 * public list.
 * Everything below is shared by both, because it is the half people notice: the
 * URL they copy, the debounce while they type, and what "Limpiar filtros" does.
 *
 * ⚠️ **Four behaviours here are things people rely on**, and each is a decision
 * made on purpose:
 *
 *   1. **URL ⇄ filter two-way sync**, with defaults ABSENT from the URL. The
 *      library's address is `/`, not `/?search=&order=clip.createdAt&limit=12`,
 *      so what a visitor copies and shares is readable and carries only what
 *      they actually chose.
 *   2. **A 500 ms debounce on filter changes**, so typing in the big search box
 *      is one request, not one per keystroke.
 *   3. **`limit` persisted per endpoint**, so a visitor who prefers 48 cards
 *      keeps them across visits.
 *   4. **Page resets to 1 when a filter changes** — otherwise a search from
 *      page 7 lands on the empty page 7 of two results.
 *
 * ⚠️ **What is NOT here, deliberately: request cancellation and duplicate
 * suppression.** Pinia Colada does both from the key: a changed key cancels the
 * in-flight request of the superseded one, and an unchanged key is the same
 * cache entry, so there is nothing to suppress. Re-adding either would be
 * fighting the library.
 *
 * ⚠️ **"Colada cancels it" is only half a sentence, and the missing half was a
 * real bug.** Colada aborts an outdated call's `AbortSignal`; it cannot reach
 * `fetch` on its own. The query function has to accept that signal and pass it
 * down to the use case — which is what `vue/queries/abortable.ts` does, and
 * what nothing did until the e2e suite measured zero aborted requests on a
 * superseded search. Any new list query wired here must go through `abortable`
 * too; forgetting it fails silently, because a stale answer still lands in its
 * own cache key and nothing on screen looks wrong.
 *
 * ### Two conscious divergences
 *
 * - **Any external URL change is adopted, not just an empty one.** Reacting only
 *   to the empty query (the navbar's "Inicio" link) left pressing Back with the
 *   address and the list disagreeing.
 *   Adopting every external change makes the sync genuinely two-way and makes
 *   the empty case fall out for free — an empty query simply *is* every filter
 *   at its default.
 * - **Returning to a filter you already used is instant.** Colada answers from
 *   cache and revalidates. Same data, no spinner.
 *
 * @example
 * ```ts
 * const list = useFilteredList({
 *   id: 'clips',
 *   // ⚠️ Annotate the union members: `order: 'clip.createdAt'` alone widens to
 *   // `string`, and the query factory takes a `ClipOrder`.
 *   defaultFilters: { search: '', order: 'clip.createdAt' as ClipOrder, tags: [] as Tag[] },
 *   defaultLimit: 12,
 *   queryOptions: clipListQueryOptions,
 * });
 * ```
 */

/** Anything the API paginates. Both list endpoints answer in this shape. */
export interface ListPage<TItem> {
  readonly results: readonly TItem[];
  readonly total: number;
}

/**
 * What a filter may hold.
 *
 * ⚠️ Strings, numbers and string arrays only — the three things that survive a
 * round trip through a query string without a per-field codec. `tags` is the
 * only array filter in the app and its members are free text, so an array of
 * numbers has no reason to exist here; adding one means adding the codec too,
 * not widening this type.
 */
export type FilterValue = string | number | readonly string[];

export type FilterSet = Readonly<Record<string, FilterValue>>;

/**
 * The filter as the API receives it: every field optional (an empty one is
 * omitted rather than sent blank), plus the paging the caller never sets by
 * hand.
 */
export type ListQuery<TFilters> = {
  readonly [K in keyof TFilters]?: TFilters[K];
} & {
  readonly page: number;
  readonly limit: number;
};

export interface UseListFiltersOptions<TFilters extends FilterSet> {
  /**
   * Stable name for this endpoint. ⚠️ It namespaces the persisted `limit`, so
   * two lists must never share one: with a single key, changing the page size
   * on the episode grid would silently change it on the library too.
   */
  readonly id: string;

  /**
   * The filter shape AND its defaults, in one object.
   *
   * ⚠️ A value equal to its default never reaches the URL. This is the only
   * declaration of "default", so there is no second list to keep in sync.
   */
  readonly defaultFilters: TFilters;

  /** Page size before the visitor or the URL says otherwise. */
  readonly defaultLimit?: number;

  /** ⚠️ 500 ms. `0` fires on every change. */
  readonly debounceMs?: number;

  /** Set `false` for a list whose page size should not outlive the visit. */
  readonly persistLimit?: boolean;

  /**
   * Whether `page` travels in the URL.
   *
   * ⚠️ **`false` for every infinite list**, which is all three public ones:
   * "filters, search and sort stay
   * in [the URL] — those are what people share", and a scroll position is not.
   * With it off, `page` stays 1 here and the batch number lives inside the
   * infinite query instead; an old shared `?page=3` is normalised away on
   * arrival rather than silently meaning something different.
   *
   * `true` is the paginated form, which only the admin clip list still uses.
   */
  readonly pageInUrl?: boolean;
}

export interface UseListFiltersReturn<TFilters extends FilterSet> {
  /** Writable, and what the inputs bind to. Mutating it debounces a refetch. */
  readonly filters: Ref<TFilters>;
  /** 1-based, like the API and like the URL. ⚠️ Pinned to 1 when
   *  `pageInUrl` is false — an infinite list pages inside its query. */
  readonly page: Ref<number>;
  readonly limit: Ref<number>;
  /**
   * The filter the request is actually running with: the post-debounce
   * snapshot, empties pruned. Lags `filters` by up to `debounceMs`.
   */
  readonly appliedQuery: ComputedRef<ListQuery<TFilters>>;
  /** Back to defaults — the library's "Limpiar filtros". Fires immediately. */
  readonly reset: () => void;
  /** Whether anything is set beyond the defaults. Draws the mobile filter
   *  button's badge, and decides whether "Limpiar filtros" is worth offering. */
  readonly activeFilterCount: ComputedRef<number>;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const DEFAULT_DEBOUNCE_MS = 500;

/** ⚠️ Namespaced, and the endpoint id is IN the key. `localStorage` is one flat
 *  map per origin, shared with the anonymous voter token and, later, consent. */
const LIMIT_STORAGE_PREFIX = 'gravindex.list-limit.';

/** `localStorage`, or `null`. Reading the property itself can throw — Safari
 *  with cookies blocked, a sandboxed iframe — so the access is inside the try. */
function resolveStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readStoredLimit(id: string): number | null {
  const storage = resolveStorage();
  if (storage === null) return null;
  try {
    const stored = Number.parseInt(storage.getItem(LIMIT_STORAGE_PREFIX + id) ?? '', 10);
    return Number.isInteger(stored) && stored > 0 ? stored : null;
  } catch {
    return null;
  }
}

function writeStoredLimit(id: string, limit: number): void {
  const storage = resolveStorage();
  if (storage === null) return;
  try {
    storage.setItem(LIMIT_STORAGE_PREFIX + id, String(limit));
  } catch {
    // A page size nobody could save is not worth an error. Private windows and
    // full quotas both land here and the list works exactly the same.
  }
}

function sameFilterValue(a: FilterValue, b: FilterValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => item === b[index]);
  }
  return a === b;
}

/** First usable string in whatever vue-router parsed out of the query string. */
function firstString(raw: LocationQuery[string] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw.find((item) => item !== null) : raw;
  return typeof value === 'string' ? value : undefined;
}

function readPositiveInt(raw: LocationQuery[string] | undefined): number | null {
  const parsed = Number.parseInt(firstString(raw) ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * One filter, read back out of the URL, shaped by the type of its default.
 *
 * ⚠️ Coercion is driven by the DECLARED default, not by whether the text looks
 * like a number. Guessing per value would turn the tag `82` into the number
 * `82`, which a filter must not do.
 */
function readFilterValue(
  raw: LocationQuery[string] | undefined,
  fallback: FilterValue,
): FilterValue {
  if (Array.isArray(fallback)) {
    const values = (Array.isArray(raw) ? raw : [raw]).filter(
      (item): item is string => typeof item === 'string' && item !== '',
    );
    return values;
  }
  if (typeof fallback === 'number') {
    const parsed = Number(firstString(raw));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return firstString(raw) ?? fallback;
}

/** Empty means absent: `''` and `[]` are "no filter", and sending them blank
 *  would only make two cache keys for one request. */
function isEmptyFilterValue(value: FilterValue): boolean {
  return value === '' || (Array.isArray(value) && value.length === 0);
}

export function useListFilters<TFilters extends FilterSet>(
  options: UseListFiltersOptions<TFilters>,
): UseListFiltersReturn<TFilters> {
  const {
    id,
    defaultFilters,
    defaultLimit = DEFAULT_LIMIT,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    persistLimit = true,
    pageInUrl = true,
  } = options;

  const route = useRoute();
  const router = useRouter();

  function filtersFromQuery(query: LocationQuery): TFilters {
    const next: Record<string, FilterValue> = {};
    for (const [name, fallback] of Object.entries(defaultFilters)) {
      next[name] = readFilterValue(query[name], fallback);
    }
    return next as TFilters;
  }

  function limitFromQuery(query: LocationQuery): number {
    return (
      readPositiveInt(query.limit) ?? (persistLimit ? readStoredLimit(id) : null) ?? defaultLimit
    );
  }

  const filters = ref(filtersFromQuery(route.query)) as Ref<TFilters>;
  // ⚠️ An arriving `?page=3` is IGNORED when paging does not travel in the URL.
  // Those links exist from the days of pagination, and the honest answer to one
  // is the first batch of the same filter, not an empty
  // screen or a scroll position nobody can reproduce. The normalisation at the
  // end of this function then rewrites the address so it says so.
  const page = ref(pageInUrl ? (readPositiveInt(route.query.page) ?? DEFAULT_PAGE) : DEFAULT_PAGE);
  const limit = ref(limitFromQuery(route.query));

  /** The current state as the API wants it: empties dropped, paging attached. */
  function snapshot(): ListQuery<TFilters> {
    const pruned: Record<string, FilterValue> = {};
    for (const [name, value] of Object.entries(filters.value)) {
      if (!isEmptyFilterValue(value)) pruned[name] = value;
    }
    return { ...pruned, page: page.value, limit: limit.value } as ListQuery<TFilters>;
  }

  /**
   * The current state as the URL should show it.
   *
   * ⚠️ **Defaults are omitted, and that is the whole point.** A value equal to
   * `defaultFilters[name]`, page 1, and the default page size never appear —
   * so the library lives at `/` and a shared link carries only real choices.
   * ⚠️ A `limit` the visitor chose and we remembered is NOT a default, so it
   * does show up; that is what makes the address reproduce what is on screen.
   */
  function urlQuery(): LocationQueryRaw {
    const query: LocationQueryRaw = {};
    for (const [name, value] of Object.entries(filters.value)) {
      const fallback = defaultFilters[name];
      if (fallback !== undefined && sameFilterValue(value, fallback)) continue;
      if (isEmptyFilterValue(value)) continue;
      query[name] = Array.isArray(value) ? [...value] : String(value);
    }
    // ⚠️ Never for an infinite list — see `pageInUrl`. `page` is pinned to 1
    // there, so this is belt and braces rather than a branch that matters.
    if (pageInUrl && page.value !== DEFAULT_PAGE) query.page = String(page.value);
    if (limit.value !== defaultLimit) query.limit = String(limit.value);
    return query;
  }

  function sameAsUrl(query: LocationQuery): boolean {
    const wanted = urlQuery();
    const wantedNames = Object.keys(wanted);
    if (wantedNames.length !== Object.keys(query).length) return false;
    return wantedNames.every((name) => {
      const mine = wanted[name];
      const theirs = query[name];
      const asList = (value: unknown): string[] =>
        Array.isArray(value) ? value.map(String) : [String(value)];
      const a = asList(mine);
      const b = asList(theirs);
      return a.length === b.length && a.every((item, index) => item === b[index]);
    });
  }

  /** What the query is actually running with. Only `commit()` moves it. */
  const appliedQuery = ref(snapshot()) as Ref<ListQuery<TFilters>>;

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  /** True while the URL is writing INTO the state, so the watchers stay quiet. */
  let adopting = false;
  /**
   * True while a filter change is resetting the page back to 1.
   *
   * ⚠️ Without it the debounce leaks a request. The filters watcher resets the
   * page BEFORE it arms the timer — it has to, so the paginator never sits on
   * page 7 while the results change underneath it — and the paging watcher,
   * being `flush: 'sync'`, runs inside that assignment and sees
   * `debounceTimer === undefined`. It concludes no debounce is pending and
   * commits, firing a request for whatever half-typed search happened to be in
   * the box. Only a list already off page 1 could hit it, which is why the plain
   * burst test passes and only the page-7 one caught it.
   */
  let resettingPage = false;

  function cancelDebounce(): void {
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
  }

  /**
   * Hand the current state to the query and to the address bar, together.
   *
   * ⚠️ The URL moves when the request does, not when a key is pressed. Writing
   * it per keystroke would fill the browser history with half-typed searches
   * even with `replace`, and would disagree with what is on screen for the
   * length of the debounce.
   */
  function commit(): void {
    cancelDebounce();
    appliedQuery.value = snapshot();
    if (!sameAsUrl(route.query)) {
      // `.catch` because a navigation the router considers redundant resolves
      // as a failure object rather than throwing — and there is nothing to do
      // about it either way.
      void router.replace({ query: urlQuery() }).catch(() => {});
    }
  }

  function scheduleCommit(): void {
    cancelDebounce();
    if (debounceMs <= 0) {
      commit();
      return;
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      commit();
    }, debounceMs);
  }

  // ⚠️ `flush: 'sync'` on both watchers, so `adopting` is a reliable guard: a
  // queued watcher would run after the flag was already cleared. It also makes
  // the ordering below deterministic — the filters watcher sets the timer
  // BEFORE the paging watcher can see it.
  watch(
    filters,
    () => {
      if (adopting) return;
      // ⚠️ Immediately, not after the debounce: the paginator must not sit on
      // page 7 for half a second while the results underneath it change. The
      // flag is what stops the paging watcher from turning this bookkeeping
      // into a request of its own — see `resettingPage`.
      resettingPage = true;
      try {
        page.value = DEFAULT_PAGE;
      } finally {
        resettingPage = false;
      }
      scheduleCommit();
    },
    { deep: true, flush: 'sync' },
  );

  watch(
    [page, limit],
    () => {
      if (adopting || resettingPage) return;
      // A pending debounce means a filter just changed and reset the page; that
      // commit will carry this value too. Committing here as well would fire
      // the request the debounce exists to prevent.
      if (debounceTimer === undefined) commit();
    },
    { flush: 'sync' },
  );

  if (persistLimit) {
    // Every change, including one that arrived in a shared link.
    watch(limit, (value) => writeStoredLimit(id, value), { flush: 'sync' });

    // ⚠️ …and the one the link arrived WITH, which no watcher can see. The ref
    // is *initialised* from the URL above, and an initial value is not a change,
    // so on a full page load `/?limit=48` would otherwise be forgotten the
    // moment the visitor navigated away — while the very same link followed
    // from inside the app (Back, or the navbar) went through the route watcher
    // and was remembered. Two behaviours for one address is not a page size
    // anybody can predict.
    //
    // ⚠️ Only when the URL actually carried one. Writing `limit.value` here
    // unconditionally would persist a default nobody chose, and turn "the
    // visitor prefers 48" into "the visitor once visited this page".
    if (readPositiveInt(route.query.limit) !== null) {
      writeStoredLimit(id, limit.value);
    }
  }

  /**
   * The address bar changed under us: Back, Forward, or a link to `/` from the
   * navbar. Take it as the truth and stop whatever was pending.
   */
  watch(
    () => route.query,
    (query) => {
      if (sameAsUrl(query)) return;
      adopting = true;
      try {
        filters.value = filtersFromQuery(query);
        page.value = pageInUrl ? (readPositiveInt(query.page) ?? DEFAULT_PAGE) : DEFAULT_PAGE;
        limit.value = limitFromQuery(query);
      } finally {
        adopting = false;
      }
      cancelDebounce();
      appliedQuery.value = snapshot();
    },
  );

  // ⚠️ Normalize an incoming address once, on setup: `/?limit=12&search=` is the
  // same list as `/` and should say so. In the ordinary case the two already
  // match and no navigation happens at all.
  if (!sameAsUrl(route.query)) {
    void router.replace({ query: urlQuery() }).catch(() => {});
  }

  function reset(): void {
    adopting = true;
    try {
      filters.value = { ...defaultFilters };
      page.value = DEFAULT_PAGE;
    } finally {
      adopting = false;
    }
    // ⚠️ `limit` survives: the page size is a preference, not a filter.
    commit();
  }

  return {
    filters,
    page,
    limit,
    appliedQuery: computed(() => appliedQuery.value),
    reset,
    activeFilterCount: computed(
      () =>
        Object.entries(filters.value).filter(([name, value]) => {
          const fallback = defaultFilters[name];
          return (
            !isEmptyFilterValue(value) &&
            !(fallback !== undefined && sameFilterValue(value, fallback))
          );
        }).length,
    ),
  };
}
