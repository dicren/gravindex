import { watch } from 'vue';
import type { Router } from 'vue-router';

import { usePlaybackStore } from '@/stores/playback.store';

/**
 * How often a resumed app asks whether there is a new build, at most.
 *
 * ⚠️ It exists for the INSTALLED app, which is the case a service worker alone
 * does not cover: a standalone window can sit in the background for days and
 * never make a page load, so nothing would ever notice a deploy. A browser tab
 * left open has the same problem. Fifteen minutes is a request of a few hundred
 * bytes against the site's own origin, and only when somebody comes back to the
 * window.
 */
const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * The screens that hold work nobody has saved anywhere.
 *
 * ⚠️ **By route NAME, not by path prefix**, because `/creator` and
 * `/creator/:title` share one and mean opposite things: the first is
 * `creatorSearch`, which is the library with the episode overlay over it and has
 * nothing in it to lose, and the second is the editor.
 *
 * - `creator` — a cut in progress: start, end, title, tags, none of it sent.
 * - `adminClip` — `titleDraft`, `startDraft`, `endDraft` and `tagDraft`, four
 *   refs that exist nowhere but in that tab until the moderator saves.
 */
const ROUTES_WITH_UNSAVED_WORK: ReadonlySet<string> = new Set(['creator', 'adminClip']);

const noop = (): void => {};

export interface ReloadContext {
  /** `playback.playing`. */
  readonly playing: boolean;
  /** `playback.loading` — pressed play, stream still cold. Counts as playing. */
  readonly loading: boolean;
  /** The current route's `name`. */
  readonly routeName: string;
}

/**
 * Whether a new version may be applied **right now**, which means reloading the
 * page under whoever is using it.
 *
 * Two answers of "no", and both are about not destroying something:
 *
 * ⚠️ **Audio.** What plays here is a three-hour episode as often as it is a
 * forty-second cut, and a reload cuts it dead. The queue does remember where it
 * was (`gravindex.queue` has carried `at` since 2026-08-26), so the position is
 * not lost — but on a phone the browser blocks autoplay after a reload, so it
 * would come back silent and paused, which is worse than waiting.
 *
 * ⚠️ **Unsaved work**, which is the editor and the admin clip screen. Reloading
 * there throws away somebody's typing to save them a wait of minutes.
 *
 * ⚠️ **Neither half covers the other, and the editor is why.** `EditorView` owns
 * its own audio element (`utils/editor-audio.ts`) precisely because the playback
 * store clamps to a cut and it has to scrub the whole episode — so
 * `playback.playing` is `false` while the editor is sounding, and only the route
 * check protects it. In the other direction, somebody can be listening to an
 * episode from `/about`, where there is nothing to save.
 *
 * Everything else is fair game — a list, a permalink, the queue screen — because
 * the app's whole state at rest lives in `localStorage` and the URL.
 */
export function isSafeToReload(context: ReloadContext): boolean {
  if (context.playing || context.loading) return false;
  return !ROUTES_WITH_UNSAVED_WORK.has(context.routeName);
}

/**
 * ⚠️ Wrapped, and around the **property access** rather than only the call — the
 * same rule the six `localStorage` readers in this package follow. Reading
 * `navigator.serviceWorker` throws outright in a sandboxed iframe, and it is
 * simply absent over plain `http://` on a LAN, which is a real way to run the
 * dev server.
 */
function serviceWorkerContainer(): ServiceWorkerContainer | null {
  try {
    return globalThis.navigator?.serviceWorker ?? null;
  } catch {
    return null;
  }
}

/**
 * The update half of the PWA: keeps the app on the latest build, **silently**.
 *
 * There is no "a new version is available" notice anywhere in this app, and that
 * is the requirement rather than an omission. Nobody visiting an index of podcast
 * clips has an opinion about which build they are on, and a banner asking them
 * turns a solved problem into a question. So: the new version is fetched, and it
 * is applied at the first moment applying it costs nothing (see
 * `isSafeToReload`).
 *
 * ⚠️ **This is only half of "always up to date", and the smaller half.** The
 * service worker sends every navigation to the network (`sw.ts`), so a normal
 * cold entry already lands on the newest `index.html` and therefore the newest
 * bundle, with no worker message and no reload involved. What this function adds
 * is the two cases where there is no cold entry: a tab that stays open, and an
 * installed app that is resumed rather than launched.
 *
 * Mounted once from `App.vue`, like `startAnalytics`, and for the same reasons:
 * it needs the router and a store, and it must be torn down with the app that
 * owns them. It returns its own teardown.
 */
