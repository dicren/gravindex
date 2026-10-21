import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';

import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * The version the footer prints, baked in at build time.
 *
 * ⚠️ `process.env` does not exist in a browser and Vite refuses to invent it,
 * so the replacement is a bare global constant — declared for TypeScript in
 * `env.d.ts`.
 *
 * `createRequire` rather than an `import ... with { type: 'json' }`: the import
 * attribute is still behind a flag in the Node this config runs under, and a
 * config file that only loads on some machines is worse than one boring line.
 *
 * The value is THIS package's `version` field. `vitest.config.ts` merges this
 * config, so the same constant exists under test and a spec can compare the
 * rendered string against `package.json`.
 */
const packageVersion: string =
  (createRequire(import.meta.url)('./package.json') as { version?: string }).version ?? '0';

// ⚠️ There is exactly ONE env file in this repository, at the root: it feeds
// `docker-compose.yml` and the backend, and `.env.example` is its committed
// template. Pointing Vite's `envDir` there keeps it that way instead of growing
// a second, package-local copy that drifts. Only `VITE_`-prefixed keys reach
// the bundle, so the database password sitting in the same file is not exposed.
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // '' as the prefix = load unprefixed keys too, so this config (Node side, not
  // the bundle) can read `SERVER_PORT` and `BACKEND_URL`.
  const env = loadEnv(mode, REPO_ROOT, '');
  const backendUrl = env.BACKEND_URL || `http://localhost:${env.SERVER_PORT || '3000'}`;

  return {
    envDir: REPO_ROOT,
    define: {
      __APP_VERSION__: JSON.stringify(packageVersion),
    },
    plugins: [
      vue(),
      vuetify({ autoImport: true }),

      /**
       * The PWA: a web manifest, an icon set, and a service worker that makes
       * the app installable and openable without a network.
       *
       * The two decisions worth reading before changing anything here are in
       * `src/vue/pwa/sw.ts` (why navigations never come out of the cache) and
       * `src/vue/pwa/start-app-updates.ts` (why a new build waits for the audio
       * to stop). What follows is only how they get built.
       */
      VitePWA({
        /**
         * ⚠️ **`injectManifest`, not the default `generateSW`.** Workbox's
         * generated worker answers every navigation with ONE precached
         * `index.html`, and in this app the document is different per URL: the
         * backend rewrites `<title>` and the Open Graph tags into it for a clip
         * and an episode as it serves them, and nothing in the client puts a
         * title back. A generated worker would therefore have quietly turned
         * every shared permalink's tab into "Índice gravinero".
         */
        strategies: 'injectManifest',
        srcDir: 'src/vue/pwa',
        filename: 'sw.ts',

        /**
         * ⚠️ No registration script in `index.html`. The app registers the
         * worker itself from `src/vue/pwa/start-app-updates.ts`, mounted in
         * `App.vue` beside `startAnalytics`, because deciding WHEN a new version
         * may take over needs the router and the playback store — neither of
         * which a script tag has.
         *
         * The plugin still injects `<link rel="manifest">` on its own, so
         * `index.html` must not carry one too.
         */
        injectRegister: null,

        /**
         * ⚠️ **Default `true`, and it quietly overrides `globIgnores`.** The
         * plugin force-adds every icon named in `manifest` to the precache, so
         * the ignore below silently only took the Apple one — 410 kB of launcher
         * icons rode along, measured after the fact in the built `sw.js`. The
         * launcher fetches these when somebody installs the app; the running page
         * never renders one.
         */
        includeManifestIcons: false,

        /**
         * ⚠️ `vitest.config.ts` merges this whole config, so without this the
         * plugin would run under every unit test — building a service worker
         * for a jsdom that has no `navigator.serviceWorker` to register it.
         */
        disable: mode === 'test',

        // A service worker in the dev server would cache a build that HMR is
        // busy replacing. `npm run dev` stays a plain SPA.
        devOptions: { enabled: false },

        manifest: {
          id: '/',
          name: 'Índice gravinero',
          // ⚠️ Under 12 characters, or a launcher truncates it. This is the
          // podcast's name, which is what somebody looks for on their phone —
          // "Índice gravinero" is what the site calls itself, and it is the one
          // shown while installing.
          short_name: 'Gravina82',
          description:
            'Los mejores momentos del podcast gravina82: cortados, etiquetados y listos para escuchar.',
          lang: 'es',
          dir: 'ltr',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          // ⚠️ The same value `index.html` already carries in its `theme-color`
          // meta. Two places, one number: change them together.
          theme_color: '#313131',
          // `stageEdge` from `theme/gravinero-theme.ts` — the dark edge of the
          // stage gradient, which is what the splash screen should look like.
          background_color: '#1d1d1d',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            {
              src: '/icons/icon-maskable-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: '/icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
          shortcuts: [
            { name: 'La cola', url: '/cola' },
            { name: 'Episodios', url: '/episodes' },
          ],
        },

        injectManifest: {
          globPatterns: ['**/*.{js,css,html,woff2,png,jpg,ico,svg}'],
          /**
           * ⚠️ **The Material Design Icons font ships in five formats and this
           * drops four of them.** `eot`, `ttf` and `woff` are 3,3 MB of a 5,2 MB
           * build, and no browser that can run a service worker asks for
           * anything but `woff2` — precaching them would mean every visitor
           * downloading three copies of a font to never use them. The `.css`
           * that names all five is precached and unchanged; the browser still
           * picks one.
           */
          /**
           * ⚠️ **And the install icons, which the app never asks for.** They are
           * fetched by the launcher when somebody installs the app, not by the
           * running page — precaching them would add ~450 kB to every visitor's
           * first load for five files no screen ever renders.
           */
          globIgnores: ['**/*.{eot,ttf,woff}', '**/*.map', '**/icons/*.png'],
        },
      }),
    ],
    resolve: {
      alias: {
        // Framework-free core: domain, application, infrastructure, config.
        '#': fileURLToPath(new URL('./src/core', import.meta.url)),
        // Vue delivery layer: views, components, stores, router, theme.
        '@': fileURLToPath(new URL('./src/vue', import.meta.url)),
      },
    },
    server: {
      /**
       * ⚠️ **Warm the lazily-imported screens, or the dev server reloads the
       * page under whoever is using it.** Auto-imported Vuetify components are
       * rewritten to `vuetify/components/VX`, and the dependency optimizer only
       * discovers the ones reachable from the entry on its first scan: the first
       * time a screen that needs another one is opened it logs "new
       * dependencies optimized" and does a full reload, which throws away the
       * navigation that caused it. The e2e suite hits this on every cold
       * `node_modules`, in the first test that opens a clip (`VChip` and
       * `VCombobox`, both first reached from `ClipView`), and stops hitting it
       * once the cache is warm — so it reads as a random flake.
       */
      warmup: {
        clientFiles: ['./src/main.ts', './src/vue/views/*.vue', './src/vue/views/*/*.vue'],
      },
      // Dev only. In production the backend serves this build itself, so the
      // SPA and the API share an origin and no proxy exists at all.
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
          // `changeOrigin` rewrites the outgoing `Host`, so any redirect the
          // backend builds from that header comes back pointing at the
          // upstream's origin — which the browser then blocks as cross-origin.
          // `autoRewrite` puts this server's host back into the `Location`.
          autoRewrite: true,
        },
      },
    },
  };
});
