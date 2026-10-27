import { watch } from 'vue';

import { usePlaybackStore } from '@/stores/playback.store';
import { useQueueStore, type QueuedItem } from '@/stores/queue.store';

/**
 * The system media session: what the lock screen draws, and what its buttons do.
 *
 * ⚠️ **Without this there is no lock screen at all, and on Android the queue
 * stops at the end of the first cut.** A page gets a media notification, media
 * keys and a `next` control only by populating `navigator.mediaSession`; the
 * browser supplies none of it from an `<audio>` element on its own. So what
 * somebody locking their phone mid-episode gets is: no title, no cover, no
 * transport, and — because the playback store stops at `clip.end` and hands over
 * to `queue.next()` which nobody can reach — silence from the second clip
 * onwards. The player itself is fine; it is only unreachable.
 *
 * ⚠️ **It draws nothing and owns nothing.** Every value below is read from
 * `playback` and `queue`, and every button calls the same store methods a
 * control on screen calls. There is no second queue, no second element, and no
 * state that could disagree with the player.
 *
 * Mounted once from `App.vue`, like `startAppUpdates`, and it returns its own
 * teardown.
 */

const noop = (): void => {};

/**
 * What the notification says the album is, for both kinds.
 *
 * ⚠️ A clip's `artist` is its **episode's** title and an episode's is the
 * podcast — the two are what a lock screen renders as "the thing inside this
 * thing". This line is the third level, and it is the site: stable, identical on
 * every item, and the only string here that is not API data.
 */
const ALBUM = 'Índice gravinero';

/** ⚠️ The podcast, named once: an episode has no `episodeTitle` to borrow. */
const EPISODE_ARTIST = 'Gravina82';

/**
 * How far the lock screen's two seek buttons jump when the browser does not say.
 *
 * The spec makes `seekOffset` optional, and Chrome's own pair of buttons sends
 * nothing, so the number has to exist here. Ten seconds is what the editor's
 * own `±10` nudges use, which is the smallest honest claim: this app's material
 * is speech, and a thumb on a lock screen cannot aim at a second.
 */
const DEFAULT_SEEK_OFFSET_SECONDS = 10;

/**
 * How far below `duration` a position has to stay, in seconds.
 *
 * ⚠️ **A `position` equal to `duration` throws in Chrome.** The spec says the
 * position must be strictly inside `[0, duration]`, Chrome reads the top of that
 * range as "the item is over, and this is not a valid state to report", and the
 * throw takes the whole update with it — every tick, for the last second of
 * every clip. A millisecond below is not a fudge anybody can see: a lock
 * screen's progress bar is drawn in whole percent.
 */
const POSITION_EPSILON_SECONDS = 0.001;

/**
 * Every action this app answers.
 *
 * ⚠️ **All of them are registered unconditionally, before anything is queued.**
 * Some browsers require a `play` handler to exist before they will raise the
 * notification at all, and the rest are the same shape of requirement: a session
 * that only gains `next` while something is playing gains it after the moment
 * the visitor locked the screen. Registering all eight once, at mount, costs
 * nothing — the ones a browser does not support throw and are ignored.
 */
const ACTIONS = [
  'play',
  'pause',
  'stop',
  'seekbackward',
  'seekforward',
  'seekto',
  'nexttrack',
  'previoustrack',
] as const;

type HandledAction = (typeof ACTIONS)[number];

/**
 * ⚠️ Wrapped, and around the **property access** rather than only the call — the
 * same rule the six `localStorage` readers in this package follow. Reading
 * `navigator.mediaSession` is absent in jsdom, absent in a sandboxed iframe and
 * absent over plain `http://` on a LAN, which is a real way to run the dev
 * server. There is nothing to feature-detect without touching `navigator`.
 */
function resolveMediaSession(): MediaSession | null {
  try {
    return globalThis.navigator?.mediaSession ?? null;
  } catch {
    return null;
  }
}

/**
 * What the notification should say, or `null` for "take it away".
 *
 * ⚠️ **`null` is a value, not a failure**, and it is what makes the notification
 * disappear when the queue is emptied. It is also the answer while the queue
 * points at a key hydration has not resolved yet: there is a title to show only
 * once the id is a clip or an episode, and inventing one would put a stale name
 * on somebody's lock screen.
 *
 * ⚠️ `MediaMetadata` is constructed inside the `try` because the constructor is
 * a separate global and this module's whole contract is that its absence must
 * not cost the app anything. A `null` costs the notification and nothing else.
 */
