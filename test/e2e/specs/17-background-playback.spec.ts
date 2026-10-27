// **Playback the platform can interrupt, and a queue that survives it**
// (2026-10-27: `playback.store` now believes the ELEMENT — `play`/`pause`/
// `ended`/`error` — instead of only its own calls; `queue.store` skips an item
// that failed twice and says so ONCE per run of dead files; the transport gained
// `previous`.)
//
// ⚠️ **Everything here needs an event a browser will not produce by itself.** A
// clip never really runs out — the store stops it at `clip.end` on `timeupdate`
// — a system pause is the browser's decision and not the app's, and the fixture
// answers every mp3 successfully. So `lib/fixtures.ts`'s `emitAudioEvent` makes
// the element the app built say the thing, and `page.route` refuses a file
// outright, which is the only way to make a load really fail. Either way the
// app's OWN listeners are what run: nothing in this file calls a store.
//
// ⚠️ **Nothing in this file writes a row.** Each group either queues its clips
// through the rows or plants a queue in `localStorage`, and every request is a
// read — the row counts and sequences the suite checks around a run are
// untouched.

import type { Locator, Page } from '@playwright/test';

import { API_URL, TEST_EPISODE_ID } from '../lib/constants';
import { getEpisode, type EpisodeClipJson } from '../lib/api';
import {
  audioSource,
  audioState,
  emitAudioEvent,
  expect,
  pauseAudioElement,
  test,
} from '../lib/fixtures';

const QUEUE_KEY = 'gravindex.queue';

interface ListedClip {
  readonly id: number;
  readonly title: string;
  readonly episode: { readonly id: number };
}

/** What a stored queue says: the keys, where the player is, and where it was. */
interface StoredQueue {
  readonly keys: readonly string[];
  readonly index: number;
  readonly at: number;
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

/** The element is sounding, and the transport agrees. */
async function expectSounding(page: Page): Promise<void> {
  await expect
    .poll(async () => (await audioState(page))[0]?.paused, { message: 'the stream is running' })
    .toBe(false);
  await expect(page.locator('.player__play')).toHaveAttribute('aria-label', 'Pausar');
}

/** The queue as this browser has it. ⚠️ Read, never written: nothing here may
 *  touch a row, and this is the same `localStorage` entry spec 11 asserts on. */
async function storedQueue(page: Page): Promise<StoredQueue> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), QUEUE_KEY);
  return JSON.parse(raw ?? '{}') as StoredQueue;
}

/** Put a queue in place before the app boots, so hydration resolves it — the
 *  door a reload comes through, and the only way to hold clips from more than
 *  one episode without navigating away from the player under test. */
async function plantQueue(page: Page, keys: readonly string[]): Promise<void> {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [QUEUE_KEY, JSON.stringify({ keys, index: 0, at: 0 })],
  );
}

/**
 * Every request the page makes for an episode's mp3, in order.
 *
 * ⚠️ **Registered before the page opens** — a media request made during boot
 * would otherwise be missed. It is how the tests below say "two attempts per dead
 * file" (`load()`, then the one retry) without reading a store.
 */
function watchMp3Requests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('.mp3')) urls.push(request.url());
  });
  return urls;
}

/** Answer a failure for these episodes' mp3s, and leave the fixture's handler in
 *  charge of every other file. ⚠️ Registered after the fixture's route, so this
 *  one is asked first and `fallback()` is what keeps the rest working. */
async function breakEpisodes(page: Page, episodeIds: readonly number[]): Promise<void> {
  await page.route(/\/audio\/\d+\.mp3$/, async (route) => {
    if (episodeIds.some((id) => route.request().url().includes(`/audio/${id}.mp3`))) {
      await route.abort('failed');
      return;
    }
    await route.fallback();
  });
}

