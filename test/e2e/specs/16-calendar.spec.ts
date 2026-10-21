// **The calendar view of the episode list.**
// (`EpisodeCalendar`, `CalendarRibbon`, `CalendarMonth`, `CalendarDayPanel`.)
//
// The episode list drawn by date: seventeen years in one strip that does not
// scroll, a year of day grids under it, and the day you pick as a layer over the
// top.
//
// Everything here is behaviour a jsdom test cannot reach — a real history stack,
// a measured popover that flips when it would fall out of the frame, and a
// scroll computed from three elements' actual rectangles.
//
// ⚠️ **It only reads.** Nothing in this file publishes a clip, votes or tags, so
// the row counts the teardown snapshots are untouched.

import { expect, test } from '../lib/fixtures';

/** The last day of a year with episodes, and the first of the next one. */
const LAST_OF_2011 = '2011-12-18';

/**
 * Is the open day's whole month on screen, and the panel with it?
 *
 * ⚠️ **The month is the subject.** Keeping the panel out from under the header
 * was not enough on its own: it left the month it belongs to half off the bottom,
 * so the layer was legible and the thing it described was not. The band runs from
 * the sticky header — measured, because this site's bar is not a `<v-app-bar>`
 * and `--v-layout-top` is empty — to whatever closes it from below.
 */
async function wholeMonthVisible(
  page: import('@playwright/test').Page,
): Promise<{ month: boolean; panel: boolean } | null> {
  return page.evaluate(() => {
    const open = document.querySelector('.cm__d.is-on');
    const month = open?.closest('.cm')?.getBoundingClientRect();
    const pop = document.querySelector('.pop')?.getBoundingClientRect();
    if (month === undefined || pop === undefined) return null;

    const bar = document.querySelector('.topbar')?.getBoundingClientRect();
    const player = document.querySelector('.player-dock, .player')?.getBoundingClientRect();
    const top = Math.max(0, bar?.bottom ?? 0);
    const bottom = Math.min(window.innerHeight, player?.top ?? window.innerHeight);

    const inside = (box: DOMRect): boolean => box.top >= top - 1 && box.bottom <= bottom + 1;
    return { month: inside(month), panel: inside(pop) };
  });
}

test.describe('getting in and out', () => {
  test('the switch pushes, so Back returns to the list', async ({ page, gotoApp }) => {
    await gotoApp('/episodes');
    await expect(page.locator('.ep-row').first()).toBeVisible();

    await page.getByRole('button', { name: 'Calendario' }).click();

    await expect(page.locator('.cal__year')).toBeVisible();
    expect(new URL(page.url()).pathname).toMatch(/^\/episodes\/calendario\/\d{4}$/);

    await page.goBack();

    expect(new URL(page.url()).pathname).toBe('/episodes');
    await expect(page.locator('.ep-row').first()).toBeVisible();
  });

  test('⚠️ walking through years costs ONE press of Back, not one per year', async ({
    page,
    gotoApp,
  }) => {
    await gotoApp('/episodes');
    await page.getByRole('button', { name: 'Calendario' }).click();
    await expect(page.locator('.cal__year')).toBeVisible();

    const back = page.getByRole('button', { name: 'Año anterior' });
    for (let i = 0; i < 4; i += 1) await back.click();
    await expect(page.locator('.cal__year')).not.toHaveText(/^$/);

    // Four years walked, and the calendar is still one entry deep.
    await page.goBack();

    expect(new URL(page.url()).pathname).toBe('/episodes');
  });

  test('opens on the last year there is, and a shared link opens on its own', async ({
    page,
    gotoApp,
  }) => {
    await gotoApp('/episodes/calendario');
    await expect(page.locator('.cal__year')).toBeVisible();
    const newest = await page.locator('.cal__year').textContent();
    expect(new URL(page.url()).pathname).toBe(`/episodes/calendario/${newest?.trim()}`);

    await gotoApp('/episodes/calendario/2011');
    await expect(page.locator('.cal__year')).toHaveText('2011');
  });

  test('carries the filters in and keeps drawing them', async ({ page, gotoApp }) => {
    await gotoApp('/episodes?withClips=true');
    await expect(page.locator('.ep-row').first()).toBeVisible();

    await page.getByRole('button', { name: 'Calendario' }).click();
    await expect(page.locator('.cal__year')).toBeVisible();

    expect(new URL(page.url()).search).toContain('withClips=true');
    // Only the 61 episodes that have ever been cut from, so every painted day is
    // a cut day.
    await expect(page.locator('.cm__d.has-ep')).toHaveCount(0);
    await expect(page.locator('.cm__d.has-clips').first()).toBeVisible();
  });
});

