// **The measured waveform** — `GET /episodes/:id/waveform`
// (`packages/backend/src/waveform/`), drawn behind the clip permalink instead
// of `GravWave`'s deterministic placeholder once an episode has been measured.
//
// ⚠️ Nothing in the disposable test database has ever been measured: the fixture
// leaves the `waveform` column `NULL` everywhere (root `AGENTS.md`). So this
// group writes a deterministic waveform directly through SQL for one clip's
// episode (`lib/db.ts`'s own reason for existing, used here to set up a write
// rather than read one back) and resets it in `afterAll`, so the suite can run
// again immediately and get the same answer.
//
// ⚠️ The mp3 itself is answered locally (`lib/media.ts`) — nothing here reaches
// the media host, and this group never plays the clip at all: the waveform
// renders on load, before a single frame of audio is requested.

import { getEpisode, getEpisodeWaveform } from '../lib/api';
import { psql } from '../lib/db';
import { TEST_EPISODE_ID } from '../lib/constants';
import { expect, test } from '../lib/fixtures';

// Must match `WAVEFORM_POINTS_PER_SECOND` in
// `packages/backend/src/waveform/waveform.constants.ts` — one stored byte per
// this many seconds of audio.
const WAVEFORM_POINTS_PER_SECOND = 10;
// `ClipView.vue` passes `:bars="160"` to `GravWave`, which is what its
// placeholder falls back to when there is no measured data yet.
const PLACEHOLDER_BAR_COUNT = 160;

const bars = (page: import('@playwright/test').Page) =>
  page.locator('.clip-hero__wave svg.grav-wave__svg').first().locator('rect');

test.describe('the waveform behind the clip permalink', () => {
  let clipId: number;
  let clipTitle: string;
  let start: number;
  let end: number;

  test.beforeAll(async () => {
    const episode = await getEpisode(TEST_EPISODE_ID);
    const clip = episode.clips[0];
    if (clip === undefined) {
      throw new Error(`episode ${TEST_EPISODE_ID} has no clips to test the waveform with`);
    }
    clipId = clip.id;
    clipTitle = clip.title;
    start = clip.start;
    end = clip.end;
  });

  test.afterAll(() => {
    psql(`update "episode" set "waveform" = null where "id" = ${TEST_EPISODE_ID}`);
  });

  // ⚠️ Runs BEFORE the measured test below, and the suite's single worker with
  // no retries is what makes that ordering something this file can rely on —
  // the two tests share the SAME episode on purpose, so "unmeasured" really
  // means "before this group's own write", not "some other episode".
  test('draws the drawn placeholder for an episode that has not been measured yet', async ({
    page,
    gotoApp,
  }) => {
    await gotoApp(`/${clipId}`);
    await expect(page.getByRole('heading', { name: clipTitle })).toBeVisible();

    await expect(bars(page)).toHaveCount(PLACEHOLDER_BAR_COUNT);
  });

  test('draws exactly as many bars as the API answers, once the episode is measured', async ({
    page,
    gotoApp,
  }) => {
    // Deterministic bytes, one per 100 ms, covering a margin past the clip's
    // `end` so the permalink's own request — exactly `[start, end]` — never
    // gets clamped by running off the end of the stored column.
    const totalSeconds = end + 5;
    const byteCount = totalSeconds * WAVEFORM_POINTS_PER_SECOND;
    let hex = '';
    for (let i = 0; i < byteCount; i += 1) hex += (i % 256).toString(16).padStart(2, '0');
    psql(
      `update "episode" set "waveform" = decode('${hex}', 'hex') where "id" = ${TEST_EPISODE_ID}`,
    );

    const waveform = await getEpisodeWaveform(TEST_EPISODE_ID, {
      from: start,
      to: end,
      points: PLACEHOLDER_BAR_COUNT,
    });
    expect(waveform.points).toBeGreaterThan(0);

    await gotoApp(`/${clipId}`);
    await expect(page.getByRole('heading', { name: clipTitle })).toBeVisible();

    await expect(bars(page)).toHaveCount(waveform.points);
  });
});
