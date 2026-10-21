// **The PWA**: the manifest, the service worker, and the two things the service
// worker is not allowed to break.
//
// ⚠️ This group goes to the BACKEND (`API_URL`), not to the Vite dev server the
// rest of the suite uses. A dev build emits no service worker and no manifest at
// all, so a test pointed at `:5174` would pass by finding nothing — the same
// trap `09-meta-tags.spec.ts` documents for the injected meta tags.
//
// ⚠️ Nothing here writes a row. The service worker is proved with reads, a
// `caches` inspection and the browser's own offline switch.

import { API_URL } from '../lib/constants';
import { expect, test } from '../lib/fixtures';

interface ManifestIcon {
  readonly src: string;
  readonly sizes: string;
  readonly type: string;
  readonly purpose: string;
}

interface Manifest {
  readonly name: string;
  readonly short_name: string;
  readonly display: string;
  readonly scope: string;
  readonly start_url: string;
  readonly icons: readonly ManifestIcon[];
}

/** Every URL this browser has in a Cache Storage bucket, whatever the bucket. */
async function cachedUrls(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const urls: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(request.url);
    }
    return urls;
  });
}

/** Load a page and wait until a service worker is actually driving it. */
async function openControlled(page: import('@playwright/test').Page, path: string): Promise<void> {
  await page.goto(`${API_URL}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 15_000,
  });
}

test.describe('the PWA', () => {
  test.beforeAll(async () => {
    // ⚠️ Like the meta-tag group, this one needs a BUILT SPA for the backend to
    // serve — and a build made since the PWA landed, or there is no worker.
    const response = await fetch(`${API_URL}/sw.js`);
    if (response.status !== 200) {
      throw new Error(
        'the backend is serving no service worker, so there is no PWA to test. ' +
          'Run `npm run build -w packages/frontend`.',
      );
    }
  });

  test('serves a web manifest whose icons all exist', async () => {
    const response = await fetch(`${API_URL}/manifest.webmanifest`);

    expect(response.status).toBe(200);
    // Not `application/json`: a manifest served as anything else is ignored by
    // some browsers, and nothing in this repo sets the header by hand.
    expect(response.headers.get('content-type')).toContain('application/manifest+json');

    const manifest = (await response.json()) as Manifest;
    expect(manifest.name).toBe('Índice gravinero');
    expect(manifest.short_name).toBe('Gravina82');
    expect(manifest.display).toBe('standalone');
    expect(manifest.scope).toBe('/');
    expect(manifest.start_url).toBe('/');

    // Both purposes, both sizes. Android draws the maskable one and crops it;
    // without one it puts the square icon inside a white circle.
    expect(manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose}`).sort()).toEqual([
      '192x192 any',
      '192x192 maskable',
      '512x512 any',
      '512x512 maskable',
    ]);

    // ⚠️ A manifest that names an icon which 404s is a manifest that fails to
    // install, and nothing else in the build would notice.
    for (const icon of manifest.icons) {
      const image = await fetch(`${API_URL}${icon.src}`);
      expect(image.status, `${icon.src} is missing`).toBe(200);
      expect(image.headers.get('content-type')).toContain('image/png');
    }

    // iOS reads this one from the document rather than from the manifest.
    const appleIcon = await fetch(`${API_URL}/icons/apple-touch-icon.png`);
    expect(appleIcon.status).toBe(200);
  });

  test('registers a service worker that takes over the page it was opened on', async ({ page }) => {
    await openControlled(page, '/');

    const scope = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return registration.scope;
    });

    // The whole origin, which is what a `/sw.js` at the root buys.
    expect(new URL(scope).pathname).toBe('/');
  });

  test('keeps a clip permalink titled with the clip, service worker and all', async ({ page }) => {
    // ⚠️ **The regression this whole design exists to avoid.** The `<title>` of a
    // permalink is written by the backend per URL and nothing in the client puts
    // one back, so a worker that answered navigations out of its precache would
    // silently retitle every shared link "Índice gravinero".
    const clips = (await (await fetch(`${API_URL}/api/clips?limit=1`)).json()) as {
      results: ReadonlyArray<{ id: number; title: string }>;
    };
    const clip = clips.results[0];
    expect(clip, 'the test database has no clips').toBeDefined();
    if (clip === undefined) return;

    await openControlled(page, '/');
    await page.goto(`${API_URL}/${clip.id}`, { waitUntil: 'domcontentloaded' });

    // ⚠️ The precached shell's title is the build's own, `Índice gravinero`. Any
    // other value can only have come from the backend, this URL, just now.
    expect(await page.title()).toBe(`${clip.title} | Índice gravinero`);
  });

  test('serves the home document from the network too, not from the precache', async ({ page }) => {
    // ⚠️ **The one route that gets this wrong by default.** Workbox's precache
    // route appends `directoryIndex` (`index.html`) to any URL ending in `/`, so
    // `/` matches the precached shell even though it is not in the manifest —
    // and the home page, the commonest entry point of all, would quietly stop
    // updating on entry. The worker registers its navigation route first and
    // passes `directoryIndex: ''` to say so twice.
    //
    // ⚠️ The signal is the HEADERS, not `fromServiceWorker()`: that one is true
    // either way, because the worker answers the navigation in both cases — the
    // question is whether it went to the network to do it. The two paths carry
    // different headers, and they are the backend's own: `/` is served by the SPA
    // fallback, which sets `Cache-Control: no-cache` and no `Last-Modified`,
    // while the precached copy was fetched from the static `/index.html`, which
    // `express.static` serves with `public, max-age=0` and a `Last-Modified`.
    await openControlled(page, '/');

    const response = await page.goto(`${API_URL}/`, { waitUntil: 'domcontentloaded' });
    const headers = response?.headers() ?? {};

    expect(headers['cache-control']).toBe('no-cache');
    expect(headers['last-modified']).toBeUndefined();
  });

  test('does serve the hashed assets from the precache', async ({ page }) => {
    // The other half of the same claim: documents go to the network, everything
    // with a content hash in its name comes out of the cache. Without this, the
    // test above would also pass for a worker that caches nothing at all.
    //
    // ⚠️ It is `every`, not `some`, and that is what caught a real one: the icon
    // font is requested as `…woff2?v=7.4.47` because that is what `@mdi/font`'s
    // stylesheet writes, and Workbox looked up the exact URL, missed, and went to
    // the network — 400 kB precached and never read, and every icon an empty box
    // offline. See `ignoreURLParametersMatching` in `sw.ts`.
    await openControlled(page, '/');

    const cached: string[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/assets/') && !response.fromServiceWorker()) {
        cached.push(new URL(response.url()).pathname);
      }
    });
    const seen = page.waitForResponse((response) => response.url().includes('/assets/'));
    await page.goto(`${API_URL}/`, { waitUntil: 'load' });
    await seen;

    expect(cached).toEqual([]);
  });

  test('still opens with no network at all', async ({ page }) => {
    await openControlled(page, '/');
    // Give the precache time to finish before pulling the plug.
    await page.waitForFunction(async () => (await caches.keys()).length > 0, undefined, {
      timeout: 15_000,
    });

    await page.context().setOffline(true);
    try {
      // A route this browser has never visited: it can only come from the
      // precached shell.
      await page.goto(`${API_URL}/episodes`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#app')).toBeAttached();
      // The app really booted rather than the browser drawing its own error.
      await expect(page.locator('#app')).not.toBeEmpty();
    } finally {
      await page.context().setOffline(false);
    }
  });

  test('never caches anything from the API', async ({ page }) => {
    await openControlled(page, '/');

    // ⚠️ The listener goes on BEFORE the navigation that triggers the calls. The
    // library asks for clips and tags as it renders, so waiting for them after
    // `openControlled` waits for something that already happened.
    const clips = page.waitForResponse((response) => response.url().includes('/api/clips'));
    await page.goto(`${API_URL}/`, { waitUntil: 'load' });

    expect((await clips).fromServiceWorker()).toBe(false);

    const apiEntries = (await cachedUrls(page)).filter((url) =>
      new URL(url).pathname.startsWith('/api/'),
    );

    // ⚠️ Votes, tags and the play counter are writes; the audio endpoint serves
    // byte ranges. None of it may ever be answered from a cache.
    expect(apiEntries).toEqual([]);
  });

  test('precaches one copy of the icon font, not four', async ({ page }) => {
    await openControlled(page, '/');
    await page.waitForFunction(async () => (await caches.keys()).length > 0, undefined, {
      timeout: 15_000,
    });

    const fonts = (await cachedUrls(page))
      .filter((url) => url.includes('materialdesignicons-webfont'))
      .map((url) => url.slice(url.lastIndexOf('.')));

    // ⚠️ The font ships as eot/ttf/woff/woff2 and is 3,3 MB of a 5,2 MB build.
    // Precaching the lot would mean every visitor downloading three formats no
    // browser that can run this worker will ever ask for.
    expect(fonts).toEqual(['.woff2']);
  });

  test('does not precache the launcher icons', async ({ page }) => {
    // ⚠️ `vite-plugin-pwa` force-adds every icon named in the manifest to the
    // precache and its `includeManifestIcons` defaults to `true`, which silently
    // overrides `globIgnores` — 410 kB of icons the running page never renders,
    // riding along on every visitor's first load. Only the built `sw.js` showed
    // it; the plugin's own size report did not.
    await openControlled(page, '/');
    await page.waitForFunction(async () => (await caches.keys()).length > 0, undefined, {
      timeout: 15_000,
    });

    const icons = (await cachedUrls(page)).filter((url) =>
      new URL(url).pathname.startsWith('/icons/'),
    );

    expect(icons).toEqual([]);
  });

  test('keeps the worker a worker, with none of the app inside it', async () => {
    // ⚠️ The plugin builds `sw.ts` with the main config's aliases, so an
    // `@/stores/…` import there resolves happily and drags Vue, Pinia and half
    // the delivery layer into the service worker. No lint rule stands in the
    // way — `eslint-plugin-boundaries` classifies by element and a worker has no
    // element to belong to — so the size of the built file is the guard.
    const worker = await (await fetch(`${API_URL}/sw.js`)).text();

    expect(worker.length).toBeLessThan(60_000);
  });
});
