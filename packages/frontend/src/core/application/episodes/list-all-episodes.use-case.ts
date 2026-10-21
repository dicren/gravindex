import type { EpisodeListItem } from '#/domain/episodes/episode.entity';
import type { EpisodeRepository } from '#/domain/episodes/episode.repository';

/**
 * Every episode under a filter, in one call — what the calendar view needs.
 *
 * ⚠️ **A loop over the paginated endpoint, not a new one.** `GET /episodes` caps
 * `limit` at 100 (`common/dto/pagination-query.dto.ts`), so the whole catalogue
 * is six requests of ~35 KB. An aggregate endpoint would be cheaper on the wire
 * and would cost a contract and a regenerated client — for a catalogue this
 * size that trade
 * is not worth taking (root `CLAUDE.md`, "Scale").
 *
 * ⚠️ **This is not a list screen and must never become one.** It exists because
 * the calendar draws 208 months at once and cannot ask for a page; every list
 * the visitor scrolls goes through `ListEpisodesUseCase` and
 * `use-infinite-list.ts` as before.
 */

/** Everything `GET /episodes` takes except the paging this use case owns. */
export interface ListAllEpisodesQuery {
  readonly search?: string;
  readonly withClips?: boolean;
}

/** The largest page the API will serve. */
const PAGE_SIZE = 100;

/**
 * ⚠️ A backstop, not a limit anybody should reach: 20 pages is 2000 episodes
 * against 580 today and ~30 new ones a year. It only fires if `total` and the
 * rows disagree — a server bug — where the alternative is a request loop that
 * never ends.
 */
const MAX_PAGES = 20;

export class ListAllEpisodesUseCase {
  constructor(private readonly episodeRepository: EpisodeRepository) {}

  async execute(
    query: ListAllEpisodesQuery = {},
    signal?: AbortSignal,
  ): Promise<readonly EpisodeListItem[]> {
    const episodes: EpisodeListItem[] = [];

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const batch = await this.episodeRepository.list({ ...query, page, limit: PAGE_SIZE }, signal);
      episodes.push(...batch.results);

      // ⚠️ `total` is the authority, exactly as `getNextPageParam` decides it in
      // `use-infinite-list.ts`: a final page that happens to be exactly 100 rows
      // long would otherwise cost one extra request to discover it was the last.
      if (episodes.length >= batch.total || batch.results.length === 0) break;
    }

    return episodes;
  }
}
