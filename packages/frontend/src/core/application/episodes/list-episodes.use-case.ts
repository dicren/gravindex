import type {
  EpisodeListQuery,
  EpisodePage,
  EpisodeRepository,
} from '#/domain/episodes/episode.repository';

/**
 * The episode grid, and the autocomplete the clip editor starts from.
 *
 * ⚠️ `search` covers the TITLE only — see `EpisodeListQuery`.
 */
export class ListEpisodesUseCase {
  constructor(private readonly episodeRepository: EpisodeRepository) {}

  execute(query: EpisodeListQuery = {}, signal?: AbortSignal): Promise<EpisodePage> {
    return this.episodeRepository.list(query, signal);
  }
}