function metadataFor(item: QueuedItem | null): MediaMetadata | null {
  if (item === null) return null;

  // ⚠️ Only a real URL goes in `artwork`. An empty `src` is not "no cover" to a
  // browser, it is a request for the page itself — which it then tries to draw.
  const artwork: MediaImage[] = item.cover.trim() === '' ? [] : [{ src: item.cover }];

  try {
    return new MediaMetadata({
      title: item.title,
      artist: item.kind === 'clip' ? item.episodeTitle : EPISODE_ARTIST,
      album: ALBUM,
      artwork,
    });
  } catch {
    return null;
  }
}

/**
 * A position the session will accept: inside the item, and never equal to its
 * length. See `POSITION_EPSILON_SECONDS`.
 */
function positionWithin(duration: number, elapsed: number): number {
  const seconds = Number.isFinite(elapsed) ? elapsed : 0;
  const top = Math.max(0, duration - POSITION_EPSILON_SECONDS);
  return Math.min(Math.max(seconds, 0), top);
}

/**
 * Keep the system session in step with the player and the queue.
 *
 * ⚠️ This is the whole feature: a **one-way** projection of two stores onto an
 * interface the browser owns. Nothing here is ever read back, nothing here is
 * state, and tearing it down leaves the app exactly as it was — `mediaSession`
 * is not storage and losing it costs one notification.
 *
 * Returns its own teardown, which is idempotent: `App.vue` unmounts once, but a
 * second call must not throw at a session that is already gone.
 */
export function startMediaSession(): () => void {
  const session = resolveMediaSession();
  // ⚠️ Not an error and not a warning. jsdom, a sandboxed iframe and plain
  // `http://` on a LAN all look exactly like this, and in all three the app is
  // complete without a lock screen.
  if (session === null) return noop;

  return wire(session);
}

/**
 * The wiring, once we know there IS a session to wire.
 *
 * ⚠️ Split out rather than nested behind the guard above so that `session` is a
 * non-nullable parameter. Narrowing a `const` does not survive into the closures
 * below — every one of them would need a non-null assertion, which is one place
 * per line to get wrong instead of one signature. `pwa/start-app-updates.ts`
 * documents the same split for the same reason.
 */
