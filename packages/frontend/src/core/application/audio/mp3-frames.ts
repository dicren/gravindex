/**
 * Reading MP3 frame headers, so a clip can be cut by COPYING bytes rather than
 * decoding and re-encoding audio.
 *
 * ⚠️ **Why this works at all.** An MP3 is a sequence of independent frames —
 * unlike almost any other compressed audio format, one frame decodes without
 * needing any of the others. Cutting `[start, end]` out of an episode is
 * therefore just "find where those seconds begin and end in the byte stream,
 * and copy the frames in between": no `AudioContext`, no ffmpeg, and the
 * browser never pulls more of the file than the frames it keeps.
 *
 * Verified against the real catalogue (2026-08-20): every episode sampled —
 * from 2009 to 2026, 64 to 192 kbps — is MPEG-1 Layer III, **CBR**, with no
 * `Xing`/`Info` frame. That is what lets `DownloadClipAudioUseCase`'s
 * time-to-byte arithmetic be an exact multiplication rather than a VBR table
 * lookup, and the bytes this module produces were checked byte-for-byte
 * against `ffmpeg -c copy` cutting the same span.
 */

/** One MP3 frame's header, decoded. `length` is what lets a caller step to the
 *  NEXT frame without reading its body. */
export interface Mp3Frame {
  /** bits/second. */
  readonly bitrate: number;
  /** Hz. */
  readonly sampleRate: number;
  /** 1152 for MPEG-1 Layer III, 576 for MPEG-2/2.5. */
  readonly samplesPerFrame: number;
  /** Bytes THIS frame occupies, padding included. */
  readonly length: number;
}

// Layer III bitrate tables, kbps. Index 0 ("free") and 15 ("bad") are not
// usable bitrates.
const BITRATES_MPEG1: readonly number[] = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
];
const BITRATES_MPEG2: readonly number[] = [
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
];
// Keyed by the header's 2-bit MPEG version field: 3 = MPEG-1, 2 = MPEG-2,
// 0 = MPEG-2.5. Version 1 is reserved and never appears here.
const SAMPLE_RATES: Readonly<Record<number, readonly number[]>> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

/**
 * Reads the 4-byte header at `at`. `null` if there is no valid frame there.
 *
 * ⚠️ A real sync pattern (`0xff` followed by three set bits) can appear by
 * chance inside compressed audio — a single match here is not proof of
 * anything. Callers that need to trust a position use `findFrame`, which
 * requires several frames to link in a row.
 */
export function parseFrame(bytes: Uint8Array, at: number): Mp3Frame | null {
  if (at + 4 > bytes.length) return null;

  const b0 = bytes[at];
  const b1 = bytes[at + 1];
  const b2 = bytes[at + 2];
  if (b0 === undefined || b1 === undefined || b2 === undefined) return null;
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null; // 11-bit sync

  const version = (b1 >> 3) & 3;
  const layer = (b1 >> 1) & 3;
  if (version === 1 || layer !== 1) return null; // reserved version, or not Layer III

  const bitrateIndex = (b2 >> 4) & 15;
  const sampleRateIndex = (b2 >> 2) & 3;
  const padding = (b2 >> 1) & 1;
  if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) return null;

  const isMpeg1 = version === 3;
  const kbps = (isMpeg1 ? BITRATES_MPEG1 : BITRATES_MPEG2)[bitrateIndex];
  const sampleRate = SAMPLE_RATES[version]?.[sampleRateIndex];
  if (kbps === undefined || sampleRate === undefined) return null;

  const bitrate = kbps * 1000;
  const samplesPerFrame = isMpeg1 ? 1152 : 576;
  const length = Math.floor(((samplesPerFrame / 8) * bitrate) / sampleRate) + padding;
  return { bitrate, sampleRate, samplesPerFrame, length };
}

