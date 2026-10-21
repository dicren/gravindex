import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  resetAudioElementFactory,
  setAudioElementFactory,
  usePlaybackStore,
  type PlaybackAudio,
} from '../playback.store';
import {
  clipKey,
  episodeKey,
  useQueueStore,
  type QueuedClip,
  type QueuedEpisode,
} from '../queue.store';

/**
 * The queue: what plays, what comes next, and how to get back to it tomorrow.
 *
 * ⚠️ The rules under test are deliberate, and several of them are only obvious
 * once you know why:
 *
 * - **Queueing into an EMPTY queue starts playing.** Not a convenience — with
 *   no play button on a row, a first visit that merely filled a list would begin
 *   in silence and look broken.
 * - **A clip that ends advances**, rather than stopping.
 * - **Removing the clip that is PLAYING moves playback on**, rather than leaving
 *   the player showing something no longer in the queue.
 * - **Dragging never changes what is playing**, only what comes after.
 * - **Ids only in `localStorage`**, and losing them is not an error.
 */

class FakeAudio implements PlaybackAudio {
  src = '';
  currentTime = 0;
  playCalls = 0;
  pauseCalls = 0;
  private readonly listeners = new Map<string, (() => void)[]>();

  play(): Promise<void> {
    this.playCalls += 1;
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls += 1;
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: 'timeupdate' | 'canplay' | 'ended' | 'durationchange'): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  advanceTo(seconds: number): void {
    this.currentTime = seconds;
    this.emit('timeupdate');
  }
}

const playCounter = vi.hoisted(() => ({ execute: vi.fn() }));

/** ⚠️ `POST /clips/:id/play`. Mocked to be counted, and because the real one
 *  would reach for `fetch` — which `vitest.setup.ts` makes throw on purpose. */
vi.mock('#/config/clips.config', () => ({ registerPlayUseCase: playCounter }));

const STORAGE_KEY = 'gravindex.queue';

function episode(id: number, over: Partial<QueuedEpisode> = {}): QueuedEpisode {
  return {
    kind: 'episode',
    id,
    title: `Episodio ${id}`,
    end: 3600,
    src: `https://example.test/episodes/${id}.mp3`,
    cover: 'https://example.test/cover.jpg',
    ...over,
  };
}

function clip(id: number, over: Partial<QueuedClip> = {}): QueuedClip {
  return {
    kind: 'clip',
    id,
    title: `Corte ${id}`,
    start: 100,
    end: 160,
    src: 'https://example.test/episodes/42.mp3',
    episodeId: 42,
    episodeTitle: 'Episodio 42',
    cover: 'https://example.test/cover.jpg',
    up: 3,
    ...over,
  };
}

let audio: FakeAudio;

beforeEach(() => {
  localStorage.clear();
  playCounter.execute.mockClear();
  setActivePinia(createPinia());
  audio = new FakeAudio();
  setAudioElementFactory(() => audio);
});

afterEach(() => resetAudioElementFactory());

describe('queueing', () => {
  /**
   * ⚠️ **The derived rule that makes a row without a play button work at all.**
   * With a global player, "queue" is the only verb a row has.
   */
  it('starts playing when the queue was empty', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();

    queue.enqueue(clip(1));

    expect(queue.keys).toEqual([clipKey(1)]);
    expect(queue.currentIndex).toBe(0);
    expect(playback.isPlaying(1)).toBe(true);
    expect(audio.currentTime).toBe(100);
  });

  it('only appends once something is already playing', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();

    queue.enqueue(clip(1));
    queue.enqueue(clip(2));

    expect(queue.keys).toEqual([clipKey(1), clipKey(2)]);
    // ⚠️ Still the first one: queueing a second clip must not interrupt what
    // the visitor is listening to.
    expect(playback.currentClipId).toBe(1);
  });

  it('is a no-op for a clip already in the queue', () => {
    const queue = useQueueStore();

    queue.enqueue(clip(1));
    queue.enqueue(clip(2));
    queue.enqueue(clip(1));

    expect(queue.keys).toEqual([clipKey(1), clipKey(2)]);
    expect(queue.contains(1)).toBe(true);
  });

  it('reports its size and total running time from what it has resolved', () => {
    const queue = useQueueStore();

    queue.enqueue(clip(1, { start: 0, end: 90 }));
    queue.enqueue(clip(2, { start: 0, end: 30 }));

    expect(queue.size).toBe(2);
    expect(queue.totalSeconds).toBe(120);
    expect(queue.isEmpty).toBe(false);
  });
});

