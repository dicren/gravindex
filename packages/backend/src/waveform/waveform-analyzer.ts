import { spawn } from 'node:child_process';
import { Injectable } from '@nestjs/common';
import { bucketPeaks, normalizePeaks } from './waveform-peaks';
import { WAVEFORM_BUCKET_SAMPLES, WAVEFORM_SAMPLE_RATE } from './waveform.constants';

// The one file in this module that touches ffmpeg. Everything it computes —
// bucketing, normalization — is delegated to the pure functions in
// `waveform-peaks.ts`; this file's only job is turning a file on disk into an
// `Int16Array` of samples.

export interface WaveformAnalysis {
  /** One normalized byte per `WAVEFORM_BUCKET_SAMPLES` of audio, whole file. */
  peaks: Buffer;
  /** The file's audio duration in whole seconds, as ffmpeg decoded it — not
   *  read from a container header, so it reflects what will actually play. */
  seconds: number;
}

export interface AnalyzeOptions {
  /** Defaults to `'ffmpeg'`, resolved through `PATH`. */
  ffmpegPath?: string;
  timeoutMs?: number;
}

// Generous: ffmpeg decodes an mp3 orders of magnitude faster than real time,
// but this also has to survive a slow disk or a machine under load from five
// other episodes analyzing at once (`waveform.cli.ts --concurrency`).
export const DEFAULT_ANALYZE_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Decodes `filePath` to mono 16-bit PCM at `WAVEFORM_SAMPLE_RATE` via ffmpeg,
 * buckets it into peaks and normalizes them to bytes.
 *
 * ⚠️ Buffers the WHOLE decoded episode in memory before bucketing — for a
 * two-hour episode at 8 kHz mono 16-bit that is ~115 MB. Deliberately not
 * streamed: this project's whole catalogue is ~600 episodes analyzed once,
 * offline, a handful at a time (`waveform.cli.ts --concurrency`), never in a
 * request path — see the root AGENTS.md, "Do not design for volume this
 * project does not have".
 *
 * Rejects if `ffmpeg` is not on `PATH`, exits non-zero, or times out; never
 * rejects with something that isn't an `Error`.
 */
export function analyzeAudioFile(
  filePath: string,
  options: AnalyzeOptions = {},
): Promise<WaveformAnalysis> {
  const ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
  const timeoutMs = options.timeoutMs ?? DEFAULT_ANALYZE_TIMEOUT_MS;

  return new Promise((resolvePromise, rejectPromise) => {
    // -v error         only real problems on stderr, not the banner/progress
    // -nostdin          never wait on a terminal that isn't there
    // -map 0:a:0        the first audio stream — ignore embedded cover art etc.
    // -ac 1 -ar <rate>  mono, downsampled: exactly what bucketing consumes
    // -f s16le -        raw signed 16-bit little-endian PCM, to stdout
    const args = [
      '-v',
      'error',
      '-nostdin',
      '-i',
      filePath,
      '-map',
      '0:a:0',
      '-ac',
      '1',
      '-ar',
      String(WAVEFORM_SAMPLE_RATE),
      '-f',
      's16le',
      '-',
    ];

    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const chunks: Buffer[] = [];
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      rejectPromise(new Error(`ffmpeg timed out after ${timeoutMs}ms analyzing "${filePath}"`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    // ⚠️ Fires for a missing binary (ENOENT), not just a spawn-level failure —
    // this is the "ffmpeg is not installed" case `WaveformService` degrades on.
    child.on('error', (cause) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(new Error(`could not run "${ffmpegPath}": ${cause.message}`));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        rejectPromise(new Error(`ffmpeg exited ${code} analyzing "${filePath}": ${stderr.trim()}`));
        return;
      }

      resolvePromise(toAnalysis(Buffer.concat(chunks)));
    });
  });
}

function toAnalysis(pcm: Buffer): WaveformAnalysis {
  // A trailing odd byte is a truncated final sample, not an error — some
  // real-world mp3s (eight years of them, encoded by whatever tool was handy)
  // end mid-frame. It is simply dropped.
  const sampleCount = Math.floor(pcm.length / 2);
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    samples[i] = pcm.readInt16LE(i * 2);
  }

  const rawPeaks = bucketPeaks(samples, WAVEFORM_BUCKET_SAMPLES);
  const peaks = Buffer.from(normalizePeaks(rawPeaks));
  const seconds = Math.floor(sampleCount / WAVEFORM_SAMPLE_RATE);

  return { peaks, seconds };
}

// A thin class wrapper around `analyzeAudioFile`, kept behind DI for exactly
// the reason `FeedClient` is: `WaveformService` can be tested with a fake one,
// no real ffmpeg process, no real file. `waveform-analyzer.spec.ts` already
// exercises the real thing end to end with real audio; this class adds no
// behaviour of its own.
@Injectable()
export class WaveformAnalyzer {
  analyze(filePath: string, options?: AnalyzeOptions): Promise<WaveformAnalysis> {
    return analyzeAudioFile(filePath, options);
  }
}
