import { createWriteStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Injectable } from '@nestjs/common';

// Shared by `scripts/download-episodes.ts` (the bulk pre-fetch into
// `data/episodes/`) and `waveform.service.ts` (a one-off fetch of whatever a
// newly ingested episode isn't already on disk). Both need the same thing:
// pull one episode's mp3 from gravina82.com, resumably and politely.

export const EPISODE_DOWNLOAD_USER_AGENT =
  'gravindex-episode-download/2.0 (+https://github.com/dicren/gravindex)';

// Generous on purpose: this covers a whole mp3, not the few-KB RSS feed
// `FeedClient` fetches, and some episodes run over an hour.
export const EPISODE_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

export async function fileExists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}

/**
 * Downloads `url` to `destination`. Lands at `<destination>.part` first and is
 * renamed into place only once the whole body has arrived, so a partial file
 * left by an interrupted run is never mistaken for a complete one. Returns the
 * downloaded size in bytes.
 */
export async function downloadOne(url: string, destination: string): Promise<number> {
  const partial = `${destination}.part`;

  const response = await fetch(url, {
    // ⚠️ Covers the whole exchange, headers AND body — a plain `setTimeout`
    // around the promise would leave the socket open on a stalled download.
    signal: AbortSignal.timeout(EPISODE_DOWNLOAD_TIMEOUT_MS),
    redirect: 'follow',
    headers: { 'user-agent': EPISODE_DOWNLOAD_USER_AGENT },
  });

  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  const { size } = await stat(partial);
  await rename(partial, destination);
  return size;
}

/** Removes a `.part` left by an interrupted download. Never throws. */
export async function cleanupPartialDownload(destination: string): Promise<void> {
  await rm(`${destination}.part`, { force: true });
}

// A thin class wrapper around the three functions above, kept behind DI for
// exactly the reason `FeedClient` is: `WaveformService` can be tested with a
// fake one, no real network and no real filesystem race. The standalone
// `scripts/download-episodes.ts` calls the plain functions directly instead —
// it is not part of the Nest DI graph and has no reason to join it.
@Injectable()
export class EpisodeDownloader {
  exists(path: string): Promise<boolean> {
    return fileExists(path);
  }

  download(url: string, destination: string): Promise<number> {
    return downloadOne(url, destination);
  }

  cleanupPartial(destination: string): Promise<void> {
    return cleanupPartialDownload(destination);
  }
}