function wire(session: MediaSession): () => void {
  const playback = usePlaybackStore();
  const queue = useQueueStore();

  let stopped = false;

  function applyMetadata(item: QueuedItem | null): void {
    if (stopped) return;
    try {
      session.metadata = metadataFor(item);
    } catch {
      // A session that refuses metadata still answers its buttons.
    }
  }

  /**
   * `'none'` is "there is no media here", and it is a different thing from
   * `'paused'`: an idle player with an empty queue must not offer a play button
   * on the lock screen that would start nothing. The two halves are `playing`
   * (what the element reports) and whether the element holds anything at all.
   */
  function applyPlaybackState(): void {
    if (stopped) return;
    const state: MediaSessionPlaybackState =
      playback.current === null ? 'none' : playback.playing ? 'playing' : 'paused';
    try {
      session.playbackState = state;
    } catch {
      // Same as above: the transport's handlers are the part that matters.
    }
  }

  /**
   * ⚠️ **Skipped entirely while the length is unknown**, which is the normal
   * state of the nine episodes nothing has measured (`GET
   * /episodes/:id/waveform`'s `to` is `0`) and of any whole episode on a cold
   * boot. `setPositionState` throws on `NaN`, on `Infinity` and on `0`, and an
   * uncaught throw there would take the rest of the session's work with it.
   * Not calling it is honest: the notification simply shows no progress bar,
   * which is exactly what the app knows.
   */
  function applyPositionState(): void {
    if (stopped) return;
    const duration = playback.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;

    try {
      session.setPositionState({
        duration,
        position: positionWithin(duration, playback.elapsed),
        playbackRate: 1,
      });
    } catch {
      // Chrome and Safari disagree about the edges of the accepted range; a
      // rejected update is a missing progress bar, never a broken session.
    }
  }

  /** Seconds into the item — the unit `playback.seek` takes, never an absolute
   *  position inside the episode. The store clamps again; this clamp is what
   *  keeps "forward" from asking for a number that means nothing. */
  function seekBy(offset: number): void {
    const duration = playback.duration;
    const limit = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
    playback.seek(Math.min(Math.max(playback.elapsed + offset, 0), limit));
  }

  const handlers: Record<HandledAction, (details: MediaSessionActionDetails) => void> = {
    /**
     * ⚠️ **Registered even though it looks redundant with a notification that
     * already exists**, and it is the handler some browsers want before they
     * raise that notification at all. `resume` rather than `play`, because the
     * element may already hold the item and pressing play must carry on from
     * where it was paused (`togglePlayback` is the with-nothing-loaded path).
     */
    play: () => {
      if (playback.current !== null) playback.resume();
      else queue.togglePlayback();
    },
    pause: () => playback.pause(),

    /**
     * ⚠️ **Recorded decision: `stop` pauses, it does not empty the queue.** A
     * media-session stop is a transport button on a lock screen, one thumb
     * away from `pause` — and emptying somebody's hand-arranged queue from there
     * would be destroying work with no undo. `/cola`'s `Vaciar` is the only
     * thing that clears a queue, and it says so.
     */
    stop: () => playback.pause(),

    seekbackward: (details) => seekBy(-(details.seekOffset ?? DEFAULT_SEEK_OFFSET_SECONDS)),
    seekforward: (details) => seekBy(details.seekOffset ?? DEFAULT_SEEK_OFFSET_SECONDS),

    /**
     * ⚠️ `seekTime` is optional in the spec and is **seconds into the item**,
     * which is what `playback.seek` takes — the episode's own offset is added
     * inside the store. A missing or non-finite value is ignored rather than
     * passed on as `NaN`, which the element would swallow silently.
     */
    seekto: (details) => {
      const seconds = details.seekTime;
      if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return;
      playback.seek(seconds);
    },

    nexttrack: () => queue.next(),
    previoustrack: () => queue.previous(),
  };

  for (const action of ACTIONS) {
    // ⚠️ **One `try` per action, on purpose.** Browsers throw for an action they
    // do not implement — and the set differs between Chrome, Firefox and Safari —
    // so a single `try` around all eight would lose the ones registered after
    // the first rejection.
    try {
      session.setActionHandler(action, handlers[action]);
    } catch {
      // Not supported here. The remaining seven still register.
    }
  }

  /**
   * Three watchers, one per thing the browser asks about, and all `flush: 'sync'`
   * because a session write left waiting in a microtask is a lock screen showing
   * the previous clip — there is no render here to batch with.
   *
   * 1. **`queue.current`** → metadata. The queue is where a title lives; the
   *    playback store only knows ids and a source.
   * 2. **`playback.current` + `playback.playing`** → playbackState. Both halves:
   *    `playing` alone cannot tell "paused" from "nothing loaded".
   * 3. **`playback.elapsed` + `playback.duration`** → position. `duration` is in
   *    the tuple because it is the number that turns a skipped call into a real
   *    one: it goes from `0` to a length when the element learns the file, with
   *    `elapsed` still at zero.
   */
  const stopWatchers = [
    watch(() => queue.current, applyMetadata, { flush: 'sync' }),
    watch(() => [playback.current, playback.playing] as const, applyPlaybackState, {
      flush: 'sync',
    }),
    watch(() => [playback.elapsed, playback.duration] as const, applyPositionState, {
      flush: 'sync',
    }),
  ];

  // The state the watchers will maintain, written once for a session mounted
  // onto a player that already holds something (a reload keeps the queue).
  applyMetadata(queue.current);
  applyPlaybackState();
  applyPositionState();

  return () => {
    if (stopped) return;
    stopped = true;

    for (const stop of stopWatchers) stop();

    for (const action of ACTIONS) {
      // ⚠️ `null` is the registered way to unregister, and this is why the
      // teardown has to name every action it registered rather than trusting
      // the browser to forget them.
      try {
        session.setActionHandler(action, null);
      } catch {
        // Same asymmetry as registration: one unsupported action must not stop
        // the rest from being released.
      }
    }

    try {
      session.metadata = null;
      session.playbackState = 'none';
    } catch {
      // Nothing left to release.
    }
  };
}
