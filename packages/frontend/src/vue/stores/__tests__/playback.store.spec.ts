import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import {
  resetAudioElementFactory,
  setAudioElementFactory,
  startPlaybackReconciliation,
  usePlaybackStore,
  WATCHDOG_INTERVAL_MS,
  type PlayableItem,
  type PlaybackAudio,
  type PlaybackAudioEvent,
} from '../playback.store';

// The rule — only one clip plays at a time — is asserted here as a property of
// the store, not of a broadcast: there is one audio element, so there is nothing
// to broadcast.

/**
 * A stand-in for `HTMLAudioElement`. Necessary, not convenient: jsdom's
 * `play()` is "not implemented", so a real element cannot be driven at all.
 * It records what the store did to it and can fire the events a browser would.
 *
 * ⚠️ **It emits `play` and `playing` synchronously from `play()`, and that is
 * load-bearing.** `playing` is the ELEMENT's state in the store now, so a fake
 * that only recorded the call would leave every assertion about playback false.
 * A real browser fires them too; only the timing is compressed here.
 */
class FakeAudio implements PlaybackAudio {
  /** ⚠️ `NaN` before metadata, exactly as a real element reports it. */
  duration = Number.NaN;
  playCalls = 0;
  pauseCalls = 0;
  /** How many times the store asked for a fresh load — the retry and `stop()`. */
  loadCalls = 0;
  /** How many times the store pointed the element at a file. */
  srcWrites = 0;
  /** Which attributes it was asked to release, in order. */
  removedAttributes: string[] = [];
  /**
   * ⚠️ Turn the NEXT seek into the `InvalidStateError` a real element raises at
   * `HAVE_NOTHING` — the state a failed load leaves behind.
   */
  refuseNextSeek = false;
  private source = '';
  private time = 0;
  private readonly listeners = new Map<PlaybackAudioEvent, (() => void)[]>();
  private pausedFlag = true;

  get src(): string {
    return this.source;
  }

  set src(url: string) {
    this.source = url;
    this.srcWrites += 1;
  }

  get currentTime(): number {
    return this.time;
  }

  set currentTime(seconds: number) {
    if (this.refuseNextSeek) {
      this.refuseNextSeek = false;
      throw new DOMException('The element has nothing to seek', 'InvalidStateError');
    }
    this.time = seconds;
  }

  /** ⚠️ The element's own opinion, which is half of what `reconcile()` reads. */
  get paused(): boolean {
    return this.pausedFlag;
  }

  play(): Promise<void> {
    this.playCalls += 1;
    this.pausedFlag = false;
    this.emit('play');
    this.emit('playing');
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls += 1;
    this.pausedFlag = true;
    this.emit('pause');
  }

  load(): void {
    this.loadCalls += 1;
  }

  removeAttribute(name: 'src'): void {
    this.removedAttributes.push(name);
    // ⚠️ Not `this.src = ''`: releasing is not the store pointing the element at
    // a file, and `srcWrites` counts only the latter.
    if (name === 'src') this.source = '';
  }

  addEventListener(type: PlaybackAudioEvent, listener: () => void): void {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(type, [...existing, listener]);
  }

