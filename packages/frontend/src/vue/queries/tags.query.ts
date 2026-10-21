import { useQuery, type DefineQueryOptions, type UseQueryReturn } from '@pinia/colada';
import { listTagsUseCase } from '#/config/tags.config';
import type { DomainError } from '#/domain/errors';
import type { TagCount } from '#/domain/tags/tag.entity';
import { abortable } from './abortable';
import { tagKeys } from './query-keys';

/**
 * ⚠️ Five minutes: how long the tag list is served without a refetch.
 *
 * The window is Colada's, and invalidation is `useAddTag`/`useCreateClip` (see
 * `clips.query.ts`).
 *
 * It is not kept in `localStorage`, on purpose. That kind of cache outlives the
 * tab, so a tag added on another device would stay invisible for five minutes
 * *per browser*, with no way to notice. Colada's cache is per-session and the writes that
 * change it are in the same process, which is the version that can be correct.
 */
const TAGS_STALE_TIME_MS = 5 * 60_000;

/**
 * ⚠️ `abortable` here is about *abandonment*, not supersession: the key is
 * constant, so this entry is never replaced by a newer one — but it can still
 * be dropped while in flight when the last autocomplete showing it goes away.
 * Reads carry a signal, writes do not; one rule, no exceptions to remember.
 */
export function tagListQueryOptions(): DefineQueryOptions<TagCount[], DomainError> {
  return {
    key: tagKeys.list(),
    query: abortable((signal) => listTagsUseCase.execute(signal)),
    staleTime: TAGS_STALE_TIME_MS,
  };
}

/**
 * Every distinct tag with its use count — the source for the library's tag
 * filter and the editor's tag autocomplete.
 *
 * One entry shared by every caller: the key is constant, so two consumers
 * mounted at once make one request.
 *
 * ⚠️ **Code-point order on the wire, count order on screen.** The endpoint's
 * ordering is pinned by a test for a real reason (a different Postgres locale
 * reshuffles every accented tag), and the filter draws the long tail by use —
 * ten tags carry 49 % of the 382 rows and 50 are used once. Re-sorting 102 rows
 * here is free; changing the endpoint would not be.
 */
export function useTagList(): UseQueryReturn<TagCount[], DomainError> {
  return useQuery<TagCount[], DomainError>(tagListQueryOptions);
}
