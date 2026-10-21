// The stand-in for the media host the fixture points at (`media.example.com`).
//
// ⚠️ **Nothing in this suite touches a real server.** The episode mp3s and the
// cover images the app points at would otherwise be fetched over the internet,
// and a test run that downloaded a 40 MB episode would be slow and
// non-deterministic all at once. Every request to that origin is answered here.
//
// The audio it answers with is a real, decodable WAV of silence, served with
// working byte ranges — which is what makes the playback assertions honest:
// Chromium really loads it, really seeks into it, and really reports a
// `currentTime`. A stub that only pretended would prove nothing about "the clip
// starts at `start`".

import type { Page, Route } from '@playwright/test';

/** 8 kHz, 8-bit, mono: the smallest shape Chromium decodes without complaint. */
const SAMPLE_RATE = 8_000;

/**
 * ⚠️ Long enough that every clip in the catalogue fits inside it (the longest
 * `end` in the fixture is well under two hours) AND that the editor's default cut
 * — `duration − 10 min` — lands on a round, assertable timecode. Nothing this
 * size is ever transferred: the handler answers byte ranges, so Chromium only
 * ever pulls the megabyte around the seek point.
 */
export const AUDIO_DURATION_SECONDS = 12_000;

const DATA_BYTES = SAMPLE_RATE * AUDIO_DURATION_SECONDS;
const HEADER_BYTES = 44;
const TOTAL_BYTES = HEADER_BYTES + DATA_BYTES;
/** Cap per response. A media element asks for `bytes=0-`; answering with the
 *  whole 96 MB would be a download, and HTTP explicitly allows a shorter slice. */
const MAX_CHUNK_BYTES = 1 << 20;

/** A 1×1 transparent PNG, for the episode covers. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function wavHeader(): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + DATA_BYTES, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format: PCM
  header.writeUInt16LE(1, 22); // channels
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE, 28); // byte rate
  header.writeUInt16LE(1, 32); // block align
  header.writeUInt16LE(8, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(DATA_BYTES, 40);
  return header;
}

/** `[start, end]` inclusive, as HTTP means it. 8-bit PCM silence is `0x80`. */
function audioSlice(start: number, end: number): Buffer {
  const slice = Buffer.alloc(end - start + 1, 0x80);
  if (start < HEADER_BYTES) {
    wavHeader().copy(slice, 0, start, Math.min(HEADER_BYTES, end + 1));
  }
  return slice;
}

function parseRange(header: string | undefined): { start: number; end: number } | null {
  if (header === undefined) return null;
  const match = /bytes=(\d+)-(\d*)/.exec(header);
  if (match === null) return null;
  const start = Number(match[1]);
  const end = match[2] === '' ? TOTAL_BYTES - 1 : Number(match[2]);
  return { start, end: Math.min(end, TOTAL_BYTES - 1) };
}

async function fulfilAudio(route: Route): Promise<void> {
  const range = parseRange(route.request().headers()['range']);
  const start = range?.start ?? 0;
  let end = range?.end ?? TOTAL_BYTES - 1;
  if (end - start + 1 > MAX_CHUNK_BYTES) end = start + MAX_CHUNK_BYTES - 1;

  await route.fulfill({
    status: range === null ? 200 : 206,
    headers: {
      'content-type': 'audio/wav',
      'accept-ranges': 'bytes',
      'content-range': `bytes ${start}-${end}/${TOTAL_BYTES}`,
      'content-length': String(end - start + 1),
    },
    body: audioSlice(start, end),
  });
}

/**
 * Answer for the fixture's media host: silence for the mp3s, a pixel for
 * everything else (covers). ⚠️ Registered on the CONTEXT, so a test that forgets
 * it still cannot reach the real host.
 */
export async function interceptEpisodeMedia(page: Page): Promise<void> {
  await page.route(/media\.example\.com/, async (route) => {
    if (route.request().url().endsWith('.mp3')) {
      await fulfilAudio(route);
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'image/png' },
      body: PNG_1X1,
    });
  });
}
