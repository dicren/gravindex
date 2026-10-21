/**
 * `hh:mm:ss` in both directions — the editor's own clock.
 *
 * The other half of the clock. `formatClipTime` already covers the short `mm:ss`
 * form and its `withHours` flag was written for
 * exactly this caller; the two things it does not do are the two things the
 * editor needs, so they live here:
 *
 * - ⚠️ **A non-finite duration.** `HTMLAudioElement.duration` is `NaN` until the
 *   browser has metadata, and this screen renders the episode's length as soon
 *   as it mounts. `formatClipTime(NaN, true)` prints `NaN:NaN:NaN`; the guard
 *   below prints `--:--:--` instead.
 * - **Reading a timecode back.** The editor keeps every time as a STRING and
 *   only the save turns it into the seconds the API stores — so
 *   `hhmmssToSeconds` is on the hot path of every nudge, every zoom and the
 *   publish itself. Nothing else in the app needs it.
 *
 * ⚠️ `hhmmssToSeconds` must never answer `NaN` for anything unparseable: that
 * would poison every sum downstream in silence (`formatTime(-1)` → `--:--:--` →
 * `NaN` → a clip saved at `NaN` seconds). It answers `null` instead, so the caller
 * has to decide.
 */
import { formatClipTime } from './format-time';

/** Seconds (may be fractional) -> `"hh:mm:ss"`. Negative/non-finite -> `"--:--:--"`. */
export function formatHhmmss(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--:--';
  return formatClipTime(seconds, true);
}

/** `"hh:mm:ss"` or `"mm:ss"` -> integer seconds. `null` when unparseable. */
export function hhmmssToSeconds(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length !== 2 && parts.length !== 3) return null;

  const nums = parts.map((p) => (/^\d+$/.test(p.trim()) ? Number.parseInt(p, 10) : Number.NaN));
  if (nums.some((n) => !Number.isFinite(n))) return null;

  if (nums.length === 3) {
    const [h, m, s] = nums as [number, number, number];
    return h * 3600 + m * 60 + s;
  }
  const [m, s] = nums as [number, number];
  return m * 60 + s;
}
