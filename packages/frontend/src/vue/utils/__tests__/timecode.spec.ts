import { describe, expect, it } from 'vitest';
import { formatHhmmss, hhmmssToSeconds } from '@/utils/timecode';

/**
 * The editor's clock. ⚠️ The round trip at the bottom is the one that matters:
 * a lossy pair here would publish a clip at a second the user never saw. The
 * editor keeps seconds, but the same property is what lets the view prove that
 * what it stores is what it printed.
 */

describe('formatHhmmss', () => {
  it('pads every segment', () => {
    expect(formatHhmmss(0)).toBe('00:00:00');
    expect(formatHhmmss(9)).toBe('00:00:09');
    expect(formatHhmmss(65)).toBe('00:01:05');
  });

  it('keeps hours for durations over an hour', () => {
    expect(formatHhmmss(3600)).toBe('01:00:00');
    expect(formatHhmmss(3661)).toBe('01:01:01');
    // A real gravina82 episode: 2 h 47 m.
    expect(formatHhmmss(10_020)).toBe('02:47:00');
  });

  it('does not overflow past 24 h', () => {
    expect(formatHhmmss(90_000)).toBe('25:00:00');
  });

  it('floors fractional seconds, as the API stores integers', () => {
    expect(formatHhmmss(59.9)).toBe('00:00:59');
  });

  it('guards negatives and non-finite input', () => {
    // ⚠️ `HTMLAudioElement.duration` is NaN until the browser has metadata, and
    // this screen prints the episode's length from its first render.
    expect(formatHhmmss(-1)).toBe('--:--:--');
    expect(formatHhmmss(Number.NaN)).toBe('--:--:--');
    expect(formatHhmmss(Number.POSITIVE_INFINITY)).toBe('--:--:--');
  });
});

describe('hhmmssToSeconds', () => {
  it('parses hh:mm:ss', () => {
    expect(hhmmssToSeconds('00:00:00')).toBe(0);
    expect(hhmmssToSeconds('01:01:01')).toBe(3661);
    expect(hhmmssToSeconds('02:47:00')).toBe(10_020);
    expect(hhmmssToSeconds('25:00:00')).toBe(90_000);
  });

  it('parses the two-segment mm:ss form', () => {
    expect(hhmmssToSeconds('01:05')).toBe(65);
  });

  it('returns null instead of NaN for junk', () => {
    expect(hhmmssToSeconds('')).toBeNull();
    expect(hhmmssToSeconds('abc')).toBeNull();
    expect(hhmmssToSeconds('1:2:3:4')).toBeNull();
    expect(hhmmssToSeconds('--:--:--')).toBeNull();
    expect(hhmmssToSeconds('-1:00:00')).toBeNull();
  });
});

describe('round trip', () => {
  it('is lossless for integer seconds', () => {
    for (const s of [0, 1, 59, 60, 599, 3600, 3661, 10_020, 86_399, 90_000]) {
      expect(hhmmssToSeconds(formatHhmmss(s))).toBe(s);
    }
  });
});