test.describe('the ribbon', () => {
  test('draws every month of the catalogue without scrolling', async ({ page, gotoApp }) => {
    await gotoApp('/episodes/calendario/2011');
    await expect(page.locator('.gv__track')).toBeVisible();

    const track = page.locator('.gv__track');
    const fits = await track.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(fits).toBe(true);

    // ⚠️ Invariants, not volumes: this suite runs against the disposable test
    // database, which is a third shorter than the seeded one. What must hold either way is that the strip
    // draws ONE BRICK PER EPISODE and one column per year of the catalogue.
    const total = Number(
      (await page.locator('.episodes__count').textContent())?.replace(/\D+/g, '') ?? '0',
    );
    expect(total).toBeGreaterThan(0);
    expect(await page.locator('.gv__b').count()).toBe(total);

    const years = await page.locator('.gv__year').count();
    expect(years).toBeGreaterThan(5);
    expect(await page.locator('.gv__yr').count()).toBe(years);
    // Every year but the two ends contributes its full twelve months.
    expect(await page.locator('.gv__m').count()).toBeGreaterThanOrEqual((years - 2) * 12);
  });

  test('changes the year from the strip', async ({ page, gotoApp }) => {
    await gotoApp('/episodes/calendario/2011');
    await expect(page.locator('.cal__year')).toHaveText('2011');

    await page.locator('.gv__year[data-year="2014"]').click();

    await expect(page.locator('.cal__year')).toHaveText('2014');
    expect(new URL(page.url()).pathname).toBe('/episodes/calendario/2014');
  });
});

