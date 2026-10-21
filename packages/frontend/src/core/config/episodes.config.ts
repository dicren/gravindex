import { DownloadClipAudioUseCase } from '#/application/clips/download-clip-audio.use-case';
import { GetEpisodeUseCase } from '#/application/episodes/get-episode.use-case';
import { GetEpisodeWaveformUseCase } from '#/application/episodes/get-episode-waveform.use-case';
import { ListAllEpisodesUseCase } from '#/application/episodes/list-all-episodes.use-case';
import { ListEpisodesUseCase } from '#/application/episodes/list-episodes.use-case';
import { EpisodeAudioHttpRepository } from '#/infrastructure/episodes/episode-audio-http.repository';
import { EpisodeHttpRepository } from '#/infrastructure/episodes/episode-http.repository';

/**
 * Composition root for the episodes feature. Nothing here writes, so no
 * identity is involved at all.
 */
const episodeRepository = new EpisodeHttpRepository();
const episodeAudioRepository = new EpisodeAudioHttpRepository();

export const listEpisodesUseCase = new ListEpisodesUseCase(episodeRepository);
/** ⚠️ The calendar only. Every scrollable list goes through the paginated one. */
export const listAllEpisodesUseCase = new ListAllEpisodesUseCase(episodeRepository);
export const getEpisodeUseCase = new GetEpisodeUseCase(episodeRepository);
export const getEpisodeWaveformUseCase = new GetEpisodeWaveformUseCase(episodeRepository);
export const downloadClipAudioUseCase = new DownloadClipAudioUseCase(episodeAudioRepository);
