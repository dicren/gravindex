import { describe, expect, it } from 'vitest';
import type {
  EpisodeAudioRange,
  EpisodeAudioRepository,
} from '#/domain/episodes/episode-audio.repository';
import { UnexpectedResponseError, ValidationError } from '#/domain/errors';
import { id3Length, parseFrame } from '../../audio/mp3-frames';
import {
  concat,
  SYNTH_SAMPLE_RATE,
  SYNTH_SAMPLES_PER_FRAME,
  synthFrames,
  synthId3,
} from '../../audio/__tests__/synth-mp3';
import { DownloadClipAudioUseCase } from '../download-clip-audio.use-case';

/** A repository backed by an in-memory buffer, exactly like the real HTTP one
 *  except the "server" is a `Uint8Array`. `readRange` is instrumented so a
 *  test can assert HOW MUCH of the file was actually requested. */
function repositoryOver(buffer: Uint8Array): {
  repository: EpisodeAudioRepository;
  requests: { from: number; to: number }[];
} {
  const requests: { from: number; to: number }[] = [];
  const repository: EpisodeAudioRepository = {
    readRange: (_episodeId: number, from: number, to: number): Promise<EpisodeAudioRange> => {
      requests.push({ from, to });
      return Promise.resolve({
        bytes: buffer.subarray(from, Math.min(to + 1, buffer.length)),
        totalBytes: buffer.length,
      });
    },
  };
  return { repository, requests };
}

/** How many valid, chained frames are in a cut result, starting right after
 *  its own leading `ID3v2` tag — an independent check that the use case's
 *  output is itself a well-formed mp3, not just "some bytes". */
function countAudioFrames(bytes: Uint8Array): number {
  let at = id3Length(bytes);
  let count = 0;
  while (at < bytes.length) {
    const frame = parseFrame(bytes, at);
    if (frame === null) break;
    at += frame.length;
    count++;
  }
  return count;
}

const KBPS = 128;
const DURATION_SECONDS = 120;
const TOTAL_FRAMES = Math.ceil((DURATION_SECONDS * SYNTH_SAMPLE_RATE) / SYNTH_SAMPLES_PER_FRAME);

