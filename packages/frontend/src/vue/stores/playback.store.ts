import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';

/**
 * What the player is pointed at: a clip, or **a whole episode**.
 *
 * ⚠️ Structural on purpose: it is NOT the clips domain entity. The store lives
 * in `vue/`, the entity in `core/domain/clips/`, and keeping the dependency out
 * means the player can be tested with four numbers and a string, and that a
 * change to the clip DTO cannot break playback. The card maps
 * `(clip, episode)` into this — `src` is the EPISODE's remote mp3, because a
 * clip has no audio file of its own (root `AGENTS.md`).
 *
 * ⚠️ **`kind` is required, and it is not decoration** (2026-08-25). Ids are only
 * unique *within* their kind — clip 93 and episode 93 both exist — so without it
 * `isCurrent(93)` on a clip row would light up because an episode that happens to
 * share the number is playing. Every identity question here goes through it.
 */
export interface PlayableItem {
  readonly kind: 'clip' | 'episode';
  /** A clip id, or an episode id. ⚠️ Only unique together with `kind`. */
  readonly id: number;
  /** The episode's remote mp3. Several clips — and the episode itself — share one. */
  readonly src: string;
  /** Seconds into the episode. */
  readonly start: number;
  /**
   * Seconds into the episode. Playback stops here.
   *
   * ⚠️ **`end <= start` means "until the file runs out"**, and that is the whole
   * episode's normal state rather than an error: an episode's length reaches the
   * app through `GET /episodes/:id/waveform`'s `to`, which is `0` for the 9 of
   * 589 episodes nothing has measured yet, and it is never known at all on a cold
   * boot where the queue holds an id and nothing else. The browser knows it —
   * see `mediaDuration` — so the unknown case is answered rather than refused.
   */
  readonly end: number;
}

/**
 * The slice of `HTMLAudioElement` this store drives. `new Audio()` satisfies
 * it, and so does a plain object in a test — which is the point: jsdom's
 * `HTMLMediaElement.play()` is not implemented, so a real element could never
 * be asserted against.
 */
export interface PlaybackAudio {
  src: string;
  currentTime: number;
  /** ⚠️ `NaN` until the browser has metadata, and `Infinity` for a stream. Only
   *  read to answer the unknown-`end` case above; a finite number is required
   *  before it is believed. */
  readonly duration?: number;
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(
    type: 'timeupdate' | 'canplay' | 'ended' | 'durationchange',
    listener: () => void,
  ): void;
}

/**
 * How the store gets its one audio element. Swapped in tests; never swapped at
 * runtime.
 */
let audioFactory: () => PlaybackAudio = () => new Audio();

/** Test seam. ⚠️ Call `resetAudioElementFactory()` afterwards. */
export function setAudioElementFactory(factory: () => PlaybackAudio): void {
  audioFactory = factory;
}

export function resetAudioElementFactory(): void {
  audioFactory = () => new Audio();
}

/**
 * How far into `item` an `at` has to point before it is honoured.
 *
 * ⚠️ A position of three seconds is not a position, it is the beginning — and
 * restoring one makes a clip that was barely started look like it skipped its
 * first words. The queue applies the same floor on the way in
 * (`queue.store.ts`), so nothing under this is ever written either.
 */
export const MIN_RESUME_SECONDS = 5;

/**
 * Where inside `item` playback should actually begin, in seconds from its
 * start.
 *
 * ⚠️ **An offset at or past the item's own end is dropped**, and the item
 * plays from the top instead. `localStorage` is hand-edited, an admin can
 * shorten a clip under a position somebody had already left in it, and
 * `handleTimeUpdate` would answer a seek past `end` by ending the clip
 * instantly — which reads as "the play button skips to the next one".
 */
function resumeOffset(item: PlayableItem, at: number): number {
  if (!Number.isFinite(at) || at < MIN_RESUME_SECONDS) return 0;
  const known = item.end > item.start ? item.end - item.start : 0;
  if (known > 0 && at >= known) return 0;
  return Math.floor(at);
}

