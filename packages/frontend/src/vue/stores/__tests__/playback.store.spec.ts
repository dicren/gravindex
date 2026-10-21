import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  resetAudioElementFactory,
  setAudioElementFactory,
  usePlaybackStore,
  type PlayableItem,
  type PlaybackAudio,
} from '../playback.store';

// The rule — only one clip plays at a time — is asserted here as a property of
// the store, not of a broadcast: there is one audio element, so there is nothing
// to broadcast.

/**
 * A stand-in for `HTMLAudioElement`. Necessary, not convenient: jsdom's
 * `play()` is "not implemented", so a real element cannot be driven at all.
 * It records what the store did to it and can fire the events a browser would.
 */
class FakeAudio implements PlaybackAudio {
  src = '';
  currentTime = 0;
  /** ⚠️ `NaN` before metadata, exactly as a real element reports it. */
  duration = Number.NaN;
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
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(type, [...existing, listener]);
  }

  /** What the browser does while the stream advances. */
  emit(type: 'timeupdate' | 'canplay' | 'ended' | 'durationchange'): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  /** Advance the stream and report it, as a real element would. */
  advanceTo(seconds: number): void {
    this.currentTime = seconds;
    this.emit('timeupdate');
  }
}

const EPISODE = 'https://example.test/episodes/42.mp3';
const OTHER_EPISODE = 'https://example.test/episodes/7.mp3';

const clipA: PlayableItem = { kind: 'clip', id: 1, src: EPISODE, start: 100, end: 130 };
const clipB: PlayableItem = { kind: 'clip', id: 2, src: EPISODE, start: 300, end: 320 };
const clipElsewhere: PlayableItem = { kind: 'clip', id: 3, src: OTHER_EPISODE, start: 10, end: 20 };

/** A whole episode: same episode file as `clipA`, from the top, and with no
 *  `end` of its own — the shape `/episode/:id` queues. */
const wholeEpisode: PlayableItem = { kind: 'episode', id: 42, src: EPISODE, start: 0, end: 0 };

let audio: FakeAudio;

