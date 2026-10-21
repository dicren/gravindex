import {
  WAVEFORM_NORMALIZATION_PERCENTILE,
  WAVEFORM_POINTS_PER_SECOND,
} from './waveform.constants';

// Pure functions over decoded PCM samples and stored waveform bytes — no
// ffmpeg, no filesystem, no database. That is what lets the bucketing,
// normalization, resampling and slicing maths run in milliseconds under Jest
// with nothing installed: `waveform-analyzer.spec.ts` is the one suite in this
// module that needs the `ffmpeg` binary, and it skips itself when the binary
// is missing.

/**
 * The peak (max absolute sample) of every `bucketSize`-sample window over
 * `samples`, one entry per bucket. The final, short bucket — when
 * `samples.length` is not an exact multiple of `bucketSize` — is still
 * measured rather than dropped: discarding a fraction of a second at the very
 * end of every episode would be a small but permanent gap in the one place a
 * listener is likeliest to look for it, the outro.
 *
 * Values are raw sample magnitudes (`0..32767` for 16-bit PCM), not yet
 * normalized to a byte — that is `normalizePeaks`' job, over the WHOLE
 * episode at once, which this function has no view of.
 */
export function bucketPeaks(samples: Int16Array, bucketSize: number): number[] {
  if (bucketSize <= 0) {
    throw new Error(`bucketSize must be positive, got ${bucketSize}`);
  }
  if (samples.length === 0) {
    return [];
  }

  const bucketCount = Math.ceil(samples.length / bucketSize);
  const peaks = new Array<number>(bucketCount);

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = bucket * bucketSize;
    const end = Math.min(start + bucketSize, samples.length);
    let peak = 0;
    for (let i = start; i < end; i += 1) {
      const magnitude = Math.abs(samples[i] ?? 0);
      if (magnitude > peak) {
        peak = magnitude;
      }
    }
    peaks[bucket] = peak;
  }

  return peaks;
}

/**
 * Raw sample-magnitude peaks → one unsigned byte each, scaled so that the
 * `WAVEFORM_NORMALIZATION_PERCENTILE`th-largest peak in the episode lands at
 * 255. Everything louder clips to 255 rather than stretching the scale to fit
 * it.
 *
 * ⚠️ Normalizing against the true MAXIMUM instead would let one microphone pop
 * or a clipped intro sting compress every ordinary spoken passage into a thin
 * band near zero — exactly the kind of episode this podcast has plenty of,
 * recorded over eight years on whatever hardware was on hand that week.
 *
 * A silent episode (every peak is 0) returns an all-zero array rather than
 * dividing by zero.
 */
export function normalizePeaks(peaks: readonly number[]): Uint8Array {
  const output = new Uint8Array(peaks.length);
  if (peaks.length === 0) {
    return output;
  }

  const sorted = [...peaks].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.floor(sorted.length * WAVEFORM_NORMALIZATION_PERCENTILE),
  );
  // Safe: `index` is clamped into `[0, sorted.length - 1]` above, and
  // `sorted.length === peaks.length > 0` (the empty case already returned).
  const ceiling = sorted[index] as number;

  if (ceiling <= 0) {
    return output;
  }

  for (let i = 0; i < peaks.length; i += 1) {
    output[i] = Math.min(255, Math.round(((peaks[i] ?? 0) / ceiling) * 255));
  }

  return output;
}

/**
 * Resample `peaks` down to (at most) `targetCount` bytes, by taking the
 * MAXIMUM of each source window rather than an average.
 *
 * ⚠️ Averaging peaks flattens the shape: a short loud syllable inside an
 * otherwise quiet window would vanish into the mean instead of showing as a
 * spike, which is the one thing a "waveform" exists to show. Every caller of
 * this function is asking for fewer bars to draw, never a smoother signal.
 *
 * `targetCount >= peaks.length` returns `peaks` unchanged — this function only
 * ever removes detail, it never invents it.
 */
export function downsamplePeaks(peaks: Uint8Array, targetCount: number): Uint8Array {
  if (targetCount <= 0) {
    return new Uint8Array(0);
  }
  if (targetCount >= peaks.length) {
    return peaks;
  }

  const output = new Uint8Array(targetCount);
  for (let i = 0; i < targetCount; i += 1) {
    const start = Math.floor((i * peaks.length) / targetCount);
    const end = Math.max(start + 1, Math.floor(((i + 1) * peaks.length) / targetCount));
    let peak = 0;
    for (let j = start; j < end; j += 1) {
      const value = peaks[j] ?? 0;
      if (value > peak) {
        peak = value;
      }
    }
    output[i] = peak;
  }

  return output;
}

export interface SliceBounds {
  /** Byte offset into the stored column, 0-based. */
  offset: number;
  /** Byte count to read, clamped to what the column actually holds. */
  length: number;
}

/**
 * Seconds `[from, to)` into a byte offset/length pair over a `totalBytes`-long
 * stored waveform, at `WAVEFORM_POINTS_PER_SECOND` bytes/second.
 *
 * Clamps rather than throws: a `to` past the end of the episode, or a negative
 * `from`, is the ordinary result of a clip's `end` landing a second past what
 * the feed's `itunes:duration` measured — the two numbers come from different
 * sources and are not guaranteed to agree to the second. Answering with
 * whatever bytes exist is more useful than a 400 for what is, on the wire, a
 * perfectly playable clip.
 */
export function sliceBounds(from: number, to: number, totalBytes: number): SliceBounds {
  const totalSeconds = totalBytes / WAVEFORM_POINTS_PER_SECOND;
  const clampedFrom = Math.max(0, Math.min(from, totalSeconds));
  const clampedTo = Math.max(clampedFrom, Math.min(to, totalSeconds));

  const offset = Math.floor(clampedFrom * WAVEFORM_POINTS_PER_SECOND);
  const end = Math.ceil(clampedTo * WAVEFORM_POINTS_PER_SECOND);
  const length = Math.max(0, Math.min(end, totalBytes) - offset);

  return { offset, length };
}