  /** What the browser does while the stream advances. */
  emit(type: PlaybackAudioEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  /** Advance the stream and report it, as a real element would. */
  advanceTo(seconds: number): void {
    this.currentTime = seconds;
    this.emit('timeupdate');
  }
}

/**
 * Make the element accept `play()` without ever producing sound: `play` fires,
 * `playing` does not.
 *
 * ⚠️ **This is what a load that is about to fail looks like**, and the reason
 * `playing` cannot answer "did this attempt work": a browser fires `play` the
 * moment `play()` is accepted — before a single byte has arrived, and for an
 * aborted mp3 just as much as for a healthy one (2026-10-27).
 */
function playsWithoutAudio(target: FakeAudio): void {
  vi.spyOn(target, 'play').mockImplementation(() => {
    target.playCalls += 1;
    target.emit('play');
    return Promise.resolve();
  });
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

  /**
   * ⚠️ **`loading` is the element's state now**, so the fake that reports
   * `playing` the instant it is asked closes the window at once — which is what
   * a browser with the bytes in hand does too. The window itself is what this
   * asserts, so the element here is one that accepted the call and has got
   * nowhere yet: no `play`/`playing`, and no `timeupdate`.
   */
  it('is loading until the stream produces anything', () => {
    vi.spyOn(audio, 'play').mockImplementation(() => Promise.resolve());
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

  /**
   * A `play()` the browser refuses, and the `AbortError` that is not a refusal.
   *
   * ⚠️ Both used to end the same way: swallowed, with the element stuck. What
   * separates them is the generation — a load a later `play()` has superseded is
   * not this store's failure to answer for.
   */
  describe('a play the browser refuses', () => {
    it('leaves the state stopped, without losing the position', async () => {
      const store = usePlaybackStore();
      store.play(clipA);
      audio.advanceTo(clipA.start + 12);
      store.pause();

      vi.spyOn(audio, 'play').mockRejectedValue(
        new DOMException('play() failed', 'NotAllowedError'),
      );
      store.resume();

      await vi.waitFor(() => expect(store.playing).toBe(false));

      expect(store.shouldBePlaying).toBe(false);
      expect(store.loading).toBe(false);
      // ⚠️ A failed play is not a reason to lose somebody's place: nothing here
      // seeks, and `start` is never re-applied.
      expect(audio.currentTime).toBe(clipA.start + 12);
      expect(store.elapsed).toBe(12);
    });

    /**
     * ⚠️ **An `AbortError` is the browser answering a load somebody replaced**,
     * not a refusal to play. Both conditions of the guard are exercised here:
     * the promise belongs to a superseded generation AND carries `AbortError`,
     * and either alone is enough to ignore it.
     */
    it('ignores an AbortError from a load a later play() superseded', async () => {
      const store = usePlaybackStore();

      let abort: (reason: unknown) => void = () => {};
      const superseded = new Promise<void>((_resolve, reject) => {
        abort = (reason) => reject(reason);
      });
      const spy = vi.spyOn(audio, 'play').mockImplementationOnce(() => superseded);

      store.play(clipA);
      store.play(clipB);

      abort(new DOMException('The play() request was interrupted', 'AbortError'));
      await flushPromises();

      expect(spy).toHaveBeenCalledTimes(2);
      expect(store.currentClipId).toBe(clipB.id);
      // ⚠️ The intent is exactly as the LATER call left it.
      expect(store.shouldBePlaying).toBe(true);
      expect(store.playing).toBe(true);
    });
  });

  /**
   * An element that cannot load what it was given.
   *
   * ⚠️ **One retry, from the current position**, and then a hand-over. A
   * network blip on a remote mp3 is worth a second attempt; a source that failed
   * twice is dead, and a player that retries for ever is a loop nobody can see.
   */
  describe('an element that fails to load', () => {
    it('retries once, resuming where the listener actually is', () => {
      const store = usePlaybackStore();
      store.play(clipA);
      // Twelve seconds in, so a retry that started over would be visible: the
      // whole point is that a network blip does not rewind the clip.
      audio.advanceTo(clipA.start + 12);
      const loads = audio.loadCalls;
      const plays = audio.playCalls;

      audio.emit('error');

      expect(audio.loadCalls).toBe(loads + 1);
      expect(audio.playCalls).toBe(plays + 1);
      expect(audio.src).toBe(EPISODE);
      expect(audio.currentTime).toBe(clipA.start + 12);
      expect(store.elapsed).toBe(12);
      expect(store.shouldBePlaying).toBe(true);
    });

    it('gives up on the second failure, and calls the error handler once', () => {
      const store = usePlaybackStore();
      const onError = vi.fn();
      store.setErrorHandler(onError);

      store.play(clipA);
      audio.emit('error');
      audio.emit('error');

      expect(onError).toHaveBeenCalledTimes(1);
      expect(store.playing).toBe(false);
      expect(store.shouldBePlaying).toBe(false);
      expect(store.loading).toBe(false);
    });

    // ⚠️ Same reasoning as `endedHandler`: with nothing listening, silently
    // doing nothing is the worst of the three possible answers.
    it('rewinds when nothing is listening for the failure', () => {
      const store = usePlaybackStore();
      store.play(clipA);
      audio.advanceTo(clipA.start + 12);

      audio.emit('error');
      audio.emit('error');

      expect(store.playing).toBe(false);
      expect(audio.currentTime).toBe(clipA.start);
    });

    it('can be unregistered', () => {
      const store = usePlaybackStore();
      const onError = vi.fn();
      store.setErrorHandler(onError);
      store.setErrorHandler(null);

      store.play(clipA);
      audio.emit('error');
      audio.emit('error');

      expect(onError).not.toHaveBeenCalled();
    });

    // ⚠️ The retry allowance belongs to ONE load: a later item gets its own.
    it('gives a new item its own retry', () => {
      const store = usePlaybackStore();
      const onError = vi.fn();
      store.setErrorHandler(onError);

      store.play(clipA);
      audio.emit('error');
      audio.emit('error');
      expect(onError).toHaveBeenCalledTimes(1);

      store.play(clipB);
      audio.emit('error');

      // Still the first failure of clip B: no hand-over.
      expect(onError).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * **`hasAudio`: what the element actually produced** (2026-10-27).
   *
   * ⚠️ **`playing` cannot answer it.** A browser fires `play` the moment
   * `play()` is accepted — before a byte has arrived — so a source that is about
   * to 404 looks exactly like a healthy one for as long as it takes to fail. The
   * queue watches this flag to decide when a run of dead files has ended, and
   * watching `playing` instead made every dead item in a row speak (measured:
   * `test/e2e/specs/17-background-playback.spec.ts`).
   */
  describe('what the element actually produced', () => {
    it('is false while the element is only unpaused, and true on `playing`', () => {
      const store = usePlaybackStore();
      playsWithoutAudio(audio);

      store.play(clipA);

      // ⚠️ The transport must already say "playing": narrowing THAT would make
      // the play button look dead for the whole of a cold remote stream.
      expect(store.playing).toBe(true);
      expect(store.hasAudio).toBe(false);

      audio.emit('playing');

      expect(store.hasAudio).toBe(true);
      expect(store.playing).toBe(true);
    });

    it('drops it again on an error, and on stop()', () => {
      const store = usePlaybackStore();
      playsWithoutAudio(audio);
      store.play(clipA);
      audio.emit('playing');
      expect(store.hasAudio).toBe(true);

      // The failure buys one retry, and a load that produces nothing is exactly
      // what has to leave this false.
      audio.emit('error');
      expect(store.hasAudio).toBe(false);

      audio.emit('playing');
      expect(store.hasAudio).toBe(true);

      store.stop();
      expect(store.hasAudio).toBe(false);
    });

    /**
     * ⚠️ **The other half of a dead source** — defect 2. A clip of the SAME
     * episode shares `src`, so without forgetting `loadedSrc` when the store
     * gives up, `play()` believes the element already holds the file: no
     * `load()`, an element still in its error state, a `play()` that rejects
     * without an `error` event, and a player that does nothing when pressed.
     */
    it('reloads a source that failed twice when the same item is played again', () => {
      const store = usePlaybackStore();
      store.play(clipA);

      audio.emit('error'); // the one retry
      audio.emit('error'); // dead: no handler, so the store rewinds and forgets the source

      const loads = audio.loadCalls;
      const writes = audio.srcWrites;

      store.play(clipA);

      expect(audio.srcWrites).toBe(writes + 1);
      expect(audio.loadCalls).toBe(loads + 1);
      expect(audio.src).toBe(EPISODE);
    });

    /**
     * ⚠️ **A dead source has no position**, and the no-handler fallback runs
     * inside an `error` listener: an exception there escapes into the page
     * instead of stopping the player. `rewind()` itself must still run.
     */
    it('does not throw when the dead element refuses the seek back to the start', () => {
      const store = usePlaybackStore();
      store.play(clipA);

      audio.emit('error'); // the one retry
      const pauses = audio.pauseCalls;
      audio.refuseNextSeek = true;

      expect(() => audio.emit('error')).not.toThrow();

      expect(audio.pauseCalls).toBe(pauses + 1);
      expect(store.shouldBePlaying).toBe(false);
      expect(store.playing).toBe(false);
      expect(store.elapsed).toBe(0);
    });
  });

  /**
   * ⚠️ **The element's `ended` is the same ending as a `timeupdate` past
   * `end`**, and it is the one a whole episode relies on: a clip normally stops
   * at its own `end`, and the element running out is the net for an `end` past
   * the file.
   */
  describe('the element reaching the end of the file', () => {
    it('ends a clip exactly like the timeupdate path does', () => {
      const store = usePlaybackStore();
      const seen: { paused: number; at: number }[] = [];
      store.setEndedHandler(() => seen.push({ paused: audio.pauseCalls, at: audio.currentTime }));

      store.play(clipA);
      audio.emit('ended');

      // Once, and with the element already stopped at the clip's start.
      expect(seen).toEqual([{ paused: 1, at: clipA.start }]);
      expect(store.playing).toBe(false);
      expect(store.shouldBePlaying).toBe(false);
      expect(store.elapsed).toBe(0);
    });
  });

  /**
   * **Intention versus state** — the reason this store has two of them.
   *
   * ⚠️ `playing` is what the element reports; `shouldBePlaying` is what was
   * asked for. A system pause separates them, and `reconcile()` is what puts
   * them back together.
   */
  describe('intention versus state', () => {
    it('keeps the intent through a pause nobody here asked for', () => {
      const store = usePlaybackStore();
      store.play(clipA);
      audio.advanceTo(clipA.start + 12);
      expect(store.shouldBePlaying).toBe(true);

      // A call arriving, headphones unplugged, the OS pausing media: the
      // element stops and says so, and it never asked this store.
      audio.pause();

      expect(store.playing).toBe(false);
      expect(store.shouldBePlaying).toBe(true);

      store.reconcile();

      expect(store.playing).toBe(true);
      expect(store.shouldBePlaying).toBe(true);
      expect(audio.playCalls).toBe(2);
      // ⚠️ From where it stopped: reconciling resumes, it never restarts.
      expect(audio.currentTime).toBe(clipA.start + 12);
      expect(store.elapsed).toBe(12);
    });

    it('does nothing when nothing was asked for', () => {
      const store = usePlaybackStore();
      // Nothing loaded and no element at all: the cold-boot state, which a
      // `pageshow` can land on.
      expect(() => store.reconcile()).not.toThrow();

      store.play(clipA);
      store.pause();
      const plays = audio.playCalls;
      const pauses = audio.pauseCalls;

      store.reconcile();

      expect(audio.playCalls).toBe(plays);
      expect(audio.pauseCalls).toBe(pauses);
      expect(store.playing).toBe(false);
      expect(store.shouldBePlaying).toBe(false);
    });
  });

  /**
   * `stop()` is the way out of a stuck element.
   *
   * ⚠️ Forgetting the item but leaving `src` assigned leaves the element
   * pointed at a resource it has decided not to play — a stream that never
   * recovered, an mp3 that 404'd, a tab frozen mid-load. The release is
   * `removeAttribute('src')` + `load()`, and forgetting `loadedSrc` is the other
   * half: it is what makes the next `play()` of the same item a real load.
   */
  describe('stop releasing the element', () => {
    it('drops the source, and reloads it when the same item is played again', () => {
      const store = usePlaybackStore();
      store.play(clipA);
      const loads = audio.loadCalls;

      store.stop();

      expect(audio.removedAttributes).toEqual(['src']);
      expect(audio.src).toBe('');
      expect(audio.loadCalls).toBe(loads + 1);
      expect(store.shouldBePlaying).toBe(false);
      expect(store.playing).toBe(false);

      store.play(clipA);

      expect(audio.src).toBe(EPISODE);
      expect(audio.loadCalls).toBe(loads + 2);
      expect(store.shouldBePlaying).toBe(true);
    });
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
    // ⚠️ `loading` is the element's state now. The fake reports `playing`
    // immediately; a cold REMOTE stream instead sits in `waiting` — which is
    // exactly the window in which a seek is silently discarded, and the one
    // this test is about.
    audio.emit('waiting');
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

/**
 * `document.visibilityState` is read-only in a real page, so it is replaced on
 * the document itself and removed afterwards — `delete` uncovers jsdom's own
 * getter again rather than leaving a `'visible'` behind for the next spec.
 */
function setVisibilityState(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

function resetVisibilityState(): void {
  Reflect.deleteProperty(document, 'visibilityState');
}

/**
 * **Coming back to the page puts it back on.**
 *
 * ⚠️ This is the half that actually gets somebody their audio back after a phone
 * call: a system pause leaves the intent set (see "intention versus state") and
 * this is what notices the page has returned. The watchdog underneath it is a
 * net, not the guarantee.
 */
describe('startPlaybackReconciliation', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    audio = new FakeAudio();
    setAudioElementFactory(() => audio);
  });

  afterEach(() => {
    resetAudioElementFactory();
    resetVisibilityState();
    vi.useRealTimers();
  });

  it('reconciles when the page becomes visible again', () => {
    const store = usePlaybackStore();
    store.play(clipA);
    audio.pause();
    setVisibilityState('hidden');
    const teardown = startPlaybackReconciliation();

    const plays = audio.playCalls;
    // Going away is not a reason to touch anything.
    document.dispatchEvent(new Event('visibilitychange'));
    expect(audio.playCalls).toBe(plays);

    setVisibilityState('visible');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(audio.playCalls).toBe(plays + 1);
    expect(store.playing).toBe(true);

    teardown();
  });

  // ⚠️ `resume` (Page Lifecycle) and `pageshow` (the back/forward cache) are the
  // other two ways a page comes back from having been parked.
  it('reconciles on `resume` and on `pageshow`', () => {
    const store = usePlaybackStore();
    store.play(clipA);
    const teardown = startPlaybackReconciliation();

    audio.pause();
    document.dispatchEvent(new Event('resume'));
    expect(store.playing).toBe(true);

    audio.pause();
    window.dispatchEvent(new Event('pageshow'));
    expect(store.playing).toBe(true);

    teardown();
  });

  it('removes every listener when torn down', () => {
    const store = usePlaybackStore();
    store.play(clipA);
    audio.pause();
    const teardown = startPlaybackReconciliation();
    teardown();

    const plays = audio.playCalls;
    setVisibilityState('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('resume'));
    window.dispatchEvent(new Event('pageshow'));

    expect(audio.playCalls).toBe(plays);
    expect(store.playing).toBe(false);
  });

  /**
   * ⚠️ **The watchdog is a net, not the guarantee.** While the page is hidden it
   * compares the element's clock with the last value it saw; two seconds without
   * movement, with the intent still set, means the element's own reports are not
   * to be believed. A clock that IS moving is a working element, left alone.
   */
  it('nudges a frozen element while the page is hidden', () => {
    vi.useFakeTimers();
    const store = usePlaybackStore();
    store.play(clipA);
    const plays = audio.playCalls;

    setVisibilityState('hidden');
    const teardown = startPlaybackReconciliation();
    document.dispatchEvent(new Event('visibilitychange'));

    // Frozen, with the intent still set: the net goes out.
    vi.advanceTimersByTime(WATCHDOG_INTERVAL_MS);
    expect(audio.playCalls).toBe(plays + 1);

    // Moving: nobody touches it.
    const afterNudge = audio.playCalls;
    audio.currentTime += 5;
    vi.advanceTimersByTime(WATCHDOG_INTERVAL_MS);
    expect(audio.playCalls).toBe(afterNudge);

    teardown();
    // ⚠️ And the interval is gone with it.
    audio.currentTime += 5;
    vi.advanceTimersByTime(WATCHDOG_INTERVAL_MS * 4);
    expect(audio.playCalls).toBe(afterNudge);
  });
});
