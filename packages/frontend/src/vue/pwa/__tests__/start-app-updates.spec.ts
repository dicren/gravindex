import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

import { isSafeToReload, startAppUpdates } from '@/pwa/start-app-updates';
import { usePlaybackStore } from '@/stores/playback.store';
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
