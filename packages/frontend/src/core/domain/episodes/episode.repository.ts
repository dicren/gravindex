import type { EpisodeDetail, EpisodeListItem, EpisodeWaveform } from './episode.entity';

/**
 * ⚠️ `search` matches the episode TITLE only — narrower than `GET /clips`,
 * which also searches the episode title and the tags. That asymmetry is
 * deliberate and part of the API contract, so do not widen it here.
 */
export interface EpisodeListQuery {
  /** 1-based. */
  readonly page?: number;
  readonly limit?: number;
  readonly search?: string;
  /** The `Solo con cortes · 61` toggle. `false` and absent mean the same. */
  readonly withClips?: boolean;
}

/** Newest first, by publish date. Rows carry a clip COUNT but no clips and no
 *  vote counts — that is what `findById` is for. */
export interface EpisodePage {
  readonly results: readonly EpisodeListItem[];
  readonly total: number;
}

/**
 * Port implemented by `infrastructure/episodes/episode-http.repository.ts`.
 *
 * ⚠️ Both methods are reads, so both take an optional `AbortSignal` — the
 * episode grid supersedes its own request on every keystroke exactly as the
 * library does. See `ClipRepository` for why writes deliberately do not.
 */
export interface EpisodeRepository {
  list(query: EpisodeListQuery, signal?: AbortSignal): Promise<EpisodePage>;

  /** ⚠️ Takes the numeric id. The router's `<id>-<slug>` form is a delivery
   *  concern; `core/` never sees the slug. */
  findById(id: number, signal?: AbortSignal): Promise<EpisodeDetail>;

  /** ⚠️ Never rejects into a `NOT_FOUND` for "not measured yet" — the API
   *  answers 200 with an empty waveform for that, and this port passes it
   *  through unchanged. Only a genuinely missing episode reaches `NOT_FOUND`. */
  getWaveform(
    id: number,
    query?: EpisodeWaveformQuery,
    signal?: AbortSignal,
  ): Promise<EpisodeWaveform>;
}

export interface EpisodeWaveformQuery {
  /** Seconds into the episode to start the slice at. Default 0. */
  readonly from?: number;
  /** Seconds into the episode to end the slice at. Default: the whole episode. */
  readonly to?: number;
  /** How many points to resample the slice down to. */
  readonly points?: number;
}
