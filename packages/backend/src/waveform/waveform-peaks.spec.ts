import { bucketPeaks, downsamplePeaks, normalizePeaks, sliceBounds } from './waveform-peaks';
import { WAVEFORM_POINTS_PER_SECOND } from './waveform.constants';

// Pure maths. No ffmpeg, no filesystem, no database.

describe('bucketPeaks', () => {
  it('returns the max absolute value of every full bucket', () => {
    const samples = Int16Array.from([1, -2, 3, 10, -20, 5]);

    expect(bucketPeaks(samples, 3)).toEqual([3, 20]);
  });

  it('still measures a trailing partial bucket rather than dropping it', () => {
    const samples = Int16Array.from([1, 2, 3, 4, 5]);

    expect(bucketPeaks(samples, 3)).toEqual([3, 5]);
  });

  it('returns an empty array for no samples', () => {
    expect(bucketPeaks(new Int16Array(0), 800)).toEqual([]);
  });

  it('rejects a non-positive bucket size', () => {
    expect(() => bucketPeaks(Int16Array.from([1]), 0)).toThrow();
  });
});

describe('normalizePeaks', () => {
  it('scales the 99.5th-percentile peak to 255', () => {
    // 1000 equal peaks: the 99.5th percentile IS the max, so it lands at 255
    // exactly and every entry (being equal) does too.
    const peaks = new Array<number>(1000).fill(16_000);

    const normalized = normalizePeaks(peaks);

    expect(normalized[0]).toBe(255);
    expect(normalized[999]).toBe(255);
  });

  it('clips an outlier above the percentile ceiling to 255 instead of stretching the scale', () => {
    // 900 quiet peaks, 99 louder ones, and a single clipped-mic-pop outlier —
    // 1000 values, so the 99.5th percentile (index 995) lands on a "louder"
    // peak (2000), not on the outlier itself.
    const peaks = [
      ...new Array<number>(900).fill(500),
      ...new Array<number>(99).fill(2_000),
      32_767,
    ];

    const normalized = normalizePeaks(peaks);

    // The outlier clips to 255 instead of stretching the scale to fit it...
    expect(normalized[999]).toBe(255);
    // ...which is what lets an ordinary quiet peak land at a THIRD of full
    // scale (500 / 2000 ceiling) instead of being crushed near zero, which is
    // what normalizing against the true 32767 maximum would have done
    // (round(500 / 32767 * 255) === 4).
    expect(normalized[0]).toBe(64);
  });

  it('returns an all-zero array for silence, without dividing by zero', () => {
    const normalized = normalizePeaks([0, 0, 0]);

    expect(Array.from(normalized)).toEqual([0, 0, 0]);
  });

  it('returns an empty array for no peaks', () => {
    expect(normalizePeaks([])).toEqual(new Uint8Array(0));
  });
});

describe('downsamplePeaks', () => {
  it('takes the maximum of each window, not the average', () => {
    const peaks = Uint8Array.from([10, 200, 10, 10, 5, 5, 5, 200]);

    const downsampled = downsamplePeaks(peaks, 2);

    expect(Array.from(downsampled)).toEqual([200, 200]);
  });

  it('returns the input unchanged when asked for at least as many points as it has', () => {
    const peaks = Uint8Array.from([1, 2, 3]);

    expect(downsamplePeaks(peaks, 3)).toBe(peaks);
    expect(downsamplePeaks(peaks, 10)).toBe(peaks);
  });

  it('returns an empty array for a non-positive target', () => {
    expect(downsamplePeaks(Uint8Array.from([1, 2, 3]), 0)).toEqual(new Uint8Array(0));
  });

  it('covers every source byte exactly once across the windows', () => {
    const peaks = Uint8Array.from({ length: 37 }, (_, i) => i + 1);

    const downsampled = downsamplePeaks(peaks, 5);

    // The last window's max is always the final byte, since windows are
    // contiguous and increasing.
    expect(downsampled[4]).toBe(37);
    expect(downsampled).toHaveLength(5);
  });
});

describe('sliceBounds', () => {
  const totalBytes = 100 * WAVEFORM_POINTS_PER_SECOND; // 100 seconds' worth

  it('converts whole seconds to bytes at WAVEFORM_POINTS_PER_SECOND', () => {
    expect(sliceBounds(0, 10, totalBytes)).toEqual({
      offset: 0,
      length: 10 * WAVEFORM_POINTS_PER_SECOND,
    });
  });

  it('clamps a negative from to zero', () => {
    expect(sliceBounds(-5, 10, totalBytes)).toEqual({
      offset: 0,
      length: 10 * WAVEFORM_POINTS_PER_SECOND,
    });
  });

  it('clamps a to past the end of the episode', () => {
    const result = sliceBounds(90, 1000, totalBytes);

    expect(result.offset + result.length).toBe(totalBytes);
  });

  it('never returns a negative length when to lands before from', () => {
    expect(sliceBounds(50, 10, totalBytes)).toEqual({
      offset: 50 * WAVEFORM_POINTS_PER_SECOND,
      length: 0,
    });
  });

  it('returns nothing for a zero-length column', () => {
    expect(sliceBounds(0, 60, 0)).toEqual({ offset: 0, length: 0 });
  });
});