/** `count` clips on `count` DIFFERENT episodes, so each one has its own mp3. */
async function clipsOnDifferentEpisodes(count: number): Promise<ListedClip[]> {
  const response = await fetch(`${API_URL}/api/clips?limit=100`);
  expect(response.ok).toBe(true);
  const listed = (await response.json()) as { results: ListedClip[] };

  const picked: ListedClip[] = [];
  const episodes = new Set<number>();
  for (const row of listed.results) {
    if (episodes.has(row.episode.id)) continue;
    episodes.add(row.episode.id);
    picked.push(row);
    if (picked.length === count) break;
  }
  expect(picked, 'the fixture has enough clips on different episodes').toHaveLength(count);
  return picked;
}

/**
 * Wait for the broken-audio notice and **pin it**, then hand it back.
 *
 * ⚠️ **The click is not decoration.** An unpinned notice dismisses itself after
 * 2.5 s, so "there was never a second one" could only be asserted inside one
 * toast's lifetime — which is exactly the window a slow machine can lose. Pinned,
 * a second notice would show up beside it and stay there.
 */
async function pinBrokenAudioNotice(page: Page): Promise<Locator> {
  const notice = page.locator('.grav-notification');
  await expect(notice).toHaveCount(1);
  await expect(notice.locator('.grav-notification__level')).toHaveText('Aviso');
  await expect(notice.locator('.grav-notification__title')).toHaveText('Audio roto');
  await expect(notice.locator('.grav-notification__text')).toHaveText(
    'No se ha podido cargar este audio. Sigo con el siguiente.',
  );
  await notice.click();
  return notice;
}

test.describe('the end of the stream', () => {
  let clips: EpisodeClipJson[] = [];

  test.beforeAll(async () => {
    clips = (await getEpisode(TEST_EPISODE_ID)).clips;
    expect(clips.length).toBeGreaterThan(1);
  });

  /**
   * ⚠️ **The net under the `timeupdate` path.**
   *
   * Everything else on this site stops a clip in `handleTimeUpdate`, at
   * `clip.end`. The element's own `ended` is what happens when the mp3 runs out
   * instead — a cut whose `end` is past the file, or a whole episode — and a
   * store that only listened to `timeupdate` would sit there after the last byte
   * with the queue stuck and the play button still saying `Pausar`. So: two
   * clips, an `ended` that arrives while the first is sounding, and the second
   * one playing.
   */
  test('an ended event advances the queue, on the same element', async ({ page, gotoApp }) => {
    const [first, second] = clips;
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    await queueFromRow(page, first!);
    await queueFromRow(page, second!);

    await expect(page.locator('.player__title')).toHaveText(first!.title);
    await expectSounding(page);

    expect(await emitAudioEvent(page, 'ended'), 'the app had built an element').toBe(true);

    // ⚠️ The player moved on by itself: no button was pressed.
    await expect(page.locator('.player__title')).toHaveText(second!.title);
    await expectSounding(page);

    // ⚠️ Still ONE element, and it is pointing where the second clip starts — an
    // `ended` handler that built a second player would be a second source of
    // sound, which is the one thing this store exists to prevent.
    const state = await audioState(page);
    expect(state).toHaveLength(1);
    expect(state[0]!.currentTime).toBeGreaterThanOrEqual(second!.start);
  });
});

