/**
 * Fitting a measured waveform to the number of bars a screen can draw.
 *
 * ⚠️ **The reason this exists is that a whole episode's waveform is a brick.**
 * `GET /episodes/:id/waveform` returns the PEAK of each bucket, which is the
 * right answer for a clip — a couple of minutes over a couple of hundred points
 * is a fraction of a second per bar, and speech genuinely peaks and drops inside
 * it. Over a three-hour episode at the ~320 bars a 1100 px panel fits, each bar
 * summarises 34 seconds, and the loudest instant in any 34 seconds of a podcast
 * is always near full scale: measured on episode 93 (`Episodio 58`), asking the
 * server for 300 points gives a median of **255 out of 255**. The drawing is a
 * rectangle and says nothing.
 *
 * Asking for the maximum resolution and averaging down here fixes it without
 * touching the backend: the same episode at 2000 points averaged to 340 bars has
 * a median of 212 and a real shape. Averaging is what makes the difference —
 * taking every Nth point, or asking the server for fewer, both give the peak
 * back.
 *
 * ⚠️ **Only for the whole-episode case.** A clip's slice is already the right
 * resolution and must not be smoothed: its peaks are what make one cut's bar
 * distinguishable from the next.
 */

/** The most `GET /episodes/:id/waveform` will return (root `AGENTS.md`). */
export const MAX_WAVEFORM_POINTS = 2000;

/**
 * Average `peaks` down to `bars` values.
 *
 * Returns the input untouched when it is already at or below the target — an
 * episode with no measured waveform answers with an empty array, and an
 * up-sample would be inventing detail that was never measured.
 */
export function averageToBars(peaks: readonly number[], bars: number): readonly number[] {
  if (bars <= 0) return [];
  if (peaks.length <= bars) return peaks;

  const out: number[] = [];
  for (let i = 0; i < bars; i += 1) {
    const from = Math.floor((i * peaks.length) / bars);
    // ⚠️ `max(from + 1, …)`: with a target close to the input length the two
    // bounds can round to the same index, and an empty slice averages to `NaN`,
    // which draws nothing at all rather than a short bar.
    const to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / bars));

    let sum = 0;
    for (let j = from; j < to; j += 1) sum += peaks[j] ?? 0;
    out.push(Math.round(sum / (to - from)));
  }

  return out;
}
