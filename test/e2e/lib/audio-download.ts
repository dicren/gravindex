// The stand-in for `GET /api/episodes/:id/audio` — the new same-origin proxy
// `DownloadClipAudioUseCase` reads MP3 frames out of.
//
// ⚠️ **Answers on the BROWSER side, so `:3001` (the e2e backend) is never even
// asked.** `plays` (`fixtures.ts`) protects the `playback` table the same way,
// for the same reason: nothing in this suite may reach a third party's server,
// and this endpoint's whole job is relaying the media host's bytes.
//
// ⚠️ **Not `media.ts`'s WAV.** That fixture exists for `<audio>` playback,
// where any decodable stream will do; this one has to be a real MPEG-1 Layer
// III frame stream, because the app reads frame HEADERS out of it — a WAV file
// has none.

import type { Page, Route } from '@playwright/test';

const BITRATE_INDEX = 9; // 128 kbps, Layer III's table
const SAMPLE_RATE = 44100;
const SAMPLES_PER_FRAME = 1152;
const FRAME_BYTES_EXACT = ((SAMPLES_PER_FRAME / 8) * 128_000) / SAMPLE_RATE; // ~418.0998

/** Byte offset at which frame `index` WOULD start, in an infinite CBR stream —
 *  `Math.floor(n * exact)` distributes the fractional padding the same way a
 *  real encoder's running remainder does, without iterating from frame 0. */
function cumulativeBytes(frameIndex: number): number {
  return Math.floor(frameIndex * FRAME_BYTES_EXACT);
}

/** Long enough that no seeded clip's `[start, end]` — the longest `end` in the
 *  pristine fixture is well under two hours — runs past it. Nothing this size is
 *  ever materialised: `sliceBytes` below computes only the window asked for. */
const DURATION_SECONDS = 3 * 60 * 60;
const TOTAL_FRAMES = Math.ceil((DURATION_SECONDS * SAMPLE_RATE) / SAMPLES_PER_FRAME);
const TOTAL_BYTES = cumulativeBytes(TOTAL_FRAMES);

/** `[from, to]` inclusive. Walks only the frames overlapping the window and
 *  writes their 4-byte headers at the right offset — everything else in the
 *  slice stays zero, which is fine: `parseFrame`/`findFrame` never read a
 *  frame's payload, only its header. */
function sliceBytes(from: number, to: number): Uint8Array {
  const out = new Uint8Array(to - from + 1);

  let index = Math.max(0, Math.floor(from / FRAME_BYTES_EXACT) - 2);
  let frameStart = cumulativeBytes(index);
  while (frameStart <= to) {
    const frameLength = cumulativeBytes(index + 1) - frameStart;
    const padding = frameLength - Math.floor(FRAME_BYTES_EXACT);
    const header = [0xff, 0xfb, (BITRATE_INDEX << 4) | (padding << 1), 0x40];
    for (let b = 0; b < 4; b++) {
      const at = frameStart + b;
      if (at >= from && at <= to) out[at - from] = header[b]!;
    }
    index++;
    frameStart = cumulativeBytes(index);
  }

  return out;
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
  const end = range?.end ?? TOTAL_BYTES - 1;

  await route.fulfill({
    status: range === null ? 200 : 206,
    headers: {
      'content-type': 'audio/mpeg',
      'accept-ranges': 'bytes',
      'content-range': `bytes ${start}-${end}/${TOTAL_BYTES}`,
      'content-length': String(end - start + 1),
    },
    body: Buffer.from(sliceBytes(start, end)),
  });
}

/** Answers `GET /api/episodes/:id/audio` for any id, with a synthetic 128 kbps
 *  CBR mp3. ⚠️ Registered on the CONTEXT, like `interceptEpisodeMedia`, so a
 *  test that forgets to ask for it still cannot reach the real backend route. */
export async function interceptClipAudioDownload(page: Page): Promise<void> {
  await page.route('**/api/episodes/*/audio', fulfilAudio);
}