/**
 * Finds where a frame starts, at or after `from`, requiring `chain` frames to
 * link in a row — each one's `length` landing exactly on the next one's sync
 * pattern. That is what makes a match trustworthy: a false `0xff` inside the
 * audio essentially never has three more real frames immediately following it.
 *
 * Returns `-1` if nothing links all the way to the end of `bytes` — the caller
 * is expected to have given a wide enough window that a real frame boundary is
 * in it somewhere.
 */
export function findFrame(bytes: Uint8Array, from: number, chain = 4): number {
  for (let i = Math.max(0, from); i < bytes.length - 4; i++) {
    let at = i;
    let linked = 0;
    while (linked < chain) {
      const frame = parseFrame(bytes, at);
      if (frame === null) break;
      at += frame.length;
      linked++;
      if (at > bytes.length - 4) break; // ran out of buffer — what linked so far is enough
    }
    if (linked === chain || at > bytes.length - 4) return i;
  }
  return -1;
}

/**
 * Length of the leading `ID3v2` tag, if there is one — `0` otherwise.
 *
 * The size field is "syncsafe" (7 usable bits per byte, so no byte inside it
 * can look like an MP3 sync pattern by accident), and a footer adds another 10
 * bytes when the tag declares one. Some episodes carry embedded cover art
 * here, pushing the tag past 200 KB.
 */
export function id3Length(bytes: Uint8Array): number {
  if (bytes.length < 10) return 0;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0; // "ID3"

  const b5 = bytes[5] ?? 0;
  const b6 = bytes[6] ?? 0;
  const b7 = bytes[7] ?? 0;
  const b8 = bytes[8] ?? 0;
  const b9 = bytes[9] ?? 0;
  const size = (b6 << 21) | (b7 << 14) | (b8 << 7) | b9;
  const hasFooter = (b5 & 0x10) !== 0;
  return 10 + size + (hasFooter ? 10 : 0);
}

/** One `ID3v2.3` text frame: UTF-16 with a byte-order mark, which is what
 *  admits any character a clip's title can carry — tildes, eñes, emoji —
 *  without a codepage to get wrong. */
function id3TextFrame(id: string, text: string): Uint8Array {
  const units = text.length; // JS strings are already UTF-16 code units
  const payload = new Uint8Array(3 + units * 2);
  payload[0] = 0x01; // encoding: UTF-16 with BOM
  payload[1] = 0xff;
  payload[2] = 0xfe; // BOM, little-endian
  for (let i = 0; i < units; i++) {
    const code = text.charCodeAt(i);
    payload[3 + i * 2] = code & 0xff;
    payload[4 + i * 2] = code >> 8;
  }

  const frame = new Uint8Array(10 + payload.length);
  for (let i = 0; i < 4; i++) frame[i] = id.charCodeAt(i);
  new DataView(frame.buffer).setUint32(4, payload.length); // v2.3 frame size is NOT syncsafe
  frame.set(payload, 10);
  return frame;
}

export interface Id3Fields {
  /** Title. */
  readonly TIT2?: string;
  /** Artist. */
  readonly TPE1?: string;
  /** Album. */
  readonly TALB?: string;
}

/** A minimal `ID3v2.3` tag from title/artist/album, skipping whichever of
 *  those are left `undefined`. */
export function id3Tag(fields: Id3Fields): Uint8Array {
  const entries: readonly [string, string | undefined][] = [
    ['TIT2', fields.TIT2],
    ['TPE1', fields.TPE1],
    ['TALB', fields.TALB],
  ];
  const frames = entries
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([id, value]) => id3TextFrame(id, value));

  const size = frames.reduce((total, frame) => total + frame.length, 0);
  const tag = new Uint8Array(10 + size);
  tag.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]); // "ID3", v2.3.0, no flags
  tag[6] = (size >> 21) & 0x7f;
  tag[7] = (size >> 14) & 0x7f;
  tag[8] = (size >> 7) & 0x7f;
  tag[9] = size & 0x7f; // the TAG's own size IS syncsafe

  let at = 10;
  for (const frame of frames) {
    tag.set(frame, at);
    at += frame.length;
  }
  return tag;
}
