import { beforeEach } from 'vitest';

/**
 * ⚠️ **Node 26 ships an experimental `localStorage` on `globalThis`.** Without
 * `--localstorage-file` it is unusable: reading it warns and yields `undefined`,
 * and it shadows the jsdom storage every spec in this package relies on. Vitest
 * keeps the jsdom instance it created on `globalThis.jsdom`, so where the global
 * is broken it is replaced with jsdom's own storage. The `Storage.prototype`
 * spies in the specs then see the same calls they always did.
 */
const jsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window;
if (jsdomWindow !== undefined) {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    if (typeof globalThis[name]?.clear !== 'function') {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        writable: true,
        value: jsdomWindow[name],
      });
    }
  }
}

/**
 * ⚠️ **No unit test may reach the network, and this is what enforces it.**
 *
 * Vitest's jsdom environment serves pages from `http://localhost:3000`, which is
 * exactly where this project's backend listens in local development — so a
 * component that fires a request during a test does not fail, it succeeds
 * against the real database. That is not a hypothetical: the queue store counts
 * a play the moment a clip starts (`registerPlayUseCase`), and mounting the
 * global player or the queue store in a spec wrote **39 rows into the local
 * database**, which surfaced much later as a failing row-count assertion with
 * nothing in it pointing back here.
 *
 * So the default `fetch` throws, loudly, naming the URL. A test that genuinely
 * exercises the HTTP layer replaces it — every `core/infrastructure` spec
 * already does, with its own `stubFetch` — and the assignment below puts the
 * guard back before the next one.
 *
 * ⚠️ The throw is caught downstream and turned into a `NetworkError` by
 * `translateHttpError`, which is the taxonomy working as designed: a fire-and-
 * forget call swallows it (`RegisterPlayUseCase`) and a read surfaces it as an
 * error state. Neither reaches a server, which is the whole point.
 */
function forbiddenFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return Promise.reject(
    new Error(
      `A unit test tried to fetch ${url}. Unit tests never reach the network: ` +
        'stub `globalThis.fetch`, or mock the use case in `#/config/*.config.ts`.',
    ),
  );
}

beforeEach(() => {
  globalThis.fetch = forbiddenFetch as typeof fetch;
});