test.describe('a pause nobody asked for', () => {
  let clips: EpisodeClipJson[] = [];

  test.beforeAll(async () => {
    clips = (await getEpisode(TEST_EPISODE_ID)).clips;
  });

  /**
   * ⚠️ **The regression this rewrite exists for: the play button used to lie.**
   * A call arriving, headphones being unplugged, a frozen tab or an OS media key
   * all pause the ELEMENT while the store still believed it was playing, so the
   * transport showed `Pausar` over silence and pressing it did the wrong thing.
   * Now `playing` is the element's own state, and `reconcile()` is what puts
   * intent and state back together when the page comes back.
   *
   * ⚠️ **The pause is real** (`pauseAudioElement` calls `HTMLMediaElement.pause`,
   * not a dispatched event): a synthetic `pause` would leave the element playing
   * while the store believed it had stopped, and the recovery could then never be
   * observed — `reconcile()` would find the element already running.
   *
   * ⚠️ **The page is brought back with the platform's own two inputs, not with
   * `Page.setWebLifecycleState`.** That CDP call was measured here: driving the
   * page `frozen` and back to `active` fired **no** `visibilitychange`, `resume`,
   * `pageshow` or `freeze` at all, so a test written on it would assert a
   * recovery it never actually asked for. `visibilityState` is genuinely
   * `visible` in this browser (asserted below), so the dispatched event is
   * exactly the one Chrome sends when a tab comes back.
   */
  test('is undone when the page becomes visible again', async ({ page, gotoApp }) => {
    const [clip] = clips;
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    await queueFromRow(page, clip!);
    await expectSounding(page);

    expect(await pauseAudioElement(page), 'the app had built an element').toBe(true);

    // ⚠️ The element stopped and the BUTTON SAYS SO — this half alone is the
    // regression: before the rewrite it still read `Pausar`.
    await expect.poll(async () => (await audioState(page))[0]?.paused).toBe(true);
    await expect(page.locator('.player__play')).toHaveAttribute('aria-label', 'Reproducir');

    // The premise of the synthetic event, so it cannot quietly become a lie.
    expect(await page.evaluate(() => document.visibilityState)).toBe('visible');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

    await expectSounding(page);
  });
});