/**
 * ⚠️ **`playNow` is not `enqueue`, and the permalink is why.** `Escuchar` used
 * to go through `enqueue`, which appends and only starts playback when the
 * queue was empty: anybody with something already queued pressed the one button
 * on that screen that says "listen" and heard nothing, while a row was silently
 * added to the end of a list on another page (fixed 2026-08-19).
 */
describe('playing one clip now', () => {
  it('slots the clip in after the current one and plays it', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();

    queue.enqueue(clip(1));
    queue.enqueue(clip(2));
    queue.enqueue(clip(3));

    queue.playNow(clip(9, { start: 5, end: 25 }));

    // ⚠️ Interrupted, not replaced: everything queued after it still follows.
    expect(queue.keys).toEqual([clipKey(1), clipKey(9), clipKey(2), clipKey(3)]);
    expect(queue.currentIndex).toBe(1);
    expect(playback.isPlaying(9)).toBe(true);
    expect(audio.currentTime).toBe(5);
  });

  it('plays a clip already in the queue where it stands', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();

    queue.enqueue(clip(1));
    queue.enqueue(clip(2));
    queue.enqueue(clip(3));

    queue.playNow(clip(3));

    // ⚠️ **Not moved.** Reordering somebody's queue as a side effect of
    // pressing play would rearrange the one list on this site people arrange
    // by hand.
    expect(queue.keys).toEqual([clipKey(1), clipKey(2), clipKey(3)]);
    expect(queue.currentIndex).toBe(2);
    expect(playback.isPlaying(3)).toBe(true);
  });

  it('starts an untouched queue at the front', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();

    queue.playNow(clip(7));

    // ⚠️ With nothing loaded, `currentIndex` is -1 and "after the current one"
    // is position 0 — which is what "next" means when there is no current.
    expect(queue.keys).toEqual([clipKey(7)]);
    expect(queue.currentIndex).toBe(0);
    expect(playback.isPlaying(7)).toBe(true);
  });
});

describe('advancing', () => {
  it('plays the next clip when one runs out', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    queue.enqueue(clip(1));
    queue.enqueue(clip(2, { start: 300, end: 320 }));

    audio.advanceTo(160);

    expect(playback.currentClipId).toBe(2);
    expect(queue.currentIndex).toBe(1);
    expect(playback.playing).toBe(true);
  });

  // ⚠️ Does not loop and does not autoplay anything outside the queue: the last
  // clip ending is the end.
  it('stops at the end of the last clip', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    queue.enqueue(clip(1));

    audio.advanceTo(160);

    expect(playback.playing).toBe(false);
    expect(queue.currentIndex).toBe(0);
  });

  it('has a next button that does the same thing', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    queue.enqueue(clip(1));
    queue.enqueue(clip(2));

    expect(queue.hasNext).toBe(true);
    queue.next();

    expect(playback.currentClipId).toBe(2);
    expect(queue.hasNext).toBe(false);
  });
});

