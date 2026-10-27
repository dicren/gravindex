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
 * Everything this store listens for on the element.
 *
 * ⚠️ **It is a union of its own rather than `HTMLMediaElementEventMap`**, because
 * a test double has no DOM to borrow a map from and because this list is the
 * store's actual contract with the element — a shorter list here is the shortest
 * way to lose the event that mattered.
 */
export type PlaybackAudioEvent =
  | 'timeupdate'
  | 'canplay'
  | 'durationchange'
  | 'ended'
  | 'play'
  | 'playing'
  | 'pause'
  | 'waiting'
  | 'stalled'
  | 'suspend'
  | 'loadstart'
  | 'error';

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
  /** The element's own opinion. Absent on a fake that does not model it. */
  readonly paused?: boolean;
  play(): Promise<void> | void;
  pause(): void;
  /** Re-load the current `src` from scratch — how a stuck element is unstuck. */
  load(): void;
  /** Optional: real elements have it, fakes need not. `stop()` uses it to release the element. */
  removeAttribute?(name: 'src'): void;
  addEventListener(type: PlaybackAudioEvent, listener: () => void): void;
}

/**
 * How often the hidden-page watchdog looks at the element's clock.
 *
 * ⚠️ **Two seconds is a net's resolution, not a guarantee's.** See
 * `startPlaybackReconciliation` for what it can and cannot catch.
 */
export const WATCHDOG_INTERVAL_MS = 2000;

/**
 * Which load attempt the store is on.
 *
 * ⚠️ **Module scope on purpose**, and it is not shared state in any meaningful
 * sense: there is one audio element in the app, and this only exists so a
 * rejection from a load somebody else has already superseded can be recognised
 * and ignored. A `play()` on a new item bumps it, and so does the single retry
 * an `error` buys (below) — both mean "whatever was in flight is no longer the
 * attempt that counts".
 */
let loadGeneration = 0;

/**
 * ⚠️ **A real DOM node, appended to the document**, which is not a detail:
 * Safari is markedly better behaved with a media element that is in the tree —
 * it keeps `currentTime` and keeps playing in the background — than with one
 * that only exists as a variable.
 *
 * ⚠️ It is still ONE element and ONE construction of `new Audio()` (the e2e
 * suite counts constructions, not DOM nodes), `preload: 'metadata'` so a cold
 * clip does not pull a whole episode down, and `display: none` because there is
 * nothing to see.
 */
function createDefaultAudio(): PlaybackAudio {
  const element = new Audio();
  element.preload = 'metadata';
  element.setAttribute('playsinline', '');
  element.style.display = 'none';
  attachToDocument(element);
  return element;
}

/** ⚠️ Guarded twice: the property access, and the append. A sandboxed iframe or
 *  an SVG document has no body to append to, and the element plays fine
 *  detached — which is the state this store ran in before. */
function attachToDocument(element: HTMLAudioElement): void {
  try {
    const body = globalThis.document?.body ?? null;
    body?.appendChild(element);
  } catch {
    // No body, no append: not a reason to fail playback.
  }
}

/**
 * How the store gets its one audio element. Swapped in tests; never swapped at
 * runtime.
 */
let audioFactory: () => PlaybackAudio = createDefaultAudio;

/** Test seam. ⚠️ Call `resetAudioElementFactory()` afterwards. */
export function setAudioElementFactory(factory: () => PlaybackAudio): void {
  audioFactory = factory;
}

/** Restores the same factory the app boots with — the one that attaches the
 *  element to the document. */
export function resetAudioElementFactory(): void {
  audioFactory = createDefaultAudio;
}

/**
 * The `.name` of a rejection, read without trusting its type.
 *
 * ⚠️ A rejected `play()` is a `DOMException` in every browser, but the promise
 * reaches us as `unknown` and `any` is banned by lint, so it is narrowed before
 * anything is read off it. `null` means "not something with a name", which is
 * simply "not an abort".
 */
function rejectionName(reason: unknown): string | null {
  if (typeof reason !== 'object' || reason === null) return null;
  const name = (reason as { name?: unknown }).name;
  return typeof name === 'string' ? name : null;
}

/** ⚠️ `resume` is the Page Lifecycle API's event and never made it into
 *  TypeScript's `DocumentEventMap`, so the name is widened once here instead of
 *  casting at each call site. Browsers that never fire it simply never call the
 *  listener. */
