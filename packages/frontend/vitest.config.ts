import { fileURLToPath } from 'node:url';
// ⚠️ `defineConfig` MUST come from `vitest/config`, not from `vite`. Vitest 4
// (and 5) no longer augment Vite's own `defineConfig` with the `test` key, so the
// `vite` import type-checks fine until `vue-tsc` reaches this file and rejects
// `test` as an unknown property.
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

// `vite.config.ts` exports a config *function* (it needs `mode` for
// `loadEnv`), so resolve it with the same env before merging.
export default defineConfig((configEnv) =>
  mergeConfig(
    viteConfig(configEnv),
    defineConfig({
      test: {
        environment: 'jsdom',
        root: fileURLToPath(new URL('./', import.meta.url)),
        // ⚠️ One job: make `fetch` throw by default. jsdom serves these tests
        // from `http://localhost:3000`, which is where the real backend listens
        // in development — so an accidental request does not fail, it succeeds
        // against the dev database. Read the file; it happened.
        setupFiles: ['./vitest.setup.ts'],
        // Vuetify ships per-component `.css` side-effect imports. Left
        // externalized, Vitest loads them through Node's module loader, which
        // cannot parse `.css` — inlining routes them through Vite's transform.
        server: {
          deps: {
            inline: ['vuetify'],
          },
        },
      },
    }),
  ),
);