describe('removing', () => {
  it('moves playback on when the clip removed was the one playing', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    queue.enqueue(clip(1));
    queue.enqueue(clip(2));

    queue.remove(clipKey(1));

    expect(queue.keys).toEqual([clipKey(2)]);
    expect(playback.currentClipId).toBe(2);
  });

  it('stops when the clip removed was the last one playing', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    queue.enqueue(clip(1));

    queue.remove(clipKey(1));

    expect(queue.isEmpty).toBe(true);
    expect(playback.current).toBeNull();
  });

  // ⚠️ What is playing must not change because a row ABOVE it went away.
  it('keeps the same clip playing when something before it is removed', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    queue.enqueue(clip(1));
    queue.enqueue(clip(2));
    queue.enqueue(clip(3));
    queue.next();

    queue.remove(clipKey(1));

    expect(playback.currentClipId).toBe(2);
    expect(queue.currentIndex).toBe(0);
  });

  it('clears the list AND stops playback', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    queue.enqueue(clip(1));
    queue.enqueue(clip(2));

    queue.clear();

    // ⚠️ A player still going over an empty queue is the state nobody can
    // explain.
    expect(queue.isEmpty).toBe(true);
    expect(playback.current).toBeNull();
    expect(playback.playing).toBe(false);
  });
});

describe('reordering', () => {
  it('moves a clip without changing what is playing', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    queue.enqueue(clip(1));
    queue.enqueue(clip(2));
    queue.enqueue(clip(3));

    queue.move(2, 0);

    expect(queue.keys).toEqual([clipKey(3), clipKey(1), clipKey(2)]);
    // ⚠️ The index follows the CLIP, not the number.
    expect(queue.currentIndex).toBe(1);
    expect(playback.currentClipId).toBe(1);
  });

  it('does nothing for a move that goes nowhere', () => {
    const queue = useQueueStore();
    queue.enqueue(clip(1));
    queue.enqueue(clip(2));

    queue.move(0, 0);
    queue.move(9, 0);

    expect(queue.keys).toEqual([clipKey(1), clipKey(2)]);
  });

  it('clamps a move past the end', () => {
    const queue = useQueueStore();
    queue.enqueue(clip(1));
    queue.enqueue(clip(2));

    queue.move(0, 99);

    expect(queue.keys).toEqual([clipKey(2), clipKey(1)]);
  });
});

/**
 * ⚠️ **`/cola`'s split between "already sounded" and everything else**
 * (2026-08-19). Nothing here decides what to show — that is the view's job —
 * but the store draws the line: `currentIndex` is it, `played` is strictly
 * before it, `upcoming` is at or after it, and the two together are always
 * `rows` again with nothing lost or duplicated.
 */
describe('history split (played/upcoming)', () => {
  it('puts everything before currentIndex in played, the rest in upcoming', () => {
    const queue = useQueueStore();
    queue.enqueue(clip(1));
    queue.enqueue(clip(2));
    queue.enqueue(clip(3));
    queue.playAt(1);

    expect(queue.played.map((row) => row.item.id)).toEqual([1]);
    expect(queue.upcoming.map((row) => row.item.id)).toEqual([2, 3]);
    // The clip playing is always the first upcoming row.
    expect(queue.upcoming[0]?.item.id).toBe(queue.current?.id);
  });

  it('has nothing played with nothing loaded', () => {
    // A stored index the sanity check in `readStoredQueue` had to reject —
    // out of range for `ids` — comes back as `currentIndex: -1` with `ids`
    // still full, the same "nothing loaded, but not empty" shape a fresh
    // store can genuinely start in.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ids: [1, 2], index: 99 }));
    const queue = useQueueStore();
    queue.remember(clip(1));
    queue.remember(clip(2));

    expect(queue.currentIndex).toBe(-1);
    expect(queue.played).toEqual([]);
    expect(queue.upcoming.map((row) => row.item.id)).toEqual([1, 2]);
  });

  it('carries the real position from `ids`, not a position within what is resolved', () => {
    // The hydration case: an id in the middle is still being fetched, so
    // `entries` has a gap `rows` must not close by re-numbering around it.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ids: [1, 2, 3], index: 2 }));
    const queue = useQueueStore();
    queue.remember(clip(1));
    // id 2 is deliberately never resolved.
    queue.remember(clip(3));

    expect(queue.rows.map((row) => row.index)).toEqual([0, 2]);
    expect(queue.played.map((row) => row.index)).toEqual([0]);
    expect(queue.upcoming.map((row) => row.index)).toEqual([2]);
  });

  it('shrinks played as playback moves backwards into it', () => {
    const queue = useQueueStore();
    queue.enqueue(clip(1));
    queue.enqueue(clip(2));
    queue.enqueue(clip(3));
    queue.playAt(2);
    expect(queue.played).toHaveLength(2);

    queue.playAt(0);

    expect(queue.played).toEqual([]);
    expect(queue.upcoming.map((row) => row.item.id)).toEqual([1, 2, 3]);
  });
});