test.describe('the day panel', () => {
  test('opens against its day, and closes every way it offers', async ({ page, gotoApp }) => {
    await gotoApp('/episodes/calendario/2011');
    const day = page.locator('.cm__d.has-clips').first();
    await day.click();

    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();
    // The list's own row, inside the layer.
    await expect(panel.locator('.ep-row')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();

    await day.click();
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Cerrar' }).click();
    await expect(panel).toBeHidden();

    await day.click();
    await expect(panel).toBeVisible();
    await day.click();
    await expect(panel).toBeHidden();
  });

  test('⚠️ flips above the day when it would fall out of the bottom', async ({ page, gotoApp }) => {
    await gotoApp('/episodes/calendario/2011');

    // A day in the last row of months, where there is no room below it.
    await page.locator('.cal__months > .cm').last().locator('.cm__d[data-day]').last().click();
    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();

    await expect(panel).toHaveClass(/is-above/);
    const inside = await panel.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const frame = el.closest('.cal')?.getBoundingClientRect();
      return frame !== undefined && box.left >= frame.left - 1 && box.right <= frame.right + 1;
    });
    expect(inside).toBe(true);
  });

  test('⚠️ steps to the next day WITH an episode and drags the year with it', async ({
    page,
    gotoApp,
  }) => {
    await gotoApp('/episodes/calendario/2011');
    await page.locator(`[data-day="${LAST_OF_2011}"]`).click();

    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.pop__date')).toContainText('2011');

    await panel.getByRole('button', { name: 'Día siguiente con episodio' }).click();

    // Over the year boundary: the calendar, the address and the panel all moved.
    await expect(page.locator('.cal__year')).toHaveText('2012');
    expect(new URL(page.url()).pathname).toBe('/episodes/calendario/2012');
    await expect(panel.locator('.pop__date')).toContainText('2012');
  });

  test('⚠️ the arrow keys do exactly what the two buttons do', async ({ page, gotoApp }) => {
    await gotoApp('/episodes/calendario/2011');
    await page.locator('.cm__d[data-day]').first().click();

    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();
    const first = await panel.locator('.pop__date').textContent();

    await page.keyboard.press('ArrowRight');
    await expect(panel.locator('.pop__date')).not.toHaveText(first ?? '');
    const second = await panel.locator('.pop__date').textContent();

    await page.keyboard.press('ArrowLeft');
    await expect(panel.locator('.pop__date')).toHaveText(first ?? '');
    expect(second).not.toBe(first);
  });

  test('⚠️ a press anywhere else closes it — nothing dims the calendar behind', async ({
    page,
    gotoApp,
  }) => {
    await gotoApp('/episodes/calendario/2011');
    await page.locator('.cm__d[data-day]').first().click();

    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();

    // The filter rail: outside the panel and not a day.
    await page.locator('.rail').click({ position: { x: 20, y: 300 } });

    await expect(panel).toBeHidden();
  });

  test('⚠️ every step keeps the panel where it can be seen', async ({ page, gotoApp }) => {
    await gotoApp('/episodes/calendario/2011');
    // The first day of the year: stepping back lands in December of the year
    // before, at the bottom of a grid the page is scrolled to the top of.
    await page.locator('.cm__d[data-day]').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.cal__year')).toHaveText('2010');

    // ⚠️ Under the HEADER counts as hidden. It is sticky and always on screen,
    // and `--v-layout-top` is empty here because this bar is not a `<v-app-bar>`
    // — which is exactly how the panel used to slide under it.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const box = document.querySelector('.pop')?.getBoundingClientRect();
          const bar = document.querySelector('.topbar')?.getBoundingClientRect();
          const player = document.querySelector('.player-dock, .player')?.getBoundingClientRect();
          if (box === undefined) return false;
          return (
            box.top >= Math.max(0, bar?.bottom ?? 0) - 1 &&
            box.bottom <= (player?.top ?? window.innerHeight) + 1
          );
        }),
      )
      .toBe(true);
  });

  test('⚠️ shows the whole MONTH on every step, panel included', async ({ page, gotoApp }) => {
    await gotoApp('/episodes/calendario/2011');
    // The first day of the year: one step back crosses into December of the year
    // before, at the bottom of a grid the page has not scrolled to.
    await page.locator('.cm__d[data-day]').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    for (let i = 0; i < 4; i += 1) {
      await expect.poll(() => wholeMonthVisible(page)).toEqual({ month: true, panel: true });
      await page.keyboard.press('ArrowLeft');
    }
    await expect.poll(() => wholeMonthVisible(page)).toEqual({ month: true, panel: true });
  });

  test('⚠️ never steals an arrow key aimed at the search box', async ({ page, gotoApp }) => {
    await gotoApp('/episodes/calendario/2011');
    await page.locator('.cm__d[data-day]').first().click();

    const panel = page.getByRole('dialog');
    const before = await panel.locator('.pop__date').textContent();

    const field = page.getByRole('searchbox', { name: /Buscar episodio/ });
    await field.fill('zombis');
    await field.press('ArrowLeft');

    await expect(panel.locator('.pop__date')).toHaveText(before ?? '');
  });
});

