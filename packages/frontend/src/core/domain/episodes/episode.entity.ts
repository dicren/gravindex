import type { EpisodeClip } from '#/domain/clips/clip.entity';

/**
 * An episode of the podcast.
 *
 * ⚠️ Episodes are **not hosted**: `file` is the URL of an mp3 that lives
 * somewhere else entirely, and the browser streams it directly, seeking to a
 * clip's `start` — playback never touches this app's own backend. Downloading
 * a CUT is different: `DownloadClipAudioUseCase` reads small `Range` slices of
 * this same URL through the backend's `GET /episodes/:id/audio`, a same-origin
 * relay that exists only because this host sends no CORS headers.
 *
 * `description` exists in the database and is deliberately absent from the API
 * and from here — it has never been surfaced in the UI.
 */
export interface Episode {
  /** Public identifier. `/episode/<id>-<slug>` is the shareable URL, and only
   *  the leading integer is ever parsed back out of it. */
  readonly id: number;
  readonly title: string;
  /** Cover image URL. */
  readonly cover: string;
  /** The remote mp3 the browser streams. */
  readonly file: string;
  /** The episode's page on gravina82.com. */
  readonly originalUrl: string;
  /** Publish date. The API sends UTC ISO-8601; this is the parsed instant. */
  readonly date: Date;
}

/**
 * A row of `GET /episodes`.
 *
 * ⚠️ `clipCount`, not the clips. The episode list prints `7 cortes` /
 * `sin cortes` on every row and offers a "solo con cortes" toggle, and the
 * numbers are the point of the screen: only **61 of 395** episodes have ever
 * been cut from. Showing that is why the primary action on that screen is
 * `Cortar`, not "ver".
 */
export interface EpisodeListItem extends Episode {
  readonly clipCount: number;
}

/**
 * `GET /episodes/:id`: the episode plus every clip cut from it.
 *
 * ⚠️ Those clips carry `up`/`down` but **no `points`** and **no episode** —
 * see `EpisodeClip`. The asymmetry with `GET /clips` is part of the API contract
 * and is deliberate.
 */
export interface EpisodeDetail extends Episode {
  readonly clips: readonly EpisodeClip[];
}

/**
 * A slice of an episode's measured waveform — `GET /episodes/:id/waveform`.
 *
 * ⚠️ `peaks` is already `0..255` per point by the time it gets here; the
 * base64 the wire carries is an `infrastructure/` concern nothing above it
 * ever sees. An EMPTY array means the episode has not been measured yet, not
 * that it is silent — `GravWave` falls back to its drawn placeholder for
 * that, exactly as it always has.
 */
export interface EpisodeWaveform {
  /** Seconds into the episode this slice starts at. */
  readonly from: number;
  /** Seconds into the episode this slice ends at. */
  readonly to: number;
  readonly peaks: readonly number[];
}
