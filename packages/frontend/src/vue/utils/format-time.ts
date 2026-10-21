/**
 * Clip durations, as the player prints them.
 *
 * Formats both numbers on the player row. The behaviour is deliberate,
 * including the two things that look like accidents and are not:
 *
 * - **The hours field is omitted below one hour.** Clips are cuts — the median
 *   is under two minutes — so `01:32` is what almost every card shows, and
 *   padding it to `00:01:32` would make the common case read like a timestamp.
 *   `withHours` forces the long form for a caller that needs the columns to
 *   line up (the editor's timeline, later).
 * - **A negative input answers `--:--:--`.** This guard is kept
 *   because it is reachable: `elapsed` is derived from an audio element's
 *   `currentTime`, and a stream that has not seeked yet reports a position
 *   *before* the clip's start.
 */
const HOUR_SECONDS = 60 * 60;

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function formatClipTime(seconds: number, withHours = false): string {
  const total = Math.floor(seconds);
  const s = Math.floor(total % 60);
  const m = Math.floor((total / 60) % 60);
  const h = Math.floor(total / HOUR_SECONDS);

  if (s < 0 || m < 0 || h < 0) return '--:--:--';

  const hours = h > 0 || withHours ? `${pad(h)}:` : '';
  return `${hours}${pad(m)}:${pad(s)}`;
}
