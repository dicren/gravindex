import type { EpisodeDetail } from '#/domain/episodes/episode.entity';
import type { EpisodeRepository } from '#/domain/episodes/episode.repository';

/**
 * One episode with every clip cut from it.
 *
 * ⚠️ Takes the numeric id. The `/episode/<id>-<slug>` URL is a routing detail:
 * the slug is decoration nobody parses, and turning it back into an id is the
 * router's job, not this layer's.
 */
export class GetEpisodeUseCase {
  constructor(private readonly episodeRepository: EpisodeRepository) {}

  execute(episodeId: number, signal?: AbortSignal): Promise<EpisodeDetail> {
    return this.episodeRepository.findById(episodeId, signal);
  }
}
