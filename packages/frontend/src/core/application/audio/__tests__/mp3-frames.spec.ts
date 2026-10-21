import { describe, expect, it } from 'vitest';
import { findFrame, id3Length, id3Tag, parseFrame } from '../mp3-frames';
import { concat, synthFrames, synthId3 } from './synth-mp3';

/**
 * ⚠️ **No binary fixture anywhere here.** `synth-mp3.ts` builds real, valid
 * MPEG-1 Layer III frames from nothing but arithmetic — the same frames
 * verified against `ffprobe`/`ffmpeg` and against a byte-for-byte comparison
 * with `ffmpeg -c copy` cutting a real episode (2026-08-20). What that
 * verification could not cover is malformed input, which is what most of this
 * file is about: `parseFrame`/`findFrame` have to survive a real MP3 file's
 * false positives, not just recognise valid ones.
 */

describe('parseFrame', () => {
  it('reads bitrate, sample rate, frame size and length from a real frame', () => {
    const bytes = synthFrames(1, 128);

    const frame = parseFrame(bytes, 0);

    expect(frame).toEqual({
      bitrate: 128_000,
      sampleRate: 44100,
      samplesPerFrame: 1152,
      length: bytes.length, // one frame — its length IS the whole buffer
    });
  });

  it('reads a different bitrate correctly, without hard-coding one anywhere', () => {
    const frame = parseFrame(synthFrames(1, 64), 0);

    expect(frame?.bitrate).toBe(64_000);
  });

  it('returns null for a reserved bitrate index (1111)', () => {
    const bytes = synthFrames(1, 128);
    bytes[2] = 0xf0 | (bytes[2]! & 0x0f); // force the top nibble to 15

    expect(parseFrame(bytes, 0)).toBeNull();
  });

  it('returns null for a reserved sample-rate index (11)', () => {
    const bytes = synthFrames(1, 128);
    bytes[2] = (bytes[2]! & 0xf3) | 0x0c; // force bits 2-3 to 11

    expect(parseFrame(bytes, 0)).toBeNull();
  });

  it('returns null when the sync pattern is missing', () => {
    const bytes = synthFrames(1, 128);
    bytes[0] = 0x00;

    expect(parseFrame(bytes, 0)).toBeNull();
  });

  it('returns null rather than reading past the end of the buffer', () => {
    const bytes = synthFrames(1, 128);

    expect(parseFrame(bytes, bytes.length - 2)).toBeNull();
  });
});

describe('findFrame', () => {
  it('locates a frame that already starts exactly at the search point', () => {
    const bytes = synthFrames(6, 128);

    expect(findFrame(bytes, 0)).toBe(0);
  });

  it('steps past a stray sync byte inside real frame data, and keeps looking', () => {
    const bytes = synthFrames(6, 128);
    const plantAt = 600; // inside the second frame's body — frames are 418B at 128kbps
    // A plausible-looking header, but nothing real follows it — a false
    // positive, exactly like a byte pattern that can occur inside compressed
    // audio by chance.
    bytes[plantAt] = 0xff;
    bytes[plantAt + 1] = 0xfb;
    bytes[plantAt + 2] = 0x90;
    bytes[plantAt + 3] = 0x00;

    const found = findFrame(bytes, 500);

    expect(found).not.toBe(plantAt);
    expect(found).toBeGreaterThan(plantAt);
    // And what it landed on really does chain into valid frames — the whole
    // point of requiring several in a row.
    expect(parseFrame(bytes, found)).not.toBeNull();
  });

  it('returns -1 when nothing in the buffer ever links into a chain', () => {
    const garbage = new Uint8Array(100).fill(0x00);

    expect(findFrame(garbage, 0)).toBe(-1);
  });

  it('accepts a chain that runs out of buffer before completing, at the end of a file', () => {
    // Three real frames, then a fourth cut short — the last frame of a real
    // episode looks exactly like this once sliced by a byte Range.
    const bytes = synthFrames(4, 128).subarray(0, 418 * 3 + 50);

    expect(findFrame(bytes, 0)).toBe(0);
  });
});

describe('id3Length', () => {
  it('is 0 when there is no ID3v2 tag at all', () => {
    expect(id3Length(synthFrames(1, 128))).toBe(0);
  });

  it('reads a small tag exactly', () => {
    expect(id3Length(synthId3(100))).toBe(110);
  });

  it('reads a tag past 200 KB, the size real embedded cover art reaches', () => {
    expect(id3Length(synthId3(212_000))).toBe(212_010);
  });

  it('accounts for a declared 10-byte footer', () => {
    const tag = synthId3(100);
    tag[5] = (tag[5] ?? 0) | 0x10; // the footer flag

    expect(id3Length(tag)).toBe(120);
  });

  it('treats a buffer shorter than the tag header as having no tag', () => {
    expect(id3Length(new Uint8Array([0x49, 0x44, 0x33]))).toBe(0);
  });
});

describe('id3Tag', () => {
  /** Independent of `id3TextFrame` — reads a v2.3 text frame back out by hand,
   *  so this is a round trip through two separate implementations, not the
   *  same code checking itself. */
  function readTextFrame(tag: Uint8Array, id: string): string | undefined {
    const view = new DataView(tag.buffer, tag.byteOffset, tag.byteLength);
    let at = 10;
    while (at + 10 <= tag.length) {
      const frameId = String.fromCharCode(tag[at]!, tag[at + 1]!, tag[at + 2]!, tag[at + 3]!);
      const size = view.getUint32(at + 4);
      const payloadAt = at + 10;
      if (frameId === id) {
        const units = (size - 3) / 2; // encoding byte + 2-byte BOM, then UTF-16LE
        let text = '';
        for (let i = 0; i < units; i++) {
          const lo = tag[payloadAt + 3 + i * 2]!;
          const hi = tag[payloadAt + 3 + i * 2 + 1]!;
          text += String.fromCharCode(lo | (hi << 8));
        }
        return text;
      }
      at = payloadAt + size;
    }
    return undefined;
  }

  it('round-trips a title with accents, an eñe and an emoji', () => {
    const title = 'Prueba de recorte — ñañá «acentos» 🎧';

    const tag = id3Tag({ TIT2: title });

    expect(readTextFrame(tag, 'TIT2')).toBe(title);
  });

  it('carries title, artist and album in one tag', () => {
    const tag = id3Tag({ TIT2: 'El corte', TPE1: 'gravina82', TALB: 'Episodio 148' });

    expect(readTextFrame(tag, 'TIT2')).toBe('El corte');
    expect(readTextFrame(tag, 'TPE1')).toBe('gravina82');
    expect(readTextFrame(tag, 'TALB')).toBe('Episodio 148');
  });

  it('omits a field left undefined, rather than writing an empty frame', () => {
    const tag = id3Tag({ TIT2: 'Solo título' });

    expect(readTextFrame(tag, 'TIT2')).toBe('Solo título');
    expect(readTextFrame(tag, 'TPE1')).toBeUndefined();
    expect(readTextFrame(tag, 'TALB')).toBeUndefined();
  });

  it('produces a tag whose own declared length matches its real length', () => {
    const tag = id3Tag({ TIT2: 'x', TPE1: 'y', TALB: 'z' });

    expect(id3Length(tag)).toBe(tag.length);
  });

  it('is itself a valid prefix a real player could skip: audio starts right after it', () => {
    const tag = id3Tag({ TIT2: 'Corte de prueba' });
    const file = concat([tag, synthFrames(1, 128)]);

    const audioStart = id3Length(file);

    expect(parseFrame(file, audioStart)).not.toBeNull();
  });
});
