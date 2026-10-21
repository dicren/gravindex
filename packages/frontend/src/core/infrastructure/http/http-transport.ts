import ky from 'ky';

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * The transport every API call goes through: a `ky` instance handed to the
 * generated client as its `fetch` implementation (see `api-client.config.ts`).
 *
 * ⚠️ Why this shape. The app uses `ky` for its HTTP client, but
 * `@hey-api/openapi-ts` has no `ky` client plugin — its clients are `fetch`,
 * `axios`, `next` and `nuxt`. Rather than give up either half (generated paths,
 * or `ky`), the generated **fetch** client is pointed at `ky`, which is itself
 * a `fetch` wrapper. The generator keeps owning every URL; `ky` keeps owning
 * timeouts, retries and — when the anonymous voter token and the admin JWT
 * arrive — the one `beforeRequest` hook that attaches them.
 *
 * ⚠️ `throwHttpErrors: false` is load-bearing. `ky` rejects on any non-2xx by
 * default, which would blow past the generated client's own error handling
 * (`{ data, error, response }`) and turn every 404 into an exception from the
 * wrong layer. Status handling belongs in the repositories, via
 * `translate-http-error.ts`.
 */
const transport = ky.create({
  timeout: DEFAULT_TIMEOUT_MS,
  throwHttpErrors: false,
  // `ky` still retries idempotent requests on 429/5xx with `throwHttpErrors`
  // off; the default is 2. Writes (POST/PATCH/DELETE) are never retried, which
  // is what we want for votes and clip creation.
  retry: 2,
});

export const httpTransport: typeof fetch = (input, init) => transport(input, init);

// A `Range` read of an episode's mp3 (`episode-audio-http.repository.ts`) is
// not the few-hundred-byte JSON every other call here is: it is up to ~1 MB,
// and `DEFAULT_TIMEOUT_MS` was sized for the former. `.extend()` inherits
// everything else from `transport` — `throwHttpErrors: false`, `retry: 2`,
// any header hook added later — so this is a longer clock, not a different
// contract. Matches the backend's own `EPISODE_AUDIO_TIMEOUT_MS`.
const AUDIO_TIMEOUT_MS = 30_000;
const audioTransport = transport.extend({ timeout: AUDIO_TIMEOUT_MS });

export const audioHttpTransport: typeof fetch = (input, init) => audioTransport(input, init);
