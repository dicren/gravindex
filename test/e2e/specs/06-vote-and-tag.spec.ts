// **Voting and tagging**, including the two outcomes that are NOT errors.
//
// ⚠️ The repeated vote comes back as **HTTP 201 with an `error` field**, not as
// an HTTP failure. That is the contract (Nest's default status for a POST,
// which nobody ever changed) and it is kept deliberately. It has to surface as a notice — `¡No puedes votar dos veces!`
// — and the counter must not move. Both halves are asserted here, and so is the
// status code itself: a suite that only checked the toast would still pass if
// someone "fixed" this into a 409.
//
// The repeated TAG is the mirror image: a genuine 409, and still not a failure —
// `Ese tag ya existe en ese clip.` and nothing else happens.
//
// ⚠️ **There is one vote and it is positive.** What this asserts is that the
// upvote survives a reload, plus a direct check that `-1` is refused.
//
// Every row written here carries this test's voter token and is deleted by the
// global teardown, which then asserts the pristine counts again.

import { statSync } from 'node:fs';
import { getEpisode } from '../lib/api';
import { API_URL, TEST_EPISODE_ID, WRITE_MARKER } from '../lib/constants';
import { expect, test } from '../lib/fixtures';

function upLabel(title: string, count: number): RegExp {
  return new RegExp(`^Votar a favor de ${escapeRegExp(title)} \\(${count} votos\\)$`);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test.describe('voting', () => {
  test('a first vote moves the counter; the second is a notice, not a failure', async ({
    page,
    gotoApp,
  }) => {
    const clip = (await getEpisode(TEST_EPISODE_ID)).clips[0]!;
    const statuses: number[] = [];
    page.on('response', (response) => {
      if (new URL(response.url()).pathname === `/api/clips/${clip.id}/vote/1`) {
        statuses.push(response.status());
      }
    });

    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    const row = page.locator('.i-row').filter({ hasText: clip.title }).first();
    const up = row.getByRole('button', { name: /^Votar a favor/ });

    await expect(up).toHaveAttribute('aria-label', upLabel(clip.title, clip.up));
    await up.click();

    // ⚠️ Patched from the server's own `{ add, delete }`, not refetched: the
    // deliberate exception to "writes invalidate".
    await expect(up).toHaveAttribute('aria-label', upLabel(clip.title, clip.up + 1));
    await expect(page.locator('.grav-notification')).toHaveCount(0);

    await up.click();
    await expect(page.locator('.grav-notification')).toContainText('¡No puedes votar dos veces!');
    // The number did NOT move.
    await expect(up).toHaveAttribute('aria-label', upLabel(clip.title, clip.up + 1));

    // ⚠️ **And it lands above the player, which is why the notices moved to the
    // top (2026-08-26).** They used to be `bottom: 2.5rem` with `z-index: 1000`
    // against a 78 px transport at `4`, so a notice did not sit near the player,
    // it sat ON the play button — and this exact notice, the repeated vote, is
    // the one people meet most. A box check rather than a CSS one: what broke
    // was where it landed, not which rule put it there.
    const noticeBox = (await page.locator('.grav-notification').first().boundingBox())!;
    const playerBox = (await page.locator('.player-dock').boundingBox())!;
    expect(noticeBox.y + noticeBox.height).toBeLessThan(playerBox.y);
    expect(noticeBox.y).toBeLessThan(200);

    await expect.poll(() => statuses).toEqual([201, 201]);
  });

  test('the vote survives a reload, because it is a row and not a local counter', async ({
    page,
    gotoApp,
  }) => {
    const clip = (await getEpisode(TEST_EPISODE_ID)).clips[1]!;
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    const row = page.locator('.i-row').filter({ hasText: clip.title }).first();

    await row.getByRole('button', { name: /^Votar a favor/ }).click();
    await expect(row.getByRole('button', { name: /^Votar a favor/ })).toHaveAttribute(
      'aria-label',
      upLabel(clip.title, clip.up + 1),
    );

    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    const reloaded = page.locator('.i-row').filter({ hasText: clip.title }).first();
    await expect(reloaded.getByRole('button', { name: /^Votar a favor/ })).toHaveAttribute(
      'aria-label',
      upLabel(clip.title, clip.up + 1),
    );
  });

  /**
   * ⚠️ **A negative vote is not a vote, and the API says so.** The UI cannot
   * reach this — there is one button — so it is asserted against the endpoint
   * directly: a client sending `-1` must be TOLD, rather than have it silently
   * counted as an upvote or silently dropped.
   */
  test('a negative vote is refused by the API', async ({ request, voterToken }) => {
    const clip = (await getEpisode(TEST_EPISODE_ID)).clips[2]!;

    const response = await request.post(`${API_URL}/api/clips/${clip.id}/vote/-1`, {
      headers: { 'X-Voter-Token': voterToken },
    });

    expect(response.status()).toBe(400);
  });

  test('a vote also moves the count in the player, for the clip it is playing', async ({
    page,
    gotoApp,
  }) => {
    // ⚠️ The player reads its number from the queue store, which is not a query
    // cache — so it is patched separately, and this is what notices if that is
    // ever dropped.
    const clip = (await getEpisode(TEST_EPISODE_ID)).clips[3]!;
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);

    const row = page.locator('.i-row').filter({ hasText: clip.title }).first();
    await row.getByRole('button', { name: `Añadir ${clip.title} a la cola` }).click();
    await expect(page.locator('.player__title')).toHaveText(clip.title);

    const pill = page.locator('.player__pill').first();
    await expect(pill).toHaveText(String(clip.up));

    await pill.click();
    await expect(pill).toHaveText(String(clip.up + 1));
  });

  /**
   * ⚠️ **The library, which stores its rows in a DIFFERENT cache shape from
   * every other screen here.** `/` is a Colada infinite query — one entry
   * holding every batch loaded so far — while the episode page above is an
   * ordinary one. A patch written for the ordinary shape skips the infinite
   * entry in silence, so the vote lands on the server and the number under the
   * thumb does not move. That shipped, and nothing in either suite caught it:
   * the tests above all drive the episode page.
   *
   * The clip is searched for by title so the row is on the first batch
   * regardless of how the library happens to be sorted.
   */
  test('a vote moves the counter on the library, whose list is infinite', async ({
    page,
    gotoApp,
  }) => {
    const clip = (await getEpisode(TEST_EPISODE_ID)).clips[5]!;

    await gotoApp(`/?search=${encodeURIComponent(clip.title)}`);
    const row = page.locator('.i-row').filter({ hasText: clip.title }).first();
    const up = row.getByRole('button', { name: /^Votar a favor/ });
    await expect(up).toHaveAttribute('aria-label', upLabel(clip.title, clip.up));

    await up.click();

    await expect(up).toHaveAttribute('aria-label', upLabel(clip.title, clip.up + 1));
    await expect(row.locator('.i-row__count')).toHaveText(String(clip.up + 1));
  });
});