describe('playback.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    audio = new FakeAudio();
    setAudioElementFactory(() => audio);
  });

  afterEach(() => resetAudioElementFactory());

  it('starts with nothing loaded', () => {
    const store = usePlaybackStore();

    expect(store.currentClipId).toBeNull();
    expect(store.playing).toBe(false);
    expect(store.elapsed).toBe(0);
  });

  it('loads the episode mp3 and seeks to the clip start', () => {
    const store = usePlaybackStore();

    store.play(clipA);

    // ⚠️ A clip has no audio file of its own: the source is the episode's
    // remote mp3, seeked to the cut.
    expect(audio.src).toBe(EPISODE);
    expect(audio.currentTime).toBe(clipA.start);
    expect(audio.playCalls).toBe(1);
    expect(store.isPlaying(clipA.id)).toBe(true);
  });

  it('seeks again once the stream is ready', () => {
    const store = usePlaybackStore();
    store.play(clipA);

    // A cold stream discards a seek issued before it has metadata — the reason
    // the seek waits for `canplay`.
    audio.currentTime = 0;
    audio.emit('canplay');

    expect(audio.currentTime).toBe(clipA.start);
    expect(audio.playCalls).toBe(2);
  });

  it('reports the elapsed time within the clip, not within the episode', () => {
    const store = usePlaybackStore();
    store.play(clipA);

    audio.advanceTo(clipA.start + 12);

    expect(store.elapsed).toBe(12);
    expect(store.duration).toBe(30);
  });

  it('is loading until the stream actually moves', () => {
    const store = usePlaybackStore();

    store.play(clipA);
    expect(store.isLoading(clipA.id)).toBe(true);

    audio.advanceTo(clipA.start + 1);
    expect(store.isLoading(clipA.id)).toBe(false);
  });

  /**
   * ⚠️ **The one seam the queue needed.** Reaching `clip.end` hands over to
   * whatever registered a handler, rather than rewinding and stopping.
   * A callback rather than an import, so this
   * store still knows nothing about a queue — which is also what keeps the clip
   * EDITOR unaffected: it drives its own element and never reaches this path.
   */
  describe('the end-of-clip handover', () => {
    it('calls the handler when the clip runs out', () => {
      const store = usePlaybackStore();
      const onEnded = vi.fn();
      store.setEndedHandler(onEnded);

      store.play(clipA);
      audio.advanceTo(clipA.end);

      expect(onEnded).toHaveBeenCalledTimes(1);
    });

    // ⚠️ The element stops FIRST. A slow `next` would otherwise leave the
    // episode playing on past the cut, which is the one thing a clip exists to
    // prevent.
    it('stops the element before handing over', () => {
      const store = usePlaybackStore();
      const seen: { paused: number; at: number }[] = [];
      store.setEndedHandler(() => seen.push({ paused: audio.pauseCalls, at: audio.currentTime }));

      store.play(clipA);
      audio.advanceTo(clipA.end);

      expect(seen).toEqual([{ paused: 1, at: clipA.start }]);
    });

    // ⚠️ Not dead code: a test, and the app before the queue store is
    // instantiated, both run with no handler — and silently doing nothing at
    // the end of a clip is the worst of the three possible behaviours.
    it('falls back to rewinding when nothing is listening', () => {
      const store = usePlaybackStore();
      store.play(clipA);

      audio.advanceTo(clipA.end);

      expect(store.playing).toBe(false);
      expect(audio.currentTime).toBe(clipA.start);
    });

    it('can be unregistered', () => {
      const store = usePlaybackStore();
      const onEnded = vi.fn();
      store.setEndedHandler(onEnded);
      store.setEndedHandler(null);

      store.play(clipA);
      audio.advanceTo(clipA.end);

      expect(onEnded).not.toHaveBeenCalled();
    });
  });

  describe('resume and stop', () => {
    // ⚠️ `resume`, not `play`: the latter takes a clip and re-seeks to `start`,
    // so pressing play after pause would jump backwards.
    it('resumes where it was paused rather than restarting the clip', () => {
      const store = usePlaybackStore();
      store.play(clipA);
      audio.advanceTo(clipA.start + 10);
      store.pause();

      store.resume();

      expect(audio.currentTime).toBe(clipA.start + 10);
      expect(store.playing).toBe(true);
    });

    it('resumes nothing when nothing is loaded', () => {
      const store = usePlaybackStore();

      store.resume();

      expect(store.playing).toBe(false);
    });

    // ⚠️ Different from `rewind`, which keeps the clip loaded and ready to play
    // again: this is what `Vaciar` does, and it must leave the player with
    // nothing to show.
    it('stop forgets the clip entirely', () => {
      const store = usePlaybackStore();
      store.play(clipA);

      store.stop();

      expect(store.current).toBeNull();
      expect(store.currentClipId).toBeNull();
      expect(store.playing).toBe(false);
      expect(audio.pauseCalls).toBe(1);
    });
  });

  /**
   * **Starting somewhere other than the beginning** (2026-08-26).
   *
   * ⚠️ The queue is what remembers a position across visits; all this store does
   * is take a number and point the element at it. The unit is **seconds into the
   * item**, the same one `elapsed` reports, so a caller never has to know that a
   * clip's audio lives 29 minutes into an episode.
   */
  describe('resuming an item at a position', () => {
    it('starts where it was left, not at the clip start', () => {
      const store = usePlaybackStore();

      store.play(clipA, 12);

      expect(audio.currentTime).toBe(clipA.start + 12);
      expect(store.elapsed).toBe(12);
      // ...and the clip still ends where it always did.
      expect(store.duration).toBe(30);
    });

    // The same fact `pendingSeek` exists for: a cold stream discards a seek
    // issued before it has metadata, and a resumed one is always cold.
    it('seeks there again once the stream is ready', () => {
      const store = usePlaybackStore();
      store.play(clipA, 12);

      audio.currentTime = 0;
      audio.emit('canplay');

      expect(audio.currentTime).toBe(clipA.start + 12);
    });

    /**
     * ⚠️ **Otherwise the play button looks like a skip button.** A seek at or
     * past `end` is answered by `handleTimeUpdate` ending the clip on the first
     * tick, which hands over to the queue and plays the NEXT one. Storage is
     * hand-edited and an admin can shorten a clip under a position somebody
     * already left in it, so this is reachable without anybody doing anything
     * wrong.
     */
    it('ignores a position past the clip’s own end', () => {
      const store = usePlaybackStore();

      store.play(clipA, 500);

      expect(audio.currentTime).toBe(clipA.start);
      expect(store.elapsed).toBe(0);
    });

    // ⚠️ Three seconds in is the beginning, not a place. Restoring it would make
    // a clip that was barely started sound like it skipped its first words.
    it('ignores a position in the first seconds', () => {
      const store = usePlaybackStore();

      store.play(clipA, 3);

      expect(audio.currentTime).toBe(clipA.start);
      expect(store.elapsed).toBe(0);
    });

    /**
     * ⚠️ **A whole episode has no `end` to be clamped against** — its length is
     * `0` on a cold boot, which means "until the file runs out" — so an hour and
     * a half into a three-hour episode has to be honoured on nothing but the
     * caller's word. It is the case the feature exists for.
     */
    it('honours a position inside an episode whose length nobody knows yet', () => {
      const store = usePlaybackStore();

      store.play(wholeEpisode, 5400);

      expect(audio.currentTime).toBe(5400);
      expect(store.elapsed).toBe(5400);
    });

    /**
     * ⚠️ **Only an item being LOADED is placed.** `toggle()` and the queue's own
     * `playAt` both call `play()` on the clip already in the element, where the
     * contract has always been "carry on from where you paused"; honouring a
     * number there would move playback under somebody who only pressed play.
     */
    it('leaves the item already loaded exactly where it is', () => {
      const store = usePlaybackStore();
      store.play(clipA);
      audio.advanceTo(clipA.start + 10);
      store.pause();

      store.play(clipA, 25);

      expect(audio.currentTime).toBe(clipA.start + 10);
      expect(store.elapsed).toBe(10);
    });
  });

  // ⚠️ The clip's whole reason to exist: the file is a full episode and nothing
  // else would ever stop it.
  describe('stopping at the end', () => {
    it('stops and rewinds when the clip runs out', () => {
      const store = usePlaybackStore();
      store.play(clipA);

      audio.advanceTo(clipA.end);

      expect(audio.pauseCalls).toBe(1);
      expect(audio.currentTime).toBe(clipA.start);
      expect(store.playing).toBe(false);
      expect(store.elapsed).toBe(0);
    });

    it('does not stop a moment before it', () => {
      const store = usePlaybackStore();
      store.play(clipA);

      audio.advanceTo(clipA.end - 0.5);

      expect(store.playing).toBe(true);
      expect(audio.pauseCalls).toBe(0);
    });

    it('stops too when the episode itself ends first', () => {
      const store = usePlaybackStore();
      store.play(clipA);

      audio.emit('ended');

      expect(store.playing).toBe(false);
      expect(audio.currentTime).toBe(clipA.start);
    });
  });

  // ⚠️ There is one element and one current clip, so nothing has to announce a
  // play for the others to stop themselves.
  describe('only one clip at a time', () => {
    it('playing B stops A', () => {
      const store = usePlaybackStore();
      store.play(clipA);

      store.play(clipB);

      expect(store.isPlaying(clipA.id)).toBe(false);
      expect(store.isPlaying(clipB.id)).toBe(true);
      expect(store.currentClipId).toBe(clipB.id);
      expect(audio.currentTime).toBe(clipB.start);
    });

    it('reuses the element for a clip of the same episode', () => {
      const store = usePlaybackStore();
      store.play(clipA);
      audio.src = `${EPISODE}#normalised-by-the-dom`;

      store.play(clipB);

      // The DOM rewrites `src` into an absolute URL, so the store tracks what it
      // assigned instead of reading it back — otherwise every clip of the same
      // episode would reload the mp3.
      expect(audio.src).toBe(`${EPISODE}#normalised-by-the-dom`);
    });

    it('switches the source for a clip of another episode', () => {
      const store = usePlaybackStore();
      store.play(clipA);

      store.play(clipElsewhere);

      expect(audio.src).toBe(OTHER_EPISODE);
    });

    it('uses one element for every clip there will ever be', () => {
      const built: FakeAudio[] = [];
      setAudioElementFactory(() => {
        const element = new FakeAudio();
        built.push(element);
        return element;
      });
      const store = usePlaybackStore();

      store.play(clipA);
      store.play(clipB);
      store.play(clipElsewhere);

      expect(built).toHaveLength(1);
    });
  });

  describe('pause and resume', () => {
    it('holds position on pause', () => {
      const store = usePlaybackStore();
      store.play(clipA);
      audio.advanceTo(clipA.start + 5);

      store.pause();

      expect(audio.pauseCalls).toBe(1);
      expect(store.playing).toBe(false);
      expect(store.elapsed).toBe(5);
      expect(audio.currentTime).toBe(clipA.start + 5);
    });

    it('resumes from there rather than restarting', () => {
      const store = usePlaybackStore();
      store.play(clipA);
      audio.advanceTo(clipA.start + 5);
      store.pause();

      store.play(clipA);

      expect(audio.currentTime).toBe(clipA.start + 5);
      expect(store.playing).toBe(true);
    });

    it('toggles with the single play/pause button on the card', () => {
      const store = usePlaybackStore();

      store.toggle(clipA);
      expect(store.isPlaying(clipA.id)).toBe(true);

      store.toggle(clipA);
      expect(store.isPlaying(clipA.id)).toBe(false);

      store.toggle(clipA);
      expect(store.isPlaying(clipA.id)).toBe(true);
    });

    it('toggling another clip takes over instead of pausing', () => {
      const store = usePlaybackStore();
      store.play(clipA);

      store.toggle(clipB);

      expect(store.isPlaying(clipB.id)).toBe(true);
      expect(store.isPlaying(clipA.id)).toBe(false);
    });
  });

  // The click-seekable `<progress>`.
  describe('seeking', () => {
    it('seeks by fraction of the clip', () => {
      const store = usePlaybackStore();
      store.play(clipA);

      store.seekToFraction(0.5);

      expect(audio.currentTime).toBe(clipA.start + 15);
      expect(store.elapsed).toBe(15);
    });

    it('clamps a click past either edge', () => {
      const store = usePlaybackStore();
      store.play(clipA);

      store.seekToFraction(1.4);
      expect(audio.currentTime).toBe(clipA.end);

      store.seekToFraction(-0.3);
      expect(audio.currentTime).toBe(clipA.start);
    });

    it('does nothing with no clip loaded', () => {
      const store = usePlaybackStore();

      store.seekToFraction(0.5);

      expect(store.elapsed).toBe(0);
    });
  });

  it('survives a rejected play (autoplay policy) without breaking', async () => {
    const rejecting = new FakeAudio();
    vi.spyOn(rejecting, 'play').mockRejectedValue(new DOMException('NotAllowedError'));
    setAudioElementFactory(() => rejecting);
    const store = usePlaybackStore();

    store.play(clipA);
    await vi.waitFor(() => expect(store.playing).toBe(false));

    expect(store.isLoading(clipA.id)).toBe(false);
  });
});

