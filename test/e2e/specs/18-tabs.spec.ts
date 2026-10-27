// **Two tabs: one queue and one sound** (2026-10-27).
//
// ⚠️ **This is the only group in the suite that opens a SECOND page**, and it is
// the only way to settle what the change actually promises. A unit test can
// prove the protocol (`tab-coordination/__tests__/start-tab-coordination.spec.ts`),
// but not that the browser really delivers a `storage` event to the other tab nor
// that `BroadcastChannel` crosses pages — which is the whole transport.
//
// What is asserted, and nothing else:
//
//   1. **The sound moves to the tab somebody presses play in.** The other tab
//      pauses politely; the queue does not move and nothing is lost.
//   2. **The queue follows the tab that last wrote it.** A row removed in one
//      tab disappears from the other without a reload.
//
// ⚠️ **Two tabs of one browser context, not two contexts.** `localStorage`, the
// `storage` event and `BroadcastChannel` are per ORIGIN within one context;
// separate contexts would be two different browsers and would prove nothing.
//
// ⚠️ **Nothing here writes a row.** Every request is a read, and the two edits
// the tabs make are to `localStorage`. The one write playback would cause —
// `POST /clips/:id/play` — is answered locally on both pages, as the `page`
// fixture does for the first tab. The row counts and sequences the suite checks
// around a run are untouched.

import type { BrowserContext, Page } from '@playwright/test';

import { getEpisode } from '../lib/api';
import { TEST_EPISODE_ID } from '../lib/constants';
import { audioState, expect, test } from '../lib/fixtures';
import { interceptEpisodeMedia } from '../lib/media';

const QUEUE_KEY = 'gravindex.queue';

/**
 * A second tab of the same origin.
 *
 * ⚠️ **Three of the `page` fixture's jobs have to be repeated here**, because the
 * fixture only instruments the page Playwright handed it: the media host is
 * intercepted (no test may reach a third party's server), `POST /clips/:id/play`
 * is answered locally (a real one would append to the pristine fixture), and the
 * voter token would come from the app rather than the fixture — harmless here,
 * since neither tab votes. Everything else is the browser's and needs no help:
 * same context, same origin, same `localStorage`, same channel.
 */
async function openSecondTab(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await interceptEpisodeMedia(page);
  await page.route('**/api/clips/*/play', (route) =>
    route.fulfill({
      status: 201,
      headers: { 'content-type': 'application/json' },
      body: '{"id":0}',
    }),
  );
  return page;
}

/** What this browser has stored: the queue both tabs share. */
async function storedQueue(page: Page): Promise<{ keys: string[]; index: number; at: number }> {
  return page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? 'null'), QUEUE_KEY);
}

/** The row's only play-shaped control: a row queues, it never plays. */
async function queueFromRow(page: Page, clip: { readonly title: string }): Promise<void> {
  await page
    .locator('.i-row')
    .filter({ hasText: clip.title })
    .first()
    .getByRole('button', { name: `Añadir ${clip.title} a la cola` })
    .click();
}

test.describe('one sound', () => {
  /**
   * ⚠️ **The case that made this worth building**: two tabs, one of them
   * listening, and the visitor presses play in the other. Before 2026-10-27 both
   * elements sounded at once — two copies of the same episode, a second apart.
   */
  test('the sound moves to the tab somebody presses play in', async ({
    page,
    context,
    gotoApp,
  }) => {
    const [clip] = (await getEpisode(TEST_EPISODE_ID)).clips;

    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    // ⚠️ Queueing into an EMPTY queue starts it, which is what a row without a
    // play button is worth (`queue.store.ts`).
    await queueFromRow(page, clip!);
    await expect(page.locator('.player__play')).toHaveAttribute('aria-label', 'Pausar');

    const second = await openSecondTab(context);
    await second.goto(`/episode/${TEST_EPISODE_ID}`);

    // ⚠️ **The queue travelled with no request of its own**: the second tab booted
    // from the same `localStorage` and hydrated the id it found there.
    await expect(second.locator('.player__title')).toHaveText(clip!.title);

    await second.locator('.player__play').click();

    await expect(second.locator('.player__play')).toHaveAttribute('aria-label', 'Pausar');
    // ⚠️ A PAUSE in the other tab, not a stop: the clip is still on its
    // transport, and pressing play there carries on rather than starting over.
    await expect(page.locator('.player__play')).toHaveAttribute('aria-label', 'Reproducir');
    await expect.poll(async () => (await audioState(page))[0]?.paused).toBe(true);
    await expect(page.locator('.player__title')).toHaveText(clip!.title);
  });
});

test.describe('one queue', () => {
  /**
   * ⚠️ **Both tabs idle, and that is on purpose**: nothing here may depend on
   * playback. `index: -1` is "nothing loaded", so the queue is a list and
   * neither tab starts making sound.
   */
  test('a row removed in one tab disappears from the other', async ({ page, context, gotoApp }) => {
    const clips = (await getEpisode(TEST_EPISODE_ID)).clips.slice(0, 2);
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [QUEUE_KEY, JSON.stringify({ keys: clips.map((clip) => `c${clip.id}`), index: -1, at: 0 })],
    );

    await gotoApp('/cola');
    await expect(page.locator('.q-row')).toHaveCount(2);

    const second = await openSecondTab(context);
    await second.goto('/cola');
    await expect(second.locator('.q-row')).toHaveCount(2);

    await page.getByRole('button', { name: `Quitar ${clips[0]!.title} de la cola` }).click();

    // ⚠️ **No reload in the second tab.** The browser's own `storage` event is
    // what it hears, which is the piece no unit test can prove.
    await expect(page.locator('.q-row')).toHaveCount(1);
    await expect(second.locator('.q-row')).toHaveCount(1);
    await expect(second.locator('.q-row')).toContainText(clips[1]!.title);
    expect((await storedQueue(second)).keys).toEqual([`c${clips[1]!.id}`]);
  });
});
