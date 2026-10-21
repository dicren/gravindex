// **Playback and the queue.** (`playback.store` + `queue.store`, and the
// `$EventBus` `clip-play` channel they replaced.)
//
// A clip has no audio file of its own: the element loads the EPISODE's mp3 and
// seeks to `clip.start`. So "it starts at `start`" is a real, readable number —
// `audio.currentTime` on the element the application built.
//
// ⚠️ **A row no longer plays, it queues**, which
// changes what this group asserts: queueing into an EMPTY queue starts playback,
// queueing again only appends, and the single shared element is now proved by
// the PLAYER rather than by one card silencing another.
//
// ⚠️ The mp3 is answered locally (`lib/media.ts`). Nothing here reaches the
// media host.

import { getEpisode, type EpisodeClipJson } from '../lib/api';
import { TEST_EPISODE_ID } from '../lib/constants';
import { audioState, expect, test } from '../lib/fixtures';

/** How far past `start` the stream may have got by the time we look. Generous:
 *  the point is that it seeked, not how fast the machine is. */
const TOLERANCE_SECONDS = 20;

test.describe('queueing a clip', () => {
  let clips: EpisodeClipJson[] = [];

  test.beforeAll(async () => {
    clips = (await getEpisode(TEST_EPISODE_ID)).clips;
    expect(clips.length).toBeGreaterThan(1);
  });

  test('starts at the clip’s start, not at the beginning of the episode', async ({
    page,
    gotoApp,
    plays,
  }) => {
    const clip = clips[0]!;
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);

    const row = page.locator('.i-row').filter({ hasText: clip.title }).first();
    await row.getByRole('button', { name: `Añadir ${clip.title} a la cola` }).click();

    // ⚠️ The derived rule: an empty queue starts playing at once, or a first
    // visit would begin in silence and look broken.
    await expect.poll(async () => (await audioState(page)).length).toBe(1);
    await expect
      .poll(async () => (await audioState(page))[0]?.paused, { message: 'the stream is running' })
      .toBe(false);

    const [audio] = await audioState(page);
    // ⚠️ The clip starts 29 minutes into the episode. An element that ignored
    // `start` would read ~0 here — which is precisely the regression this guards.
    expect(clip.start).toBeGreaterThan(60);
    expect(audio!.currentTime).toBeGreaterThanOrEqual(clip.start);
    expect(audio!.currentTime).toBeLessThan(clip.start + TOLERANCE_SECONDS);

    // The player's clock agrees: elapsed is counted from the clip's START, so it
    // reads a handful of seconds and not the 29 minutes the stream is at.
    // ⚠️ `mm:ss`, not `hh:mm:ss` — `formatClipTime` drops the hours below one,
    // because a clip is a cut.
    await expect(page.locator('.player__title')).toHaveText(clip.title);
    await expect(page.locator('.player__time')).toHaveText(/^00:[0-2]\d \/ /);

    // ⚠️ One play row per clip. Intercepted rather
    // than written, so the pristine `playback` count is untouched.
    await expect.poll(() => plays.clipIds).toEqual([clip.id]);
    await page.locator('.player__play').click();
    await page.locator('.player__play').click();
    await page.waitForTimeout(500);
    expect(plays.clipIds).toEqual([clip.id]);
  });

  /**
   * ⚠️ **The queue button's third state, and why it exists at all.** It used to
   * disappear on the playing row — right in the abstract, since that clip is
   * already out of the queue, and wrong on screen: the row lost 8 rem and every
   * icon in its action bar slid sideways, so the column of share/download
   * glyphs bent around whichever clip was sounding. The geometry is what this
   * test measures, because that is what nobody notices in a unit test.
   */
  test('the row that is playing says so on a button of exactly the same width', async ({
    page,
    gotoApp,
  }) => {
    const clip = clips[0]!;
    const other = clips[1]!;
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);

    const row = page.locator('.i-row').filter({ hasText: clip.title }).first();
    const otherRow = page.locator('.i-row').filter({ hasText: other.title }).first();

    const before = await otherRow.locator('.i-row__ico').first().boundingBox();
    const heightBefore = (await row.boundingBox())?.height;

    await row.getByRole('button', { name: `Añadir ${clip.title} a la cola` }).click();

    await expect(row).toHaveClass(/is-playing/);
    // ⚠️ Present and inert, not absent.
    await expect(row.locator('.i-row__queue')).toHaveText('Reproduciendo');
    await expect(row.locator('.i-row__queue')).toBeDisabled();
    // ⚠️ And no badge above the title: it was the fourth mark, and the only
    // thing in a row that changed its height.
    await expect(row.locator('.i-row__now')).toHaveCount(0);
    expect((await row.boundingBox())?.height).toBe(heightBefore);

    // The share icon of the playing row lands on the same x as everyone
    // else's, and nothing moved on the row beside it either.
    const playingIcon = await row.locator('.i-row__ico').first().boundingBox();
    const after = await otherRow.locator('.i-row__ico').first().boundingBox();
    expect(playingIcon?.x).toBe(after?.x);
    expect(after?.x).toBe(before?.x);
  });

  /**
   * ⚠️ **On a wide screen the waveform is the seek control, and the only one**
   * (2026-08-22). The rule along the top of the player is a plain rule again
   * here: it would draw a position the waveform beside it already draws, and
   * offer a drag the waveform already offers. Both halves are measured, because
   * only a browser applies the media query that decides it.
   */
  test('the waveform seeks, and the rule along the top is only a rule', async ({
    page,
    gotoApp,
  }) => {
    const clip = clips[0]!;
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    await page
      .locator('.i-row')
      .filter({ hasText: clip.title })
      .first()
      .getByRole('button', { name: `Añadir ${clip.title} a la cola` })
      .click();

    // Nothing to drag up here, and no second position to read.
    await expect(page.locator('.player__seek')).toBeHidden();
    await expect(page.locator('.player__progress-fill')).toBeHidden();

    const wave = page.locator('.player__wave');
    await expect(wave).toBeVisible();

    const box = (await wave.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.66, box.y + box.height / 2);

    const length = clip.end - clip.start;
    await expect
      .poll(async () => (await audioState(page))[0]!.currentTime)
      .toBeGreaterThan(clip.start + length * 0.5);
    await expect(page.locator('.player__time')).not.toHaveText(/^00:0\d \//);
  });

  /**
   * ⚠️ **The rule along the top of the player is the seek control BELOW 720 px,
   * and there only.** The waveform is hidden at this width, so the rule is the
   * one place the position is either drawn or changed — hence the viewport, and
   * hence measuring it in a browser rather than trusting it to a unit test.
   */
  test.describe('below 720 px', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the rule along the top of the player drags the position', async ({ page, gotoApp }) => {
      const clip = clips[0]!;
      await gotoApp(`/episode/${TEST_EPISODE_ID}`);
      await page
        .locator('.i-row')
        .filter({ hasText: clip.title })
        .first()
        .getByRole('button', { name: `Añadir ${clip.title} a la cola` })
        .click();

      await expect(page.locator('.player__wave')).toBeHidden();

      const seek = page.locator('.player__seek');
      await expect(seek).toBeEnabled();

      const box = (await seek.boundingBox())!;
      // Two thirds along the bar. A range input jumps to where it is pressed.
      await page.mouse.click(box.x + box.width * 0.66, box.y + box.height / 2);

      const length = clip.end - clip.start;
      await expect
        .poll(async () => (await audioState(page))[0]!.currentTime)
        .toBeGreaterThan(clip.start + length * 0.5);
      await expect(page.locator('.player__time')).toBeHidden();
    });
  });

  test('queueing a second clip appends without interrupting the first', async ({
    page,
    gotoApp,
  }) => {
    const first = clips[0]!;
    const second = clips[1]!;
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);

    const firstRow = page.locator('.i-row').filter({ hasText: first.title }).first();
    const secondRow = page.locator('.i-row').filter({ hasText: second.title }).first();

    await firstRow.getByRole('button', { name: `Añadir ${first.title} a la cola` }).click();
    await expect(page.locator('.player__title')).toHaveText(first.title);

    await secondRow.getByRole('button', { name: `Añadir ${second.title} a la cola` }).click();

    // ⚠️ Still the first: queueing must not interrupt what is being listened to.
    await expect(page.locator('.player__title')).toHaveText(first.title);
    await expect(page.locator('.player__queue')).toContainText('2 en cola');
    await expect(secondRow.locator('.i-row__queue')).toHaveText('En la cola');
    await expect(secondRow.locator('.i-row__queue')).toBeDisabled();

    // ⚠️ Still ONE element. Nothing else has to be silenced, because there is only
    // one player.
    expect(await audioState(page)).toHaveLength(1);
  });

  test('the next button advances to the following clip', async ({ page, gotoApp }) => {
    const first = clips[0]!;
    const second = clips[1]!;
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);

    for (const clip of [first, second]) {
      await page
        .locator('.i-row')
        .filter({ hasText: clip.title })
        .first()
        .getByRole('button', { name: `Añadir ${clip.title} a la cola` })
        .click();
    }

    await page.getByRole('button', { name: 'Siguiente corte de la cola' }).click();

    await expect(page.locator('.player__title')).toHaveText(second.title);
    // The stream seeked to the new clip on the same element.
    expect(await audioState(page)).toHaveLength(1);
    await expect
      .poll(async () => (await audioState(page))[0]!.currentTime)
      .toBeGreaterThanOrEqual(second.start);
    // ...and there is nothing after it, so the button goes inert.
    await expect(page.getByRole('button', { name: 'Siguiente corte de la cola' })).toBeDisabled();
  });

  /**
   * ⚠️ **The permalink shows a vote count now, and could not before.**
   * `GET /clips/:id` returned no counts at all, and the permalink was the one screen
   * that needed them.
   */
  test('the permalink shows one vote count, and plays', async ({ page, gotoApp }) => {
    const clip = clips[0]!;
    await gotoApp(`/${clip.id}`);

    await expect(page.locator('.clip-hero')).toHaveCount(1);
    // ⚠️ Scoped to the hero: the rows underneath — `Relacionados` and `Del mismo
    // episodio` — each carry a vote button of their own, which is the point of
    // reusing the same row component.
    const hero = page.locator('.clip-hero');
    await expect(hero.getByRole('button', { name: /Votar a favor/ })).toHaveCount(1);
    // ⚠️ And exactly one control: every vote is positive, so there is no second
    // button anywhere on the page.
    await expect(page.getByRole('button', { name: /Votar en contra/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Escuchar' }).click();
    await expect.poll(async () => (await audioState(page)).length).toBe(1);
    await expect(page.locator('.player__title')).toHaveText(clip.title);
  });

  /**
   * ⚠️ **`Escuchar` has to sound even when the queue is not empty**, and for a
   * while it did not: it fell through to the same append a row does, which only
   * starts playback on an empty queue. The bug was invisible on a fresh visit
   * and total for anybody who had queued anything — the button played nothing
   * and silently added a row to a list on another page.
   */
  test('the permalink’s Escuchar interrupts a queue that is already going', async ({
    page,
    gotoApp,
  }) => {
    const queued = clips[0]!;
    const wanted = clips[1]!;

    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    await page
      .locator('.i-row')
      .filter({ hasText: queued.title })
      .first()
      .getByRole('button', { name: `Añadir ${queued.title} a la cola` })
      .click();
    await expect(page.locator('.player__title')).toHaveText(queued.title);

    await gotoApp(`/${wanted.id}`);
    await page.getByRole('button', { name: 'Escuchar' }).click();

    // ⚠️ Sounding now, and sitting right after the clip it interrupted rather
    // than at the end of the queue.
    await expect(page.locator('.player__title')).toHaveText(wanted.title);
    // ⚠️ **`1 en cola`, and the number is the assertion.** The pill counts
    // `upcoming` — what is left to hear — and not the whole queue, which is
    // `GlobalPlayer.vue`'s own documented rule: what has already played must not
    // inflate a number that says what is still ahead. So interrupting leaves ONE
    // clip ahead, the one that just started, with the interrupted one now behind
    // the playhead. The bug this test exists for — the button appending in
    // silence without playing anything — leaves the index where it was and reads
    // `2 en cola` instead.
    await expect(page.locator('.player__queue')).toContainText('1 en cola');
    // ⚠️ `at` is the position inside the clip that is sounding (2026-08-26),
    // whatever the stream has reached by the time this runs.
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('gravindex.queue') ?? '{}')),
    ).toEqual({ keys: [`c${queued.id}`, `c${wanted.id}`], index: 1, at: expect.any(Number) });
  });
});
