import { describe, expect, it } from 'vitest';
import {
  decodeQueueCode,
  encodeQueueCode,
  MAX_SHAREABLE_CLIPS,
  MAX_SHAREABLE_ID,
  QUEUE_CODE_PARAM,
} from '../queue-code';

/**
 * Sharing a queue as a string in a URL.
 *
 * ⚠️ **The worked example from the design is the first test**, character for
 * character: `[137, 107, 43, 178, 147]` → `2D1j0h2s2N`.
 * If that ever changes, every link already
 * shared stops meaning what it meant — which is the whole reason the encoding
 * is fixed-width and separator-free rather than "some compression".
 */

describe('encodeQueueCode', () => {
  it('produces the design’s worked example exactly', () => {
    expect(encodeQueueCode([137, 107, 43, 178, 147])).toBe('2D1j0h2s2N');
  });

  it('is two characters per id, in queue order, with no separators', () => {
    const code = encodeQueueCode([1, 2, 3]);

    expect(code).toHaveLength(6);
    expect(decodeQueueCode(code)).toEqual([1, 2, 3]);
  });

  it('beats a comma-separated list, which is the point', () => {
    const ids = [137, 107, 43, 178, 147];

    // 26 characters once the commas are percent-escaped.
    expect(encodeQueueCode(ids).length).toBeLessThan(encodeURIComponent(ids.join(',')).length);
  });

  it('answers an empty string for an empty queue', () => {
    expect(encodeQueueCode([])).toBe('');
  });

  /**
   * ⚠️ **Fifty, and the cap is deliberate.** A hundred characters is still a
   * link somebody can paste into a message; beyond that it is a file pretending
   * to be a link.
   */
  it('caps the link at fifty clips', () => {
    const ids = Array.from({ length: 80 }, (_, i) => i + 1);

    expect(encodeQueueCode(ids)).toHaveLength(MAX_SHAREABLE_CLIPS * 2);
    expect(decodeQueueCode(encodeQueueCode(ids))).toHaveLength(MAX_SHAREABLE_CLIPS);
  });

  // ⚠️ Skipped rather than truncating the rest: one impossible id must not
  // silently shorten the queue at the point it appears.
  it('skips an id the encoding cannot carry, and keeps the others', () => {
    expect(decodeQueueCode(encodeQueueCode([1, MAX_SHAREABLE_ID + 1, 2]))).toEqual([1, 2]);
  });

  it('covers ids far past anything that exists', () => {
    // 3843, against a largest real id of 182 and roughly ten new clips a year.
    expect(MAX_SHAREABLE_ID).toBe(3843);
    expect(decodeQueueCode(encodeQueueCode([MAX_SHAREABLE_ID]))).toEqual([MAX_SHAREABLE_ID]);
  });
});

describe('decodeQueueCode', () => {
  it('round-trips every id it can carry', () => {
    const ids = [1, 61, 62, 63, 182, 999, MAX_SHAREABLE_ID];

    expect(decodeQueueCode(encodeQueueCode(ids))).toEqual(ids);
  });

  /**
   * ⚠️ **Never throws.** A code arrives from a URL somebody may have edited,
   * truncated in a chat client or typed by hand, and the honest answer to a
   * broken one is whatever prefix still parses — not a crash on a screen the
   * visitor did not ask for.
   */
  it.each(['', 'x', '!!', '2D1j0h2s2', 'ñ', '  '])('survives the malformed code %p', (code) => {
    expect(() => decodeQueueCode(code)).not.toThrow();
    expect(Array.isArray(decodeQueueCode(code))).toBe(true);
  });

  it('drops a dangling half-group rather than reading it as a zero', () => {
    // A truncated link: five ids' worth plus one stray character.
    expect(decodeQueueCode('2D1j0h2s2N2')).toEqual([137, 107, 43, 178, 147]);
  });

  it('stops at the first character outside the alphabet', () => {
    expect(decodeQueueCode('2D**1j')).toEqual([137]);
  });

  // Id 0 does not exist — postgres sequences start at 1 — so `00` is a
  // malformed code rather than a clip.
  it('never yields id 0', () => {
    expect(decodeQueueCode('0000')).toEqual([]);
  });

  it('collapses duplicates, because a queue has none', () => {
    expect(decodeQueueCode(encodeQueueCode([5, 5, 6]))).toEqual([5, 6]);
  });
});

describe('the parameter name', () => {
  // ⚠️ One character on purpose: if ids ever pass 3843, a future `c3=` with
  // three-character groups can live beside it and old links keep working.
  it('is `c`', () => {
    expect(QUEUE_CODE_PARAM).toBe('c');
  });
});