describe('persistence', () => {
  /**
   * ⚠️ **Keys, the index and the position inside the current item — and nothing
   * else.** No titles, no audio URLs, no vote counts: a title edited or a clip
   * deleted through the admin surface would otherwise leave a stale copy on
   * somebody's machine forever, and a queue is a list of public ids anyway.
   *
   * ⚠️ `at` is `0` here because nothing has played for five seconds yet. What it
   * means when it is not, and why it is written at all, is the group at the
   * bottom of this file.
   */
  it('writes keys, the index and the position, and nothing else', () => {
    const queue = useQueueStore();
    queue.enqueue(clip(1));
    queue.enqueue(clip(2));

    const raw = localStorage.getItem(STORAGE_KEY) ?? '';
    expect(JSON.parse(raw)).toEqual({ keys: ['c1', 'c2'], index: 0, at: 0 });
    expect(raw).not.toContain('Corte 1');
    expect(raw).not.toContain('example.test');
  });

  /**
   * ⚠️ **The pre-2026-08-25 shape, and it must keep loading.** Everything
   * written before an episode could be queued is an array of bare numbers, and
   * every one of those numbers is a clip. Reading it as anything else — or not
   * reading it — would empty the queue of everyone who had one when the change
   * shipped.
   */
  it('reads previously stored `ids` data as clips', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ids: [7, 8], index: 1 }));

    const queue = useQueueStore();

    expect(queue.keys).toEqual([clipKey(7), clipKey(8)]);
    expect(queue.currentIndex).toBe(1);
  });

  it('reads the queue back on a cold start', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ keys: ['c7', 'c8'], index: 1 }));

    const queue = useQueueStore();

    expect(queue.keys).toEqual([clipKey(7), clipKey(8)]);
    expect(queue.currentIndex).toBe(1);
    // ⚠️ Nothing is RESOLVED yet — the ids are all the store has, and turning
    // them back into clips is the delivery layer's job.
    expect(queue.items).toEqual([]);
    expect(queue.current).toBeNull();
  });

  it.each([
    ['not JSON at all', 'nonsense'],
    ['JSON that is not an object', '"nope"'],
    ['an object with no keys', '{"index":3}'],
    ['keys that are neither', '{"keys":[true,null],"index":0}'],
    ['an index past the end', '{"keys":["c1"],"index":9}'],
    ['a key with no kind', '{"keys":["1"],"index":0}'],
    ['a key of an unknown kind', '{"keys":["x1"],"index":0}'],
    ['a position that is not a number', '{"keys":["c1"],"index":0,"at":"20"}'],
    ['a position before the file starts', '{"keys":["c1"],"index":0,"at":-30}'],
  ])('survives %s', (_label, stored) => {
    localStorage.setItem(STORAGE_KEY, stored);

    expect(() => useQueueStore()).not.toThrow();
  });

  it('drops non-positive ids rather than repairing them', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ids: [1, 0, -3, 2.5, 2], index: 0 }));

    expect(useQueueStore().keys).toEqual([clipKey(1), clipKey(2)]);
  });

  it('drops malformed keys rather than repairing them', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ keys: ['c1', 'c0', 'e-2', 'zzz', 'e93', 'c1'], index: 0 }),
    );

    // ⚠️ `c1` twice collapses to one: the queue has no duplicates anywhere else
    // either, and a hand-edited value is exactly where one would come from.
    expect(useQueueStore().keys).toEqual([clipKey(1), episodeKey(93)]);
  });

  /**
   * ⚠️ **Reading the property itself can throw** — Safari with "block all
   * cookies", a sandboxed iframe — so the access is inside the `try`, not just
   * the call. An empty queue is a working app; a throw at module scope is a
   * blank page.
   */
  it('starts empty when localStorage throws on access', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });

    try {
      const queue = useQueueStore();
      expect(queue.keys).toEqual([]);
      // ...and writing must not throw either.
      expect(() => queue.enqueue(clip(1))).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
    }
  });
});

