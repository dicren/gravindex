// Package-level flat config. The shared rules — including the repo-wide ban on
// `any` and the Prettier integration — live at the root and are SPREAD here;
// see the long comment in `../../eslint.config.mjs` for why `base` and
// `default` are two exports.
//
// ⚠️ `.mjs` and not `.ts`, matching the root and the backend: ESLint only reads
// a TypeScript config when it finds `jiti`, and there is nothing to gain in
// types here.
import { globalIgnores } from 'eslint/config';
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';
import pluginVue from 'eslint-plugin-vue';
import pluginVitest from '@vitest/eslint-plugin';
import pluginBoundaries from 'eslint-plugin-boundaries';
import { base } from '../../eslint.config.mjs';

/** The framework-free half of the app. Nothing here may import a UI library. */
const CORE_ELEMENTS = ['domain', 'application', 'infrastructure', 'config'];

/**
 * ⚠️ Packages that make a file part of the delivery layer, wherever it sits.
 * `@pinia/colada` is the one that matters most: a `useQuery` inside a use case
 * inverts the dependency rule this whole layout exists to enforce, and
 * `packages/frontend/CLAUDE.md` ("Where Pinia Colada lives") says so in prose.
 * This is that prose, made mechanical.
 */
const UI_ONLY_PACKAGES = ['vue', 'vue-router', 'vuetify', 'vuetify/**', 'pinia', '@pinia/colada'];

/**
 * ⚠️ RE-VERIFY THE BOUNDARIES AFTER TOUCHING THIS FILE. The rules' failure mode
 * is silence, not noise: without a working resolver, or with a selector shape
 * the plugin accepts but never matches, they report nothing and look green.
 * Four probes, run with `rm -f .eslintcache && npx eslint .` — the first three
 * must FAIL, the fourth must PASS:
 *
 *   1. a `src/vue/**` file importing `#/infrastructure/…`
 *        -> boundaries/dependencies (vue may not reach infrastructure)
 *   2. a `src/core/**` file importing `@pinia/colada`
 *        -> boundaries/external (core stays framework-free)
 *   3. a new `src/probe.ts` belonging to no element
 *        -> boundaries/no-unknown-files
 *   4. `src/main.ts` itself, which must stay clean — it is the one file no
 *      other probe covers, and the classification most easily broken.
 */
