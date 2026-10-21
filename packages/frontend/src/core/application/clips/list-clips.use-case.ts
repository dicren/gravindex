import type { ClipListQuery, ClipPage, ClipRepository } from '#/domain/clips/clip.repository';

/**
 * The library: search, tag filter, sort, paginate.
 *
 * ⚠️ It passes the filter straight through, and that is the whole job. The
 * caching, debouncing and in-flight deduplication belong to the Pinia Colada
 * query that wraps this from `vue/` —
 * none of it may leak in here.
 *
 * ⚠️ `signal` is the one thing that DOES travel inward, and it is a plain
 * `AbortSignal`: the query that wraps this owns *when* a search is abandoned,
 * but only the adapter can act on it, and this layer is the wire between them.
 * A withdrawn request rejects with `RequestAbortedError`.
 */
export class ListClipsUseCase {
  constructor(private readonly clipRepository: ClipRepository) {}

  execute(query: ClipListQuery = {}, signal?: AbortSignal): Promise<ClipPage> {
    return this.clipRepository.list(query, signal);
  }
}