const PAGE_LIFECYCLE_RESUME = 'resume' as keyof DocumentEventMap;

/** ⚠️ Property access inside the `try`, the same rule the six `localStorage`
 *  readers in this package follow: a sandboxed document throws on the access
 *  itself, not only on the call. */
function documentObject(): Document | null {
  try {
    return globalThis.document ?? null;
  } catch {
    return null;
  }
}

function windowObject(): Window | null {
  try {
    return (globalThis.window as Window | undefined) ?? null;
  } catch {
    return null;
  }
}

/** ⚠️ Defaults to "visible" when the answer cannot be read: reconciling costs
 *  one `play()` and doing nothing can cost somebody their audio. */
function pageIsHidden(): boolean {
  try {
    return globalThis.document?.visibilityState === 'hidden';
  } catch {
    return false;
  }
}

/**
 * Put the element's clock somewhere, tolerating an element that has nothing to
 * seek.
 *
 * ⚠️ **A load that never got as far as metadata leaves the element at
 * `HAVE_NOTHING`** — which is exactly the state a failed load leaves behind — and
 * a `currentTime` assignment there can raise `InvalidStateError`. Both callers
 * here are reachable from an `error` listener and from a click on the play
 * button, and neither may throw: a dead source has no position to go back to, so
 * losing the seek costs nothing. On a live element the assignment lands exactly
 * as it did before; the `try` is inert.
 */
