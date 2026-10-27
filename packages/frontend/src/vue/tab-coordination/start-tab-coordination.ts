import { watch } from 'vue';

import { usePlaybackStore } from '@/stores/playback.store';
import { QUEUE_STORAGE_KEY, useQueueStore } from '@/stores/queue.store';

/**
 * **Two tabs of this site, one queue and one sound** (2026-10-27).
 *
 * Until this existed every tab was a player of its own: the queue in
 * `localStorage` was read once at boot and never re-read, so tab B never learned
 * what tab A had queued; both elements sounded at once; and because `persist()`
 * writes the whole record, a background tab with a stale clock rewrote `at` over
 * a position the other tab was actually listening at.
 *
 * ⚠️ **This is coordination, not a shared session.** There is no leader, no
 * lease and no command channel: a tab cannot press play, seek or skip in
 * another one. Two independent, cheap pieces do the work:
 *
 * 1. **The queue follows the last writer**, through the browser's own `storage`
 *    event — which fires in every OTHER tab of the origin and never in the one
 *    that wrote, exactly the semantics needed, and with no new storage key and
 *    no new persisted state. `queue.syncFromStorage()` is where the rules live.
 * 2. **A tab that starts sounding claims it**, and the others pause politely.
 *    That needs a message, hence `BroadcastChannel`; where the browser has none
 *    (or refuses to build one) the claim is simply not sent, and the tab behaves
 *    exactly as it did before 2026-10-27 — the queue coordination still works,
 *    because `storage` is older than `BroadcastChannel` by a decade.
 *
 * ⚠️ **Nothing state-shaped travels on the channel.** No message carries a queue,
 * a position or a title: the queue already travels through `localStorage`, and
 * duplicating it on the wire would be a second source of truth to keep in step.
 * A claim says one thing — "this tab is taking the sound" — and is worthless a
 * second later.
 *
 * ⚠️ **Nothing here is stored, server-side or otherwise.** The tab id is
 * generated per page load and lives in memory: it is not a fingerprint, it is
 * not persisted, and it never appears in the queue or in a request. It exists to
 * tell "me" from "another tab", nothing else.
 */

/** One channel for the whole origin. ⚠️ Not a storage key — nothing to migrate. */
const CHANNEL_NAME = 'gravindex.tabs';

/** What one tab says to the others. */
export interface PlayClaimedMessage {
  readonly type: 'play-claimed';
  readonly tabId: string;
}

export type TabMessage = PlayClaimedMessage;

/**
 * Which tab this is, for the life of this page load.
 *
 * ⚠️ **Module scope is the right scope, because one JS realm IS one tab.**
 * `Math.random` and not `crypto.randomUUID()`: it is an echo filter, not an
 * identifier, and `randomUUID` is missing from exactly the plain-`http://`-on-a-
 * LAN case `local-storage-voter-token.provider.ts` already has to work around.
 */
const tabId = createTabId();

function createTabId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * How this tab asks for the sound, set by `startTabCoordination()`.
 *
 * ⚠️ **A seam, not a channel**, and the same shape `setQueueResolver`,
 * `setEndedHandler` and `setErrorHandler` already have: the editor is a
 * component and the channel belongs to the shell, so the editor knocks and this
 * is the door. `null` — before `App.vue` mounts, or in a spec — makes
 * `claimPlayback()` a no-op rather than a throw.
 */
let claimer: (() => void) | null = null;

/**
 * **This tab is taking the sound.**
 *
 * Called by `startTabCoordination`'s own watcher when the player starts, and by
 * the clip editor when it plays — the editor owns an element of its own
 * (`utils/editor-audio.ts`) and never touches `playback.playing`, so a watcher
 * cannot see it.
 *
 * ⚠️ Deliberately not called for a pause, a stop or a seek: giving the sound up
 * needs no announcement, and a tab that is going quiet must not stop somebody
 * else's listening.
 */
