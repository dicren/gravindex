import type { CreateClientConfig } from '../generated/client.gen';
import { httpTransport } from './http-transport';

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

/**
 * The generated client's base URL, resolved once.
 *
 * ⚠️ The default is the CURRENT ORIGIN. The paths in `openapi.json` already
 * carry `/api`, and in production the backend serves this SPA and the API from
 * one host; in split dev the Vite proxy forwards `/api` to the backend. So
 * nothing about the API's location is baked into the bundle at build time.
 *
 * ⚠️ Absolute, not the bare relative prefix it could be. The generated client
 * concatenates `baseUrl + path` and hands the result to `new Request()`, which
 * only resolves a relative URL against the document — reliable in a browser
 * tab, not under Vitest's jsdom, where the global `Request` demands an absolute
 * URL. Resolving here keeps infrastructure testable without a browser.
 *
 * ⚠️ Exported, not just used below: `episode-audio-http.repository.ts` builds
 * its OWN client (a longer timeout for a ~1 MB `Range` read, see
 * `http-transport.ts`) and must resolve to the exact same origin — a second,
 * independently-computed base URL is how the two silently drift.
 */
export function resolveApiBaseUrl(): string {
  // Trailing slashes are stripped: the client concatenates, so one would
  // produce `//api/tags`.
  return (configuredBaseUrl || window.location.origin).replace(/\/+$/, '');
}

/**
 * Runtime configuration for the generated client. `@hey-api/openapi-ts` wires
 * this in itself (`runtimeConfigPath` in `openapi-ts.config.ts`), so the
 * settings apply wherever `generated/` is imported — there is no "configure the
 * client first" step anyone can forget.
 */
export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  baseUrl: resolveApiBaseUrl(),
  fetch: httpTransport,
});
