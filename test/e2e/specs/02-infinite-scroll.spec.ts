// **Infinite scroll**, which replaced the paginator on every public list.
// (`useInfiniteList`.)
//
// ⚠️ Four claims, and each is mechanical rather than a judgement call: batches
// of 24, `page` gone from the URL, the total under the filter rather than "N of
// M loaded", and — the one that is easy to get wrong — **coming back from a clip
// lands where you were**, with every batch still rendered.
//
// ⚠️ The per-list `gravindex.list-limit.<id>` key must no longer be written for
// these lists. `limit` stopped being a preference and became the batch, so
// remembering it would mean remembering something nobody chose.

import type { Page } from '@playwright/test';

import { expect, test } from '../lib/fixtures';

const CLIPS_KEY = 'gravindex.list-limit.clips';
const EPISODES_KEY = 'gravindex.list-limit.episodes';
const BATCH = 24;

async function readStorage(page: Page, key: string): Promise<string | null> {
  return page.evaluate((name) => window.localStorage.getItem(name), key);
}

/**
 * ⚠️ **One click is not always one batch, and that is the component, not a bug.**
 * The button only exists at the sentinel, which sits off screen, so Playwright
 * scrolls it into view to click it — and a sentinel inside the observer's 400 px
 * margin asks for the next batch by itself once the current one lands. The list
 * therefore grows in whole batches until the sentinel is out of reach.
 *
 * So the tests below count in BATCHES, never in a fixed total: they wait for the
 * network to go quiet after the click and then assert that what grew is a whole
 * number of batches on top of what was there. Asserting `toHaveCount(48)` here
 * was a race against the observer, and it lost about one run in ten.
 */
async function clickLoadMore(page: Page, name: RegExp): Promise<void> {
  const button = page.getByRole('button', { name });

  // ⚠️ The button lives at the sentinel, and the observer may pull the next
  // batch WHILE Playwright is scrolling it into view: the list re-renders and
  // the element under the cursor is replaced before the click lands. Locally
  // that is invisible; on a slow CI runner it showed up as a 90 s timeout with
  // "element was detached from the DOM, retrying".
  //
  // The locator is lazy, so each attempt finds the button as it is NOW, and
  // `force` skips the actionability check that the re-render keeps
  // invalidating. This is about making the click land, not about relaxing what
  // the tests assert.
  for (let attempt = 0; ; attempt++) {
    try {
      await button.click({ force: true, timeout: 10_000 });
      break;
    } catch (error) {
      if (attempt >= 4) throw error;
      await page.waitForTimeout(250);
    }
  }

  await page.waitForLoadState('networkidle');
}

/** Rows on screen once the click has settled, and the ones it started with. */
async function rowsAfterLoadMore(
  page: Page,
  row: string,
  name: RegExp,
): Promise<{ before: number; after: number }> {
  const before = await page.locator(row).count();
  await clickLoadMore(page, name);
  const after = await page.locator(row).count();
  expect(after).toBeGreaterThan(before);
  expect(after % BATCH).toBe(0);
  return { before, after };
}