describe('DownloadClipAudioUseCase', () => {
  it('cuts exactly the number of frames the requested span needs, from a file with no ID3 tag', async () => {
    const file = synthFrames(TOTAL_FRAMES, KBPS);
    const { repository } = repositoryOver(file);

    const result = await new DownloadClipAudioUseCase(repository).execute({
      episodeId: 148,
      episodeTitle: 'Episodio 148',
      clipTitle: 'Un corte',
      start: 10,
      end: 15,
    });

    const wantedFrames = Math.ceil((5 * SYNTH_SAMPLE_RATE) / SYNTH_SAMPLES_PER_FRAME);
    expect(countAudioFrames(result.bytes)).toBe(wantedFrames);
  });

  it('cuts starting at the very first byte of the audio (start = 0)', async () => {
    const file = synthFrames(TOTAL_FRAMES, KBPS);
    const { repository } = repositoryOver(file);

    const result = await new DownloadClipAudioUseCase(repository).execute({
      episodeId: 148,
      episodeTitle: 'Episodio 148',
      clipTitle: 'Desde el inicio',
      start: 0,
      end: 3,
    });

    expect(countAudioFrames(result.bytes)).toBeGreaterThan(0);
  });

  it('skips a leading ID3v2 tag that fits in the first probe', async () => {
    const file = concat([synthId3(500), synthFrames(TOTAL_FRAMES, KBPS)]);
    const { repository } = repositoryOver(file);

    const result = await new DownloadClipAudioUseCase(repository).execute({
      episodeId: 148,
      episodeTitle: 'Episodio 148',
      clipTitle: 'Con carátula pequeña',
      start: 10,
      end: 15,
    });

    const wantedFrames = Math.ceil((5 * SYNTH_SAMPLE_RATE) / SYNTH_SAMPLES_PER_FRAME);
    expect(countAudioFrames(result.bytes)).toBe(wantedFrames);
  });

  it('rereads the header when an embedded cover pushes the tag past the first probe', async () => {
    // Bigger than HEADER_PROBE_BYTES (16 KB) — real episodes carry tags over
    // 200 KB with embedded cover art.
    const file = concat([synthId3(20_000), synthFrames(TOTAL_FRAMES, KBPS)]);
    const { repository, requests } = repositoryOver(file);

    const result = await new DownloadClipAudioUseCase(repository).execute({
      episodeId: 148,
      episodeTitle: 'Episodio 148',
      clipTitle: 'Con carátula grande',
      start: 10,
      end: 15,
    });

    const wantedFrames = Math.ceil((5 * SYNTH_SAMPLE_RATE) / SYNTH_SAMPLES_PER_FRAME);
    expect(countAudioFrames(result.bytes)).toBe(wantedFrames);
    // The first probe alone (0..16 KB) could not have found the audio start —
    // proves the reread, from right after the 20,010-byte tag, actually
    // happened rather than the cut succeeding by luck.
    expect(requests.some((r) => r.from === 20_010)).toBe(true);
  });

  it('truncates rather than throwing when the requested end runs past the end of the file', async () => {
    const file = synthFrames(TOTAL_FRAMES, KBPS);
    const { repository } = repositoryOver(file);
    const fileDurationSeconds = (file.length * 8) / (KBPS * 1000);

    const result = await new DownloadClipAudioUseCase(repository).execute({
      episodeId: 148,
      episodeTitle: 'Episodio 148',
      clipTitle: 'Hasta el final',
      start: fileDurationSeconds - 2,
      end: fileDurationSeconds + 30,
    });

    expect(countAudioFrames(result.bytes)).toBeGreaterThan(0);
  });

  it('only ever requests small windows, never the whole file', async () => {
    const file = synthFrames(TOTAL_FRAMES, KBPS); // ~1.8 MB at 128 kbps for 120s
    const { repository, requests } = repositoryOver(file);

    await new DownloadClipAudioUseCase(repository).execute({
      episodeId: 148,
      episodeTitle: 'Episodio 148',
      clipTitle: 'Un corte',
      start: 10,
      end: 15,
    });

    // A 5s cut needs the header probe plus one padded window around the span
    // — nowhere near the ~1.8 MB file, however many requests that takes.
    for (const request of requests) {
      expect(request.to - request.from).toBeLessThan(file.length / 4);
    }
  });

  it('names the file after the clip title, with a .mp3 extension', async () => {
    const file = synthFrames(TOTAL_FRAMES, KBPS);
    const { repository } = repositoryOver(file);

    const result = await new DownloadClipAudioUseCase(repository).execute({
      episodeId: 148,
      episodeTitle: 'Episodio 148',
      clipTitle: 'La mulata del clítoris',
      start: 10,
      end: 15,
    });

    expect(result.filename).toBe('La mulata del clítoris.mp3');
  });

  it('strips characters a filesystem or a save dialog cannot take', async () => {
    const file = synthFrames(TOTAL_FRAMES, KBPS);
    const { repository } = repositoryOver(file);

    const result = await new DownloadClipAudioUseCase(repository).execute({
      episodeId: 148,
      episodeTitle: 'Episodio 148',
      clipTitle: '¿Qué? / Parte 1 : "la revancha"',
      start: 10,
      end: 15,
    });

    expect(result.filename).not.toMatch(/[\\/:*?"<>|]/);
  });

  it('rejects a clip whose end is not after its start, without reading anything', async () => {
    const { repository, requests } = repositoryOver(synthFrames(TOTAL_FRAMES, KBPS));

    await expect(
      new DownloadClipAudioUseCase(repository).execute({
        episodeId: 148,
        episodeTitle: 'Episodio 148',
        clipTitle: 'Corte invertido',
        start: 20,
        end: 20,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(requests).toHaveLength(0);
  });

  it('surfaces a header with no valid frame as UnexpectedResponseError', async () => {
    const garbage = new Uint8Array(4096).fill(0x00);
    const { repository } = repositoryOver(garbage);

    await expect(
      new DownloadClipAudioUseCase(repository).execute({
        episodeId: 148,
        episodeTitle: 'Episodio 148',
        clipTitle: 'Corte imposible',
        start: 0,
        end: 5,
      }),
    ).rejects.toBeInstanceOf(UnexpectedResponseError);
  });

  it('reads the second episode independently of the first — no shared state', async () => {
    const fileA = synthFrames(TOTAL_FRAMES, 64);
    const fileB = synthFrames(TOTAL_FRAMES, 320);
    const { repository: repoA } = repositoryOver(fileA);
    const { repository: repoB } = repositoryOver(fileB);
    const useCase = new DownloadClipAudioUseCase(repoA);
    const otherUseCase = new DownloadClipAudioUseCase(repoB);

    const [resultA, resultB] = await Promise.all([
      useCase.execute({
        episodeId: 1,
        episodeTitle: 'A',
        clipTitle: 'a',
        start: 5,
        end: 10,
      }),
      otherUseCase.execute({
        episodeId: 2,
        episodeTitle: 'B',
        clipTitle: 'b',
        start: 5,
        end: 10,
      }),
    ]);

    expect(countAudioFrames(resultA.bytes)).toBeGreaterThan(0);
    expect(countAudioFrames(resultB.bytes)).toBeGreaterThan(0);
  });
});