function setPosition(element: PlaybackAudio, seconds: number): void {
  try {
    element.currentTime = seconds;
  } catch {
    // A source that never loaded has no position to go to.
  }
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
 * ### Intention and state are two different things (2026-10-27)
 *
 * ⚠️ **`playing` is the ELEMENT's state, not the store's intent.** It used to be
 * written only where this store itself called `play`/`pause`, which meant a
 * system pause — a phone call, headphones unplugged, a frozen tab, an OS-level
 * media key — left the play button lying: the store still believed it was
 * playing and the element had stopped. Now `play`/`playing` say true and
 * `pause`/`ended`/`error` say false, exactly as the element reports them, while
 * `shouldBePlaying` holds what was ASKED for. They part company in precisely
 * that case, and `reconcile()` is what puts them back together.
 *
 * ⚠️ The second half of the same problem: a `play()` rejected by the autoplay
 * policy used to be swallowed with the element stuck on the old source until a
 * reload. Now a rejection clears the intent, a first `error` buys one retry from
 * the CURRENT position, a second gives up and hands over to `setErrorHandler`,
 * and `stop()` is the manual door out.
 *
 * ### The queue plugs in here, and did
 *
 * This store was written with a global player in mind and said so: one element,
 * clips addressed by **id**, no component owning audio state. `queue.store.ts`
 * is that player's other half, and it needed exactly two seams here —
 * `setEndedHandler` and now `setErrorHandler`, below. **Order, persistence and
 * "what comes next" are not this store's business**, and keeping them out is
 * what lets it still be tested with four numbers and a string.
 */
export const usePlaybackStore = defineStore('playback', () => {
  /** What the element is currently loaded with. `shallowRef`: it is a plain
   *  value object, and nothing ever mutates it in place. */
  const current = shallowRef<PlayableItem | null>(null);
  /** ⚠️ **The element's state.** True from `play`/`playing`, false from
   *  `pause`/`ended`/`error` — never written because this store decided to play
   *  something. `shouldBePlaying` is the other half. */
  const playing = ref(false);
  /**
   * **The element has PRODUCED AUDIO for the current load** (2026-10-27).
   *
   * ⚠️ **`playing` answers "is the element unpaused"; this answers "did it ever
   * get as far as producing sound".** They are not the same question and the gap
   * between them is a real defect: a browser fires `play` the moment `play()` is
   * accepted — before any byte has arrived, and for a file that is about to 404
   * just as much as for a healthy one. Only the `playing` event means the
   * element actually has data and is running.
   *
   * ⚠️ **This is the only honest signal for "this attempt worked"**, and the
   * queue needs exactly that: it is what ends a run of dead files, so one notice
   * covers a whole batch instead of one per file. See `handleError` for the
   * other end of it — every failure clears it, because a failed attempt has
   * produced nothing by definition.
   *
   * ⚠️ `playing` is deliberately NOT narrowed to this: the transport must react
   * on `play`, or the play button looks dead for the whole of a cold remote
   * stream.
   */
  const hasAudio = ref(false);
  /** Between "the user pressed play" and the element producing anything: true
   *  from `play()` on a new item, and from `loadstart`/`waiting`/`stalled`,
   *  which is what makes it the ELEMENT's state too. False on
   *  `playing`/`canplay`/`timeupdate`. */
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

  /**
   * The intent: "this should be sounding".
   *
   * ⚠️ **Private, and read as `shouldBePlaying`.** `playing` above answers "is
   * it?", which is the element's business; this answers "should it be?", which
   * is the visitor's. Nothing outside reconciles the two except `reconcile()` —
   * a system pause must NOT be read as "they wanted silence", or the tab coming
   * back would stay silent for ever.
   */
  const intent = ref(false);

  /** ⚠️ Not reactive: it is an imperative resource, and a `ref` around a media
   *  element only invites templates to touch it. */
  let audio: PlaybackAudio | null = null;
  /** The `src` we last assigned, kept because the DOM normalises `audio.src`
   *  into an absolute URL — comparing against the raw string would reload the
   *  same mp3 on every clip of the same episode. `null` means "the element holds
   *  nothing", which is what `stop()` leaves behind. */
  let loadedSrc: string | null = null;
  /** Where to jump once the element is ready. ⚠️ Setting `currentTime` before
   *  the browser has metadata is silently discarded, which is why the seek
   *  waits for `canplay`. */
  let pendingSeek: number | null = null;
  /** Whether the current load already spent its one retry. Reset by every new
   *  item, or a flapping network would retry for ever. */
  let retriedThisLoad = false;
  /** The element's clock as the watchdog last saw it. `null` means "no
   *  baseline yet", so the first look only records one. */
  let lastClock: number | null = null;

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

  /**
   * What to do when an item cannot be played at all.
   *
   * ⚠️ **Sibling of `endedHandler`, and the same shape on purpose.** A dead
   * source means the queue should skip, and skipping is the queue's business;
   * this store still knows nothing about a queue. `null` falls back to
   * `rewind()` for exactly the reason `endedHandler` does — doing nothing at all
   * is the worst of the three.
   */
  let errorHandler: (() => void) | null = null;

  /** ⚠️ `null` while an EPISODE is playing, and that is the point: a clip row
   *  asking "is it me?" must not be answered by an episode's id. */
  const currentClipId = computed(() => (current.value?.kind === 'clip' ? current.value.id : null));
  const currentEpisodeId = computed(() =>
    current.value?.kind === 'episode' ? current.value.id : null,
  );

  /** The intent, read-only. ⚠️ A `computed` rather than the bare ref so nothing
   *  outside can set it: the two ways in are `play()`/`resume()` (true) and
   *  `pause()`/`rewind()`/`stop()` (false). */
  const shouldBePlaying = computed(() => intent.value);

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

  /**
   * The element accepted the instruction: it is unpaused and on its way.
   *
   * ⚠️ **`play` and `playing` are two different facts, and this split is the
   * whole point.** `play` fires the instant `play()` is accepted — before a
   * single byte has arrived, and *also* for a source that is about to fail.
   * `playing` is the one that only fires once the element has data and is
   * actually producing audio.
   *
   * ⚠️ **`playing` must stay responsive to `play`**, or the transport looks dead
   * for the whole of a cold remote stream. What "this attempt worked" therefore
   * needs is `hasAudio`, below — not a narrower `playing`.
   */
  function handlePlayInstruction(): void {
    playing.value = true;
    loading.value = false;
  }

  /**
   * ⚠️ **The element has produced audio for this load** — the only honest
   * signal that an attempt worked. See `hasAudio`.
   */
  function handlePlaying(): void {
    hasAudio.value = true;
    handlePlayInstruction();
  }

  /**
   * The element stopped, and **nobody here asked it to**.
   *
   * ⚠️ **The intent is deliberately untouched.** A call arriving, headphones
   * being unplugged or the OS pausing media all land here; treating that as "the
   * visitor pressed pause" is what would leave the tab silent for ever, because
   * `reconcile()` would then have nothing to restore.
   *
   * ⚠️ `hasAudio` is NOT touched either: it records that this load produced
   * sound at some point, which a pause does not undo.
   */
  function handlePaused(): void {
    playing.value = false;
  }

  /** ⚠️ The element is waiting for bytes, not for a decision: the loading window
   *  is the element's, and it reopens on a mid-clip stall. `suspend` is in the
   *  event union but is not one of these — it means "I stopped reading for now",
   *  which a playing element does all the time. */
  function handleLoading(): void {
    loading.value = true;
  }

  /** The end of a clip: hand over to the queue, or rewind if nothing is
   *  listening. ⚠️ `rewind()` FIRST when there is a handler too — the element
   *  must stop before anything else loads into it, or a slow `next` leaves the
   *  episode playing past the cut. */
  function handleEnded(): void {
    rewind();
    endedHandler?.();
  }

  /**
   * The element could not load or decode what it was given.
   *
   * ⚠️ **One retry, from where the listener actually is.** A blip on a remote
   * mp3 is the common case and it is worth a second attempt — but the retry has
   * to resume at the CURRENT position. Restarting at `item.start` would quietly
   * rewind somebody twelve minutes into a clip, which is worse than failing.
   *
   * ⚠️ **The second failure is not retried.** A source that failed twice is
   * dead (a 404, an unsupported codec), and retrying for ever is how a player
   * ends up in a loop nobody can see. The store gives up on the item and hands
   * over to `errorHandler` — skipping is the queue's decision, not this store's.
   */
  function handleError(): void {
    const item = current.value;
    playing.value = false;
    loading.value = false;
    // ⚠️ A failed attempt has produced no audio, whatever an earlier one did.
    hasAudio.value = false;

    if (audio === null || item === null) {
      intent.value = false;
      return;
    }

    if (retriedThisLoad) {
      intent.value = false;
      /**
       * ⚠️ **The dead source is forgotten here, and that is not tidying.**
       * `loadedSrc` is the store's belief that the element already holds this
       * URL, and after a load that failed twice that belief is the bug: the next
       * item of the SAME episode shares `src`, so `play()` would skip its
       * "a new file" branch entirely — no `load()`, an element still in its
       * error state, a `play()` that rejects without an `error` event, and a
       * player showing the next clip that does nothing when pressed. Clearing it
       * is the same half of `stop()`'s release (see there), which is what makes
       * the next `play()` of an already-attempted source a real load.
       *
       * ⚠️ `current` is deliberately left in place: the queue is about to
       * replace it, and clearing it here would blank the player for a frame.
       */
      loadedSrc = null;
      if (errorHandler !== null) errorHandler();
      else rewind();
      return;
    }

    retriedThisLoad = true;
    // ⚠️ `currentTime` is 0 before metadata, and then the only honest position
    // is what the last `timeupdate` reported.
    const position =
      audio.currentTime > item.start ? audio.currentTime : item.start + elapsed.value;
    const element = audio;

    // ⚠️ A retry is a NEW attempt, so it supersedes whatever the previous
    // `play()` is still waiting for — otherwise its rejection would clear a load
    // that is now the one that counts.
    loadGeneration += 1;
    element.src = loadedSrc ?? item.src;
    loadedSrc = item.src;
    element.load();
    // ⚠️ `load()` has just put the element back at `HAVE_NOTHING`, which is the
    // state a seek can refuse — see `setPosition`.
    setPosition(element, position);
    pendingSeek = position;
    start(element);
  }

  function handleCanPlay(): void {
    loading.value = false;
    if (audio === null || pendingSeek === null) return;
    audio.currentTime = pendingSeek;
    pendingSeek = null;
    /**
     * ⚠️ **The INTENT, not the state.** This asked `playing` when `playing` meant
     * "we asked for sound"; now that it means "the element says it is sounding",
     * the honest question is what the visitor wanted. The two differ on exactly
     * the case this branch exists for — a `canplay` that arrives for a load whose
     * `play` event has not landed yet — and pressing play again there is
     * harmless, while skipping it would leave a resumed stream paused.
     */
    if (intent.value) void start(audio);
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
      // ⚠️ The element's own state, which is what `playing` now IS. Registering
      // `play` as well as `playing` is not redundancy: the first fires the
      // moment the promise is accepted, the second once there is data, and a
      // transport that waits for the second can look unresponsive on a cold
      // stream. They are two different facts — see `hasAudio`.
      audio.addEventListener('play', handlePlayInstruction);
      audio.addEventListener('playing', handlePlaying);
      audio.addEventListener('pause', handlePaused);
      audio.addEventListener('loadstart', handleLoading);
      audio.addEventListener('waiting', handleLoading);
      audio.addEventListener('stalled', handleLoading);
      audio.addEventListener('error', handleError);
    }
    return audio;
  }

  /**
   * Call `play()` and deal with the rejection.
   *
   * ⚠️ **Autoplay policies reject this when there was no user gesture**, and a
   * `load()` interrupts an attempt already in flight — both arrive here as a
   * rejected promise. Two of those are not failures at all:
   *
   * - **a stale generation**: a later `play()` has already superseded this
   *   attempt, so its failure says nothing about the one that counts;
   * - **an `AbortError`**: the browser aborting a load it was told to abandon.
   *
   * Anything else is a real "it will not play", and the honest answer is to stop
   * claiming it should — without touching the position, because a failed play is
   * not a reason to lose somebody's place.
   */
  function start(element: PlaybackAudio): void {
    const generation = loadGeneration;

    const failed = (reason: unknown): void => {
      if (generation !== loadGeneration) return;
      if (rejectionName(reason) === 'AbortError') return;
      intent.value = false;
      playing.value = false;
      loading.value = false;
    };

    try {
      // ⚠️ `play()` is called SYNCHRONOUSLY and only the promise is awaited: a
      // test double — and a browser — reports `play` before `play()` returns,
      // and deferring the call to a microtask would make this store's state
      // disagree with the element's for a tick.
      void Promise.resolve(element.play()).catch(failed);
    } catch (reason) {
      // A synchronous throw is the same failure as a rejection.
      failed(reason);
    }
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

    // ⚠️ Every `play()` supersedes whatever is still in flight. This is what
    // lets an `AbortError` from a load somebody has already replaced be ignored
    // rather than reported as a fault.
    loadGeneration += 1;

    const fresh = !isLoaded(item);
    if (fresh) {
      retriedThisLoad = false;
      lastClock = null;
      current.value = item;
      elapsed.value = resumeOffset(item, at);
      loading.value = true;
    }

    /**
     * ⚠️ **The source question belongs to the ELEMENT, not to the item**, which
     * is why it is asked outside the "a new item" branch above. `stop()` releases
     * the source, and so does the give-up in `handleError` — which is what makes
     * the next item of the SAME episode work — and an element in either state
     * will not play again until it is pointed at the file. Skipping this because
     * "the item is already loaded" is precisely the stuck player this store
     * exists to remove (2026-10-27).
     *
     * ⚠️ The seek happens for a new item or a re-loaded source, never on a plain
     * resume: `play()` of the one already in the element means "carry on from
     * where you paused", which is what `toggle()` depends on.
     */
    if (fresh || loadedSrc !== item.src) {
      const target = item.start + elapsed.value;
      if (loadedSrc !== item.src) {
        element.src = item.src;
        loadedSrc = item.src;
        // A new file: whatever the last one lasted is not what this one lasts.
        mediaDuration.value = 0;
        // ⚠️ And whatever the last one produced is not what this one produces:
        // a fresh source has produced nothing yet.
        hasAudio.value = false;
        // ⚠️ Assigning `src` already starts the load; asking for it again
        // releases whatever the previous resource was still holding, which is
        // the whole difference between a fresh item and a stuck element.
        element.load();
        // ⚠️ A cold stream has no metadata yet, so the seek below is silently
        // discarded — `canplay` does it again. Only set this when the source
        // actually changed: left armed on an already-loaded element, a later
        // `canplay` (after a stall) would yank playback back to `clip.start`.
        pendingSeek = target;
      }
      setPosition(element, target);
    }

    intent.value = true;
    start(element);
  }

  /** Hold position. The card's play button while the clip is playing. */
  function pause(): void {
    intent.value = false;
    if (audio === null) return;
    audio.pause();
    playing.value = false;
  }

  /** Resume the clip already loaded, wherever it was paused. ⚠️ Not `play()`:
   *  that one takes a clip and would re-seek to `start`, so pressing play after
   *  pause would jump backwards. */
  function resume(): void {
    if (audio === null || current.value === null) return;
    intent.value = true;
    start(audio);
  }

  /** The card's single play/pause button. */
  function toggle(item: PlayableItem): void {
    if (playing.value && isLoaded(item)) pause();
    else play(item);
  }

  /**
   * Stop and forget the clip entirely — what `Vaciar` does. ⚠️ Different from
   * `rewind`, which keeps the clip loaded and ready to play again.
   *
   * ⚠️ **This is the way OUT of a stuck element, and that is why it releases the
   * source.** Pausing and leaving `src` assigned leaves the element pointed at a
   * resource it has decided not to play: a stream that never recovered, an mp3
   * that 404'd, a tab that was frozen mid-load. Forgetting `loadedSrc` as well
   * is the other half — it is what makes the next `play()` of the same item a
   * real load instead of "it is already in there", which is the one assumption
   * that stops being true after a release.
   */
  function stop(): void {
    intent.value = false;
    // ⚠️ Cleared FIRST: releasing the source below can make a real element
    // report an `error`, and there must be no item left for that to retry.
    current.value = null;
    if (audio !== null) {
      audio.pause();
      audio.removeAttribute?.('src');
      audio.load();
    }
    loadedSrc = null;
    playing.value = false;
    loading.value = false;
    hasAudio.value = false;
    elapsed.value = 0;
    mediaDuration.value = 0;
    pendingSeek = null;
    retriedThisLoad = false;
    lastClock = null;
  }

  /** ⚠️ See `endedHandler`. Registered once, by the queue store. */
  function setEndedHandler(handler: (() => void) | null): void {
    endedHandler = handler;
  }

  /** ⚠️ See `errorHandler`. Sibling of `setEndedHandler`: the queue decides to
   *  skip, this store still knows nothing about a queue. */
  function setErrorHandler(handler: (() => void) | null): void {
    errorHandler = handler;
  }

  /** Stop and go back to `clip.start`, still loaded. What reaching `clip.end`
   *  does, and what a queue would replace with "advance". */
  function rewind(): void {
    const item = current.value;
    if (audio === null || item === null) return;
    intent.value = false;
    audio.pause();
    /**
     * ⚠️ **A seek can throw, and the caller that matters is a failure.**
     * `handleError` falls back to `rewind()` when nothing is listening for the
     * failure, and after a load that never produced a byte the element is at
     * `HAVE_NOTHING`, where assigning `currentTime` raises `InvalidStateError`.
     * That would escape an event listener and take the page with it, for a
     * position a dead source does not have anyway. See `setPosition`.
     */
    setPosition(audio, item.start);
    playing.value = false;
    loading.value = false;
    elapsed.value = 0;
    lastClock = null;
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
     * would start at zero. `loading` is exactly the window in which the element
     * has not produced anything yet, so outside it the seek has landed and
     * re-applying it from a later `canplay` (after a stall) would yank playback
     * backwards, which is what the note on `play()` warns about.
     */
    pendingSeek = loading.value ? target : null;
  }

  /** The click-seekable progress bar, in `0..1`. */
  function seekToFraction(fraction: number): void {
    seek(fraction * duration.value);
  }

  /**
   * Is the ELEMENT actually playing?
   *
   * ⚠️ **Both halves have to agree, and that is the point.** `paused` is the
   * element's own opinion (absent on a test double that does not model it) and
   * `playing` is what its events last told us. A hidden tab is exactly the case
   * where one of them is wrong — and the watchdog, below, is what clears the
   * event half so this can answer "no" and let `reconcile()` restart it.
   */
  function elementIsPlaying(element: PlaybackAudio): boolean {
    const elementSaysPlaying = element.paused === undefined ? true : !element.paused;
    return elementSaysPlaying && playing.value;
  }

  /**
   * Put intention and state back together.
   *
   * ⚠️ **The whole reason the intent exists.** Called when the page becomes
   * visible again, when the page is resumed out of the back/forward cache, and
   * by the watchdog while it is hidden. Reads the ELEMENT, not the store's own
   * memory, so it works exactly as well for a pause nobody here asked for.
   *
   * ⚠️ Safe with nothing loaded and no element: both are the state on a cold
   * boot, and a reconciler that throws there would break the page's `pageshow`.
   */
  function reconcile(): void {
    if (current.value === null || audio === null) return;

    if (intent.value) {
      if (!elementIsPlaying(audio)) start(audio);
      return;
    }

    if (elementIsPlaying(audio)) audio.pause();
  }

  /**
   * One look at the element's clock, while the page is hidden.
   *
   * ⚠️ **A net, not the guarantee.** Chrome throttles timers in a hidden tab to
   * roughly one a minute, so this cannot be counted on to nudge anything
   * promptly; and a silent element that is still advancing its clock looks
   * perfectly healthy to it. What actually gets somebody their audio back is
   * `reconcile()` on `visibilitychange` — this is what covers the case where the
   * tab comes back and the element stayed frozen, i.e. the state that used to
   * need a reload.
   *
   * ⚠️ Two seconds without movement, with the intent still set, means the
   * element's own reports are not to be believed: `playing` is cleared so
   * `reconcile()` can see it as stopped, and the intent is untouched — this is a
   * nudge, never a decision to stop.
   */
  function watchdogTick(): void {
    if (!intent.value) {
      lastClock = null;
      return;
    }
    if (audio === null || current.value === null) return;

    const clock = audio.currentTime;
    if (lastClock !== null && clock === lastClock) {
      playing.value = false;
      reconcile();
    }
    lastClock = clock;
  }

  return {
    current,
    currentClipId,
    currentEpisodeId,
    playing,
    shouldBePlaying,
    hasAudio,
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
    reconcile,
    watchdogTick,
    setEndedHandler,
    setErrorHandler,
  };
});