/**
 * A whole episode is playable through this store (2026-08-25), and the two
 * things that makes true are both here: identity is `(kind, id)` rather than
 * an id, and an item may arrive without knowing how long it is.
 */
describe('a whole episode', () => {
  // Same harness as the block above; this one is a sibling because it is about
  // a different shape of item, not a different part of the same one.
  beforeEach(() => {
    setActivePinia(createPinia());
    audio = new FakeAudio();
    setAudioElementFactory(() => audio);
  });

  afterEach(() => resetAudioElementFactory());

  /**
   * ⚠️ **The reason `kind` exists.** Clip 42 and episode 42 both exist in this
   * database; without the discriminator every clip row numbered 42 on the site
   * would light up as "playing" because an episode is.
   */
  it('does not answer a clip row asking about the same id', () => {
    const store = usePlaybackStore();

    store.play(wholeEpisode);

    expect(store.isCurrentEpisode(42)).toBe(true);
    expect(store.isPlayingEpisode(42)).toBe(true);
    expect(store.currentEpisodeId).toBe(42);

    expect(store.isCurrent(42)).toBe(false);
    expect(store.isPlaying(42)).toBe(false);
    expect(store.currentClipId).toBeNull();
  });

  /**
   * ⚠️ **`end: 0` means "until the file runs out", not "zero seconds long".**
   * It is the normal state of an episode nothing has measured and of every
   * episode on a cold boot, so the length comes from the element instead.
   */
  it('takes its length from the element when it has none of its own', () => {
    const store = usePlaybackStore();

    store.play(wholeEpisode);
    expect(store.duration).toBe(0);

    audio.duration = 2494.6;
    audio.emit('durationchange');

    expect(store.duration).toBe(2494.6);
  });

  it('ignores a duration the element cannot state yet', () => {
    const store = usePlaybackStore();
    store.play(wholeEpisode);

    audio.duration = Number.NaN;
    audio.emit('durationchange');
    expect(store.duration).toBe(0);

    // A live stream. Believing it would make every computed downstream infinite.
    audio.duration = Number.POSITIVE_INFINITY;
    audio.emit('durationchange');
    expect(store.duration).toBe(0);
  });

  /**
   * ⚠️ **Nothing stops it early.** A clip stops at its `end` because the mp3 is
   * a whole episode and nothing else would; an episode with no `end` of its own
   * must run to the element's `ended` event, or a length this store guessed
   * would cut it off mid-sentence.
   */
  it('is not cut short by the end check while its length is unknown', () => {
    const store = usePlaybackStore();
    const ended = vi.fn();
    store.setEndedHandler(ended);

    store.play(wholeEpisode);
    audio.advanceTo(9000);

    expect(ended).not.toHaveBeenCalled();
    expect(store.elapsed).toBe(9000);

    audio.emit('ended');
    expect(ended).toHaveBeenCalledTimes(1);
  });

  /** A measured episode keeps its own end, and stops there like anything else. */
  it('stops at a measured end', () => {
    const store = usePlaybackStore();
    const ended = vi.fn();
    store.setEndedHandler(ended);

    store.play({ ...wholeEpisode, end: 100 });
    expect(store.duration).toBe(100);

    audio.advanceTo(100);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  /**
   * ⚠️ **"Play this episode from 41:00" is one click on the map**, and the seek
   * lands before the stream has metadata — where setting `currentTime` is
   * silently discarded. It has to be re-applied from `canplay`, or every click
   * on the map would start the episode at zero.
   */
  it('re-applies a seek that landed while the stream was still cold', () => {
    const store = usePlaybackStore();

    store.play(wholeEpisode);
    expect(store.loading).toBe(true);

    store.seek(2460);
    // The element discarded it, as a real one does with no metadata.
    audio.currentTime = 0;
    audio.emit('canplay');

    expect(audio.currentTime).toBe(2460);
  });

  /** ...and once it is running, a `canplay` after a stall must NOT yank
   *  playback back to the last place anybody clicked. */
  it('does not re-apply a seek once the stream is running', () => {
    const store = usePlaybackStore();

    store.play(wholeEpisode);
    audio.advanceTo(10);
    expect(store.loading).toBe(false);

    store.seek(600);
    audio.advanceTo(605);
    audio.emit('canplay');

    expect(audio.currentTime).toBe(605);
  });

  /** ⚠️ The clamp is skipped while the length is unknown: clamping to
   *  `duration` would be clamping to zero, i.e. every seek landing at the
   *  start. */
  it('does not clamp a seek to zero while the length is unknown', () => {
    const store = usePlaybackStore();
    store.play(wholeEpisode);

    store.seek(1800);

    expect(store.elapsed).toBe(1800);
  });
});