test.describe('tagging', () => {
  test('a new tag appears on the clip; the same tag again is a notice', async ({
    page,
    gotoApp,
  }) => {
    const clip = (await getEpisode(TEST_EPISODE_ID)).clips[4]!;
    const tag = `${WRITE_MARKER}-uno`;
    const statuses: number[] = [];
    page.on('response', (response) => {
      if (new URL(response.url()).pathname.startsWith(`/api/clips/${clip.id}/tag/`)) {
        statuses.push(response.status());
      }
    });

    // ⚠️ Adding a tag lives on the clip permalink now: it is the one screen
    // where a clip is shown whole, and a row has no room for an input.
    await gotoApp(`/${clip.id}`);
    await expect(page.locator('.clip-tags .v-chip').filter({ hasText: tag })).toHaveCount(0);

    await page.getByRole('button', { name: 'Añadir un tag a este clip' }).click();
    await page.getByRole('combobox', { name: 'Añadir un tag a este clip' }).fill(tag);
    await page.keyboard.press('Enter');

    // ⚠️ The chip arrives with the refetch, not from a local copy — `useAddTag`
    // invalidates the clip keys. Keeping both would double the chip for a beat.
    await expect(page.locator('.clip-tags .v-chip').filter({ hasText: tag })).toHaveCount(1);

    await page.getByRole('button', { name: 'Añadir un tag a este clip' }).click();
    await page.getByRole('combobox', { name: 'Añadir un tag a este clip' }).fill(tag);
    await page.keyboard.press('Enter');

    await expect(page.locator('.grav-notification')).toContainText(
      'Ese tag ya existe en ese clip.',
    );
    await expect(page.locator('.clip-tags .v-chip').filter({ hasText: tag })).toHaveCount(1);

    // 201 then 409: the second one IS an HTTP error, and still not a failure to
    // the visitor. The two outcomes in this file are not the same shape.
    await expect.poll(() => statuses).toEqual([201, 409]);
  });

  test('clicking a tag on the library filters by exactly that tag', async ({ page, gotoApp }) => {
    await gotoApp('/');
    await expect(page.locator('.i-row').first()).toBeVisible();

    const chip = page.locator('.i-row__tag').first();
    const tag = ((await chip.textContent()) ?? '').trim();
    await chip.click();

    // ⚠️ It REPLACES the filter rather than appending: the single-tag behaviour.
    await expect.poll(() => new URL(page.url()).searchParams.getAll('tags')).toEqual([tag]);
    await expect(page.locator('.tagfilter__chosen .tagfilter__item')).toHaveCount(1);
  });
});

test.describe('sharing and downloading', () => {
  test('share copies the permalink and says so', async ({ page, gotoApp, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await gotoApp('/');
    await expect(page.locator('.i-row').first()).toBeVisible();

    const title = ((await page.locator('.i-row__title').first().textContent()) ?? '').trim();
    await page.getByRole('button', { name: `Compartir ${title}` }).click();

    await expect(page.locator('.grav-notification')).toContainText('Enlace copiado');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    // ⚠️ `/<id>` — the shape people have been sharing since 2019.
    expect(copied).toMatch(/^http:\/\/[^/]+\/\d+$/);
  });

  /**
   * ⚠️ **Recorded deviation from the accepted design (2026-08-20): download is
   * no longer drawn-and-inert.** The design assumed a real download needed a
   * server-side re-encode; an mp3 is a sequence of
   * independent frames, so the clip is cut client-side by copying bytes out of
   * `Range` reads (`core/application/audio/mp3-frames.ts`), and the only thing
   * the backend does is relay them same-origin — `lib/audio-download.ts` is
   * what stands in for that relay here, since the media host must never be
   * reached from this suite.
   */
  test('download saves a real, correctly-named mp3 file', async ({ page, gotoApp }) => {
    await gotoApp('/');
    await expect(page.locator('.i-row').first()).toBeVisible();

    const title = ((await page.locator('.i-row__title').first().textContent()) ?? '').trim();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: `Descargar ${title}` }).click(),
    ]);

    expect(download.suggestedFilename()).toBe(`${title}.mp3`);
    const path = await download.path();
    expect(path).not.toBeNull();
    // ⚠️ Not zero bytes: a synthetic frame stream with no real audio in it
    // still has to be a well-formed cut, or this would pass for an empty file.
    expect(statSync(path!).size).toBeGreaterThan(0);
  });
});