test.describe('coming back from an episode', () => {
  test('⚠️ lands on the calendar as it was left: same day open, same position', async ({
    page,
    gotoApp,
  }) => {
    await gotoApp('/episodes/calendario/2011');
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.locator('.cm__d.has-clips').last().click();

    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();
    const day = await panel.locator('.pop__date').textContent();
    const before = await page.evaluate(() => Math.round(window.scrollY));
    expect(before).toBeGreaterThan(0);

    await panel.locator('.ep-row__title-link').click();
    await page.waitForURL(/\/episode\//);

    await page.goBack();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').locator('.pop__date')).toHaveText(day ?? '');
    await expect.poll(async () => page.evaluate(() => Math.round(window.scrollY))).toBe(before);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the year is what stays pinned, and nothing else is', async ({ page, gotoApp }) => {
    await gotoApp('/episodes/calendario/2011');
    await expect(page.locator('.cal__sticky')).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 600));

    const boxes = await page.evaluate(() => {
      const at = (sel: string) => {
        const el = document.querySelector(sel);
        return el === null ? null : Math.round(el.getBoundingClientRect().top);
      };
      return { year: at('.cal__sticky'), head: at('.rail__mobilehead') };
    });
    // The year stepper is at the top; the search header has scrolled away.
    expect(boxes.year).toBe(0);
    expect(boxes.head).toBeLessThan(0);
  });

  test('the panel is a sheet that never covers the player', async ({ page, gotoApp }) => {
    await gotoApp('/episodes/calendario/2011');
    await page.locator('.cm__d.has-clips').first().click();

    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/is-sheet/);

    const clear = await page.evaluate(() => {
      const sheet = document.querySelector('.pop')?.getBoundingClientRect();
      const player = document.querySelector('.player-dock, .player')?.getBoundingClientRect();
      return sheet !== undefined && player !== undefined && sheet.bottom <= player.top + 1;
    });
    expect(clear).toBe(true);
  });

  test('⚠️ scrolls the open day’s month into the strip the sheet leaves free', async ({
    page,
    gotoApp,
  }) => {
    await gotoApp('/episodes/calendario/2011');

    // A day in one of the last months, where the sheet would otherwise cover it.
    const late = page.locator('.cm').nth(11).locator('.cm__d[data-day]').last();
    await late.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const sticky = document.querySelector('.cal__sticky')?.getBoundingClientRect();
          const sheet = document.querySelector('.pop')?.getBoundingClientRect();
          const open = document.querySelector('.cm__d.is-on');
          const month = open?.closest('.cm')?.getBoundingClientRect();
          if (sticky === undefined || sheet === undefined || month === undefined) return false;
          return month.top >= sticky.bottom - 1 && month.bottom <= sheet.top + 1;
        }),
      )
      .toBe(true);
  });

  test('⚠️ keeps the whole month on screen while ‹ › walks, year crossings included', async ({
    page,
    gotoApp,
  }) => {
    await gotoApp('/episodes/calendario/2011');
    await page.locator('.cm__d[data-day]').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const back = page.getByRole('button', { name: 'Día anterior con episodio' });
    for (let i = 0; i < 3; i += 1) {
      await back.click();
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const sticky = document.querySelector('.cal__sticky')?.getBoundingClientRect();
            const sheet = document.querySelector('.pop')?.getBoundingClientRect();
            const open = document.querySelector('.cm__d.is-on');
            const month = open?.closest('.cm')?.getBoundingClientRect();
            if (sticky === undefined || sheet === undefined || month === undefined) return false;
            return month.top >= sticky.bottom - 1 && month.bottom <= sheet.top + 1;
          }),
        )
        .toBe(true);
    }
    await expect(page.locator('.cal__year')).toHaveText('2010');
  });

  test('⚠️ the screen title is out of the way, but still the page’s heading', async ({
    page,
    gotoApp,
  }) => {
    await gotoApp('/episodes/calendario/2011');

    const title = page.locator('.episodes__title');
    await expect(title).toHaveText('Lista de episodios');
    // Announced, never seen: it cost a line above the controls that do the work.
    const drawn = await title.evaluate((el) => el.getBoundingClientRect().height > 2);
    expect(drawn).toBe(false);
  });

  test('⚠️ the filters panel covers the year stepper, not the other way round', async ({
    page,
    gotoApp,
  }) => {
    await gotoApp('/episodes/calendario/2011');
    await page.getByRole('button', { name: /Filtros/ }).click();
    await expect(page.locator('.rail__sheet')).toBeVisible();

    const onTop = await page.evaluate(() => {
      const year = document.querySelector('.cal__sticky')?.getBoundingClientRect();
      if (year === undefined) return null;
      const at = document.elementFromPoint(year.left + year.width / 2, year.top + year.height / 2);
      return at === null ? null : at.closest('.rail__sheet') !== null;
    });
    expect(onTop).toBe(true);
  });

  test('⚠️ the filters panel stays welded to the search box while the page scrolls', async ({
    page,
    gotoApp,
  }) => {
    await gotoApp('/episodes/calendario/2011');
    await page.getByRole('button', { name: /Filtros/ }).click();
    await expect(page.locator('.rail__sheet')).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 600));

    // The search box and its button take the top back — a panel you can scroll
    // away from is a panel with no way back — and the sheet sits flush under it
    // rather than hanging at a hard-coded 116.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const head = document.querySelector('.rail__mobilehead')?.getBoundingClientRect();
          const sheet = document.querySelector('.rail__sheet')?.getBoundingClientRect();
          if (head === undefined || sheet === undefined) return null;
          return {
            headPinned: Math.round(head.top) === 0,
            flush: Math.abs(sheet.top - head.bottom) <= 1,
          };
        }),
      )
      .toEqual({ headPinned: true, flush: true });
  });

  test('⚠️ the count goes left and the view switch right, on one line', async ({
    page,
    gotoApp,
  }) => {
    await gotoApp('/episodes/calendario/2011');

    const spread = await page.evaluate(() => {
      const count = document.querySelector('.episodes__count')?.getBoundingClientRect();
      const view = document.querySelector('.episodes__view')?.getBoundingClientRect();
      if (count === undefined || view === undefined) return null;
      return {
        sameRow: Math.abs(count.top - view.top) < 20,
        countNearLeft: count.left < window.innerWidth / 3,
        viewNearRight: view.right > window.innerWidth - 20,
      };
    });
    expect(spread).toEqual({ sameRow: true, countNearLeft: true, viewNearRight: true });
  });

  test('⚠️ comes back to the same day and the same position', async ({ page, gotoApp }) => {
    await gotoApp('/episodes/calendario/2011');
    await page.locator('.cm').nth(9).locator('.cm__d[data-day]').first().click();

    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();
    const day = await panel.locator('.pop__date').textContent();
    await expect.poll(async () => page.evaluate(() => window.scrollY > 0)).toBe(true);
    const before = await page.evaluate(() => Math.round(window.scrollY));

    await panel.locator('.ep-row__title-link').click();
    await page.waitForURL(/\/episode\//);
    await page.goBack();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').locator('.pop__date')).toHaveText(day ?? '');
    await expect.poll(async () => page.evaluate(() => Math.round(window.scrollY))).toBe(before);
  });

  test('⚠️ a sideways swipe steps a day, like the two buttons', async ({ page, gotoApp }) => {
    await gotoApp('/episodes/calendario/2011');
    await page.locator('.cm__d[data-day]').first().click();

    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();
    const before = await panel.locator('.pop__date').textContent();

    // ⚠️ Real touch pointers, not `page.mouse`: the gesture is deliberately
    // ignored for a mouse, where a drag across a panel is a text selection.
    await page.evaluate(() => {
      const sheet = document.querySelector('.pop');
      if (sheet === null) throw new Error('the sheet is not there');
      const box = sheet.getBoundingClientRect();
      const y = box.top + 20;
      const fire = (type: string, x: number): void => {
        sheet.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true,
          }),
        );
      };
      fire('pointerdown', box.right - 30);
      fire('pointermove', box.left + box.width / 2);
      fire('pointerup', box.left + 30);
    });

    await expect(panel.locator('.pop__date')).not.toHaveText(before ?? '');
  });
});
