// **The clip editor, end to end.**
//
// The property that matters, and the one this whole group exists to pin:
// ⚠️ **what is published is parsed back out of what the screen displays.** The
// screen keeps seconds, not `hh:mm:ss` strings, so the guarantee has to be
// preserved deliberately (`cutSeconds` parses `startLabel` and `endLabel`). The
// last test below reads the timecodes off the page, publishes, and then reads
// the row back out of the API — the number in the database cannot disagree with
// what the person read.
//
// The episode's mp3 is answered by `lib/media.ts` with 12 000 s of silence, so
// every number here is deterministic: the episode lasts `03:20:00` and the
// editor's default cut ends ten minutes before that, at `03:10:00`.
//
// ⚠️ **`cut-start` and `cut-end` are `<input>`s since 2026-08-22**, not the
// read-only `<b>` elements they were, so they are read with `toHaveValue` /
// `inputValue()` rather than `toHaveText` / `textContent()`. The property above
// is unchanged by that — for a text field, what the screen "displays" IS its
// value — and the last test still proves it end to end.

import { getEpisode } from '../lib/api';
import { TEST_EPISODE_ID, WRITE_MARKER } from '../lib/constants';
import { AUDIO_DURATION_SECONDS } from '../lib/media';
import { dragOnTrack, readHandlePercents, readHandles, readRange } from '../lib/editor';
import { expect, hhmmssToSeconds, secondsToHhmmss, test } from '../lib/fixtures';

const DEFAULT_END = AUDIO_DURATION_SECONDS - 10 * 60;

async function openEditor(
  gotoApp: (path: string) => Promise<void>,
  page: import('@playwright/test').Page,
): Promise<void> {
  await gotoApp(`/creator/${TEST_EPISODE_ID}`);
  // Nothing is drawable before `canplay`: the stream is what says how long the
  // episode is.
  await expect(page.locator('[data-test="cut-start"]')).toBeVisible({ timeout: 60_000 });
}

