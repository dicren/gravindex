// **The queue**: persistence across a reload, and the share link round trip.
// (`queue.store`, `utils/queue-code.ts`.)
//
// ⚠️ Two claims only a browser can settle, and both are about what survives:
//
//   1. **A reload keeps the queue.** It is stored as ids and nothing else, so
//      the ids have to be resolved against the API on the way back in — and an
//      id that no longer exists has to disappear silently rather than leave a
//      404 in somebody's queue.
//   2. **A shared link never overwrites the visitor's queue.** It offers three
//      choices, and none of them happens by itself. There is no undo for
//      silently replacing a queue, which is why it is a banner and not a prompt.

import { getEpisode } from '../lib/api';
import { TEST_EPISODE_ID } from '../lib/constants';
import { audioState, expect, test } from '../lib/fixtures';

const STORAGE_KEY = 'gravindex.queue';

async function storedQueue(page: import('@playwright/test').Page): Promise<unknown> {
  return page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key) ?? 'null'),
    STORAGE_KEY,
  );
}

test.describe('the queue survives a reload', () => {
  test('stores keys only, and resolves them again on the way back', async ({ page, gotoApp }) => {
    const clips = (await getEpisode(TEST_EPISODE_ID)).clips.slice(0, 2);
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);

    for (const clip of clips) {
      await page
        .locator('.i-row')
        .filter({ hasText: clip.title })
        .first()
        .getByRole('button', { name: `Añadir ${clip.title} a la cola` })
        .click();
    }
    await expect(page.locator('.player__queue')).toContainText('2 en cola');

    // ⚠️ Keys, the index and the position inside the current clip — and nothing
    // else. No titles, no audio URLs, no vote counts: a title edited or a clip
    // deleted through the admin surface would otherwise leave a stale copy on
    // somebody's machine forever.
    // ⚠️ `c<id>`, not a bare id, since a whole episode can be queued too
    // (2026-08-25): both exist at the same numbers, so the key has to say which.
    // ⚠️ `at` is whatever the stream has reached by now — the point here is that
    // there is no SIXTH field, which is what `toEqual` is asserting.
    expect(await storedQueue(page)).toEqual({
      keys: clips.map((c) => `c${c.id}`),
      index: 0,
      at: expect.any(Number),
    });
    const raw = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
    expect(raw).not.toContain(clips[0]!.title);

    await gotoApp('/cola');

    await expect(page.locator('.q-row')).toHaveCount(2);
    await expect(page.locator('.q-row').first()).toContainText(clips[0]!.title);
    await expect(page.locator('.queue__meta')).toContainText('2 cortes');
  });

  /**
   * ⚠️ **Silently.** A clip removed through the admin surface must not leave a
   * 404 in somebody's queue, and the visitor did nothing wrong — there is
   * nothing for them to do about it either. 175 and 176 are the two ids deleted
   * by hand in production years ago.
   */
  test('drops an id that no longer resolves, without a word', async ({ page, gotoApp }) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      // ⚠️ The pre-2026-08-25 shape on purpose: it is what is on the machine of
      // everybody who had a queue before episodes could be in one, and it must
      // still load — as clips, which every one of those numbers was.
      [STORAGE_KEY, JSON.stringify({ ids: [175, 137], index: 0 })],
    );

    await gotoApp('/cola');

    await expect(page.locator('.q-row')).toHaveCount(1);
    await expect(page.locator('.q-row').first()).not.toContainText('175');
    await expect(page.locator('.grav-notification')).toHaveCount(0);
    await expect
      .poll(async () => (await storedQueue(page)) as { keys: string[] })
      .toMatchObject({
        keys: ['c137'],
      });
  });

  /**
   * **Where you were listening, kept between visits** (2026-08-26).
   *
   * ⚠️ **This reverses a decision the queue used to state in as many words**:
   * the position inside a clip was deliberately not persisted, because "a queue
   * that half-remembers is worse than one that does not". The lengths are what
   * changed the answer — the median clip runs two minutes, one in ten past
   * seven, and a whole EPISODE has been a queue item since 2026-08-25.
   *
   * ⚠️ Only a browser can prove this one: `at` has to survive `localStorage`,
   * reach an element whose stream is still cold, and end up as a real
   * `currentTime` on a real seek — the exact path a unit test replaces with a
   * fake.
   */
  test('comes back to where the clip was left, not to its beginning', async ({ page, gotoApp }) => {
    const long = (await getEpisode(TEST_EPISODE_ID)).clips.find((c) => c.end - c.start > 90);
    expect(long, 'the test episode has a clip long enough to be left half-heard').toBeDefined();

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [STORAGE_KEY, JSON.stringify({ keys: [`c${long!.id}`], index: 0, at: 40 })],
    );

    await gotoApp('/');

    // ⚠️ The key resolved back into a clip and the player is showing it, with
    // its clock at `00:00` — nothing is LOADED until play is pressed, which is
    // exactly the state the stored position has to survive.
    await expect(page.locator('.player__title')).toHaveText(long!.title);
    await expect(page.locator('.player__time')).toHaveText(/^00:00 \/ /);

    await page.locator('.player__play').click();

    // ⚠️ The element is 40 s into the CLIP, which is 40 s past `start` — a
    // position measured in the episode's own timeline, as every seek here is.
    await expect
      .poll(async () => (await audioState(page))[0]?.currentTime ?? 0, {
        message: 'the stream is where it was left',
      })
      .toBeGreaterThanOrEqual(long!.start + 40);
    // ...and the clock still counts from the cut, not from the episode.
    await expect(page.locator('.player__time')).toHaveText(/^00:[45]\d \/ /);
  });

  test('an empty queue says the app’s own joke, and offers the way back', async ({
    page,
    gotoApp,
  }) => {
    await gotoApp('/cola');

    await expect(page.locator('.queue__empty p')).toHaveText(
      'Esto está más vacío que la petaca de Melocotón Cane',
    );
    await expect(page.locator('.queue__empty a')).toHaveAttribute('href', '/');
  });
});

