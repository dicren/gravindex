import { computed, type ComputedRef, type Ref } from 'vue';
import { useQuery, type DefineQueryOptions } from '@pinia/colada';
import type { DomainError } from '#/domain/errors';
import {
  useListFilters,
  type FilterSet,
  type FilterValue,
  type ListPage,
  type ListQuery,
  type UseListFiltersOptions,
} from './use-list-filters';

export type { FilterSet, FilterValue, ListPage, ListQuery };

/**
 * A **paginated** filtered list: `use-list-filters.ts` plus one page of results.
 *
 * ⚠️ **Only the admin list uses this.** The library, the episode list and the
 * episode detail are infinite and go through `use-infinite-list.ts` — over the
 * same filter core, so the URL contract, the 500 ms debounce and "Limpiar
 * filtros" behave identically on both.
 *
 * What uses this: **the admin clip list**, deliberately. A moderation table
 * wants page numbers — "the ugly one is on
 * page 3" is a thing a moderator says — and infinite scroll would make a list
 * you audit by scrolling forever.
 *
 * Everything the composable is *about* lives one file down; this adds the
 * request and the four derived refs a paginated view renders from.
 *
 * @example
 * ```ts
 * const list = useFilteredList({
 *   id: 'admin-clips',
 *   defaultFilters: { search: '' },
 *   defaultLimit: 20,
 *   queryOptions: clipListQueryOptions,
 * });
 * ```
 */
export interface UseFilteredListOptions<
  TFilters extends FilterSet,
  TItem,
> extends UseListFiltersOptions<TFilters> {
  /** The Colada query for this endpoint — `clipListQueryOptions` and friends.
   *  ⚠️ It must go through `queries/abortable.ts`, or a superseded request runs
   *  to completion and nothing on screen shows the difference. */
  readonly queryOptions: (
    query: ListQuery<TFilters>,
  ) => DefineQueryOptions<ListPage<TItem>, DomainError>;
}

export interface UseFilteredListReturn<TFilters extends FilterSet, TItem> {
  /** Writable, and what the inputs bind to. Mutating it debounces a refetch. */
  readonly filters: Ref<TFilters>;
  /** 1-based, like the API and like the URL. */
  readonly page: Ref<number>;
  readonly limit: Ref<number>;
  /** `undefined` until the first answer — which is the view's "show the loader". */
  readonly items: ComputedRef<readonly TItem[] | undefined>;
  /** Matching rows ignoring paging. `0` until the first answer. */
  readonly total: ComputedRef<number>;
  readonly lastPage: ComputedRef<number>;
  /** A request is in flight, including a background revalidation. */
  readonly isLoading: ComputedRef<boolean>;
  /** No data yet at all: the first load, or a filter never used before. */
  readonly isPending: ComputedRef<boolean>;
  readonly error: ComputedRef<DomainError | null>;
  /** Back to defaults. Fires immediately. */
  readonly reset: () => void;
  /** Ignore the cache and ask again. */
  readonly refetch: () => Promise<unknown>;
  /** The filter the request is actually running with. */
  readonly appliedQuery: ComputedRef<ListQuery<TFilters>>;
}

export function useFilteredList<TFilters extends FilterSet, TItem>(
  options: UseFilteredListOptions<TFilters, TItem>,
): UseFilteredListReturn<TFilters, TItem> {
  const { queryOptions, ...filterOptions } = options;
  const core = useListFilters<TFilters>(filterOptions);

  const listQuery = useQuery<ListPage<TItem>, DomainError>(() =>
    queryOptions(core.appliedQuery.value),
  );

  return {
    filters: core.filters,
    page: core.page,
    limit: core.limit,
    items: computed(() => listQuery.data.value?.results),
    total: computed(() => listQuery.data.value?.total ?? 0),
    lastPage: computed(() => {
      const total = listQuery.data.value?.total ?? 0;
      return total === 0 ? 1 : Math.ceil(total / core.limit.value);
    }),
    isLoading: computed(() => listQuery.isLoading.value),
    isPending: computed(() => listQuery.data.value === undefined),
    error: computed(() => listQuery.error.value),
    reset: core.reset,
    refetch: () => listQuery.refetch(),
    appliedQuery: core.appliedQuery,
  };
}
