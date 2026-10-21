import type { EpisodeWaveform } from '#/domain/episodes/episode.entity';
import type { EpisodeRepository, EpisodeWaveformQuery } from '#/domain/episodes/episode.repository';

/**
 * A slice of an episode's measured waveform, for the player, the clip
 * permalink and the editor's zoomed track.
 *
 * ⚠️ Not an error path for "not measured yet" — the repository already
 * resolves that to an empty `peaks` array, so this use case has nothing to
 * branch on. `GravWave` decides what an empty array looks like.
 */
export class GetEpisodeWaveformUseCase {
  constructor(private readonly episodeRepository: EpisodeRepository) {}

  execute(
    episodeId: number,
    query: EpisodeWaveformQuery = {},
    signal?: AbortSignal,
  ): Promise<EpisodeWaveform> {
    return this.episodeRepository.getWaveform(episodeId, query, signal);
  }
}