describe('an id that no longer resolves', () => {
  // ⚠️ Silent by contract: a clip deleted through the admin surface must not
  // leave a 404 in somebody's queue, and the visitor did nothing wrong.
  it('is forgotten without a trace', () => {
    const queue = useQueueStore();
    queue.enqueue(clip(1));
    queue.enqueue(clip(2));

    queue.forget(clipKey(2));

    expect(queue.keys).toEqual([clipKey(1)]);
    expect(queue.entries.has(clipKey(2))).toBe(false);
  });
});

describe('a shared queue', () => {
  it('appends to the end without disturbing what is playing', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    queue.enqueue(clip(1));

    queue.enqueueMany([clip(5), clip(6)]);

    expect(queue.keys).toEqual([clipKey(1), clipKey(5), clipKey(6)]);
    expect(playback.currentClipId).toBe(1);
  });

  it('replaces the whole queue when asked to', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    queue.enqueue(clip(1));

    queue.replaceWith([clip(5), clip(6)]);

    expect(queue.keys).toEqual([clipKey(5), clipKey(6)]);
    // The first of the new ones starts, by the same empty-queue rule.
    expect(playback.currentClipId).toBe(5);
  });
});

describe('the transport a component drives', () => {
  it('pauses and resumes the clip that is playing', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    queue.enqueue(clip(1));

    queue.togglePlayback();
    expect(playback.playing).toBe(false);

    queue.togglePlayback();
    expect(playback.playing).toBe(true);
    expect(playback.currentClipId).toBe(1);
  });

  it('starts the queue from the beginning when nothing is loaded', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ids: [1], index: -1 }));
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    queue.remember(clip(1));

    queue.togglePlayback();

    expect(playback.currentClipId).toBe(1);
  });

  it('does nothing at all with an empty queue', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();

    queue.togglePlayback();

    expect(playback.current).toBeNull();
  });

  it('plays a row by its position, and pauses it on a second press', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    queue.enqueue(clip(1));
    queue.enqueue(clip(2));

    queue.toggleAt(1);
    expect(playback.currentClipId).toBe(2);

    queue.toggleAt(1);
    expect(playback.playing).toBe(false);
  });
});

describe('the vote count the player shows', () => {
  // The player reads its number from here, not from a query cache — which is
  // why `useVoteClip` patches this store as well.
  it('is replaced wholesale by `remember`', () => {
    const queue = useQueueStore();
    queue.enqueue(clip(1, { up: 3 }));

    queue.remember({ ...clip(1), up: 4 });

    // ⚠️ `current` is a `QueuedItem` now, and only a clip has a vote count.
    expect(queue.current).toMatchObject({ kind: 'clip', up: 4 });
    expect(queue.keys).toEqual([clipKey(1)]);
  });
});

describe('what this store is not', () => {
  /**
   * ⚠️ The split that keeps `playback.store` testable with four numbers and a
   * string: order and persistence here, one audio element there. A queue that
   * started reaching for the element directly would work, and would put two
   * things in charge of one resource.
   *
   * ⚠️ Comments stripped first — this file EXPLAINS at length that it owns no
   * audio, so matching the raw text matches the explanation and fails on the
   * wording. Same reasoning as `code()` in the theme spec.
   */
  it('never touches an audio element itself', () => {
    // ⚠️ `dirname(fileURLToPath(import.meta.url))` and NOT
    // `new URL('…', import.meta.url)`: Vite treats that second form as a static
    // ASSET reference and rewrites it into a served URL, so the path arrives as
    // `http://localhost/…` and `readFileSync` rejects it. Same trick as
    // `app-shell.spec.ts` and the theme spec.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../queue.store.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    expect(source).not.toMatch(/new Audio\(/);
    expect(source).not.toMatch(/currentTime/);
    expect(source).not.toMatch(/addEventListener/);
  });
});