test.describe('a source that will not load', () => {
  let next: ListedClip | null = null;

  test.beforeAll(async () => {
    // ⚠️ **A clip from ANOTHER episode, i.e. a different mp3**, so the tests that
    // follow can tell "the player moved on" from "the element kept the file it
    // had".
    [next] = await clipsOnDifferentEpisodes(1);
  });

  /**
   * ⚠️ **What a visitor sees when a clip cannot be loaded: one notice, and the
   * player has moved on to a clip that does sound.** The two failures are the
   * whole contract — the first buys a silent retry from the current position, the
   * second is final (`playback.store.handleError`) — and skipping is the queue's
   * answer (`queue.store.handlePlaybackError`): `next()`, or a stop at the last
   * item. Both errors are dispatched: this test invents the failure, and the
   * two below it refuse the file for real.
   *
   * ⚠️ **The retry is asserted by its silence.** A notice after the first
   * `error` would mean the player gave up on a blip it is designed to ride out.
   */
  test('is skipped after two failures, with one notice in Spanish', async ({ page, gotoApp }) => {
    const clips = (await getEpisode(TEST_EPISODE_ID)).clips;
    const first = clips[0]!;
    const following = next!;

    // ⚠️ **The queue is planted rather than built through rows.** The second clip
    // lives on another episode's page, and navigating there would reload the app
    // and reset the player this test is about. Hydration resolves both keys — the
    // same door a reload comes through (spec 11).
    await plantQueue(page, [`c${first.id}`, `c${following.id}`]);

    await gotoApp('/');
    await expect(page.locator('.player__title')).toHaveText(first.title);
    await page.locator('.player__play').click();
    await expectSounding(page);

    await expect(page.locator('.grav-notification')).toHaveCount(0);
    expect(await emitAudioEvent(page, 'error'), 'the app had built an element').toBe(true);

    // ⚠️ One failure is a retry, not a verdict: still the same cut, still
    // sounding, and nothing said to anybody.
    await expectSounding(page);
    await expect(page.locator('.player__title')).toHaveText(first.title);
    await expect(page.locator('.grav-notification')).toHaveCount(0);

    // ...and the second one is final.
    expect(await emitAudioEvent(page, 'error')).toBe(true);

    const notice = page.locator('.grav-notification');
    await expect(notice).toHaveCount(1);
    await expect(notice.locator('.grav-notification__level')).toHaveText('Aviso');
    await expect(notice.locator('.grav-notification__title')).toHaveText('Audio roto');
    await expect(notice.locator('.grav-notification__text')).toHaveText(
      'No se ha podido cargar este audio. Sigo con el siguiente.',
    );

    // ⚠️ **What the visitor sees next is the point of the skip**: the player
    // names the following clip, it is really SOUNDING — the skip is not a pause
    // with a different title — and the element is on that episode's own file.
    await expect(page.locator('.player__title')).toHaveText(following.title);
    await expectSounding(page);
    await expect
      .poll(() => audioSource(page), { message: 'the element moved to the next episode' })
      .toContain(`/audio/${following.episode.id}.mp3`);
  });

  /**
   * ⚠️ **One sentence for a whole run of dead files — and the run really ends.**
   *
   * This is the batch's contract, and it was broken until `playback.hasAudio`
   * existed: `queue.store` cleared its batch when `playing` went true, and a
   * browser answers that on `play` — the moment `play()` is accepted, before a
   * byte of the file, and just as much for the one that is about to 404. So every
   * next attempt started a new batch and three dead mp3s spoke three times. Now
   * the batch ends only when the element has produced sound, and here nothing
   * ever does.
   *
   * ⚠️ **Two requests per file is the proof that the retry happened**, and it is
   * also what says the run does not loop: each dead item is attempted twice
   * (original + one retry) and then given up on. A healthy stream would keep
   * asking for byte ranges from here, and a retry that never gave up would keep
   * climbing — six is the number that says neither happened.
   */
  test('says it once for a whole run of dead files, and stops at the last one', async ({
    page,
    gotoApp,
  }) => {
    const dead = await clipsOnDifferentEpisodes(3);
    const requests = watchMp3Requests(page);
    await breakEpisodes(
      page,
      dead.map((clip) => clip.episode.id),
    );
    await plantQueue(
      page,
      dead.map((clip) => `c${clip.id}`),
    );

    await gotoApp('/');
    await expect(page.locator('.player__title')).toHaveText(dead[0]!.title);
    await page.locator('.player__play').click();

    const notice = await pinBrokenAudioNotice(page);

    // ⚠️ Three files, two attempts each, in order.
    await expect.poll(() => requests.length, { message: 'two attempts per dead file' }).toBe(6);
    // ⚠️ `Reproducir` here is the rendezvous, not decoration: the transport only
    // reads it once the LAST item has been given up on, so this waits for the run
    // to be over rather than for request six to have been sent.
    await expect(page.locator('.player__play')).toHaveAttribute('aria-label', 'Reproducir');

    // ⚠️ All three were skipped: the queue walked to the end and stopped there,
    // silent — not back at the top, not still retrying.
    await expect
      .poll(async () => (await storedQueue(page)).index, {
        message: 'the queue walked to the last item',
      })
      .toBe(2);
    await expect(page.locator('.player__title')).toHaveText(dead[2]!.title);
    await expect.poll(async () => (await audioState(page))[0]?.paused).toBe(true);
    expect(requests, 'nothing is still retrying').toHaveLength(6);

    // ⚠️ The whole point of the batch: three dead files, ONE notice.
    await expect(notice).toHaveCount(1);
  });

  /**
   * ⚠️ **A dead file must not poison the next clip of the SAME episode.**
   *
   * Both clips share one `src`, and `loadedSrc` is the store's belief that the
   * element already holds that URL. After a load that failed twice, that belief
   * is a lie: `play()` used to skip its "a new file" branch entirely, so the
   * element stayed in its error state with no `load()`, no `error`, no retry and
   * no skip — a player naming the next clip whose play button did nothing at all.
   * The give-up now forgets the source, the same half of `stop()`'s release.
   *
   * ⚠️ **The file heals after the first clip's two attempts**, which is the
   * strongest form of the claim: the very mp3 that just failed twice is really
   * re-fetched for the second clip and really PLAYS. Under the old behaviour that
   * clip never issued a request, so it could not have sounded however long the
   * test waited.
   */
  test('does not leave the next clip of the same episode with an inert play button', async ({
    page,
    gotoApp,
  }) => {
    const episode = await getEpisode(TEST_EPISODE_ID);
    const [first, second] = episode.clips;
    expect(first && second, 'the test episode has two clips').toBeDefined();

    // ⚠️ The first clip's original attempt and its one retry are refused; from the
    // third request on the fixture answers normally. Counting attempts is how the
    // split lands on the clip boundary without racing the UI.
    let attempts = 0;
    await page.route(/\/audio\/\d+\.mp3$/, async (route) => {
      attempts += 1;
      if (attempts <= 2) {
        await route.abort('failed');
        return;
      }
      await route.fallback();
    });

    await plantQueue(page, [`c${first!.id}`, `c${second!.id}`]);
    await gotoApp('/');
    await expect(page.locator('.player__title')).toHaveText(first!.title);
    await page.locator('.player__play').click();

    const notice = await pinBrokenAudioNotice(page);
    // ⚠️ Polled, not read once: the skip and this read are not ordered, so a
    // single read here could catch the count before the second clip's request.
    await expect
      .poll(() => attempts, { message: 'the second clip needed a request of its own' })
      .toBeGreaterThan(2);

    // ⚠️ **The assertion the old bug fails**: the SECOND clip of that episode is
    // the one sounding, on the shared file, and its clock is moving. An inert
    // element sits on `Reproducir` with `paused` true for ever.
    await expect(page.locator('.player__title')).toHaveText(second!.title);
    await expectSounding(page);
    await expect
      .poll(async () => (await audioState(page))[0]!.currentTime, {
        message: 'the second clip is advancing',
      })
      .toBeGreaterThan(second!.start);
    await expect.poll(() => audioSource(page)).toBe(episode.file);

    // One player, and one notice: the first clip died, the second one really
    // played, so the batch was closed by sound and nothing else was said.
    expect(await audioState(page)).toHaveLength(1);
    await expect(notice).toHaveCount(1);
  });
});

