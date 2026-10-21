// **Mis momentos** (2026-08-26): the private marks somebody leaves on an
// episode while listening to it. (`stores/moments.store.ts`,
// `composables/use-moment-actions.ts`.)
//
// Four claims only a browser can settle, and every one of them is the reason
// the feature is shaped the way it is:
//
//   1. **The mark lands where the laugh was.** It is taken from the position of
//      a real audio element, minus the four seconds nobody presses in time — a
//      number this suite reads off `audio.currentTime` rather than off a mock.
//   2. **It can be made from anywhere on the site**, because the episode sounds
//      through the global player and keeps sounding when you walk off its page.
//      That is the whole reason the button is in the player at all.
//   3. **It survives a reload and opens the editor on the right window**, which
//      is the only path a moment has out of the browser it lives in.
//   4. **`Con mis momentos` filters a list the SERVER cannot filter.** The marks
//      are in `localStorage`, so the page is assembled out of `GET /episodes/:id`
//      — and this is where "no request went to the list endpoint" is provable.
//
// ⚠️ **Nothing here writes a row.** No clip is published, no vote is cast and an
// episode's playback is not counted (`POST /clips/:id/play` is a CLIP's
// counter), so the pristine counts the teardown asserts are untouched by design
// rather than by cleanup.

import { TEST_EPISODE_ID } from '../lib/constants';
import { audioState, expect, test } from '../lib/fixtures';

const STORAGE_KEY = 'gravindex.moments';

/** A second episode with clips, so the filter has two rows to order. */
const OTHER_EPISODE_ID = 92;

interface StoredMoment {
  episodeId: number;
  at: number;
  markedAt: number;
  clipId?: number;
}

async function storedMoments(page: import('@playwright/test').Page): Promise<StoredMoment[]> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw === null ? [] : ((JSON.parse(raw) as { moments: StoredMoment[] }).moments ?? []);
  }, STORAGE_KEY);
}

async function seedMoments(
  page: import('@playwright/test').Page,
  moments: StoredMoment[],
): Promise<void> {
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [STORAGE_KEY, JSON.stringify({ moments })] as const,
  );
}

test.describe('marking a moment while the episode plays', () => {
  test('stores the second the stream was at, minus the reaction lag', async ({ page, gotoApp }) => {
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);

    // ⚠️ Unavailable until the episode is what is sounding: there is no current
    // second to mark, and a button that marked 00:00 would be worse than one
    // that is visibly off.
    await expect(page.locator('.ep-transport__mark')).toBeDisabled();

    await page.locator('.ep-transport__play').click();
    await expect.poll(async () => (await audioState(page)).length).toBe(1);
    await expect.poll(async () => (await audioState(page))[0]?.paused).toBe(false);

    // Somewhere into the episode, so the mark is a number and not zero.
    // ⚠️ The clock reads `30:14`, not `00:30:14`: `formatClipTime` drops the
    // hours below one, because almost everything this site plays is a cut.
    await page.evaluate(() => {
      const element = window.__e2eAudio?.[0];
      if (element) element.currentTime = 1800;
    });
    await expect(page.locator('[data-test="episode-elapsed"]')).toHaveText(/^30:\d\d$/);

    const before = (await audioState(page))[0]!.currentTime;
    await page.locator('.ep-transport__mark').click();

    const [moment] = await storedMoments(page);
    expect(moment?.episodeId).toBe(TEST_EPISODE_ID);
    // ⚠️ **Behind the stream, never ahead of it.** The exact arithmetic is
    // pinned by the store's own tests; what only a browser can prove is that the
    // number comes off a real audio element and lands a few seconds EARLIER —
    // which is the whole point of the lag.
    expect(moment!.at).toBeLessThanOrEqual(Math.round(before));
    expect(moment!.at).toBeGreaterThanOrEqual(Math.round(before) - 6);

    // Drawn in both halves of the screen at once: a pin over the wave and a row
    // under it. ⚠️ The pin needs a scale, and while the episode is playing the
    // browser's own reading of the file is what provides it — episode 93 has no
    // measured waveform in this database.
    await expect(page.locator('[data-test="moment-pin"]')).toHaveCount(1);
    await expect(page.locator('[data-test="moment-list"] .moment')).toHaveCount(1);
    await expect(page.locator('[data-test="moment-list"]')).toContainText(
      new Date(moment!.at * 1000).toISOString().slice(11, 19),
    );
    await expect(page.locator('.episode__meta')).toContainText('1 momento tuyo');
  });

  /**
   * ⚠️ **The point of putting the button in the player.** An episode is three
   * hours long and goes through the queue precisely so that leaving its page
   * does not cut it off — so the mark has to be makeable from wherever the
   * visitor happens to be when something funny happens.
   */
  test('can be made from another screen entirely, through the player', async ({
    page,
    gotoApp,
  }) => {
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    await page.locator('.ep-transport__play').click();
    await expect.poll(async () => (await audioState(page)).length).toBe(1);

    // ⚠️ **Navigated INSIDE the app, not reloaded.** A `page.goto` would tear
    // the audio element down and prove nothing: what this test is about is that
    // the episode keeps sounding while the visitor walks around the site, which
    // is the reason it goes through the queue at all.
    await page.getByRole('link', { name: /^Biblioteca/ }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('.player__sub')).toHaveText('Episodio completo');

    await page.evaluate(() => {
      const element = window.__e2eAudio?.[0];
      if (element) element.currentTime = 600;
    });
    await expect(page.locator('.player__time')).toHaveText(/^10:\d\d \//);

    const before = (await audioState(page))[0]!.currentTime;
    await page.locator('.player [data-test="mark-moment"]').click();

    const [moment] = await storedMoments(page);
    expect(moment?.episodeId).toBe(TEST_EPISODE_ID);
    expect(moment!.at).toBeLessThanOrEqual(Math.round(before));
    expect(moment!.at).toBeGreaterThanOrEqual(Math.round(before) - 6);
  });

  /** ⚠️ Not an error: pressing twice at the same laugh is a reasonable thing to
   *  do, and the answer is "ya lo tienes". */
  test('says the second press is the same moment, and stores one', async ({ page, gotoApp }) => {
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    await page.locator('.ep-transport__play').click();
    await expect.poll(async () => (await audioState(page)).length).toBe(1);

    await page.locator('.ep-transport__mark').click();
    await page.locator('.ep-transport__mark').click();

    await expect(page.locator('.grav-notification').last()).toContainText('ya estaba marcado');
    expect(await storedMoments(page)).toHaveLength(1);
  });
});