// A guard on the wiring that makes "a clip ended" mean "play the next one": the
// queue store registers itself with the playback store on creation, and a
// refactor that drops that line breaks advancing with nothing else failing.
it('registers itself as the playback store’s end-of-clip handler', () => {
  const playback = usePlaybackStore();
  const spy = vi.spyOn(playback, 'setEndedHandler');

  useQueueStore();

  expect(spy).toHaveBeenCalledTimes(1);
});

/**
 * A whole episode is a queue item like any other (2026-08-25) — the decision
 * `/episode/:id` is built on. What makes it interesting is that it is NOT a
 * clip: it shares the id space with one, it has no play counter, and it does
 * not fit in a share link.
 */
describe('a whole episode in the queue', () => {
  it('queues and plays like anything else', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();

    queue.enqueue(episode(93));

    expect(queue.keys).toEqual([episodeKey(93)]);
    expect(queue.current).toMatchObject({ kind: 'episode', id: 93 });
    // ⚠️ From the top, and to the measured end — an episode has no `start`.
    expect(playback.current).toEqual({
      kind: 'episode',
      id: 93,
      src: 'https://example.test/episodes/93.mp3',
      start: 0,
      end: 3600,
    });
    expect(playback.playing).toBe(true);
  });

  /**
   * ⚠️ **The reason the queue is keyed by kind at all.** Clip 93 and episode 93
   * both exist; under bare ids the second one queued would be swallowed as a
   * duplicate of the first, and whichever was resolved last would decide what
   * both rows drew.
   */
  it('does not collide with the clip of the same id', () => {
    const queue = useQueueStore();

    queue.enqueue(clip(93));
    queue.enqueue(episode(93));

    expect(queue.keys).toEqual([clipKey(93), episodeKey(93)]);
    expect(queue.size).toBe(2);
    expect(queue.contains(93)).toBe(true);
    expect(queue.containsEpisode(93)).toBe(true);

    // ...and removing one leaves the other alone.
    queue.remove(clipKey(93));
    expect(queue.keys).toEqual([episodeKey(93)]);
    expect(queue.contains(93)).toBe(false);
    expect(queue.containsEpisode(93)).toBe(true);
  });

  /**
   * ⚠️ **No `POST /clips/:id/play` for an episode.** There is no episode counter
   * on the wire, and passing an episode id to the clip one would write rows
   * against whatever clip happens to share the number.
   */
  it('counts a play for a clip and not for an episode', () => {
    const queue = useQueueStore();

    queue.enqueue(clip(7));
    expect(playCounter.execute).toHaveBeenCalledWith(7);

    playCounter.execute.mockClear();
    queue.playNow(episode(7));
    expect(playCounter.execute).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ **`?c=` is clip ids only** — two base62 characters each, no room for a
   * kind, and the format is a public URL shape. `/cola` says so before anyone
   * copies the link; this is the number it says it from.
   */
  it('leaves episodes out of what a share link can carry', () => {
    const queue = useQueueStore();

    queue.enqueue(clip(137));
    queue.enqueue(episode(93));
    queue.enqueue(clip(43));

    expect(queue.shareableClipIds).toEqual([137, 43]);
  });

  /** An episode nothing has measured queues with `end: 0`, which the playback
   *  store reads as "until the file runs out". It must not be repaired here. */
  it('keeps an unmeasured episode at zero rather than inventing a length', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();

    queue.enqueue(episode(594, { end: 0 }));

    expect(playback.current).toMatchObject({ end: 0 });
    expect(queue.totalSeconds).toBe(0);
  });

  it('survives a reload with the episode still in it', () => {
    const first = useQueueStore();
    first.enqueue(clip(1));
    first.enqueue(episode(93));

    setActivePinia(createPinia());
    expect(useQueueStore().keys).toEqual([clipKey(1), episodeKey(93)]);
  });

  /** ⚠️ The end of an episode advances the queue exactly like the end of a
   *  clip: the handover is `playback.setEndedHandler`, and it knows nothing
   *  about kinds. */
  it('advances to the next item when the episode runs out', () => {
    const queue = useQueueStore();
    queue.enqueue(episode(93));
    queue.enqueue(clip(2));

    audio.emit('ended');

    expect(queue.currentIndex).toBe(1);
    expect(queue.current).toMatchObject({ kind: 'clip', id: 2 });
  });
});