export function startAppUpdates(router: Router): () => void {
  // ⚠️ Dev builds emit no service worker at all (`devOptions.enabled: false` in
  // `vite.config.ts`), so registering one here would be a guaranteed 404 on
  // every `npm run dev` boot.
  if (!import.meta.env.PROD) return noop;

  const container = serviceWorkerContainer();
  if (container === null) return noop;

  return manageUpdates(container, router);
}

/**
 * The wiring, once we know there IS a container to wire.
 *
 * ⚠️ Split out rather than nested behind the guards above so that `container` is
 * a non-nullable parameter. Narrowing a `const` does not survive into the seven
 * closures below, and the alternative — a non-null assertion in each of them —
 * would be seven places to get wrong instead of one signature.
 */
function manageUpdates(container: ServiceWorkerContainer, router: Router): () => void {
  const playback = usePlaybackStore();

  let registration: ServiceWorkerRegistration | null = null;
  /** The installed-and-waiting worker we intend to activate, once it is safe. */
  let waiting: ServiceWorker | null = null;
  /** Set the moment we ask a worker to take over, and read by the reload guard. */
  let applying = false;
  let reloading = false;
  let lastCheckedAt = 0;
  let stopped = false;

  function apply(): void {
    if (stopped || waiting === null) return;
    if (
      !isSafeToReload({
        playing: playback.playing,
        loading: playback.loading,
        routeName: String(router.currentRoute.value.name ?? ''),
      })
    ) {
      return;
    }

    const worker = waiting;
    waiting = null;
    applying = true;
    worker.postMessage({ type: 'SKIP_WAITING' });
  }

  /**
   * ⚠️ A worker that finished installing is only an UPDATE if something was
   * controlling the page already. On a first visit there is no controller, the
   * worker activates on its own and claims the page — correct, and nothing to
   * reload, because the assets on screen came off the network seconds ago.
   */
  function track(worker: ServiceWorker | null): void {
    if (worker === null || container.controller === null) return;
    waiting = worker;
    apply();
  }

  /**
   * ⚠️ Guarded by `applying`, and that guard is load-bearing: `clients.claim()`
   * in the worker fires `controllerchange` on a FIRST install too, so without it
   * every visitor's first visit would end in a spurious reload.
   */
  function onControllerChange(): void {
    if (!applying || reloading) return;
    reloading = true;
    window.location.reload();
  }

  function onVisibilityChange(): void {
    if (document.visibilityState !== 'visible' || registration === null) return;
    const now = Date.now();
    if (now - lastCheckedAt < UPDATE_CHECK_INTERVAL_MS) return;
    lastCheckedAt = now;
    // A failed check is a network blink, not something to report.
    void registration.update().catch(noop);
  }

  container.addEventListener('controllerchange', onControllerChange);
  document.addEventListener('visibilitychange', onVisibilityChange);

  void container
    .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
    .then((reg) => {
      if (stopped) return;
      registration = reg;

      // ⚠️ **The "updates on entry" path.** A worker left waiting by a previous
      // session is still waiting now, and this is the moment it costs nothing:
      // the page has just loaded, so nothing is playing and nobody is mid-cut.
      track(reg.waiting);

      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (installing === null) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed') track(reg.waiting ?? installing);
        });
      });
    })
    .catch(noop);

  // Whatever was blocking the update — a clip sounding, the editor open — stops
  // blocking it eventually. This is what notices.
  const stopWatching = watch(
    () => [playback.playing, playback.loading, router.currentRoute.value.name] as const,
    () => apply(),
  );

  return () => {
    stopped = true;
    stopWatching();
    container.removeEventListener('controllerchange', onControllerChange);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
