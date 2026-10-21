import { describe, expect, it } from 'vitest';
import { averageToBars, MAX_WAVEFORM_POINTS } from '../waveform-bars';

/**
 * Fitting an episode's waveform to the bars a panel can draw.
 *
 * ⚠️ **The measured problem this solves.** `GET /episodes/:id/waveform` returns
 * the PEAK of each bucket. Over a three-hour episode at ~320 bars every bucket
 * is half a minute of audio, and the loudest instant in half a minute of a
 * podcast is always near full scale — asking the server for 300 points on
 * episode 93 gives a median of 255 out of 255, i.e. a rectangle. Asking for the
 * maximum and averaging down here is what puts the shape back.
 */
describe('averageToBars', () => {
  it('averages each group rather than sampling it', () => {
    // ⚠️ Taking every Nth value would give `[0, 0]` and keeping the peak would
    // give `[255, 255]`. Neither is the shape of this audio; the mean is.
    expect(averageToBars([0, 255, 0, 255], 2)).toEqual([128, 128]);
  });

  it('spreads an uneven split rather than dropping the tail', () => {
    const bars = averageToBars([10, 20, 30, 40, 50], 2);

    expect(bars).toHaveLength(2);
    // Every input value is accounted for: 2 into the first bar, 3 into the
    // second, and nothing silently truncated.
    expect(bars).toEqual([15, 40]);
  });

  /** ⚠️ Rounding, because `GravWave` draws `0..255` and a fractional height is
   *  a sub-pixel rectangle nothing can see. */
  it('answers whole numbers', () => {
    expect(averageToBars([1, 2, 2], 1)).toEqual([2]);
  });

  /**
   * ⚠️ **Never up-samples.** An episode with no measured waveform answers with
   * an empty array — the state `GravWave` draws its placeholder for — and
   * stretching four points into three hundred would be inventing detail nobody
   * measured.
   */
  it('leaves anything at or below the target alone', () => {
    const short = [1, 2, 3];

    expect(averageToBars(short, 320)).toBe(short);
    expect(averageToBars([], 320)).toEqual([]);
    expect(averageToBars(short, 3)).toBe(short);
  });

  it('answers nothing for a target of nothing', () => {
    expect(averageToBars([1, 2, 3], 0)).toEqual([]);
    expect(averageToBars([1, 2, 3], -5)).toEqual([]);
  });

  /**
   * The real shape, at the real sizes: 2000 points down to 320 bars.
   *
   * ⚠️ The assertion that matters is the one about VARIATION. A flat result is
   * exactly the bug — it is what asking the server for 320 points produces —
   * so a test that only checked the length would pass on the broken version.
   */
  it('keeps the shape of a full-resolution episode', () => {
    // Loud speech with quiet gaps: near-saturated most of the time, with every
    // seventh stretch nearly silent. The peak of any large bucket is 250.
    const peaks = Array.from({ length: MAX_WAVEFORM_POINTS }, (_, i) =>
      Math.floor(i / 7) % 6 === 0 ? 20 : 250,
    );

    const bars = averageToBars(peaks, 320);

    expect(bars).toHaveLength(320);
    expect(Math.max(...bars)).toBeGreaterThan(Math.min(...bars) + 40);
    expect(Math.max(...bars)).toBeLessThanOrEqual(250);
  });
});
