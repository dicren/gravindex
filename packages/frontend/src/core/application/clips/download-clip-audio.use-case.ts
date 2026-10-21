import type { EpisodeAudioRepository } from '#/domain/episodes/episode-audio.repository';
import { UnexpectedResponseError, ValidationError } from '#/domain/errors';
import { findFrame, id3Length, id3Tag, parseFrame, type Mp3Frame } from '../audio/mp3-frames';

export interface DownloadClipAudioInput {
  readonly episodeId: number;
  readonly episodeTitle: string;
  readonly clipTitle: string;
  /** Seconds into the episode. */
  readonly start: number;
  /** Seconds into the episode. */
  readonly end: number;
}

export interface ClipAudioFile {
  readonly bytes: Uint8Array;
  /** Includes the `.mp3` extension. */
  readonly filename: string;
}

/** The first frame's parameters, plus where the audio actually starts (past
 *  any leading `ID3v2` tag) and how big the whole upstream file is. */
interface EpisodeAudioLayout extends Mp3Frame {
  readonly audioStart: number;
  readonly totalBytes: number;
}

/** One read, unless the leading `ID3v2` tag (some episodes embed cover art,
 *  measured up to ~210 KB) does not fit in it — then one more, from right
 *  after the tag. Comfortably covers every real tag measured so far while
 *  staying a tiny fraction of an episode. */
const HEADER_PROBE_BYTES = 16 * 1024;

/** Margin either side of the exact cut point: enough to resynchronise onto a
 *  real frame boundary (`findFrame` needs several frames to link) and, at the
 *  far end, to let the last wanted frame finish even if the arithmetic lands a
 *  few bytes short. */
const RESYNC_PAD_BYTES = 8 * 1024;

/**
 * Cuts `[start, end]` out of an episode's mp3 — by copying MP3 frames, never
 * decoding or re-encoding audio — and returns a small, complete, standalone
 * mp3 file. See `core/application/audio/mp3-frames.ts` for why this is
 * possible at all, and `EpisodeAudioRepository` for why the bytes come from
 * this project's own backend rather than gravina82.com directly.
 *
 * ⚠️ **The cut can land up to ~50ms late.** Resynchronising only ever searches
 * FORWARD from the exact byte the arithmetic points at, so the frame actually
 * used is the first valid one at or after that point, never one that started
 * earlier and merely overlaps it. Recorded deviation: `ffmpeg -c copy` cutting
 * the same span rounds backward instead, which is why a byte-for-byte
 * comparison against it shows `ffmpeg` including one or two extra frames at
 * the front. With clips measured in whole seconds this is inaudible.
 *
 * ⚠️ **The first couple of frames of the cut can sound faintly off.** Layer
 * III's "bit reservoir" lets a frame borrow bytes from the ones before it, so
 * the very first frames of ANY cut — made this way or with `ffmpeg -c copy` —
 * decode from an incomplete reservoir. In spoken-word audio this is a few tens
 * of milliseconds, and not audible.
 */
export class DownloadClipAudioUseCase {
  constructor(private readonly episodeAudioRepository: EpisodeAudioRepository) {}

  async execute(input: DownloadClipAudioInput): Promise<ClipAudioFile> {
    if (!(input.end > input.start)) {
      throw new ValidationError("A clip's end must be after its start.");
    }

    const layout = await this.readLayout(input.episodeId);

    // CBR: the byte a moment in time falls at is an exact multiplication, no
    // VBR table needed. See `mp3-frames.ts`'s header comment for why every
    // episode sampled so far is CBR.
    const bytesPerSecond = layout.bitrate / 8;
    const from = layout.audioStart + Math.round(input.start * bytesPerSecond);
    const to = layout.audioStart + Math.round(input.end * bytesPerSecond);

    const windowFrom = Math.max(layout.audioStart, from - RESYNC_PAD_BYTES);
    const windowTo = Math.min(layout.totalBytes - 1, to + RESYNC_PAD_BYTES);
    const window = await this.episodeAudioRepository.readRange(
      input.episodeId,
      windowFrom,
      windowTo,
    );

    const first = findFrame(window.bytes, from - windowFrom);
    if (first < 0) {
      throw new UnexpectedResponseError("Could not find a valid MP3 frame at the clip's start.");
    }

    const wanted = Math.ceil(
      ((input.end - input.start) * layout.sampleRate) / layout.samplesPerFrame,
    );
    let at = first;
    let count = 0;
    while (count < wanted) {
      const frame = parseFrame(window.bytes, at);
      // Either a malformed frame or the end of the episode reached before the
      // requested duration did — truncate rather than fail: a clip cut a few
      // frames short of `end` is still a usable download.
      if (frame === null || at + frame.length > window.bytes.length) break;
      at += frame.length;
      count++;
    }

    const tag = id3Tag({ TIT2: input.clipTitle, TPE1: 'gravina82', TALB: input.episodeTitle });
    const bytes = new Uint8Array(tag.length + (at - first));
    bytes.set(tag);
    bytes.set(window.bytes.subarray(first, at), tag.length);

    return { bytes, filename: `${toFilename(input.clipTitle)}.mp3` };
  }

  private async readLayout(episodeId: number): Promise<EpisodeAudioLayout> {
    let range = await this.episodeAudioRepository.readRange(episodeId, 0, HEADER_PROBE_BYTES - 1);

    const tagLength = id3Length(range.bytes);
    let base = 0;
    const audioStart = tagLength;

    // The tag itself may not have fit in the first read (embedded cover art
    // can run past 200 KB) — reread starting right after it rather than
    // guessing how much further to go.
    if (audioStart >= range.bytes.length - 4) {
      range = await this.episodeAudioRepository.readRange(
        episodeId,
        audioStart,
        audioStart + HEADER_PROBE_BYTES - 1,
      );
      base = audioStart;
    }

    const at = findFrame(range.bytes, audioStart - base);
    const frame = at < 0 ? null : parseFrame(range.bytes, at);
    if (frame === null) {
      throw new UnexpectedResponseError(
        "Could not find a valid MP3 frame in the episode's header.",
      );
    }

    return { ...frame, audioStart: base + at, totalBytes: range.totalBytes };
  }
}

/**
 * A downloaded file's name, not a URL slug — `vue/utils/episode-url.ts`'s
 * frozen, accent-stripping algorithm does not apply here, and a saved MP3
 * should read like the clip's actual title. Only what a filesystem or an OS
 * save dialog cannot take is stripped.
 */
function toFilename(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, '').trim();
  return cleaned === '' ? 'corte' : cleaned;
}
