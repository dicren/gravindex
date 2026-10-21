import { useQuery, type DefineQueryOptions, type UseQueryReturn } from '@pinia/colada';
import {
  getEpisodeUseCase,
  getEpisodeWaveformUseCase,
  listEpisodesUseCase,
} from '#/config/episodes.config';
import type { EpisodeDetail, EpisodeWaveform } from '#/domain/episodes/episode.entity';
import type {
  EpisodeListQuery,
  EpisodePage,
  EpisodeWaveformQuery,
} from '#/domain/episodes/episode.repository';
import type { DomainError } from '#/domain/errors';
import { abortable } from './abortable';
import { episodeKeys } from './query-keys';

/**
 * The episode grid's page, and the editor's episode autocomplete.
 *
 * Shaped as a plain options factory rather than a composable so
 * `useFilteredList` can hand it a filter that changes over time:
 * `useQuery(() => episodeListQueryOptions(effectiveQuery))` re-keys and
 * refetches by itself. That is also where the duplicate-request suppression
 * comes from: an unchanged key is the same cache entry.
 *
 * ⚠️ Cancellation is `abortable`: the key changing
 * is what makes Colada abort, but only a signal that is actually *passed on*
 * reaches `fetch`. See `clips.query.ts`.
 */
export function episodeListQueryOptions(
  query: EpisodeListQuery,
): DefineQueryOptions<EpisodePage, DomainError> {
  return {
    key: episodeKeys.list(query),
    query: abortable((signal) => listEpisodesUseCase.execute(query, signal)),
  };
}

/** One episode with every clip cut from it. ⚠️ Takes the numeric id — turning
 *  `/episode/<id>-<slug>` back into one is the view's job, not this layer's. */
export function episodeQueryOptions(
  episodeId: number,
): DefineQueryOptions<EpisodeDetail, DomainError> {
  return {
    key: episodeKeys.detail(episodeId),
    query: abortable((signal) => getEpisodeUseCase.execute(episodeId, signal)),
  };
}

export function useEpisodeList(
  query: () => EpisodeListQuery,
): UseQueryReturn<EpisodePage, DomainError> {
  return useQuery<EpisodePage, DomainError>(() => episodeListQueryOptions(query()));
}

export function useEpisode(episodeId: () => number): UseQueryReturn<EpisodeDetail, DomainError> {
  return useQuery<EpisodeDetail, DomainError>(() => episodeQueryOptions(episodeId()));
}

/**
 * A slice of an episode's waveform — the player, the clip permalink and the
 * editor's zoomed track each ask for their own `from`/`to`/`points` window,
 * and each window is its OWN cache entry, so scrubbing the editor's zoom does
 * not refetch what the permalink already has cached.
 */
export function episodeWaveformQueryOptions(
  episodeId: number,
  query: EpisodeWaveformQuery,
): DefineQueryOptions<EpisodeWaveform, DomainError> {
  return {
    key: episodeKeys.waveform(episodeId, query),
    query: abortable((signal) => getEpisodeWaveformUseCase.execute(episodeId, query, signal)),
  };
}

export function useEpisodeWaveform(
  episodeId: () => number,
  query: () => EpisodeWaveformQuery,
): UseQueryReturn<EpisodeWaveform, DomainError> {
  return useQuery<EpisodeWaveform, DomainError>(() =>
    episodeWaveformQueryOptions(episodeId(), query()),
  );
}
