import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

import { isSafeToReload, startAppUpdates } from '@/pwa/start-app-updates';
import {
  resetAudioElementFactory,
  setAudioElementFactory,
  usePlaybackStore,
  type PlayableItem,
  type PlaybackAudio,
  type PlaybackAudioEvent,
} from '@/stores/playback.store';
import { freshPinia } from '@/components/__tests__/mount-with-vuetify';

/**
 * The requirement this file guards is a negative one, and negatives are what
 * tests are for: **a new version must never announce itself, and must never
 * arrive while somebody is listening or cutting.**
 *
 * The happy path — a cold entry landing on the newest build — is not here and
 * cannot be: it happens because `sw.ts` sends navigations to the network, with
 * no message, no reload and nothing for this module to do. What is here is the
 * two cases where the app is already open, which is where the choices are.
 */

const SKIP_WAITING = { type: 'SKIP_WAITING' };

class FakeWorker {
  readonly postMessage = vi.fn();
  state: ServiceWorkerState = 'installing';
  private readonly listeners = new Set<() => void>();

  addEventListener(_type: 'statechange', listener: () => void): void {
    this.listeners.add(listener);
  }

  /** What the browser does when the worker finishes installing. */
  finishInstalling(): void {
    this.state = 'installed';
    for (const listener of this.listeners) listener();
  }
}

class FakeRegistration {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  readonly update = vi.fn(() => Promise.resolve());
  private readonly listeners = new Set<() => void>();

  addEventListener(_type: 'updatefound', listener: () => void): void {
    this.listeners.add(listener);
  }

  /** A new build shows up while the app is open. */
  findUpdate(worker: FakeWorker): void {
    this.installing = worker;
    for (const listener of this.listeners) listener();
    worker.finishInstalling();
    // The browser parks it as `waiting` only when something already controls
    // the page; on a first install it activates instead.
    if (this.controlled) this.waiting = worker;
  }

  controlled = false;
}

class FakeContainer {
  /** `null` means nothing controls this page yet, i.e. a first-ever visit. */
  controller: object | null = null;
  readonly registration = new FakeRegistration();
  readonly register = vi.fn(() => Promise.resolve(this.registration));
  private readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

/**
 * How a browser answers `play()`, in the three shapes the update policy has to
 * tell apart.
 *
 * - `refused` — the autoplay policy said no: the promise rejects with
 *   `NotAllowedError` and **not one event follows**. The element stays loaded,
 *   paused and silent, which is the state that used to make the play button lie.
 * - `sounding` — it really plays: `play` and `playing` fire and the promise
 *   resolves.
 * - `buffering` — a cold stream: `loadstart` and `waiting` fire and the promise
 *   stays pending, so the element has been asked to play and has produced
 *   nothing yet.
 */
type PlaybackBehaviour = 'refused' | 'sounding' | 'buffering';

/**
 * A stand-in for `HTMLAudioElement` that models **what the browser does**, not
 * what the app hopes for.
 *
 * ⚠️ **It exists because the regression is invisible with a friendly fake.** A
 * double whose `play()` always resolved and always emitted `play` would keep
 * every assertion on this file's positive side green while the app it describes
 * — one that cannot play at all — never updated itself. `pause()` emits
 * `'pause'`, as a real element does, so a system pause can be reproduced here
 * too, and `load()` and `currentTime`/`src` are here because the store drives
 * them and a fake that lacked them would throw instead of failing honestly.
 */
class FakeAudio implements PlaybackAudio {
  src = '';
  currentTime = 0;
  /** ⚠️ `NaN` before metadata, exactly as a real element reports it. */
  duration = Number.NaN;
  private readonly listeners = new Map<PlaybackAudioEvent, (() => void)[]>();
  private pausedFlag = true;

  constructor(private readonly behaviour: PlaybackBehaviour) {}

  /** The element's own opinion, which the store reads in `reconcile()`. */
  get paused(): boolean {
    return this.pausedFlag;
  }

  play(): Promise<void> {
    if (this.behaviour === 'refused') {
      // ⚠️ Nothing is emitted: a rejected `play()` leaves the element exactly
      // as it was, and a browser fires no event to say so.
      return Promise.reject(new DOMException('play() failed', 'NotAllowedError'));
    }

    this.pausedFlag = false;

    if (this.behaviour === 'buffering') {
      this.emit('loadstart');
      this.emit('waiting');
      // ⚠️ Never settles: the stream has produced nothing, so the request is
      // still open. The store's `loading` covers exactly this window.
      return new Promise<void>(() => {});
    }

    this.emit('play');
    this.emit('playing');
    return Promise.resolve();
  }

  pause(): void {
    this.pausedFlag = true;
    this.emit('pause');
  }

  /** The store calls this on a source change, on the single retry and on
   *  `stop()`. Nothing to do here: a fake has no bytes to release. */
  load(): void {}

  addEventListener(type: PlaybackAudioEvent, listener: () => void): void {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(type, [...existing, listener]);
  }