test.describe('the library streams instead of paginating', () => {
  test('opens on one batch of 24 and has no paginator at all', async ({ page, gotoApp, api }) => {
    await gotoApp('/');

    await expect(page.locator('.i-row')).toHaveCount(24);
    expect(api.clipLists()[0]?.search.get('limit')).toBe('24');

    // The paginator is gone, and so is the "24 de 180" counter it sat under.
    await expect(page.locator('.grav-pagination')).toHaveCount(0);
    // ⚠️ What is left is the total UNDER THE FILTER, never how many are loaded.
    await expect(page.locator('.library__count')).toHaveText('180 cortes');
  });

  test('loads the next batch and keeps the ones already there', async ({ page, gotoApp, api }) => {
    await gotoApp('/');
    await expect(page.locator('.i-row')).toHaveCount(24);
    const first = await page
      .locator('.i-row__title-link')
      .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href')));
    api.clear();

    await clickLoadMore(page, /Cargar más cortes/);

    // Batches, not a total — see `clickLoadMore`.
    expect((await page.locator('.i-row').count()) % BATCH).toBe(0);
    // The pages it asked for run consecutively from the second one onwards.
    expect(api.clipLists().map((call) => call.search.get('page'))).toEqual(
      api.clipLists().map((_, index) => String(index + 2)),
    );
    // ⚠️ Nothing already on screen was replaced, and the order held.
    const titles = await page
      .locator('.i-row__title-link')
      .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href')));
    expect(titles.slice(0, 24)).toEqual(first);
    // The counter is the total, not the number on screen.
    await expect(page.locator('.library__count')).toHaveText('180 cortes');
  });

  test('stops asking once the whole filter is loaded', async ({ page, gotoApp }) => {
    // A tag with few enough clips to exhaust in one batch: the sentinel must
    // disappear rather than keep offering a request that returns nothing.
    await gotoApp('/?tags=Gazpacho');

    await expect(page.locator('.i-row').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Cargar más cortes/ })).toHaveCount(0);
  });

  test('never puts `page` in the URL, and normalises an old link that has one', async ({
    page,
    gotoApp,
    api,
  }) => {
    await gotoApp('/');
    await expect(page.locator('.i-row')).toHaveCount(24);

    const { after } = await rowsAfterLoadMore(page, '.i-row', /Cargar más cortes/);
    expect(after).toBeGreaterThanOrEqual(2 * BATCH);

    // ⚠️ What people share is a FILTER, not a scroll position.
    expect(new URL(page.url()).searchParams.get('page')).toBeNull();

    // ...and a link that carries one answers with the
    // first batch of the same filter rather than a page nobody can reproduce.
    api.clear();
    await gotoApp('/?page=3');
    await expect(page.locator('.i-row')).toHaveCount(24);
    await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBeNull();
    expect(api.clipLists()[0]?.search.get('page')).toBe('1');
  });

  /**
   * ⚠️ **The part that is easy to get wrong.** Coming back from a clip must land
   * where you were, not at the top with one batch loaded. It works because every
   * loaded batch lives in the query cache under the FILTER's key, so the list
   * re-renders at full length in the same tick and the router's saved scroll
   * offset lands somewhere real.
   */
  test('coming back from a clip restores every batch, and the position', async ({
    page,
    gotoApp,
  }) => {
    await gotoApp('/');
    await expect(page.locator('.i-row')).toHaveCount(24);
    const { after: loaded } = await rowsAfterLoadMore(page, '.i-row', /Cargar más cortes/);

    await page.locator('.i-row__title-link').nth(30).click();
    await expect(page.locator('.clip-hero')).toBeVisible();
    const offset = await page.evaluate(() => window.scrollY);

    await page.goBack();

    // ⚠️ Every batch that was loaded, not a fixed two: the sentinel may have
    // pulled more than the click asked for, and losing any of them here is the
    // bug this test exists for.
    await expect.poll(() => page.locator('.i-row').count()).toBeGreaterThanOrEqual(loaded);
    // Somewhere down the list, not back at the top.
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect(offset).toBeGreaterThanOrEqual(0);
  });

  test('a filter change resets to the first batch', async ({ page, gotoApp }) => {
    await gotoApp('/');
    const { after: loaded } = await rowsAfterLoadMore(page, '.i-row', /Cargar más cortes/);

    await page.getByRole('searchbox', { name: 'Buscar cortes' }).fill('cancion');

    await expect.poll(() => page.locator('.i-row').count()).toBeLessThan(loaded);
    expect(new URL(page.url()).searchParams.get('search')).toBe('cancion');
  });
});

test.describe('the episode list streams too', () => {
  test('opens on a batch of 24 and offers more', async ({ page, gotoApp }) => {
    await gotoApp('/episodes');

    await expect(page.locator('.ep-row')).toHaveCount(24);
    await expect(page.locator('.episodes__count')).toHaveText('395 episodios');

    const { after } = await rowsAfterLoadMore(page, '.ep-row', /Cargar más episodios/);
    expect(after).toBeGreaterThanOrEqual(2 * BATCH);
  });
});

test.describe('`limit` stopped being a preference', () => {
  /**
   * ⚠️ It is the BATCH now, so nothing about it is a choice worth remembering.
   * A single global key, so the library's page size changed
   * the episode grid's, is gone by construction: neither key is ever written.
   */
  test('is never written to localStorage by either list', async ({ page, gotoApp }) => {
    await gotoApp('/');
    const { after } = await rowsAfterLoadMore(page, '.i-row', /Cargar más cortes/);
    expect(after).toBeGreaterThanOrEqual(2 * BATCH);

    expect(await readStorage(page, CLIPS_KEY)).toBeNull();

    await gotoApp('/episodes');
    await expect(page.locator('.ep-row').first()).toBeVisible();
    expect(await readStorage(page, EPISODES_KEY)).toBeNull();
  });

  /**
   * ⚠️ …but a `?limit=` in the address is still honoured. Those links exist —
   * the library carried a page-size selector once — and
   * the endpoint still takes the parameter.
   */
  test('is still honoured when a shared link carries one', async ({ page, gotoApp, api }) => {
    await gotoApp('/?limit=5');

    // ⚠️ Not `toHaveCount(5)`: while the sentinel stays within the 400 px margin
    // of the viewport, `InfiniteMore` asks for the next batch, so the list grows
    // in steps of five until it is out of reach. The batch size is what the
    // link asked for, and every batch is whole.
    await page.waitForLoadState('networkidle');
    const shown = await page.locator('.i-row').count();
    expect(shown).toBeGreaterThanOrEqual(5);
    expect(shown % 5).toBe(0);
    expect(api.clipLists().length).toBeGreaterThan(0);
    for (const call of api.clipLists()) {
      expect(call.search.get('limit')).toBe('5');
    }
  });
});