export default defineConfigWithVueTs(
  ...base,

  {
    name: 'app/files-to-lint',
    files: ['**/*.{vue,ts,mts,tsx}'],
  },

  // ⚠️ The generated API client is never edited by hand — `npm run generate:api`
  // rewrites it wholesale — so linting it would only produce findings nobody
  // can act on.
  globalIgnores(['**/dist/**', '**/coverage/**', 'src/core/infrastructure/generated/**']),

  ...pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    ...pluginVitest.configs.recommended,
    files: ['src/**/__tests__/*'],
  },

  // ── Hexagonal architecture, enforced ──────────────────────────────────────
  // The dependency rule points inward. This block is what makes that a lint
  // error rather than a convention people remember for a few weeks.
  {
    name: 'app/architecture-boundaries',
    files: ['src/**/*.{ts,vue}'],
    plugins: { boundaries: pluginBoundaries },
    settings: {
      // ⚠️ Without a resolver that understands the `#/*` and `@/*` aliases (and
      // extensionless imports), the plugin cannot map an import to a file — and
      // it silently SKIPS what it cannot resolve. The rule would then report
      // nothing at all and look like it was passing. If you touch this config,
      // re-verify with a deliberate violation.
      'import/resolver': {
        typescript: {
          project: ['./tsconfig.app.json', './tsconfig.vitest.json'],
          noWarnOnMultipleProjects: true,
        },
      },
      'boundaries/include': ['src/**/*'],
      // Whole trees, not per-feature subfolders: with `mode: 'folder'` and a
      // `src/core/*` pattern, files sitting at a tree's root belong to no
      // element, and `boundaries/dependencies` simply does not check unknown
      // files. `no-unknown-files` below then guarantees every new file lands in
      // one of these.
      'boundaries/elements': [
        { type: 'domain', pattern: 'src/core/domain' },
        { type: 'application', pattern: 'src/core/application' },
        { type: 'infrastructure', pattern: 'src/core/infrastructure' },
        { type: 'config', pattern: 'src/core/config' },
        { type: 'vue', pattern: 'src/vue' },
        // ⚠️ `mode: 'file'` is deprecated in v7 and emits one warning per lint
        // run. It stays anyway, because the suggested replacement is not the
        // same thing: with `partialMatch: false`, `src/main.ts` matches NO
        // element and `boundaries/no-unknown-files` then errors on the app's own
        // entry point (verified, not assumed). v7's real answer for a one-file
        // element is `boundaries/files` + a category, which is a different
        // classification concept — the policies below select by element TYPE.
        // Revisit when `mode` is actually removed.
        { type: 'main', pattern: 'src/main.ts', mode: 'file' },
      ],
    },
    rules: {
      'boundaries/no-unknown-files': 'error',
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            // domain imports nothing but itself.
            {
              from: { element: { type: 'domain' } },
              allow: { to: { element: { type: 'domain' } } },
            },
            {
              from: { element: { type: 'application' } },
              allow: { to: { element: { types: { anyOf: ['domain', 'application'] } } } },
            },
            {
              from: { element: { type: 'infrastructure' } },
              allow: {
                to: { element: { types: { anyOf: ['domain', 'application', 'infrastructure'] } } },
              },
            },
            // The composition root wires adapters to use cases, so it is the
            // one core element allowed to name a concrete implementation.
            {
              from: { element: { type: 'config' } },
              allow: {
                to: {
                  element: {
                    types: { anyOf: ['domain', 'application', 'infrastructure', 'config'] },
                  },
                },
              },
            },
            // ⚠️ `vue` may NOT reach `infrastructure`. A view that needs a
            // repository is a view skipping the use-case boundary; it takes the
            // ready-made use case from `config` instead.
            {
              from: { element: { type: 'vue' } },
              allow: {
                to: { element: { types: { anyOf: ['domain', 'application', 'config', 'vue'] } } },
              },
            },
            // The composition entry point may wire anything together.
            {
              from: { element: { type: 'main' } },
              allow: {
                to: {
                  element: {
                    types: {
                      anyOf: ['domain', 'application', 'infrastructure', 'config', 'vue'],
                    },
                  },
                },
              },
            },
          ],
        },
      ],

      // The inward rule again, for third-party code: `core/` stays
      // framework-free, which is precisely what lets its tests run with no
      // browser, no router and no store.
      //
      // ⚠️ This is a SEPARATE rule, and it has to be — despite v7 printing a
      // "migrate to boundaries/dependencies" warning on every run.
      // `boundaries/dependencies` governs imports between elements of THIS
      // project: a `to: { module: { origin: 'external' } }` policy there is
      // accepted by the schema and then silently matches nothing (verified —
      // with it, a `@pinia/colada` import inside a use case linted clean, which
      // is the worst possible failure mode for an architecture rule). Until
      // that rule actually sees third-party modules, the deprecated one is the
      // only one that works, and a warning beats a rule that quietly does
      // nothing. Re-verify with the probes below before ever swapping it.
      'boundaries/external': [
        'error',
        {
          default: 'allow',
          policies: [
            {
              from: { element: { types: { anyOf: CORE_ELEMENTS } } },
              disallow: UI_ONLY_PACKAGES,
              message:
                "core/ must stay framework-free, but this imports '{{dependency.source}}'. That package belongs in src/vue/: a Pinia Colada query WRAPS a use case from the delivery layer, it never lives inside one.",
            },
          ],
        },
      ],
    },
  },
);