test.describe('the previous control', () => {
  let clips: EpisodeClipJson[] = [];

  test.beforeAll(async () => {
    clips = (await getEpisode(TEST_EPISODE_ID)).clips;
    expect(clips.length).toBeGreaterThan(1);
  });

  /**
   * ⚠️ **Two behaviours of one button, and the 3 s line between them** — the
   * rule every music player applies, and the reason the control never has to
   * disappear (`queue.hasPrevious` is true from the first item).
   *
   * ⚠️ It is driven from the PLAYER's button and not from `mediaSession`'s
   * handler: the two call the same `queue.previous()`, but only one of them is
   * reachable from a browser test, and it is the one on screen.
   */
  test('goes back one before three seconds, and restarts the cut after it', async ({
    page,
    gotoApp,
  }) => {
    const [first, second] = clips;
    await gotoApp(`/episode/${TEST_EPISODE_ID}`);
    await queueFromRow(page, first!);
    await queueFromRow(page, second!);
    await expect(page.locator('.player__title')).toHaveText(first!.title);

    const previous = page.getByRole('button', { name: 'Corte anterior de la cola' });
    // ⚠️ Not disabled at the FIRST item: with nothing behind it, its job is
    // "start this one again", and that is the same press a music player answers.
    await expect(previous).toBeEnabled();

    await page.getByRole('button', { name: 'Siguiente corte de la cola' }).click();
    await expect(page.locator('.player__title')).toHaveText(second!.title);

    // Barely a second in: the press means "the one before this". The clock is
    // asserted first so a slow machine cannot silently turn this into the OTHER
    // branch of the test.
    await expect(page.locator('.player__time')).toHaveText(/^00:0[0-2] \//);
    await previous.click();
    await expect(page.locator('.player__title')).toHaveText(first!.title);
    await expect
      .poll(async () => (await audioState(page))[0]!.currentTime)
      .toBeGreaterThanOrEqual(first!.start);

    // Back to the second clip, and let it really play past the line.
    await page.getByRole('button', { name: 'Siguiente corte de la cola' }).click();
    await expect(page.locator('.player__title')).toHaveText(second!.title);
    await expect
      .poll(async () => (await audioState(page))[0]!.currentTime - second!.start, {
        message: 'the cut has played past three seconds',
      })
      .toBeGreaterThan(3.5);

    await previous.click();

    // ⚠️ The same clip, from its first second: a thumb reaching for `previous`
    // mid-sentence wants the beginning of this one, not the one before it.
    await expect(page.locator('.player__title')).toHaveText(second!.title);
    await expect
      .poll(async () => (await audioState(page))[0]!.currentTime - second!.start)
      .toBeLessThan(3);
    await expectSounding(page);
  });
});