/**
 * Playback, owned in one place.
 *
 * ⚠️ There is exactly ONE audio element and one `currentClipId`, so "only one
 * clip at a time" is not enforced at all — it is structural. A card asks
 * `isPlaying(clip.id)`; nothing broadcasts anything.
 *
 * ### The queue plugs in here, and did
 *
 * This store was written with a global player in mind and said so: one element,
 * clips addressed by **id**, no component owning audio state. `queue.store.ts`
 * is that player's other half, and it needed exactly one seam here —
 * `setEndedHandler`, below. **Order, persistence and "what comes next" are not
 * this store's business**, and keeping them out is what lets it still be tested
 * with four numbers and a string.
 */
export const usePlaybackStore = defineStore('playback', () => {
  /** What the element is currently loaded with. `shallowRef`: it is a plain
   *  value object, and nothing ever mutates it in place. */
  const current = shallowRef<PlayableItem | null>(null);
  const playing = ref(false);
  /** Between "the user pressed play" and the first `timeupdate`: the mp3 is
   *  remote and streamed, so this is a real, visible wait on a cold clip. */
  const loading = ref(false);
  /** Seconds elapsed **within the item** — `audio.currentTime - item.start`. */
  const elapsed = ref(0);

  /**
   * What the ELEMENT says the loaded file lasts, in seconds; `0` until it says
   * anything.
   *
   * ⚠️ Only ever consulted for an item whose own `end` is unknown (see
   * `PlayableItem.end`). A clip always knows where it stops, and must keep
   * stopping there even on an episode the browser reports a different length
   * for than the server measured.
   */
  const mediaDuration = ref(0);

  /** ⚠️ Not reactive: it is an imperative resource, and a `ref` around a media
   *  element only invites templates to touch it. */
  let audio: PlaybackAudio | null = null;
  /** The `src` we last assigned, kept because the DOM normalises `audio.src`
   *  into an absolute URL — comparing against the raw string would reload the
   *  same mp3 on every clip of the same episode. */
  let loadedSrc: string | null = null;
  /** Where to jump once the element is ready. ⚠️ Setting `currentTime` before
   *  the browser has metadata is silently discarded, which is why the seek
   *  waits for `canplay`. */
  let pendingSeek: number | null = null;

  /**
   * What to do when a clip runs out.
   *
   * ⚠️ **The one seam the queue needed.** Reaching `clip.end` advances the
   * queue rather than rewinding and stopping. It is a callback
   * rather than an import so this store still knows nothing about a queue —
   * which is also what keeps the CLIP EDITOR unaffected: it drives its own
   * element (`utils/editor-audio.ts`) and never reaches this path.
   *
   * ⚠️ `null` falls back to `rewind()`. That is not dead code: a test, and the
   * app before the queue store is instantiated, both run with no handler, and
   * silently doing nothing at the end of a clip would be the worst of the three
   * possible behaviours.
   */
  let endedHandler: (() => void) | null = null;

  /** ⚠️ `null` while an EPISODE is playing, and that is the point: a clip row
   *  asking "is it me?" must not be answered by an episode's id. */
  const currentClipId = computed(() => (current.value?.kind === 'clip' ? current.value.id : null));
  const currentEpisodeId = computed(() =>
    current.value?.kind === 'episode' ? current.value.id : null,
  );

  /**
   * The loaded item's length in seconds — what the progress bar's `max` is.
   *
   * ⚠️ Falls back to what the element reports when the item does not know (see
   * `PlayableItem.end`), minus whatever it starts at. `0` while neither knows,
   * which every reader here already had to handle: it is also the idle state.
   */
  const duration = computed(() => {
    const item = current.value;
    if (item === null) return 0;
    if (item.end > item.start) return item.end - item.start;
    return Math.max(0, mediaDuration.value - item.start);
  });

  function isCurrent(clipId: number): boolean {
    return currentClipId.value === clipId;
  }

  function isPlaying(clipId: number): boolean {
    return playing.value && isCurrent(clipId);
  }

  function isLoading(clipId: number): boolean {
    return loading.value && isCurrent(clipId);
  }

  /** The same three questions for a whole episode. ⚠️ Separate functions rather
   *  than a `kind` parameter: every call site knows which one it is asking
   *  about, and a parameter would let the two be confused at the one place the
   *  types exist to keep apart. */
  function isCurrentEpisode(episodeId: number): boolean {
    return currentEpisodeId.value === episodeId;
  }

  function isPlayingEpisode(episodeId: number): boolean {
    return playing.value && isCurrentEpisode(episodeId);
  }

  function handleTimeUpdate(): void {
    const item = current.value;
    if (audio === null || item === null) return;

    // The first `timeupdate` is also the proof that the stream started.
    loading.value = false;
    elapsed.value = Math.max(0, audio.currentTime - item.start);

    // ⚠️ Stopping at `end` is the whole reason a clip exists: the mp3 is a
    // full episode and nothing else would ever stop it.
    //
    // ⚠️ An item with no `end` of its own (a whole episode) is stopped by the
    // element's own `ended` event instead — cutting it off at a length this
    // store guessed would end the episode early on every file whose real
    // duration disagrees with the measured one.
    if (item.end > item.start && audio.currentTime >= item.end) {
      handleEnded();
    }
  }

  /** The element learned how long the file is. ⚠️ Guarded on `isFinite`:
   *  `duration` is `NaN` before metadata and `Infinity` for a live stream, and
   *  either one would poison every computed downstream. */
  function handleDurationChange(): void {
    const reported = audio?.duration;
    mediaDuration.value = typeof reported === 'number' && Number.isFinite(reported) ? reported : 0;
  }

  /** The end of a clip: hand over to the queue, or rewind if nothing is
   *  listening. ⚠️ `rewind()` FIRST when there is a handler too — the element
   *  must stop before anything else loads into it, or a slow `next` leaves the
   *  episode playing past the cut. */
  function handleEnded(): void {
    rewind();
    endedHandler?.();
  }

  function handleCanPlay(): void {
    if (audio === null || pendingSeek === null) return;
    audio.currentTime = pendingSeek;
    pendingSeek = null;
    if (playing.value) void start(audio);
  }

  function ensureAudio(): PlaybackAudio {
    if (audio === null) {
      audio = audioFactory();
      audio.addEventListener('timeupdate', handleTimeUpdate);
      audio.addEventListener('canplay', handleCanPlay);
      audio.addEventListener('durationchange', handleDurationChange);
      // A clip normally ends at `clip.end`; this is the episode itself running
      // out, which happens when a clip's `end` is past the file's duration.
      audio.addEventListener('ended', handleEnded);
    }
    return audio;
  }

  function start(element: PlaybackAudio): void {
    // ⚠️ Autoplay policies reject this when there was no user gesture. It is
    // not an error worth a toast — the card just goes back to showing "play".
    void Promise.resolve(element.play()).catch(() => {
      playing.value = false;
      loading.value = false;
    });
  }

  /** Is `item` the one already loaded? ⚠️ Both halves, always: the ids alone
   *  collide across kinds. */
  function isLoaded(item: PlayableItem): boolean {
    const loaded = current.value;
    return loaded !== null && loaded.kind === item.kind && loaded.id === item.id;
  }

  /**
   * Play `item`, stopping whatever was playing. Resumes rather than restarts
   * when it is the one already loaded.
   *
   * `at` is **seconds into the item** — the same unit as `elapsed`, not an
   * absolute position in the episode — and it is how "carry on where you left
   * off yesterday" reaches the element (2026-08-26). Zero, the default, is the
   * behaviour this store has always had.
   *
   * ⚠️ **It only applies to an item being LOADED.** Calling `play()` on the one
   * already in the element resumes it where it was paused, which is the
   * behaviour `toggle()` depends on; re-seeking it because a caller passed a
   * number would move playback under somebody who only pressed play again.
   */
  function play(item: PlayableItem, at = 0): void {
    const element = ensureAudio();

    if (!isLoaded(item)) {
      const offset = resumeOffset(item, at);
      const target = item.start + offset;

      current.value = item;
      elapsed.value = offset;
      loading.value = true;
      if (loadedSrc !== item.src) {
        element.src = item.src;
        loadedSrc = item.src;
        // A new file: whatever the last one lasted is not what this one lasts.
        mediaDuration.value = 0;
        // ⚠️ A cold stream has no metadata yet, so the seek below is silently
        // discarded — `canplay` does it again. Only set this when the source
        // actually changed: left armed on an already-loaded element, a later
        // `canplay` (after a stall) would yank playback back to `clip.start`.
        pendingSeek = target;
      }
      element.currentTime = target;
    }

    playing.value = true;
    start(element);
  }

  /** Hold position. The card's play button while the clip is playing. */
  function pause(): void {
    if (audio === null) return;
    audio.pause();
    playing.value = false;
  }

  /** Resume the clip already loaded, wherever it was paused. ⚠️ Not `play()`:
   *  that one takes a clip and would re-seek to `start`, so pressing play after
   *  pause would jump backwards. */
  function resume(): void {
    if (audio === null || current.value === null) return;
    playing.value = true;
    start(audio);
  }

  /** The card's single play/pause button. */
  function toggle(item: PlayableItem): void {
    if (playing.value && isLoaded(item)) pause();
    else play(item);
  }

  /** Stop and forget the clip entirely — what `Vaciar` does. ⚠️ Different from
   *  `rewind`, which keeps the clip loaded and ready to play again. */
  function stop(): void {
    audio?.pause();
    current.value = null;
    playing.value = false;
    loading.value = false;
    elapsed.value = 0;
    mediaDuration.value = 0;
    pendingSeek = null;
  }

  /** ⚠️ See `endedHandler`. Registered once, by the queue store. */
  function setEndedHandler(handler: (() => void) | null): void {
    endedHandler = handler;
  }

  /** Stop and go back to `clip.start`, still loaded. What reaching `clip.end`
   *  does, and what a queue would replace with "advance". */
  function rewind(): void {
    const item = current.value;
    if (audio === null || item === null) return;
    audio.pause();
    audio.currentTime = item.start;
    playing.value = false;
    loading.value = false;
    elapsed.value = 0;
  }

  /**
   * Seek within the item, in seconds from its start. Clamped, so a click at the
   * very end of the bar cannot land past `end` and stop instantly.
   *
   * ⚠️ **The clamp is skipped while the length is still unknown** — a whole
   * episode whose waveform has not answered yet. Clamping to `duration.value`
   * would be clamping to `0`, i.e. every seek on a cold episode landing at
   * second zero, which is worse than an unclamped one the element itself
   * rejects if it is past the file.
   */
  function seek(seconds: number): void {
    const item = current.value;
    if (audio === null || item === null) return;
    const wanted = Math.max(seconds, 0);
    const offset = duration.value > 0 ? Math.min(wanted, duration.value) : wanted;
    const target = item.start + offset;
    audio.currentTime = target;
    elapsed.value = offset;

    /**
     * ⚠️ **Armed while the stream is still cold, cleared once it is not.**
     * Setting `currentTime` before the browser has metadata is silently
     * discarded — the same fact `pendingSeek` exists for — so "play this
     * episode from 41:00", which is one click on the map in `/episode/:id`,
     * would start at zero. `loading` is exactly the window between pressing
     * play and the first `timeupdate`, so outside it the seek has landed and
     * re-applying it from a later `canplay` (after a stall) would yank playback
     * backwards, which is what the note on `play()` warns about.
     */
    pendingSeek = loading.value ? target : null;
  }

  /** The click-seekable progress bar, in `0..1`. */
  function seekToFraction(fraction: number): void {
    seek(fraction * duration.value);
  }

  return {
    current,
    currentClipId,
    currentEpisodeId,
    playing,
    loading,
    elapsed,
    duration,
    isCurrent,
    isPlaying,
    isLoading,
    isCurrentEpisode,
    isPlayingEpisode,
    play,
    pause,
    resume,
    toggle,
    rewind,
    stop,
    seek,
    seekToFraction,
    setEndedHandler,
  };
});
