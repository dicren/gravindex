// **Request cancellation.** (`useFilteredList`, the paragraph headed "What is
// NOT here, deliberately: request cancellation and duplicate suppression", and
// `vue/queries/abortable.ts`, which is where the signal is actually taken.)
//
// Two claims live in this group and they are NOT the same claim:
//
//   A. *The correct response wins.* Whatever order the answers come back in, the
//      screen and the address show the term the visitor last typed. This is the
//      guarantee a visitor can feel.
//   B. *The superseded request is aborted.* Nothing on screen can tell B apart
//      from its absence — the claim is entirely about work that is NOT done — so
//      it is measured at the network, here, and nowhere else.
//
// ⚠️ **B was true only on paper until an `AbortSignal` was threaded end to
// end.** Pinia Colada aborts an outdated call's signal but cannot reach `fetch`
// by itself: the query function has to accept the signal, the domain port has to
// carry it, and the HTTP adapter has to hand it to the generated client. That
// chain once existed with its last hop missing, and an abandoned search ran to
// completion with nothing looking wrong. Both tests below pass; keeping them
// green is what stops that from happening again.

import { expect, test } from '../lib/fixtures';

const SEARCH = 'Buscar cortes';
const SLOW_TERM = 'zzzznotaterm';
const FAST_TERM = 'cancion';
const SLOW_MS = 4_000;

/** Hold the answer to one search until the next one has certainly overtaken it. */
async function delaySearch(
  page: import('@playwright/test').Page,
  term: string,
  delayMs: number,
): Promise<void> {
  await page.route('**/api/clips?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('search') === term) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    await route.continue();
  });
}

test.describe('superseded requests', () => {
  test('the last term typed is the one rendered, whatever order the answers arrive in', async ({
    page,
    gotoApp,
    api,
  }) => {
    await delaySearch(page, SLOW_TERM, SLOW_MS);
    await gotoApp('/');
    await expect(page.locator('.i-row').first()).toBeVisible();
    api.clear();

    const box = page.getByRole('searchbox', { name: SEARCH });
    await box.fill(SLOW_TERM);
    // Long enough for the debounce to fire the slow request…
    await expect.poll(() => api.clipLists().length).toBe(1);
    // …and now supersede it while it is still in flight.
    await box.fill(FAST_TERM);
    await expect.poll(() => api.clipLists().length).toBe(2);

    // The fast answer lands first and is what the screen shows.
    await expect(page.locator('.i-row').first()).toBeVisible();
    expect(new URL(page.url()).searchParams.get('search')).toBe(FAST_TERM);

    // Now wait past the slow answer's arrival: it must not overwrite anything.
    await page.waitForTimeout(SLOW_MS + 1_000);
    expect(new URL(page.url()).searchParams.get('search')).toBe(FAST_TERM);
    await expect(box).toHaveValue(FAST_TERM);
    // `zzzznotaterm` matches nothing; if its answer had won, the grid would be
    // the empty state instead of a page of cards.
    await expect(page.locator('.i-row').first()).toBeVisible();
    await expect(page.getByText('Esto está más vacío')).toHaveCount(0);
  });

  // ⚠️ **The only place the abort itself is observable.**
  //
  // A superseded request that runs to completion looks identical on screen — its
  // answer just lands in a cache key nobody is watching — so this test asserts on
  // the browser's own `requestfailed` event instead: exactly one in-flight
  // `/api/clips` request must end up there once the term is replaced.
  //
  // It goes red the moment the signal is dropped at ANY hop of
  // `clipListQueryOptions` → `abortable` → `listClipsUseCase.execute` →
  // `ClipRepository.list` → the HTTP adapter → the generated client → `fetch`.
  // That is exactly why it exists: at every one of those hops, forgetting the
  // parameter still compiles, still works, and silently un-fixes this.
  test('a superseded request is aborted rather than left running', async ({
    page,
    gotoApp,
    api,
  }) => {
    const aborted: string[] = [];
    page.on('requestfailed', (request) => {
      const url = new URL(request.url());
      if (url.pathname === '/api/clips') aborted.push(request.failure()?.errorText ?? 'unknown');
    });

    await delaySearch(page, SLOW_TERM, SLOW_MS);
    await gotoApp('/');
    await expect(page.locator('.i-row').first()).toBeVisible();
    api.clear();

    const box = page.getByRole('searchbox', { name: SEARCH });
    await box.fill(SLOW_TERM);
    await expect.poll(() => api.clipLists().length).toBe(1);
    await box.fill(FAST_TERM);
    await expect.poll(() => api.clipLists().length).toBe(2);

    await expect
      .poll(() => aborted.length, {
        message: 'the in-flight request for the abandoned term should have been aborted',
        timeout: SLOW_MS + 2_000,
      })
      .toBe(1);
  });
});