test.describe('sharing a queue', () => {
  test('copies a compressed link that round-trips back to the same clips', async ({
    page,
    gotoApp,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const clips = (await getEpisode(TEST_EPISODE_ID)).clips.slice(0, 3);

    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    for (const clip of clips) {
      await page
        .locator('.i-row')
        .filter({ hasText: clip.title })
        .first()
        .getByRole('button', { name: `Añadir ${clip.title} a la cola` })
        .click();
    }

    await gotoApp('/cola');
    await page.getByRole('button', { name: 'Compartir la cola' }).click();
    await expect(page.locator('.grav-notification')).toContainText('Enlace de la cola copiado');

    const link = await page.evaluate(() => navigator.clipboard.readText());
    // ⚠️ Two base62 characters per id, no separators — six characters for three
    // clips, against the 20-odd a comma-separated list costs once escaped.
    expect(new URL(link).pathname).toBe('/cola');
    expect(new URL(link).searchParams.get('c')).toHaveLength(clips.length * 2);
  });

  /**
   * ⚠️ **Three choices, and none of them happens by itself.** A link somebody
   * sent is not a command, and a queue replaced without asking cannot be undone.
   */
  test('offers to add, replace or discard, and changes nothing until asked', async ({
    page,
    gotoApp,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const clips = (await getEpisode(TEST_EPISODE_ID)).clips;
    const shared = clips.slice(0, 2);
    const mine = clips[5]!;

    // Build a link from two clips…
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    for (const clip of shared) {
      await page
        .locator('.i-row')
        .filter({ hasText: clip.title })
        .first()
        .getByRole('button', { name: `Añadir ${clip.title} a la cola` })
        .click();
    }
    await gotoApp('/cola');
    await page.getByRole('button', { name: 'Compartir la cola' }).click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    const code = new URL(link).searchParams.get('c') ?? '';

    // …then arrive at it with a different queue of your own.
    await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    await page
      .locator('.i-row')
      .filter({ hasText: mine.title })
      .first()
      .getByRole('button', { name: `Añadir ${mine.title} a la cola` })
      .click();

    await gotoApp(`/cola?c=${code}`);

    await expect(page.locator('.queue__banner')).toContainText('Te han pasado una cola');
    // ⚠️ Untouched until a choice is made.
    await expect
      .poll(async () => (await storedQueue(page)) as { keys: string[] })
      .toMatchObject({
        keys: [`c${mine.id}`],
      });

    await page.getByRole('button', { name: 'Añadir al final' }).click();

    await expect(page.locator('.q-row')).toHaveCount(3);
    await expect
      .poll(async () => (await storedQueue(page)) as { keys: string[] })
      .toMatchObject({
        keys: [`c${mine.id}`, ...shared.map((c) => `c${c.id}`)],
      });
    // ⚠️ The code leaves the address, or a reload asks the same question again.
    await expect.poll(() => new URL(page.url()).search).toBe('');
  });

  test('a malformed code shows no banner and asks the API for nothing', async ({
    page,
    gotoApp,
    api,
  }) => {
    await gotoApp('/cola?c=!!');

    await expect(page.locator('.queue__banner')).toHaveCount(0);
    expect(api.all('/api/clips/')).toHaveLength(0);
  });
});

test.describe('the queue screen’s own controls', () => {
  test('removes a clip and empties the whole thing', async ({ page, gotoApp }) => {
    const clips = (await getEpisode(TEST_EPISODE_ID)).clips.slice(0, 2);
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    for (const clip of clips) {
      await page
        .locator('.i-row')
        .filter({ hasText: clip.title })
        .first()
        .getByRole('button', { name: `Añadir ${clip.title} a la cola` })
        .click();
    }

    await gotoApp('/cola');
    await page.getByRole('button', { name: `Quitar ${clips[1]!.title} de la cola` }).click();
    await expect(page.locator('.q-row')).toHaveCount(1);

    await page.getByRole('button', { name: 'Vaciar' }).click();
    // ⚠️ Clears the list AND stops playback: a player still going over an empty
    // queue is the state nobody can explain.
    await expect(page.locator('.queue__empty')).toBeVisible();
    await expect(page.locator('.player__title')).toHaveText('Nada sonando');
  });

  /**
   * ⚠️ **Three clips, not two.** The clip right after the one playing sits at
   * `currentIndex + 1`, the one slot nothing may move TO any more — a clip
   * dropped there would never sound again on its own. The third clip is the
   * one still free to move.
   */
  test('reorders from the keyboard, since a drag handle alone excludes people', async ({
    page,
    gotoApp,
  }) => {
    const clips = (await getEpisode(TEST_EPISODE_ID)).clips.slice(0, 3);
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    for (const clip of clips) {
      await page
        .locator('.i-row')
        .filter({ hasText: clip.title })
        .first()
        .getByRole('button', { name: `Añadir ${clip.title} a la cola` })
        .click();
    }

    await gotoApp('/cola');
    await page.getByRole('button', { name: `Subir ${clips[2]!.title} en la cola` }).click();

    const rows = page.locator('.q-row');
    // ⚠️ Nothing moves ahead of what is playing: the first row is still it.
    await expect(rows.nth(0)).toContainText(clips[0]!.title);
    await expect(rows.nth(1)).toContainText(clips[2]!.title);
    await expect(rows.nth(2)).toContainText(clips[1]!.title);
    await expect(page.locator('.player__title')).toHaveText(clips[0]!.title);
  });

  /**
   * ⚠️ The clip right after the one playing has no up-arrow to press: moving
   * it would put it ahead of `currentIndex`.
   */
  test('will not move a clip ahead of the one playing', async ({ page, gotoApp }) => {
    const clips = (await getEpisode(TEST_EPISODE_ID)).clips.slice(0, 2);
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    for (const clip of clips) {
      await page
        .locator('.i-row')
        .filter({ hasText: clip.title })
        .first()
        .getByRole('button', { name: `Añadir ${clip.title} a la cola` })
        .click();
    }

    await gotoApp('/cola');
    await expect(
      page.getByRole('button', { name: `Subir ${clips[1]!.title} en la cola` }),
    ).toBeDisabled();
  });

  /**
   * ⚠️ **Reordering works with a finger, and for months it did not.** The handle
   * carried `draggable="true"` — HTML5 drag-and-drop, which fires nothing at all
   * for touch — so on a phone the asa was inert while the hint under the list
   * told people to drag it. It is on pointer events now, one code path for
   * mouse, touch and pen.
   *
   * The gesture is dispatched with `pointerType: 'touch'` on purpose: a mouse
   * drag would have passed against an implementation that was broken for touch too,
   * and proved nothing about the case that matters.
   *
   * ⚠️ **Three clips, not two, and the THIRD row's handle.** The row playing
   * has none, and the row right after it is not a valid drop target either —
   * only the third row is still free to move.
   */
  test('reorders by dragging with a finger, which HTML5 drag never could', async ({
    page,
    gotoApp,
  }) => {
    const clips = (await getEpisode(TEST_EPISODE_ID)).clips.slice(0, 3);
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    for (const clip of clips) {
      await page
        .locator('.i-row')
        .filter({ hasText: clip.title })
        .first()
        .getByRole('button', { name: `Añadir ${clip.title} a la cola` })
        .click();
    }

    await gotoApp('/cola');
    const rows = page.locator('.q-row');
    await expect(rows).toHaveCount(3);

    const grip = rows.nth(2).locator('.q-row__grip');
    const target = await rows.nth(1).boundingBox();
    const held = await grip.boundingBox();
    const touch = { pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true };

    await grip.dispatchEvent('pointerdown', {
      ...touch,
      clientX: held!.x + held!.width / 2,
      clientY: held!.y + held!.height / 2,
    });
    await grip.dispatchEvent('pointermove', {
      ...touch,
      clientX: target!.x + target!.width / 2,
      clientY: target!.y + target!.height / 2,
    });
    await grip.dispatchEvent('pointerup', { ...touch });

    // ⚠️ Same rule as the keyboard's: the clip playing does not move.
    await expect(rows.nth(0)).toContainText(clips[0]!.title);
    await expect(rows.nth(1)).toContainText(clips[2]!.title);
    await expect(rows.nth(2)).toContainText(clips[1]!.title);
    await expect(page.locator('.player__title')).toHaveText(clips[0]!.title);
  });

  /**
   * ⚠️ **A row must not change height when it starts sounding.** `sonando ahora`
   * was a line of its own above the title, so the playing row was ~11 px taller
   * than the rest and the list shuffled under the cursor every time a clip
   * advanced. It rides inside the meta line now.
   */
  test('keeps every row the same height, playing or not', async ({ page, gotoApp }) => {
    const clips = (await getEpisode(TEST_EPISODE_ID)).clips.slice(0, 2);
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    for (const clip of clips) {
      await page
        .locator('.i-row')
        .filter({ hasText: clip.title })
        .first()
        .getByRole('button', { name: `Añadir ${clip.title} a la cola` })
        .click();
    }

    await gotoApp('/cola');
    const rows = page.locator('.q-row');
    await expect(rows.first()).toHaveClass(/is-playing/);
    await expect(rows.first().locator('.q-row__now')).toContainText('sonando ahora');

    const playing = await rows.nth(0).boundingBox();
    const idle = await rows.nth(1).boundingBox();
    expect(playing?.height).toBe(idle?.height);
  });

  /**
   * ⚠️ **The first VISIBLE row is always the one playing** (2026-08-19). What
   * came before it is folded behind the "Historial" toggle so a queue a few
   * clips deep does not scroll what matters — what is playing and what is next
   * — off the top of the screen. Row numbers still count the real position.
   *
   * ⚠️ **The label itself does not change** (2026-08-20): it used to read
   * "Mostrar/Ocultar lo que ya ha sonado", too long to sit on one line with the
   * (now icon-only) share and Vaciar buttons. "Historial" stays put; only the
   * chevron and `aria-expanded` say which state it is in.
   */
  test('folds what has already sounded behind a toggle', async ({ page, gotoApp }) => {
    const clips = (await getEpisode(TEST_EPISODE_ID)).clips.slice(0, 3);
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    for (const clip of clips) {
      await page
        .locator('.i-row')
        .filter({ hasText: clip.title })
        .first()
        .getByRole('button', { name: `Añadir ${clip.title} a la cola` })
        .click();
    }

    await gotoApp('/cola');
    // Nothing has sounded yet: no toggle, every row shown.
    await expect(page.getByRole('button', { name: 'Historial' })).toHaveCount(0);
    await expect(page.locator('.q-row:visible')).toHaveCount(3);

    await page.getByRole('button', { name: 'Siguiente corte de la cola' }).click();

    const toggle = page.getByRole('button', { name: 'Historial' });
    await expect(toggle).toContainText('1');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.q-row:visible')).toHaveCount(2);
    await expect(page.locator('.q-row:visible').first()).toContainText(clips[1]!.title);
    // ⚠️ The number is the real position in the queue, not 1 within what shows.
    await expect(page.locator('.q-row:visible').first().locator('.q-row__num')).toHaveText('2');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.q-row:visible')).toHaveCount(3);
    await expect(page.locator('.q-row:visible').first()).toContainText(clips[0]!.title);
  });
});
