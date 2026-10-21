// **The search overlay, and the mobile filter sheet.**
// (`EpisodeSearchOverlay`, `FilterRail`.)
//
// ⚠️ Choosing an episode stopped being a screen: the header's `Añadir corte`
// opens a floating search over whatever you were looking at, and `/creator` is
// still a real route so browser-back closes it and a direct link opens it over
// the library rather than over a blank page.
//
// The three things the design called out are the three things this asserts:
// **focus is trapped and given back**, **`Esc` closes**, and **it does not
// interrupt playback**.

import { getEpisode } from '../lib/api';
import { TEST_EPISODE_ID } from '../lib/constants';
import { audioState, expect, test } from '../lib/fixtures';

test.describe('the search overlay', () => {
  test('opens over the screen you were on, and back closes it', async ({ page, gotoApp }) => {
    await gotoApp('/');
    await expect(page.locator('.i-row').first()).toBeVisible();

    await page.getByRole('link', { name: 'Añadir corte' }).click();

    await expect(page.getByRole('dialog', { name: /Elegir un episodio/ })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/creator');
    // ⚠️ OVER the library, which is still rendered underneath.
    await expect(page.locator('.i-row').first()).toBeVisible();

    await page.goBack();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('a direct link opens it over the library, never over a blank page', async ({
    page,
    gotoApp,
  }) => {
    await gotoApp('/creator');

    await expect(page.getByRole('dialog', { name: /Elegir un episodio/ })).toBeVisible();
    await expect(page.locator('.i-row').first()).toBeVisible();
  });

  test('focus lands in the field, is trapped, and comes back on close', async ({
    page,
    gotoApp,
  }) => {
    await gotoApp('/');
    const opener = page.getByRole('link', { name: 'Añadir corte' });
    await opener.click();

    const field = page.locator('.pal__field input');
    await expect(field).toBeFocused();

    // ⚠️ Trapped: tabbing from the last control cycles to the first rather than
    // walking out into the page the dialog is covering.
    const controls = page.locator('.pal__box input, .pal__box button');
    const count = await controls.count();
    for (let i = 0; i < count + 1; i += 1) await page.keyboard.press('Tab');
    await expect(page.locator('.pal__box')).toContainText('cortar');
    expect(await page.evaluate(() => document.activeElement?.closest('.pal__box') !== null)).toBe(
      true,
    );

    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('searches by title, and Enter cuts the highlighted episode', async ({ page, gotoApp }) => {
    await gotoApp('/creator');

    await page.locator('.pal__field input').fill('Interruptus');
    await expect(page.locator('.pal__item').first()).toContainText('Interruptus');

    await page.keyboard.press('Enter');

    await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/creator\/\d+-/);
    await expect(page.locator('.editor__title')).toBeVisible();
  });

  test('says the search covers the title only, because it does', async ({ page, gotoApp }) => {
    // ⚠️ Load-bearing copy: `GET /episodes?search=` matches the episode title and
    // nothing else, so *gazpacho* will not find the Episodio 53 that contains
    // that clip. The hint is what stops that reading as a broken search.
    await gotoApp('/creator');

    await expect(page.locator('.pal__foot')).toContainText('busca solo en el título');
  });

  test('does not interrupt playback', async ({ page, gotoApp }) => {
    const clip = (await getEpisode(TEST_EPISODE_ID)).clips[0]!;
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    await page
      .locator('.i-row')
      .filter({ hasText: clip.title })
      .first()
      .getByRole('button', { name: `Añadir ${clip.title} a la cola` })
      .click();
    await expect.poll(async () => (await audioState(page))[0]?.paused).toBe(false);

    await page.getByRole('link', { name: 'Añadir corte' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Still running, still the same clip.
    expect((await audioState(page))[0]?.paused).toBe(false);
    await expect(page.locator('.player__title')).toHaveText(clip.title);
  });
});

test.describe('the mobile filter sheet', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('replaces the rail with a sticky search and a Filtros button', async ({ page, gotoApp }) => {
    await gotoApp('/');
    await expect(page.locator('.i-row').first()).toBeVisible();

    // The rail itself is not drawn at this width; the sticky header is.
    await expect(page.locator('.rail')).toBeHidden();
    await expect(page.locator('.rail__mobilehead')).toBeVisible();
    await expect(page.locator('.rail__sheet')).toBeHidden();

    // ⚠️ **Sticky, and asserted.** It was only ever checked for existence, so
    // when the calendar taught this header to let go of the top, a Boolean prop
    // Vue casts to `false` when absent unpinned it on every screen — invisibly,
    // and on the one this test is looking at.
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect
      .poll(async () =>
        page.evaluate(() =>
          Math.round(
            document.querySelector('.rail__mobilehead')?.getBoundingClientRect().top ?? -1,
          ),
        ),
      )
      .toBe(0);
  });

  /**
   * ⚠️ **It COVERS the list rather than pushing it down**, and that reverses what
   * this test used to assert. The reasoning is a recorded deviation at
   * `FilterRail.vue`: the design asked for a pushed sheet,
   * on the grounds that covering hides what a filter just did — but once the tag
   * list grew to fill the available height, a pushed sheet routinely ran taller
   * than the screen, with no way back to `Limpiar filtros` or to the credit short
   * of scrolling past an open-ended list of 102 tags.
   *
   * What replaced it is a fixed panel that stops short of the bottom
   * (`bottom: 25vh`), so the library still shows through underneath. That is the
   * same "you can see what you changed" signal the pushing rule was after, at a
   * height that does not depend on how many tags there are — and it is what the
   * last two assertions here measure.
   */
  test('opens the sheet with every filter in it, laid over the list', async ({ page, gotoApp }) => {
    await gotoApp('/');
    await expect(page.locator('.i-row').first()).toBeVisible();

    const firstRowTop = async () => (await page.locator('.i-row').first().boundingBox())?.y ?? 0;
    const before = await firstRowTop();

    await page.getByRole('button', { name: /Filtros/ }).click();

    await expect(page.locator('.rail__sheet')).toBeVisible();
    await expect(page.locator('.rail__sheet')).toContainText('Ordenar por');

    // ⚠️ The sheet holds the SAME filters as the rail, which is the claim — so
    // what is asserted is that its tag list is the whole tag list, read off the
    // heading the component derives from the same array rather than pinned to
    // 102. The tagging group adds a tag of its own earlier in a full run, and a
    // literal here would make this spec fail depending on what ran before it.
    const heading = (await page.locator('.rail__sheet .tagfilter__heading').textContent()) ?? '';
    const offered = Number(heading.replace(/\D+/g, ''));
    expect(offered).toBeGreaterThan(100);
    await expect(page.locator('.rail__sheet .tagfilter__item')).toHaveCount(offered);

    // The list does not move: the sheet is laid over it, not wedged above it.
    expect(await firstRowTop()).toBe(before);

    // ⚠️ And it stops short of the bottom, which is the half that makes covering
    // acceptable at all — rows of the library are still on screen under the
    // panel, so choosing a filter is not choosing blind.
    const sheet = await page.locator('.rail__sheet').boundingBox();
    const viewport = page.viewportSize();
    expect(sheet).not.toBeNull();
    expect(viewport).not.toBeNull();
    const sheetBottom = (sheet?.y ?? 0) + (sheet?.height ?? 0);
    expect(sheetBottom).toBeLessThan(viewport?.height ?? 0);

    const rowsBelow = await page
      .locator('.i-row')
      .evaluateAll(
        (rows, bottom) => rows.filter((row) => row.getBoundingClientRect().top >= bottom).length,
        sheetBottom,
      );
    expect(rowsBelow).toBeGreaterThan(0);
  });

  test('counts the active filters on the button', async ({ page, gotoApp }) => {
    // ⚠️ The badge counts the FILTERS, not the results — which is why this does
    // not wait for a row. `?search=cancion&tags=Cine` is in fact one of the
    // combinations that matches nothing: `search` and `tags[]` are deliberately
    // not independent (root `AGENTS.md`), and the count on the button has to be
    // right either way.
    await gotoApp('/?search=cancion&tags=Cine');

    await expect(page.locator('.rail__filterbtn b')).toHaveText('2');
  });

  test('the player keeps its transport and drops the waveform', async ({ page, gotoApp }) => {
    await gotoApp('/');

    await expect(page.locator('.player__play')).toBeVisible();
    await expect(page.locator('.player__queue')).toBeVisible();
    // ⚠️ The design's own rule below 720 px: the waveform, the time and the
    // caricatures go, and the title takes the space.
    await expect(page.locator('.player__wave')).toBeHidden();
    await expect(page.locator('.player__time')).toBeHidden();
    await expect(page.locator('.player__mascot')).toBeHidden();
  });
});