/**
 * Wire the page's own events to `reconcile()`, plus the hidden-page watchdog.
 *
 * ⚠️ **This is the piece that makes a system pause survivable.** Nothing else in
 * the app notices that an element stopped while the visitor was away: the tab
 * going hidden and coming back, a resume out of the back/forward cache and a
 * `pageshow` are the three moments the platform gives us, and all three land
 * here.
 *
 * Mounted once from `App.vue`, like `startAnalytics`, and it returns its own
 * teardown — every listener removed and the interval cleared.
 */
export function startPlaybackReconciliation(): () => void {
  const doc = documentObject();
  const win = windowObject();

  let watchdog: ReturnType<typeof setInterval> | null = null;

  const stopWatchdog = (): void => {
    if (watchdog === null) return;
    clearInterval(watchdog);
    watchdog = null;
  };

  /** ⚠️ The first tick only RECORDS the clock, so that the one after it has
   *  something to compare against two seconds later rather than four. */
  const startWatchdog = (): void => {
    if (watchdog !== null) return;
    usePlaybackStore().watchdogTick();
    watchdog = setInterval(() => {
      usePlaybackStore().watchdogTick();
    }, WATCHDOG_INTERVAL_MS);
  };

  /**
   * ⚠️ Resolved lazily on every call, never at module scope: this function can
   * be imported before Pinia exists, and a store captured here would be the
   * wrong one in a test.
   */
  const reconcileNow = (): void => {
    usePlaybackStore().reconcile();
  };

  /** ⚠️ Only one of the two page states is worth an interval. */
  function syncWatchdog(): void {
    if (pageIsHidden()) startWatchdog();
    else stopWatchdog();
  }

  function onVisibilityChange(): void {
    // Read BEFORE syncing: going away is not a reason to touch playback, coming
    // back is.
    const hidden = pageIsHidden();
    syncWatchdog();
    if (!hidden) reconcileNow();
  }

  /** `resume` (Page Lifecycle) and `pageshow` (back/forward cache) mean the same
   *  thing here: the page was parked, and everything it believed about the
   *  element may have happened while it was not looking. */
  function onResume(): void {
    syncWatchdog();
    reconcileNow();
  }

  doc?.addEventListener('visibilitychange', onVisibilityChange);
  doc?.addEventListener(PAGE_LIFECYCLE_RESUME, onResume);
  win?.addEventListener('pageshow', onResume);

  // ⚠️ **A tab restored straight into the background never fires
  // `visibilitychange`**, so the net is also armed here: without it, the one
  // case it exists for — an installed app opened and immediately left — would
  // have nothing watching it at all.
  syncWatchdog();

  return () => {
    stopWatchdog();
    doc?.removeEventListener('visibilitychange', onVisibilityChange);
    doc?.removeEventListener(PAGE_LIFECYCLE_RESUME, onResume);
    win?.removeEventListener('pageshow', onResume);
  };
}
