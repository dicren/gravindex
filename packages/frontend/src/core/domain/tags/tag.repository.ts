import type { TagCount } from './tag.entity';

/**
 * Port implemented by `infrastructure/tags/tag-http.repository.ts`.
 *
 * Use cases depend on this interface, never on the concrete adapter — which is
 * what lets `application/` be tested with a plain object stub, no network and
 * no Vue (see `application/tags/__tests__/list-tags.use-case.spec.ts`).
 */
export interface TagRepository {
  /**
   * Every distinct tag with its use count, in code-point order. No pagination:
   * the whole list is ~100 entries and the library's filter offers all of them
   * at once — deliberately, since 50 of the 102 are used by a single clip and
   * hiding those behind a search is how nobody ever remembers they exist.
   *
   * ⚠️ It takes the signal like every other read, even though its cache key is
   * constant and it can therefore never be *superseded*: it can still be
   * abandoned, when the last consumer showing it goes away mid-request. One
   * rule — reads carry a signal, writes do not — beats a list of exceptions.
   */
  listAll(signal?: AbortSignal): Promise<TagCount[]>;
}
