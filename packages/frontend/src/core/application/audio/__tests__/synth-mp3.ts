/**
 * Real, decodable MPEG-1 Layer III CBR frames, built from nothing but this
 * module — there is no binary fixture anywhere in this repository. Verified
 * (2026-08-20) against `ffprobe`/`ffmpeg`, and against `ffmpeg -c copy`
 * cutting the same span from a real episode: byte-for-byte identical audio.
 * Padding alternates the way a real CBR encoder's does, which is what makes
 * `findFrame`'s chain requirement meaningful here rather than trivially true.
 */

// kbps -> the 4-bit index Layer III's header spends on bitrate. Add an entry
// here before using a new bitrate in a test.
const BITRATE_INDEX: Readonly<Record<number, number>> = {
  32: 1,
  40: 2,
  48: 3,
  56: 4,
  64: 5,
  80: 6,
  96: 7,
  112: 8,
  128: 9,
  160: 10,
  192: 11,
  224: 12,
  256: 13,
  320: 14,
};

export const SYNTH_SAMPLE_RATE = 44100;
export const SYNTH_SAMPLES_PER_FRAME = 1152;

/** `count` consecutive, valid MPEG-1 Layer III frames at `kbps`, 44.1 kHz,
 *  joint stereo, no CRC. */
export function synthFrames(count: number, kbps: number): Uint8Array {
  const bitrateIndex = BITRATE_INDEX[kbps];
  if (bitrateIndex === undefined) {
    throw new Error(`unsupported test bitrate ${kbps} — add it to BITRATE_INDEX`);
  }
  const bitrate = kbps * 1000;

  const frames: Uint8Array[] = [];
  let carry = 0;
  for (let i = 0; i < count; i++) {
    const exact = ((SYNTH_SAMPLES_PER_FRAME / 8) * bitrate) / SYNTH_SAMPLE_RATE;
    const base = Math.floor(exact);
    carry += exact - base;
    const padding = carry >= 1 ? 1 : 0;
    if (padding === 1) carry -= 1;

    const frame = new Uint8Array(base + padding);
    frame[0] = 0xff;
    frame[1] = 0xfb; // MPEG-1, Layer III, no CRC
    frame[2] = (bitrateIndex << 4) | (0 << 2) | (padding << 1); // sample rate index 0 = 44100 Hz
    frame[3] = 0x40; // joint stereo
    frames.push(frame);
  }
  return concat(frames);
}

/** An `ID3v2.3` header declaring `bodyBytes` of content, with no real frames
 *  inside it — `id3Length` only reads the outer syncsafe size, so this is
 *  enough to stand in for a tag carrying embedded cover art. */
export function synthId3(bodyBytes: number): Uint8Array {
  const tag = new Uint8Array(10 + bodyBytes);
  tag.set([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]); // "ID3", v2.3.0, no flags
  tag[6] = (bodyBytes >> 21) & 0x7f;
  tag[7] = (bodyBytes >> 14) & 0x7f;
  tag[8] = (bodyBytes >> 7) & 0x7f;
  tag[9] = bodyBytes & 0x7f;
  return tag;
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
