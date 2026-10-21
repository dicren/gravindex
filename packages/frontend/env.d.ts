/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Where the SPA sends its API calls, as a URL prefix prepended to the paths
   * in the OpenAPI document (which already carry `/api`).
   *
   * Empty — the default — means **same origin**, which is what production
   * wants: the backend serves this SPA and its API from one host. In split dev
   * (Vite on one port, Nest on another) the Vite proxy in `vite.config.ts`
   * forwards `/api` to the backend, so the default works there too and nothing
   * has to be set.
   *
   * Set it to an absolute origin (e.g. a backend on another machine) only to
   * bypass that proxy — which then needs `CORS=true` on the backend.
   */
  readonly VITE_API_BASE_URL?: string;

  /**
   * The GA4 measurement id (`G-XXXXXXXXXX`).
   *
   * ⚠️ **Absent is a working configuration, not a missing one.** With no id the
   * app loads no analytics, sets no cookie and shows no consent banner — there
   * would be nothing to consent to. That is the state of this repository, which
   * is public and where no real id is ever committed (root `AGENTS.md`), and the
   * state of every development machine unless somebody sets one.
   *
   * Nothing loads it before the visitor accepts, either: the tag is injected at
   * runtime by `vue/analytics/ga4.ts`, never from `index.html`.
   */
  readonly VITE_GA4_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * This package's `version`, substituted literally at build time by the `define`
 * block in `vite.config.ts`. The footer prints it.
 *
 * ⚠️ Not `import.meta.env`: those keys come from `.env` files and only the
 * `VITE_`-prefixed ones survive, whereas this value is read out of
 * `package.json` by the config itself. It is a plain global constant, not
 * something Vite polyfills.
 */
declare const __APP_VERSION__: string;