test.describe('what a mark is for', () => {
  test('survives a reload and opens the editor on the window around it', async ({
    page,
    gotoApp,
  }) => {
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    await seedMoments(page, [{ episodeId: TEST_EPISODE_ID, at: 1979, markedAt: Date.now() }]);
    await page.reload();

    // ⚠️ The LIST, not the lane: episode 93 has no measured waveform in this
    // database and nothing is playing, so the panel has no scale to place a pin
    // against — the same reason it draws no clip bands either. The list is the
    // surface that exists at every state, which is why the delete button lives
    // there rather than on the pin.
    await expect(page.locator('[data-test="moment-list"] .moment')).toHaveCount(1);
    await expect(page.locator('[data-test="moment-list"]')).toContainText('00:32:59');
    await expect(page.locator('[data-test="moment-list"]')).toContainText('sin cortar');

    await page.locator('[data-test="moment-cut"]').click();

    // ⚠️ Twenty seconds either side, and `moment` is NOT `start`: the handles can
    // be dragged anywhere before publishing, so the mark is what identifies the
    // mark afterwards.
    await expect(page).toHaveURL(
      new RegExp(`/creator/${TEST_EPISODE_ID}\\?start=1959&end=1999&moment=1979$`),
    );
    // The editor waits for the stream to report a duration before it draws.
    await expect(page.locator('[data-test="cut-start"]')).toHaveValue('00:32:39');
    await expect(page.locator('[data-test="cut-end"]')).toHaveValue('00:33:19');
  });

  test('plays the episode from before the mark, not from the mark', async ({ page, gotoApp }) => {
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    await seedMoments(page, [{ episodeId: TEST_EPISODE_ID, at: 1979, markedAt: Date.now() }]);
    await page.reload();

    await page.locator('.moment__listen').click();

    await expect.poll(async () => (await audioState(page)).length).toBe(1);
    // ⚠️ 20 s of run-up: landing exactly on the mark starts the audio after the
    // thing that was marked.
    await expect
      .poll(async () => (await audioState(page))[0]?.currentTime ?? 0)
      .toBeGreaterThanOrEqual(1959);
    expect((await audioState(page))[0]!.currentTime).toBeLessThan(1979);
  });

  test('is forgotten on one click, and the notice names what went', async ({ page, gotoApp }) => {
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    await seedMoments(page, [
      { episodeId: TEST_EPISODE_ID, at: 1979, markedAt: Date.now() },
      { episodeId: TEST_EPISODE_ID, at: 3000, markedAt: Date.now() },
    ]);
    await page.reload();
    await expect(page.locator('[data-test="moment-list"] .moment')).toHaveCount(2);

    await page.locator('.moment__forget').first().click();

    await expect(page.locator('[data-test="moment-list"] .moment')).toHaveCount(1);
    // ⚠️ The notice names the second, which is what makes one-click deletion
    // fair: it is the instruction for putting it back.
    await expect(page.locator('.grav-notification').last()).toContainText('00:32:59');
    expect(await storedMoments(page)).toEqual([
      expect.objectContaining({ episodeId: TEST_EPISODE_ID, at: 3000 }),
    ]);
  });
});

test.describe('the "con mis momentos" filter', () => {
  test('builds the list in the browser, without asking the list endpoint', async ({
    page,
    gotoApp,
    api,
  }) => {
    await gotoApp('/episodes');
    await seedMoments(page, [
      { episodeId: TEST_EPISODE_ID, at: 500, markedAt: Date.now() },
      { episodeId: OTHER_EPISODE_ID, at: 900, markedAt: Date.now() },
    ]);
    await page.reload();

    await expect(page.locator('[data-test="only-mine"]')).toContainText('· 2');
    api.clear();
    await page.locator('[data-test="only-mine"]').click();

    await expect(page).toHaveURL(/\/episodes\?mine=true$/);
    await expect(page.locator('.ep-row')).toHaveCount(2);
    await expect(page.locator('[data-test="row-moments"]').first()).toContainText('1 momento tuyo');

    // ⚠️ The proof that the server did not answer this: the episodes were
    // fetched one by one, and `GET /episodes` was never asked for a page.
    await expect
      .poll(() => api.all('/api/episodes/').filter((call) => call.method === 'GET').length)
      .toBe(2);
    expect(api.episodeLists()).toHaveLength(0);
  });

  test('does not call an empty list a failed search', async ({ page, gotoApp }) => {
    await gotoApp('/episodes?mine=true');

    await expect(page.locator('.episodes__empty')).toContainText(
      'Todavía no has marcado ningún momento',
    );
    await expect(page.locator('.episodes__main')).not.toContainText('Ningún episodio se llama así');
  });
});