test.describe('the clip editor', () => {
  test('opens on the whole episode, with the cut defaulted ten minutes short of the end', async ({
    page,
    gotoApp,
  }) => {
    await openEditor(gotoApp, page);

    await expect(page.locator('[data-test="episode-duration"]')).toHaveText(
      secondsToHhmmss(AUDIO_DURATION_SECONDS),
    );
    await expect(page.locator('[data-test="cut-start"]')).toHaveValue('00:00:00');
    await expect(page.locator('[data-test="cut-end"]')).toHaveValue(secondsToHhmmss(DEFAULT_END));
    expect(await readHandles(page)).toEqual([0, 0, DEFAULT_END]);
    // The WINDOW is the whole episode; the CUT ends ten minutes short of it.
    expect(await readRange(page)).toEqual({ min: 0, max: AUDIO_DURATION_SECONDS });
  });

  test('the displayed timecodes are the handle values, after every kind of move', async ({
    page,
    gotoApp,
  }) => {
    await openEditor(gotoApp, page);

    // `end` is the handle nearest 60 % of a window whose other two handles sit
    // at 0, so the press picks it up.
    await dragOnTrack(page, 0.6, 0.6);
    const afterDrag = await readHandles(page);
    expect(afterDrag[2]).toBeLessThan(DEFAULT_END);
    await expect(page.locator('[data-test="cut-end"]')).toHaveValue(secondsToHhmmss(afterDrag[2]));

    // The playhead: still collapsed on `start` at 0, and a press to the RIGHT of
    // a collapsed cluster takes the highest-indexed handle in it.
    await dragOnTrack(page, 0.1, 0.1);
    const afterPlayhead = await readHandles(page);
    expect(afterPlayhead[1]).toBeGreaterThan(0);
    expect(afterPlayhead[0]).toBe(0);

    // ⚠️ The ±1/±10 buttons move the same model. `±5` was removed on 2026-08-22,
    // when the six pills per end moved to sit either side of their own timecode.
    await page.getByRole('button', { name: 'Retrasar el final 10 segundos' }).click();
    const afterNudge = await readHandles(page);
    expect(afterNudge[2]).toBe(afterDrag[2] + 10);
    await expect(page.locator('[data-test="cut-end"]')).toHaveValue(secondsToHhmmss(afterNudge[2]));

    await page.getByRole('button', { name: 'Adelantar el final 1 segundos' }).click();
    await expect(page.locator('[data-test="cut-end"]')).toHaveValue(
      secondsToHhmmss(afterNudge[2] - 1),
    );

    // And the duration on screen is the arithmetic of the two timecodes.
    const start = hhmmssToSeconds(await page.locator('[data-test="cut-start"]').inputValue());
    const end = hhmmssToSeconds(await page.locator('[data-test="cut-end"]').inputValue());
    await expect(page.locator('[data-test="cut-duration"]')).toHaveText(
      secondsToHhmmss(end - start).replace(/^00:/, ''),
    );
  });

  test('zooming narrows the window without losing a single point, and without remounting', async ({
    page,
    gotoApp,
  }) => {
    await openEditor(gotoApp, page);

    await dragOnTrack(page, 0.6, 0.6);
    await dragOnTrack(page, 0.1, 0.1);
    await dragOnTrack(page, 0.02, 0.05);

    const before = await readHandles(page);
    const percentsBefore = await readHandlePercents(page);
    const labelsBefore = {
      start: await page.locator('[data-test="cut-start"]').inputValue(),
      end: await page.locator('[data-test="cut-end"]').inputValue(),
    };

    // ⚠️ A mark on the track node itself. The slider is not rebuilt on every zoom;
    // it re-renders the SAME nodes because `min`/`max` are reactive props. If the mark
    // survives, nothing was remounted.
    await page.locator('.ths__track').evaluate((node) => {
      (node as HTMLElement).dataset.e2eMark = 'same-node';
    });

    await page.getByRole('button', { name: 'Hacer zoom a la sección delimitada' }).click();

    expect(await readHandles(page)).toEqual(before);
    await expect(page.locator('[data-test="cut-start"]')).toHaveValue(labelsBefore.start);
    await expect(page.locator('[data-test="cut-end"]')).toHaveValue(labelsBefore.end);
    await expect(page.locator('.ths__track')).toHaveAttribute('data-e2e-mark', 'same-node');

    // The zoom really happened: the window shrank and the handles moved on screen.
    const zoomed = await readRange(page);
    expect(zoomed.max - zoomed.min).toBeLessThan(DEFAULT_END);
    expect(await readHandlePercents(page)).not.toEqual(percentsBefore);

    await page.getByRole('button', { name: 'Retrocede el zoom' }).click();
    expect(await readHandles(page)).toEqual(before);

    await page.getByRole('button', { name: 'Reiniciar zoom' }).click();
    expect(await readHandles(page)).toEqual(before);
    expect(await readRange(page)).toEqual({ min: 0, max: AUDIO_DURATION_SECONDS });
    await expect(page.locator('.ths__track')).toHaveAttribute('data-e2e-mark', 'same-node');
  });

  test('refuses to publish without a title or a tag, and says which', async ({ page, gotoApp }) => {
    await openEditor(gotoApp, page);
    await page.getByRole('button', { name: 'Publicar corte' }).click();

    await expect(page.getByText('Introduce un título para el corte.')).toBeVisible();
    await expect(page.getByText('Introduce al menos un tag.')).toBeVisible();

    // ⚠️ Recomputed on every attempt, not latched: a flag that is set once and never
    // cleared would keep the message on screen after the title was typed.
    await page.getByLabel('Título del corte').fill('con título');
    await page.getByRole('button', { name: 'Publicar corte' }).click();
    await expect(page.getByText('Introduce un título para el corte.')).toHaveCount(0);
    await expect(page.getByText('Introduce al menos un tag.')).toBeVisible();
  });

  test('publishes the seconds that the screen was showing', async ({ page, gotoApp }) => {
    await openEditor(gotoApp, page);

    await dragOnTrack(page, 0.55, 0.55);
    await dragOnTrack(page, 0.12, 0.12);
    await dragOnTrack(page, 0.03, 0.08);
    await page.getByRole('button', { name: 'Retrasar el inicio 1 segundos' }).click();

    const title = `${WRITE_MARKER} corte del editor`;
    await page.getByLabel('Título del corte').fill(title);
    // ⚠️ A searchbox, not a combobox: `TagPicker` replaced the `v-combobox` on
    // 2026-08-22 and has no overlay at all. Enter still takes the first
    // suggestion, or invents what was typed when nothing matched — which is what
    // happens here, the marker being a tag nobody has ever used.
    await page
      .getByRole('searchbox', { name: 'Añade un tag al corte' })
      .fill(`${WRITE_MARKER}-editor`);
    await page.keyboard.press('Enter');

    // ⚠️ Read AFTER every move and BEFORE the click: these two strings are the
    // specification of what the row must contain.
    const shownStart = await page.locator('[data-test="cut-start"]').inputValue();
    const shownEnd = await page.locator('[data-test="cut-end"]').inputValue();
    expect(shownStart).toMatch(/^\d\d:\d\d:\d\d$/);
    expect(shownEnd).toMatch(/^\d\d:\d\d:\d\d$/);

    await page.getByRole('button', { name: 'Publicar corte' }).click();
    await page.waitForURL(new RegExp(`/episode/${TEST_EPISODE_ID}`));
    await expect(page.locator('.i-row').filter({ hasText: title })).toHaveCount(1);

    const stored = (await getEpisode(TEST_EPISODE_ID)).clips.find((clip) => clip.title === title);
    expect(stored, 'the clip reached the database').toBeDefined();
    expect(stored!.start).toBe(hhmmssToSeconds(shownStart));
    expect(stored!.end).toBe(hhmmssToSeconds(shownEnd));
    expect(stored!.tags.map((tag) => tag.tag)).toEqual([`${WRITE_MARKER}-editor`]);
  });
});
