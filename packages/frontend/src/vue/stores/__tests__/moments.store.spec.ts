import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import {
  cutWindow,
  listenFrom,
  MAX_MOMENTS,
  MAX_MOMENTS_PER_EPISODE,
  MIN_GAP_SECONDS,
  REACTION_LAG_SECONDS,
  useMomentsStore,
  type Moment,
} from '../moments.store';

/**
 * Mis momentos: the private marks somebody leaves on an episode while listening
 * to it (2026-08-26).
 *
 * ⚠️ The rules under test are the decisions, not the implementation:
 *
 * - **A mark lands where the laugh was, not where the finger was.** The button
 *   is always pressed late, so the stored second carries the reaction lag.
 * - **Two marks at the same laugh are one mark.** Ten seconds apart is 1,5 px on
 *   the map, so the second pin could not be hit even if it were drawn.
 * - **A full store drops its OLDEST mark rather than refusing the new one**, and
 *   says how many it dropped.
 * - **A mark survives the clip cut from it**, carrying its id.
 * - **Nothing here reaches the network**, ever: that is the whole reason the
 *   feature is shaped this way.
 */

const STORAGE_KEY = 'gravindex.moments';

function store(): ReturnType<typeof useMomentsStore> {
  setActivePinia(createPinia());
  return useMomentsStore();
}

function stored(): Moment[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === null ? [] : (JSON.parse(raw) as { moments: Moment[] }).moments;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('marking a moment', () => {
  it('stores the second BEFORE the button was pressed', () => {
    const moments = store();

    const outcome = moments.mark(93, 1000);

    expect(outcome.status).toBe('marked');
    expect(outcome.moment.at).toBe(1000 - REACTION_LAG_SECONDS);
  });

  it('rounds the playhead, which arrives as a float from the audio element', () => {
    const moments = store();

    expect(moments.mark(93, 1000.6).moment.at).toBe(1001 - REACTION_LAG_SECONDS);
  });

  it('never lands before the start of the episode', () => {
    const moments = store();

    // Pressed two seconds in: the lag would put the mark at −2.
    expect(moments.mark(93, 2).moment.at).toBe(0);
  });

  it('refuses a second mark at the same laugh, and hands back the one already there', () => {
    const moments = store();
    const first = moments.mark(93, 1000);

    const again = moments.mark(93, 1000 + MIN_GAP_SECONDS - 1);

    expect(again.status).toBe('too-close');
    expect(again.moment).toEqual(first.moment);
    expect(moments.countFor(93)).toBe(1);
  });

  it('accepts one far enough away', () => {
    const moments = store();
    moments.mark(93, 1000);

    expect(moments.mark(93, 1000 + MIN_GAP_SECONDS).status).toBe('marked');
    expect(moments.countFor(93)).toBe(2);
  });

  it('keeps the same second on two DIFFERENT episodes', () => {
    const moments = store();

    moments.mark(93, 1000);
    moments.mark(99, 1000);

    expect(moments.countFor(93)).toBe(1);
    expect(moments.countFor(99)).toBe(1);
    expect(moments.episodeCount).toBe(2);
  });

  it('writes through to localStorage, sorted by position', () => {
    const moments = store();

    moments.mark(93, 2000);
    moments.mark(93, 1000);

    expect(stored().map((moment) => moment.at)).toEqual([
      1000 - REACTION_LAG_SECONDS,
      2000 - REACTION_LAG_SECONDS,
    ]);
  });
});

describe('the caps', () => {
  it('drops the oldest mark of the episode once it is full, and reports it', () => {
    vi.useFakeTimers();
    const moments = store();

    // The first mark is the oldest by `markedAt`, not by position: it is made
    // first and sits in the middle of the episode.
    vi.setSystemTime(new Date('2026-08-01T10:00:00Z'));
    moments.mark(93, 5000);
    vi.setSystemTime(new Date('2026-08-02T10:00:00Z'));
    for (let index = 1; index < MAX_MOMENTS_PER_EPISODE; index += 1) {
      moments.mark(93, index * 100);
    }
    expect(moments.countFor(93)).toBe(MAX_MOMENTS_PER_EPISODE);

    vi.setSystemTime(new Date('2026-08-03T10:00:00Z'));
    const outcome = moments.mark(93, 9000);

    expect(outcome.status).toBe('marked');
    expect(outcome.status === 'marked' && outcome.evicted).toBe(1);
    expect(moments.countFor(93)).toBe(MAX_MOMENTS_PER_EPISODE);
    // The one that went is the oldest, and the newest is still there.
    expect(moments.forEpisode(93).some((moment) => moment.at === 5000 - REACTION_LAG_SECONDS)).toBe(
      false,
    );
    expect(moments.forEpisode(93).some((moment) => moment.at === 9000 - REACTION_LAG_SECONDS)).toBe(
      true,
    );
  });

  it('never holds more than the global cap, across every episode', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T10:00:00Z'));
    const moments = store();

    // Spread over enough episodes that the per-episode cap never fires.
    for (let index = 0; index <= MAX_MOMENTS; index += 1) {
      vi.setSystemTime(new Date(Date.UTC(2026, 7, 1, 10, 0, index)));
      moments.mark(Math.floor(index / 10) + 1, index * 100);
    }

    expect(moments.total).toBe(MAX_MOMENTS);
  });
});