  /** What the browser reports while the visitor is not looking. */
  emit(type: PlaybackAudioEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

const Blank = defineComponent({ template: '<div />' });

function testRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Blank },
      { path: '/creator', name: 'creatorSearch', component: Blank },
      { path: '/creator/:title', name: 'creator', component: Blank },
      { path: '/admin/clips/:id', name: 'adminClip', component: Blank },
      { path: '/:id', name: 'clip', component: Blank },
    ],
  });
}

let container: FakeContainer;

/** Start the wiring the way `App.vue` does, on a given screen. */
async function start(path = '/') {
  freshPinia();
  const router = testRouter();
  await router.push(path);
  await router.isReady();

  const stop = startAppUpdates(router);
  await flushPromises();

  return { router, stop, playback: usePlaybackStore() };
}

beforeEach(() => {
  // ⚠️ Without this the module returns a no-op immediately: a dev build emits no
  // service worker, so there would be nothing to register.
  vi.stubEnv('PROD', true);

  container = new FakeContainer();
  Object.defineProperty(globalThis.navigator, 'serviceWorker', {
    value: container,
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  Reflect.deleteProperty(globalThis.navigator, 'serviceWorker');
});

describe('isSafeToReload', () => {
  it('is safe on an ordinary screen with nothing sounding', () => {
    expect(isSafeToReload({ playing: false, loading: false, routeName: 'home' })).toBe(true);
    expect(isSafeToReload({ playing: false, loading: false, routeName: 'queue' })).toBe(true);
  });

  it('is never safe while something is sounding', () => {
    expect(isSafeToReload({ playing: true, loading: false, routeName: 'home' })).toBe(false);
  });

  it('counts a cold stream as sounding', () => {
    // `loading` is the window between pressing play and the first `timeupdate`.
    // A reload there loses a play the visitor has already asked for.
    expect(isSafeToReload({ playing: false, loading: true, routeName: 'home' })).toBe(false);
  });

  it('is never safe where there is unsaved work, however quiet it is', () => {
    // ⚠️ The editor is quiet by this measure even while it is SOUNDING: it owns
    // its own audio element and never touches the playback store.
    expect(isSafeToReload({ playing: false, loading: false, routeName: 'creator' })).toBe(false);
    expect(isSafeToReload({ playing: false, loading: false, routeName: 'adminClip' })).toBe(false);
  });

  it('is safe on the episode search overlay, which shares the editor prefix', () => {
    // ⚠️ `/creator` is `creatorSearch`: the library with an overlay over it, and
    // nothing in it to lose. A path-prefix check could not tell the two apart.
    expect(isSafeToReload({ playing: false, loading: false, routeName: 'creatorSearch' })).toBe(
      true,
    );
  });
});

/**
 * The policy above decides nothing on its own: what it is handed comes straight
 * off `usePlaybackStore()`, and **the meaning of `playing` is what changed**
 * (2026-10-27). It is the ELEMENT's state now, not the store's intention — so
 * these four tests drive the real store over a fake element that behaves like a
 * browser, rather than feeding the function four literals.
 *
 * ⚠️ **The failure they exist to catch is a `playing` that means "we asked for
 * sound" again.** The first and the last are the cases where the two flags part
 * company — a refusal drives both to `false`, a system pause clears only the
 * state — and a policy fed the intent gets one of them wrong. The two in between
 * are the other side of the coin, so the policy cannot pass by answering "safe"
 * at everything.
 */
describe('isSafeToReload, read off the real playback store', () => {
  afterEach(() => resetAudioElementFactory());

  const clip: PlayableItem = {
    kind: 'clip',
    id: 137,
    src: 'https://example.test/episodes/93.mp3',
    start: 30,
    end: 90,
  };

  /** A fresh store over an element that answers `play()` as asked. */
  function storeWith(behaviour: PlaybackBehaviour) {
    const audio = new FakeAudio(behaviour);
    setAudioElementFactory(() => audio);
    freshPinia();
    return { audio, playback: usePlaybackStore() };
  }

  const judge = (playback: ReturnType<typeof usePlaybackStore>, routeName = 'home') =>
    isSafeToReload({
      playing: playback.playing,
      loading: playback.loading,
      routeName,
    });

  it('lets the app update itself when the browser refuses to play at all', async () => {
    const { audio, playback } = storeWith('refused');

    playback.play(clip);
    await flushPromises();

    // The attempt was real — the element took the source and the clip is what
    // the player is pointed at — and it is also over: rejected, silent.
    expect(audio.src).toBe(clip.src);
    expect(playback.current).toEqual(clip);
    expect(playback.loading).toBe(false);

    // ⚠️ **THE REGRESSION.** This is the state that used to strand the app on
    // an old build for ever: `playing` was written where the store itself
    // called `play()`, so a rejection the autoplay policy never told it about
    // left the flag raised, the app believing it was sounding, and
    // `isSafeToReload` answering "no" every time the queue went quiet. Nothing
    // is sounding here — the element never left `pause` — so applying a new
    // version costs the visitor nothing and must be allowed.
    expect(playback.playing).toBe(false);
    expect(judge(playback)).toBe(true);
  });

  it('still refuses while the element really is sounding', async () => {
    const { playback } = storeWith('sounding');

    playback.play(clip);
    await flushPromises();

    expect(playback.playing).toBe(true);

    // ⚠️ The other half, and the reason the test above cannot pass by accident:
    // a policy that answered "safe" unconditionally would reload on top of
    // somebody's audio, which is the one thing it exists to prevent. Here the
    // element fired `play` and `playing`, so there IS something to cut off.
    expect(judge(playback)).toBe(false);
  });

  it('counts a cold stream as sounding', async () => {
    const { playback } = storeWith('buffering');

    playback.play(clip);
    await flushPromises();

    // A stream that has produced nothing reports `waiting`, never `playing`: the
    // element is not sounding yet, so the state alone says "safe" and only the
    // loading window stops the reload. Somebody pressed play a second ago and
    // the bytes are on their way.
    expect(playback.playing).toBe(false);
    expect(playback.loading).toBe(true);

    expect(judge(playback)).toBe(false);
  });

  it('lets the app update after a pause nobody in the app asked for', async () => {
    const { audio, playback } = storeWith('sounding');

    playback.play(clip);
    await flushPromises();

    // A phone call, headphones unplugged, an OS media key: the element stops
    // itself and fires `pause`. The store keeps the INTENT (so `reconcile()`
    // can restore it when the page comes back) and clears the STATE — which is
    // the whole point of them being two flags.
    audio.emit('pause');

    expect(playback.shouldBePlaying).toBe(true);
    expect(playback.playing).toBe(false);

    // ⚠️ Nothing is sounding, so a new version may land: rounded off against
    // the intent this would answer "no" for an app that has been silent for
    // hours — the same trap as the regression above, one flag over. The queue
    // keeps its position, so the reload lands back where they were.
    expect(judge(playback)).toBe(true);
  });
});

describe('startAppUpdates', () => {
  it('registers nothing in a dev build', async () => {
    vi.stubEnv('PROD', false);

    await start();

    expect(container.register).not.toHaveBeenCalled();
  });

  it('registers nothing when the browser has no service workers at all', async () => {
    Reflect.deleteProperty(globalThis.navigator, 'serviceWorker');

    const { stop } = await start();
    stop();

    // Starting and tearing down without a container must be uneventful: an old
    // browser, or a page over plain `http://`, simply never updates itself.
    expect(container.register).not.toHaveBeenCalled();
  });

  it('applies a version left waiting by a previous session, on entry', async () => {
    // The whole "it updates by itself when you come in" path: the worker
    // installed during the last visit and has been waiting ever since.
    container.controller = {};
    const waiting = new FakeWorker();
    container.registration.waiting = waiting;

    await start();

    expect(waiting.postMessage).toHaveBeenCalledWith(SKIP_WAITING);
  });

  it('leaves a first installation alone', async () => {
    // Nothing controls the page, so the assets on screen came off the network
    // seconds ago: the worker activates by itself and there is nothing to
    // reload. Asking it to skip waiting here is what makes a first visit blink.
    container.controller = null;
    const installing = new FakeWorker();

    await start();
    container.registration.findUpdate(installing);
    await flushPromises();

    expect(installing.postMessage).not.toHaveBeenCalled();
  });

  it('does not cut the audio: it waits for playback to stop', async () => {
    container.controller = {};
    const { playback } = await start();
    playback.playing = true;

    const waiting = new FakeWorker();
    container.registration.controlled = true;
    container.registration.findUpdate(waiting);
    await flushPromises();

    expect(waiting.postMessage).not.toHaveBeenCalled();

    playback.playing = false;
    await nextTick();

    expect(waiting.postMessage).toHaveBeenCalledWith(SKIP_WAITING);
  });

  it('does not throw away an unpublished cut: it waits for the editor to close', async () => {
    container.controller = {};
    const waiting = new FakeWorker();
    container.registration.waiting = waiting;

    const { router } = await start('/creator/93-lo-que-sea');

    expect(waiting.postMessage).not.toHaveBeenCalled();

    await router.push('/');
    await nextTick();

    expect(waiting.postMessage).toHaveBeenCalledWith(SKIP_WAITING);
  });

  it('stops for good when the app is torn down', async () => {
    container.controller = {};
    const { playback, stop } = await start();
    playback.playing = true;

    const waiting = new FakeWorker();
    container.registration.controlled = true;
    container.registration.findUpdate(waiting);
    await flushPromises();

    stop();
    playback.playing = false;
    await nextTick();

    expect(waiting.postMessage).not.toHaveBeenCalled();
    expect(container.listenerCount('controllerchange')).toBe(0);
  });
});