/**
 * **Where you were listening, kept between visits** (2026-08-26).
 *
 * ⚠️ **This group reverses a decision this file used to assert.** The queue
 * stored keys and an index and deliberately no position, on the grounds that "a
 * queue that half-remembers is worse than one that does not". The lengths are
 * what changed the answer: the median clip runs two minutes, one in ten past
 * seven, and a whole EPISODE — three hours — has been a queue item since
 * 2026-08-25. Starting that again at `00:00` tomorrow loses your place.
 *
 * The half-remembering the old note feared is answered by an invariant rather
 * than by hope: **`at` always describes `keys[index]`**, written in the same
 * call, so the queue can never point at one item and the position at another.
 * Most of what follows is that invariant, from each of the sides that could
 * break it.
 */
describe('where you were listening', () => {
  function storedQueue(): { keys: string[]; index: number; at: number } {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  }

  /** A queue somebody left behind yesterday: one clip, twenty seconds in. */
  function leftAt(seconds: number, key = 'c1'): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ keys: [key], index: 0, at: seconds }));
  }

  it('writes the position of what is playing, in whole seconds', () => {
    const queue = useQueueStore();
    queue.enqueue(clip(1));

    audio.advanceTo(clip(1).start + 21.7);

    expect(storedQueue()).toEqual({ keys: ['c1'], index: 0, at: 21 });
  });

  /**
   * ⚠️ **Every five seconds of AUDIO, not on a timer.** `timeupdate` fires about
   * four times a second and there is no interval to start, stop or leak — the
   * store reaches for `localStorage` only when the number it would write has
   * actually moved. A seek moves it by more than five in one tick, so it is
   * written at once, which is when somebody most expects it to be remembered.
   */
  it('does not write on every tick of the stream', () => {
    const queue = useQueueStore();
    queue.enqueue(clip(1));
    const writes = vi.spyOn(Storage.prototype, 'setItem');

    for (const second of [1, 2, 3, 4]) audio.advanceTo(clip(1).start + second);
    expect(writes).not.toHaveBeenCalled();

    audio.advanceTo(clip(1).start + 6);
    expect(writes).toHaveBeenCalledTimes(1);

    writes.mockRestore();
  });

  /** ⚠️ Three seconds in is the beginning, not a place — and the playback store
   *  refuses to restore one anyway (`MIN_RESUME_SECONDS`), so writing it would
   *  be storing a number nothing will ever read. */
  it('leaves the first seconds of an item alone', () => {
    const queue = useQueueStore();
    queue.enqueue(clip(1));

    audio.advanceTo(clip(1).start + 3);

    expect(storedQueue().at).toBe(0);
  });

  /** ⚠️ A deliberate pause is the clearest "I am leaving, and this is where I
   *  was" anybody gives this app: the throttle above is skipped so the number
   *  written is exact. */
  it('is exact about a pause', () => {
    const queue = useQueueStore();
    queue.enqueue(clip(1));
    audio.advanceTo(clip(1).start + 6);
    audio.advanceTo(clip(1).start + 9);
    expect(storedQueue().at).toBe(6);

    queue.togglePlayback();

    expect(storedQueue().at).toBe(9);
  });

  /**
   * The whole point, from the other end: a browser that was closed mid-clip
   * opens the element where it was, not at the cut's start.
   */
  it('hands the position back to the element on a cold start', () => {
    leftAt(20);
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    queue.remember(clip(1));

    queue.togglePlayback();

    expect(audio.currentTime).toBe(clip(1).start + 20);
    expect(playback.elapsed).toBe(20);
    // ⚠️ And the clip still stops where it always did: `start` is untouched, so
    // `duration` is the cut's own length rather than what is left of it.
    expect(playback.duration).toBe(60);
  });

  /**
   * ⚠️ **The bug this shape exists to prevent.** Persistence runs on every
   * enqueue, and a visitor who comes back and adds a clip to the queue before
   * pressing play would otherwise have their position overwritten with the `0`
   * of a player holding nothing.
   */
  it('survives an enqueue made before anybody pressed play', () => {
    leftAt(20);
    const queue = useQueueStore();

    queue.enqueue(clip(2));

    expect(storedQueue()).toEqual({ keys: ['c1', 'c2'], index: 0, at: 20 });
  });

  /**
   * ⚠️ **One number, and it belongs to whatever the queue points at.** Coming
   * back and starting something else is a decision to start something else —
   * the write that follows files this session's position under the key it
   * belongs to, and there is nothing left for the old one to describe.
   */
  it('moves to whatever the queue points at, and leaves nothing behind', () => {
    leftAt(20);
    const queue = useQueueStore();
    queue.remember(clip(1));
    queue.remember(clip(2));
    queue.keys = [clipKey(1), clipKey(2)];

    queue.playAt(1);
    expect(storedQueue()).toEqual({ keys: ['c1', 'c2'], index: 1, at: 0 });

    queue.playAt(0);
    expect(audio.currentTime).toBe(clip(1).start);
  });

  /**
   * ⚠️ **The editor stops the player and the queue keeps the place.**
   * `utils/editor-audio.ts` asks this store's player to stop on the way into
   * `/creator/:id`, so the queue is left pointing at an episode the player is no
   * longer holding — and cutting a clip out of an episode is something people do
   * *while listening to it*. Reading `elapsed` there would file a zero; the
   * position is remembered against the key instead.
   */
  it('survives the player being stopped under it', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    queue.enqueue(episode(93));
    audio.advanceTo(1800);
    expect(storedQueue().at).toBe(1800);

    playback.stop();
    expect(storedQueue().at).toBe(1800);

    // ...and pressing play again picks it up, without a reload in between.
    queue.togglePlayback();
    expect(audio.currentTime).toBe(1800);
  });

  /** ⚠️ Something that finished has no place to be resumed from, and `rewind()`
   *  has already said so by putting `elapsed` back to zero before the queue
   *  advances. */
  it('forgets the position of an item that ran out', () => {
    const queue = useQueueStore();
    queue.enqueue(clip(1));
    queue.enqueue(clip(2));
    audio.advanceTo(clip(1).start + 30);
    expect(storedQueue().at).toBe(30);

    audio.advanceTo(clip(1).end);

    expect(storedQueue()).toEqual({ keys: ['c1', 'c2'], index: 1, at: 0 });
  });

  /** ⚠️ Every one of these is reachable without anybody doing anything wrong:
   *  the value is hand-edited, and a browser that was closed mid-write leaves
   *  whatever it left. A position that does not parse is the beginning. */
  it.each([
    ['a position that is not a number', '"20"', 0],
    ['a position before the file starts', '-30', 0],
    ['a position inside the first seconds', '3', 0],
    ['a position with decimals', '20.9', 20],
  ])('reads %s as %s seconds in', (_label, stored, expected) => {
    localStorage.setItem(STORAGE_KEY, `{"keys":["c1"],"index":0,"at":${stored}}`);
    const queue = useQueueStore();
    queue.remember(clip(1));

    queue.togglePlayback();

    expect(audio.currentTime).toBe(clip(1).start + expected);
  });

  /** ⚠️ `at` describes `keys[index]`, so an index that did not survive the read
   *  takes the position down with it rather than handing it to whatever lands
   *  at that position next. */
  it('drops a position whose index did not survive the read', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ keys: ['c1'], index: 9, at: 30 }));
    const queue = useQueueStore();
    queue.remember(clip(1));
    expect(queue.currentIndex).toBe(-1);

    queue.togglePlayback();

    expect(audio.currentTime).toBe(clip(1).start);
  });
});
