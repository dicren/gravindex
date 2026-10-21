// **URL ⇄ filters.** (`useListFilters`, behaviour 1.)
//
// Two halves, and the second is the one that was a deliberate fix:
//
//   - what the visitor chose is IN the address, survives a reload, and can be
//     shared;
//   - what they did not choose is NOT. The library lives at `/`, never at
//     `/?search=&order=clip.createdAt`.
//
// ⚠️ **Neither `page` nor `limit` is in the address**, and the assertions about
// them live in `02-infinite-scroll.spec.ts`: what people share is a filter, not
// a scroll position.

import { expect, test } from '../lib/fixtures';

const SEARCH = 'Buscar cortes';
const TAG = 'Cine';

function query(page: import('@playwright/test').Page): URLSearchParams {
  return new URL(page.url()).searchParams;
}

/** The sort control is three stacked buttons in the rail now, not a select. */
async function chooseOrder(page: import('@playwright/test').Page, label: string): Promise<void> {
  await page.locator('.grav-seg').getByRole('button', { name: label, exact: true }).click();
}

/** One row of the tag filter, by its visible name. */
async function toggleTag(page: import('@playwright/test').Page, tag: string): Promise<void> {
  await page
    .locator('.tagfilter__item', { hasText: new RegExp(`^${tag}\\d*$`) })
    .first()
    .click();
}

test.describe('the address bar and the filters', () => {
  test('defaults never reach the URL', async ({ page, gotoApp }) => {
    await gotoApp('/');
    await expect(page.locator('.i-row').first()).toBeVisible();

    // Nothing chosen, nothing in the address — not even a `?`.
    expect(new URL(page.url()).search).toBe('');

    // Choosing the sort that is ALREADY the default must not add it either.
    await chooseOrder(page, 'Añadidos recientemente');
    await page.waitForTimeout(900);
    expect(new URL(page.url()).search).toBe('');

    // ⚠️ A non-default sort does show up, and the VALUE is the wire format: the label reads "Más votados", `order=points`
    // did not change, because it is in links people have shared since 2019.
    await chooseOrder(page, 'Más votados');
    await expect.poll(() => query(page).get('order')).toBe('points');

    // …and going back to the default takes it away again.
    await chooseOrder(page, 'Añadidos recientemente');
    await expect.poll(() => query(page).get('order')).toBeNull();
    expect(new URL(page.url()).search).toBe('');
  });

  test('every chosen filter is in the address, and comes back after a reload', async ({
    page,
    gotoApp,
  }) => {
    await gotoApp('/');
    await expect(page.locator('.i-row').first()).toBeVisible();

    await page.getByRole('searchbox', { name: SEARCH }).fill('cancion');
    await chooseOrder(page, 'Más votados');
    await toggleTag(page, TAG);

    await expect.poll(() => query(page).get('tags')).toBe(TAG);
    expect(query(page).get('search')).toBe('cancion');
    expect(query(page).get('order')).toBe('points');

    // ⚠️ Captured only after the commit has settled: the address is written by
    // `router.replace` a tick after the request goes out, so reading it earlier
    // is a race.
    const shared = page.url();
    await page.reload();

    await expect(page.getByRole('searchbox', { name: SEARCH })).toHaveValue('cancion');
    // The chosen tag is pinned above the dashed rule, which is what keeps it on
    // screen in a 102-row scroller.
    await expect(page.locator('.tagfilter__chosen')).toContainText(TAG);
    await expect(page.locator('.grav-seg button', { hasText: 'Más votados' })).toHaveClass(/is-on/);
    await expect.poll(() => page.url()).toBe(shared);
  });

  test('"Limpiar filtros" empties the address and the controls', async ({ page, gotoApp }) => {
    await gotoApp('/');
    await expect(page.locator('.i-row').first()).toBeVisible();

    await page.getByRole('searchbox', { name: SEARCH }).fill('cancion');
    await toggleTag(page, TAG);
    await expect.poll(() => query(page).get('tags')).toBe(TAG);

    await page.getByRole('button', { name: 'Limpiar filtros' }).click();

    await expect.poll(() => new URL(page.url()).search).toBe('');
    await expect(page.getByRole('searchbox', { name: SEARCH })).toHaveValue('');
    await expect(page.locator('.tagfilter__chosen')).toHaveCount(0);
    // ⚠️ And the control goes away with the filters: an inert "Limpiar filtros"
    // is furniture that teaches people it does nothing.
    await expect(page.getByRole('button', { name: 'Limpiar filtros' })).toHaveCount(0);
  });

  test('a tag clicked on a row becomes the whole filter', async ({ page, gotoApp }) => {
    // ⚠️ Replaces rather than appends: a tag clicked on a row is the whole filter.
    await gotoApp('/');
    await expect(page.locator('.i-row').first()).toBeVisible();

    const tag = page.locator('.i-row__tag').first();
    const name = (await tag.textContent())?.trim() ?? '';
    await tag.click();

    await expect.poll(() => query(page).get('tags')).toBe(name);
    await expect(page.locator('.tagfilter__chosen')).toContainText(name);
  });

  test('an external URL change is adopted: the navbar link clears the filter', async ({
    page,
    gotoApp,
  }) => {
    // ⚠️ **Back is NOT the mechanism here, and that is deliberate on both sides.**
    // Every filter commit navigates with `router.replace`, precisely so the
    // history does not fill with half-typed searches — so there is no earlier
    // entry to go back to. What the composable guarantees is that a change
    // arriving from OUTSIDE it is adopted; the top bar's own "Biblioteca" link is
    // that case, and it is the case that has to be special-cased.
    await gotoApp('/');
    await expect(page.locator('.i-row').first()).toBeVisible();

    await page.getByRole('searchbox', { name: SEARCH }).fill('cancion');
    await toggleTag(page, TAG);
    await expect.poll(() => query(page).get('tags')).toBe(TAG);
    expect(query(page).get('search')).toBe('cancion');

    await page.getByRole('link', { name: /^Biblioteca/ }).click();

    await expect.poll(() => new URL(page.url()).search).toBe('');
    await expect(page.getByRole('searchbox', { name: SEARCH })).toHaveValue('');
    await expect(page.locator('.tagfilter__chosen')).toHaveCount(0);
    await expect(page.locator('.i-row')).toHaveCount(24);
  });

  test('the tag filter offers all 102, with their counts, ordered by use', async ({
    page,
    gotoApp,
  }) => {
    // ⚠️ All of them, always: hiding the 50 single-use tags behind the search was
    // proposed and rejected — "si no, nadie se va a acordar de los tags
    // ocultos".
    await gotoApp('/');

    await expect(page.locator('.tagfilter__heading')).toHaveText('Tags · 102');
    await expect(page.locator('.tagfilter__item')).toHaveCount(102);
    // Ordered by use: the first row is the most-used tag in the fixture.
    await expect(page.locator('.tagfilter__item').first()).toContainText('Monográficos');
    await expect(page.locator('.tagfilter__item').first()).toContainText('45');
  });
});
