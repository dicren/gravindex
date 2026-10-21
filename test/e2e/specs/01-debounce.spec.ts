// **The 500 ms debounce.** (`useFilteredList`, behaviour 2.)
//
// ⚠️ This looks like it needs a human watching the network panel and it does
// not: the claim is "one request, not one per keystroke", and that is a COUNT.
// Everything below counts `GET /api/clips` requests the page made.

import { expect, test } from '../lib/fixtures';

const SEARCH = 'Buscar cortes';

test.describe('the 500 ms debounce', () => {
  test('a burst of keystrokes produces exactly one request, carrying the whole term', async ({
    page,
    gotoApp,
    api,
  }) => {
    await gotoApp('/');
    await expect(page.locator('.i-row').first()).toBeVisible();

    // Everything before this point is the first load, which is not what is
    // under test.
    api.clear();

    await page.getByRole('searchbox', { name: SEARCH }).pressSequentially('cancion', {
      delay: 60,
    });

    // 7 keystrokes at 60 ms is 420 ms of typing: still inside the window, so
    // nothing may have gone out yet.
    expect(api.clipLists()).toHaveLength(0);

    await expect
      .poll(() => api.clipLists().length, { message: 'one request after the debounce' })
      .toBe(1);

    const [request] = api.clipLists();
    expect(request?.search.get('search')).toBe('cancion');

    // And it stays at one: no trailing request once the results land.
    await page.waitForTimeout(1_000);
    expect(api.clipLists()).toHaveLength(1);
  });

  test('the episode list debounces on its own endpoint', async ({ page, gotoApp, api }) => {
    await gotoApp('/episodes');
    await expect(page.locator('.ep-row').first()).toBeVisible();
    api.clear();

    await page
      .getByRole('searchbox', { name: 'Buscar episodio por título' })
      .pressSequentially('interruptus', { delay: 40 });

    // ⚠️ ONE list request, plus the two one-row probes behind the
    // `Todos · 395` / `Solo con cortes · 61` toggle, which are separate cache
    // entries and do not move with the search. Counting only `limit != 1`
    // is what keeps this a test of the debounce rather than of the probes.
    await expect
      .poll(() => api.episodeLists().filter((call) => call.search.get('limit') !== '1').length)
      .toBe(1);
    const list = api.episodeLists().filter((call) => call.search.get('limit') !== '1')[0];
    expect(list?.search.get('search')).toBe('interruptus');
    await expect(page.locator('.ep-row').first()).toContainText('Interruptus');
  });

  /**
   * ⚠️ **The other half of the same mechanism**, and the half that regressed
   * once: a NON-filter change commits immediately unless a filter debounce is
   * already pending. The paginator is gone, so what proves it now is the
   * infinite-scroll sentinel — a "load more" that waited half a second before
   * asking would make the list feel stuck.
   */
  test('loading the next batch is NOT debounced: it commits at once', async ({
    page,
    gotoApp,
    api,
  }) => {
    await gotoApp('/');
    await expect(page.locator('.i-row').first()).toBeVisible();
    api.clear();

    await page.getByRole('button', { name: /Cargar más cortes/ }).click();

    // ⚠️ `>= 1`, not `=== 1`: the click asks for the next batch immediately, and
    // landing those 24 rows can leave the sentinel inside the observer's margin
    // again, which legitimately asks for one more (the header of
    // `02-infinite-scroll.spec.ts` says the same). What proves "not debounced"
    // is the 400 ms window — comfortably under the 500 ms filter debounce — and
    // the page it commits, not the number of batches the observer follows it
    // with. Counting them was a race, and it lost about one full-suite run in
    // four on a warm machine.
    await expect.poll(() => api.clipLists().length, { timeout: 400 }).toBeGreaterThanOrEqual(1);
    expect(api.clipLists()[0]?.search.get('page')).toBe('2');
  });
});
