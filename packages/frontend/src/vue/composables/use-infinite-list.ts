import { computed, type ComputedRef, type Ref } from 'vue';
import { useInfiniteQuery, type EntryKey } from '@pinia/colada';
import type { DomainError } from '#/domain/errors';
import {
  useListFilters,
  type FilterSet,
  type ListPage,
  type ListQuery,
  type UseListFiltersOptions,
} from './use-list-filters';

/**
 * A list that **streams instead of paginating** — the library, the episode list
 * and an episode's clips.
 *
 * It is `use-list-filters.ts` — the URL contract, the 500 ms debounce, "Limpiar
 * filtros" — with a `useInfiniteQuery` on top instead of a single page. Both
 * halves of the split behave identically as far as a visitor typing in the
 * search box can tell, which is the point of sharing the core.
 *
 * Four things the design decided, and where each one lives:
 *
 *  1. **Batch size 24, and `limit` stops being a preference.** It is the batch
 *     now, so `persistLimit` is off and the per-list
 *     `gravindex.list-limit.<id>` key stops being written for these lists. A
 *     `?limit=` in an old shared link is still honoured — it is in the URL, and
 *     those URLs exist.
 *  2. **`page` leaves the URL** (`pageInUrl: false`). What people share is a
 *     filter, not a scroll position.
 *  3. **Coming back lands where you were.** ⚠️ This is the part that is easy to
 *     get wrong, and the reason this is a Colada infinite query rather than a
 *     hand-rolled accumulator: every loaded batch lives in the query cache under
 *     the FILTER's key, so returning from a clip re-renders all of them at once
 *     instead of resetting to one batch. Restoring the scroll offset on top of
 *     that is the router's `scrollBehavior`.
 *  4. **The counter is the total under the filter**, never "N of M loaded" —
 *     `180 cortes`, `19 cortes`. That is `total`, which every page of the
 *     response carries.
 */
export interface UseInfiniteListOptions<TFilters extends FilterSet, TItem> extends Omit<
  UseListFiltersOptions<TFilters>,
  'persistLimit' | 'pageInUrl' | 'defaultLimit'
> {
  /** ⚠️ 24, and it is a BATCH rather than a page size — see above. Overridable
   *  only because the related strip and the editor ask for other shapes. */
  readonly batchSize?: number;

  /** The cache key for one batch. ⚠️ Built from `queries/query-keys.ts` like
   *  every other key in the app: an invalidation that misses by one word fails
   *  with no error and no symptom but stale data. */
  readonly key: (query: ListQuery<TFilters>) => EntryKey;

  /** Fetch one batch. ⚠️ It must take the `signal` and pass it down, or a
   *  superseded search runs to completion — see `queries/abortable.ts`. */
  readonly fetchPage: (query: ListQuery<TFilters>, signal: AbortSignal) => Promise<ListPage<TItem>>;
}

export interface UseInfiniteListReturn<TFilters extends FilterSet, TItem> {
  readonly filters: Ref<TFilters>;
  /** Every batch loaded so far, flattened, in order. */
  readonly items: ComputedRef<readonly TItem[] | undefined>;
  /** ⚠️ Matching rows under the current filter, ignoring how many are loaded. */
  readonly total: ComputedRef<number>;
  /** A batch is in flight — the first one or the next one. */
  readonly isLoading: ComputedRef<boolean>;
  /** Nothing to show yet: the first load, or a filter never used before. */
  readonly isPending: ComputedRef<boolean>;
  readonly error: ComputedRef<DomainError | null>;
  /** Whether the sentinel should keep asking. */
  readonly hasMore: ComputedRef<boolean>;
  /** ⚠️ Safe to call while a batch is loading: Colada drops the duplicate. */
  readonly loadMore: () => void;
  readonly reset: () => void;
  readonly refetch: () => Promise<unknown>;
  readonly activeFilterCount: ComputedRef<number>;
  readonly appliedQuery: ComputedRef<ListQuery<TFilters>>;
}

/** The design's batch. Not a page size, and not remembered. */
export const DEFAULT_BATCH_SIZE = 24;

export function useInfiniteList<TFilters extends FilterSet, TItem>(
  options: UseInfiniteListOptions<TFilters, TItem>,
): UseInfiniteListReturn<TFilters, TItem> {
  const { batchSize = DEFAULT_BATCH_SIZE, key, fetchPage, ...filterOptions } = options;

  const core = useListFilters<TFilters>({
    ...filterOptions,
    defaultLimit: batchSize,
    // ⚠️ Both off, and both for the same reason: neither the batch number nor
    // the batch SIZE is a choice the visitor made, so neither belongs in the
    // URL or in `localStorage`.
    persistLimit: false,
    pageInUrl: false,
  });

  const listQuery = useInfiniteQuery<ListPage<TItem>, DomainError, number>({
    // ⚠️ The key is the FILTER, not the filter-and-page: that is what makes all
    // the loaded batches one cache entry, and what makes coming back from a
    // clip show the list as it was rather than its first 24 rows.
    key: () => key(core.appliedQuery.value),
    initialPageParam: 1,
    query: ({ pageParam, signal }) =>
      fetchPage({ ...core.appliedQuery.value, page: pageParam }, signal),
    // ⚠️ `undefined` means "no more", which is what stops the sentinel. The
    // total is the authority rather than "the batch came back short": a batch
    // that is exactly `limit` long and happens to be the last one would
    // otherwise cost one extra request to discover.
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, batch) => sum + batch.results.length, 0);
      return loaded < lastPage.total ? allPages.length + 1 : undefined;
    },
  });

  const batches = computed(() => listQuery.data.value?.pages);

  return {
    filters: core.filters,
    items: computed(() => batches.value?.flatMap((batch) => [...batch.results])),
    // Every batch carries the same total; the last one is the freshest reading.
    total: computed(() => batches.value?.at(-1)?.total ?? 0),
    isLoading: computed(() => listQuery.isLoading.value),
    isPending: computed(() => batches.value === undefined),
    error: computed(() => listQuery.error.value),
    hasMore: computed(() => listQuery.hasNextPage.value),
    loadMore: () => {
      if (listQuery.isLoading.value || !listQuery.hasNextPage.value) return;
      void listQuery.loadNextPage();
    },
    reset: core.reset,
    refetch: () => listQuery.refetch(),
    activeFilterCount: core.activeFilterCount,
    appliedQuery: core.appliedQuery,
  };
}