export function claimPlayback(): void {
  claimer?.();
}

/**
 * The doors OUT of the sound for whoever does not drive `playback`.
 *
 * ⚠️ **One consumer, and it is the editor.** `onClaim` can pause the player
 * because the player is a store; the editor's element is a component's own, so
 * there is nothing here to call. This is the mirror of `claimer`: the editor says
 * "tell me when somebody else takes the sound" and decides for itself whether it
 * was playing. Empty — the normal case, since the editor mounts on one screen —
 * costs one loop over nothing.
 */
const soundTakenListeners = new Set<() => void>();

/**
 * **Somebody else is taking the sound.** Returns its own unsubscribe.
 *
 * ⚠️ Called whether or not this tab's PLAYER was sounding: a tab can be in the
 * editor with its element going and `playback` silent, and that is exactly the
 * case this exists for.
 */
export function onSoundTaken(listener: () => void): () => void {
  soundTakenListeners.add(listener);
  return () => {
    soundTakenListeners.delete(listener);
  };
}

/** `unknown` → a message this app understands. ⚠️ Anything else is ignored
 *  silently: the channel is public to every script on the origin. */
function asTabMessage(value: unknown): TabMessage | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as { type?: unknown; tabId?: unknown };
  if (candidate.type !== 'play-claimed') return null;
  if (typeof candidate.tabId !== 'string' || candidate.tabId === '') return null;
  return { type: 'play-claimed', tabId: candidate.tabId };
}

/** The door out: one message to every other tab, or nothing. */
interface TabChannel {
  post(message: TabMessage): void;
  close(): void;
}

/**
 * Open the channel, or answer `null`.
 *
 * ⚠️ **`null` is a working configuration**, exactly like a missing media session
 * or a `localStorage` that throws: old browsers, a sandboxed iframe, a private
 * mode with storage off. The app is complete without it — the only thing lost is
 * the courtesy pause, and the queue still follows the last writer through
 * `storage`.
 */
function openChannel(onClaim: (from: string) => void): TabChannel | null {
  const Channel = resolveBroadcastChannel();
  if (Channel === null) return null;

  try {
    const channel = new Channel(CHANNEL_NAME);
    channel.onmessage = (event: MessageEvent) => {
      const message = asTabMessage(event.data);
      if (message !== null) onClaim(message.tabId);
    };

    return {
      post: (message) => {
        try {
          channel.postMessage(message);
        } catch {
          // A channel the page closed under us. The claim is not worth a throw.
        }
      },
      close: () => {
        try {
          channel.close();
        } catch {
          // Already closed: nothing to release.
        }
      },
    };
  } catch {
    // A constructor that refuses (a blocked-storage sandbox does the same to
    // `BroadcastChannel`) leaves the app with one tab's worth of behaviour.
    return null;
  }
}

