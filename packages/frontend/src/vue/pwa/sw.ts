/// <reference lib="webworker" />

/**
 * The service worker.
 *
 * It exists for two things and nothing else: making the app **installable**, and
 * making it **open without a network**. It is deliberately not a caching layer
 * for this site's data.
 *
 * ⚠️ **Navigations go to the network, always.** This is the one decision the
 * whole file is arranged around, and it is not about freshness — it is about the
 * document being DIFFERENT per URL. The backend rewrites `<title>` and the
 * Open Graph / Twitter tags into `index.html` for a clip (`/:id`) and an episode
 * (`/episode/:slug`) as it serves them (`packages/backend/src/spa/spa-html.ts`),
 * and **nothing in this package puts a title back** — there is no
 * `document.title` anywhere in `src/`. A precached shell served for every route,
 * which is what a stock Workbox `navigateFallback` does, would quietly turn every
 * permalink's tab into "Índice gravinero". So the cached copy below is the
 * OFFLINE branch, reached only when `fetch` itself rejects.
 *
 * ⚠️ **Nothing here touches `/api`.** No route matches it, so every request —
 * reads, votes, tags, the fire-and-forget play counter and the `Range` reads
 * `GET /episodes/:id/audio` serves the client-side mp3 cutter — falls straight
 * through to the network. Caching a write would be a bug; caching a byte range
 * would be a subtler one.
 *
 * ⚠️ **And nothing here touches the audio.** `<audio>` streams the episode's mp3
 * from gravina82.com, cross-origin and in ranges; it matches no route and is in
 * no precache. Same for the Typekit stylesheet in `index.html`, which is
 * third-party and already has a real fallback chain in `gravinero.css`.
 *
 * ⚠️ **Nothing from the app may be imported here.** The plugin builds this file
 * with the main config's `resolve.alias`, so `@/stores/…` would resolve happily
 * and pull Vue, Pinia and half the delivery layer into a service worker — and no
 * lint rule stands in the way, because `eslint-plugin-boundaries` classifies by
 * element and this file's job is not to have dependencies. The e2e suite asserts
 * the built worker's size for exactly this reason.
 *
 * The client half of the update story — when a new version is APPLIED, and why
 * it waits for the audio to stop — is `start-app-updates.ts`, next door.
 */
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & {
  /**
   * The build's asset list, substituted here by `vite-plugin-pwa` (the
   * `injectManifest` strategy replaces this exact expression). Its contents are
   * decided by `injectManifest.globPatterns` in `vite.config.ts` — notably
   * WITHOUT the `eot`/`ttf`/`woff` cuts of the Material Design Icons font, which
   * are 3,3 MB of a 5,2 MB build that no browser capable of running a service
   * worker ever asks for.
   */
  readonly __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
};

/**
 * ⚠️ **Registered BEFORE the precache, and the order is the whole point.**
 * Workbox tries routes in registration order, and `PrecacheRoute` defaults to
 * `directoryIndex: 'index.html'` — so a request for `/` matches the precached
 * `index.html` even though `/` is not in the manifest. Registered the other way
 * round, the home page would come out of the cache: the one entry point most
 * people use would stop updating on entry, silently, and only until the worker
 * itself happened to update. `directoryIndex: ''` below says the same thing a
 * second time, because this is worth being wrong about twice before it breaks.
 */
registerRoute(
  new NavigationRoute(
    async ({ request }) => {
      try {
        return await fetch(request);
      } catch {
        /**
         * The offline branch: the shell exactly as the build produced it,
         * generic title and all. A generic title is the least of it here — the
         * app boots, the router renders, and every read fails into the error
         * state each view already has.
         *
         * ⚠️ Out of the PRECACHE, never out of a runtime cache of documents. A
         * copy of `/93` kept from three deploys ago names asset hashes that no
         * longer exist anywhere; the precached shell is versioned with the
         * worker, so it always names assets the worker is holding.
         */
        return (await matchPrecache('index.html')) ?? Response.error();
      }
    },
    {
      // ⚠️ `/api/docs` (Swagger UI) is a navigation and is not this SPA, and so
      // is typing `/api/clips` into the address bar. Without this, offline, both
      // would be answered with the app's own shell.
      denylist: [/^\/api(\/|$)/],
    },
  ),
);

precacheAndRoute(self.__WB_MANIFEST, {
  // See the navigation route above: this stops `/` from ever resolving to the
  // precached `index.html`.
  directoryIndex: '',

  /**
   * ⚠️ **`?v=` is what `@mdi/font` appends to its own font file**, and without
   * this the icon font is precached and then never used: the stylesheet asks for
   * `…woff2?v=7.4.47`, Workbox looks up that exact URL, misses, and goes to the
   * network. Offline that means every `mdi-` icon on the site renders as an empty
   * box, while 400 kB of precache sits there unread — measured in a browser, not
   * guessed. Workbox's own default drops `utm_*` and `fbclid`; these are the
   * same idea, and the two defaults have to be repeated because naming the
   * option replaces them.
   */
  ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^v$/],
});

/** Drops the precaches of previous builds. Without it they accumulate for ever. */
cleanupOutdatedCaches();

/**
 * ⚠️ **`skipWaiting` is never called on this worker's own initiative.** A worker
 * that activates the moment it installs reloads the page under whoever is
 * listening to a three-hour episode. The page decides when it is safe and says
 * so with this message — see `start-app-updates.ts`.
 */
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data !== null && typeof event.data === 'object' && 'type' in event.data) {
    if ((event.data as { type: unknown }).type === 'SKIP_WAITING') {
      void self.skipWaiting();
    }
  }
});

self.addEventListener('activate', (event) => {
  // Take over the pages that are already open, so the very first visit gets an
  // offline-capable app without needing a reload.
  event.waitUntil(self.clients.claim());
});