describe('forgetting one', () => {
  it('removes exactly that mark, on that episode', () => {
    const moments = store();
    const kept = moments.mark(93, 1000).moment;
    const gone = moments.mark(93, 3000).moment;
    moments.mark(99, 3000);

    moments.remove(gone.episodeId, gone.at);

    expect(moments.forEpisode(93)).toEqual([kept]);
    expect(moments.countFor(99)).toBe(1);
    expect(stored()).toHaveLength(2);
  });

  it('does nothing, and writes nothing, for a mark that is not there', () => {
    const moments = store();
    moments.mark(93, 1000);
    localStorage.removeItem(STORAGE_KEY);

    moments.remove(93, 42);

    expect(moments.total).toBe(1);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('a moment that became a clip', () => {
  it('keeps the mark and remembers the clip', () => {
    const moments = store();
    const moment = moments.mark(93, 1000).moment;

    moments.markAsCut(93, moment.at, 137);

    expect(moments.forEpisode(93)[0]?.clipId).toBe(137);
    expect(stored()[0]?.clipId).toBe(137);
  });

  it('leaves the other marks alone', () => {
    const moments = store();
    const first = moments.mark(93, 1000).moment;
    moments.mark(93, 3000);

    moments.markAsCut(93, first.at, 137);

    expect(moments.forEpisode(93).map((moment) => moment.clipId)).toEqual([137, undefined]);
  });
});

describe('what the screens derive from a mark', () => {
  it('starts listening before it, and never before the episode', () => {
    expect(listenFrom({ episodeId: 93, at: 1000, markedAt: 0 })).toBe(980);
    expect(listenFrom({ episodeId: 93, at: 5, markedAt: 0 })).toBe(0);
  });

  it('opens the editor on a window around it', () => {
    expect(cutWindow({ episodeId: 93, at: 1000, markedAt: 0 })).toEqual({ start: 980, end: 1020 });
  });

  it('clamps that window to a measured episode, at both ends', () => {
    expect(cutWindow({ episodeId: 93, at: 10, markedAt: 0 }, 3600)).toEqual({ start: 0, end: 30 });
    expect(cutWindow({ episodeId: 93, at: 3595, markedAt: 0 }, 3600)).toEqual({
      start: 3575,
      end: 3600,
    });
  });

  it('does not clamp against a length nobody knows yet', () => {
    // ⚠️ `0` is the normal state for the nine unmeasured episodes and for any
    // episode before its waveform answers. The editor clamps on `canplay`.
    expect(cutWindow({ episodeId: 93, at: 30, markedAt: 0 }, 0).end).toBe(50);
  });
});

describe('coming back tomorrow', () => {
  it('reads what was written', () => {
    const first = store();
    first.mark(93, 1000);
    first.mark(99, 2000);

    const second = store();

    expect(second.total).toBe(2);
    expect(second.episodeIds).toEqual([93, 99]);
  });

  it('drops entries that are not moments rather than failing to boot', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        moments: [
          { episodeId: 93, at: 100, markedAt: 1 },
          { episodeId: 0, at: 100, markedAt: 1 },
          { episodeId: 93, at: -5, markedAt: 1 },
          { episodeId: 93, at: 2.5, markedAt: 1 },
          'melocotón',
          null,
        ],
      }),
    );

    const moments = store();

    expect(moments.total).toBe(1);
    expect(moments.forEpisode(93)[0]?.at).toBe(100);
  });

  it('keeps a mark whose timestamp is missing — it is only ever printed', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ moments: [{ episodeId: 93, at: 100 }] }));

    expect(store().forEpisode(93)[0]).toEqual({ episodeId: 93, at: 100, markedAt: 0 });
  });

  it('starts empty on corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');

    expect(store().total).toBe(0);
  });

  it('starts empty, and still works, when localStorage throws on access', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });

    try {
      const moments = store();

      expect(moments.total).toBe(0);
      // ⚠️ The mark still happens: it just will not survive a reload, which is
      // the same outcome as never having made one.
      expect(moments.mark(93, 1000).status).toBe('marked');
      expect(moments.countFor(93)).toBe(1);
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
    }
  });
});
