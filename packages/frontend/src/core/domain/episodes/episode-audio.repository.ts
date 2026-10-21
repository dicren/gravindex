/** One byte-range read of an episode's remote mp3. */
export interface EpisodeAudioRange {
  readonly bytes: Uint8Array;
  /** The upstream file's full size, from the backend's `Content-Range`. */
  readonly totalBytes: number;
}

/**
 * Port implemented by `infrastructure/episodes/episode-audio-http.repository.ts`.
 *
 * ⚠️ Talks about episodes and byte ranges, never about gravina82.com. That host
 * sends no `Access-Control-*` headers, so this port's implementation goes
 * through the backend's `GET /episodes/:id/audio` — a same-origin passthrough
 * — rather than fetching the episode's `file` URL directly. It exists so
 * `DownloadClipAudioUseCase` can cut a clip client-side by reading MP3 frame
 * headers out of small windows, never downloading the whole episode.
 */
export interface EpisodeAudioRepository {
  /** `[from, to]` inclusive, in BYTES — an HTTP Range, not a time. */
  readRange(episodeId: number, from: number, to: number): Promise<EpisodeAudioRange>;
}