/** ⚠️ Guarded access, the same rule every `localStorage` helper here follows. */
function resolveBroadcastChannel(): typeof BroadcastChannel | null {
  try {
    const candidate = globalThis.BroadcastChannel;
    return typeof candidate === 'function' ? candidate : null;
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

function documentObject(): Document | null {
  try {
    return globalThis.document ?? null;
  } catch {
    return null;
  }
}

/**
 * Mount the two halves. Called ONCE, from `App.vue`, and it returns its own
 * teardown — the same contract as `startMediaSession` and
 * `startPlaybackReconciliation`, and for the same reason: it owns listeners,
 * not state.
 *
 * ⚠️ **It draws nothing**, and that is a decision rather than an omission.
 * There is no "otra pestaña está sonando" banner, no badge and no toast: a
 * visitor who presses play in the tab they are looking at is told what happened
 * by the transport in that tab, and the tab that went quiet was, by definition,
 * not the one being watched. A notice there would be a notice nobody reads.
 */
export function startTabCoordination(): () => void {
  const playback = usePlaybackStore();
  const queue = useQueueStore();

  /**
   * ⚠️ **Both halves of "this tab has the sound".** `playing` is the element's
   * verdict and lags a cold stream; `shouldBePlaying` is what was asked for. A
   * tab that has only been asked is still a tab somebody is listening to.
   */
  function hasTheSound(): boolean {
    return playback.playing || playback.shouldBePlaying;
  }

  /**
   * Somebody else is taking the sound.
   *
   * ⚠️ **The claim wins, always, and there is no tie-break on purpose.** Two
   * real presses can never be simultaneous — it takes a tab switch and a click
   * to produce one — so the only way to get two claims in the same instant is a
   * script, and "both tabs asked at once, so neither plays" is a truthful answer
   * to that. A window that let the earlier claim keep the sound (by id, by
   * whoever claimed first) would be a coin flip that can LEAVE TWO TABS SOUNDING,
   * which is the very thing this exists to prevent.
   *
   * ⚠️ **The one ordering that matters is free**: when A is already sounding and
   * B starts, A's own claim reached B *before* B had any sound, so B ignored it
   * — and B's claim reaches A now, so A pauses. The last tab to start sounding
   * keeps it, which is what a person pressing play means.
   *
   * ⚠️ **The pause is a pause, never a `stop()`**: it keeps the item loaded and
   * the position (`queue.store.ts` writes `at` on the `playing` watcher), so
   * pressing play in either tab carries on rather than starting the cut again.
   *
   * ⚠️ **The editor is told even when this tab's player is silent**, because the
   * two audio owners are independent: a tab can be in the editor with its element
   * going and nothing in `playback` at all.
   */
  function onClaim(from: string): void {
    if (from === tabId) return;
    if (hasTheSound()) playback.pause();
    for (const listener of soundTakenListeners) listener();
  }

  const channel = openChannel(onClaim);
  claimer = () => {
    channel?.post({ type: 'play-claimed', tabId });
  };

  /**
   * The queue another tab wrote.
   *
   * ⚠️ **`key === null` is `clear()`**, and adopting an empty queue is the right
   * answer to it too — but `syncFromStorage` decides, not this listener.
   */
  function onStorage(event: StorageEvent): void {
    if (event.key !== null && event.key !== QUEUE_STORAGE_KEY) return;
    queue.syncFromStorage();
  }

  const stopWatchingPlayback = watch(
    () => playback.playing,
    (isPlaying) => {
      if (isPlaying) claimPlayback();
    },
    // ⚠️ `sync`, so the claim leaves before anything else can react to the same
    // transition. A claim half a tick late is a claim the other tab could have
    // answered with one of its own.
    //
    // ⚠️ `playing` and not `hasAudio`: a tab resuming after a system pause has
    // produced audio before, so `hasAudio` would never claim again — and that
    // resume is precisely the case where two tabs have both been sounding for a
    // while.
    { flush: 'sync' },
  );

  const win = windowObject();
  const doc = documentObject();
  win?.addEventListener('storage', onStorage);

  /**
   * ⚠️ **A tab that was frozen, discarded or restored out of the back/forward
   * cache missed every `storage` event while it was away**, and it would come
   * back holding a queue nobody has any more. Both events are cheap and
   * idempotent: `visibilitychange` only on the way back, `pageshow` because a
   * BFCache restore does not necessarily change visibility.
   */
  function onReturn(): void {
    queue.syncFromStorage();
  }

  function onVisibilityChange(): void {
    if (doc?.visibilityState !== 'hidden') onReturn();
  }

  doc?.addEventListener('visibilitychange', onVisibilityChange);
  win?.addEventListener('pageshow', onReturn);

  return () => {
    stopWatchingPlayback();
    win?.removeEventListener('storage', onStorage);
    doc?.removeEventListener('visibilitychange', onVisibilityChange);
    win?.removeEventListener('pageshow', onReturn);
    channel?.close();
    claimer = null;
  };
}
