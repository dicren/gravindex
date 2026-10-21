// **The recorded deviation: the three handles clamp, they do not cross.**
//
// The earlier two-handle control let `start` and `end` swap places during a drag,
// and put them back afterwards. With THREE handles a swap is undefined — the
// playhead has no inverted equivalent — so each handle stops at its neighbour
// and `start <= playhead <= end` holds at all times, mid-gesture included.
//
// ⚠️ The deviation "has to be covered by an assertion, not by a note". That is
// this file. The saved cut is identical under either scheme for any valid
// selection; the gesture is what differs, so the gesture is what gets asserted —
// including the frames in the middle of it.

import { TEST_EPISODE_ID } from '../lib/constants';
import { dragOnTrack, readHandles, type HandleValues } from '../lib/editor';
import { AUDIO_DURATION_SECONDS } from '../lib/media';
import { expect, test } from '../lib/fixtures';

function ordered(values: HandleValues): boolean {
  return values[0] <= values[1] && values[1] <= values[2];
}

test.describe('the three handles clamp instead of crossing', () => {
  test.beforeEach(async ({ page, gotoApp }) => {
    await gotoApp(`/creator/${TEST_EPISODE_ID}`);
    await expect(page.locator('[data-test="cut-start"]')).toBeVisible({ timeout: 60_000 });

    // Spread the three out so each has a distinct neighbour to be stopped by:
    // end to ~60 %, playhead to ~20 %, start left at 0.
    //
    // ⚠️ **0.2 and not 0.3, and the difference is not cosmetic.** With `end` at
    // 60 % of the window, a press at exactly 30 % is EQUIDISTANT from the
    // collapsed `start`/`playhead` pair at 0 and from `end` — a three-way tie
    // that `pickHandle` resolves by a sub-pixel, so which handle the gesture
    // picks up depends on the track's width to the fraction of a pixel. It can
    // fall either way, and neither is a behaviour worth pinning. 0.2 is
    // unambiguous:
    // the pair is 2400 away and `end` is 4800.
    await dragOnTrack(page, 0.6, 0.6);
    await dragOnTrack(page, 0.2, 0.2);
    const spread = await readHandles(page);
    expect(spread[0]).toBe(0);
    expect(spread[1]).toBeGreaterThan(0);
    expect(spread[2]).toBeGreaterThan(spread[1]);
  });

  test('dragging `start` right stops it dead at the playhead', async ({ page }) => {
    const before = await readHandles(page);
    const seen: HandleValues[] = [];

    // From just left of `start` all the way to the far right of the window: the
    // gesture asks for a value past BOTH neighbours.
    await dragOnTrack(page, 0.01, 0.95, async () => {
      seen.push(await readHandles(page));
    });

    const after = await readHandles(page);
    // It moved, and it stopped exactly on its neighbour — not past it, and not
    // swapped with it.
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(before[2]);

    // ⚠️ And it was ordered in EVERY frame of the drag, which is the half a
    // naive implementation misses.
    expect(seen.length).toBeGreaterThan(3);
    for (const frame of seen) expect(ordered(frame), `out of order mid-drag: ${frame}`).toBe(true);
  });

  test('dragging `end` left stops it dead at the playhead', async ({ page }) => {
    const before = await readHandles(page);
    const seen: HandleValues[] = [];

    await dragOnTrack(page, 0.62, 0.02, async () => {
      seen.push(await readHandles(page));
    });

    const after = await readHandles(page);
    expect(after[2]).toBe(before[1]);
    expect(after[1]).toBe(before[1]);
    expect(after[0]).toBe(before[0]);
    for (const frame of seen) expect(ordered(frame), `out of order mid-drag: ${frame}`).toBe(true);
  });

  test('the playhead is boxed in by both of them', async ({ page }) => {
    const before = await readHandles(page);

    // Grab the playhead (now at ~20 %) and shove it past `end`.
    await dragOnTrack(page, 0.2, 0.99);
    let after = await readHandles(page);
    expect(after[1]).toBe(before[2]);
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);

    // …and then past `start`, from the other side.
    //
    // ⚠️ **0.59, not 0.6.** The playhead is now clamped ON `end`, so a press at
    // exactly their shared value is the collapsed-cluster tie-break — which
    // hands the gesture to whichever side the pointer is on, decided by a
    // sub-pixel. Pressing a hair to the LEFT says what the gesture means: take
    // the pair's left member, the playhead, and drag it back.
    await dragOnTrack(page, 0.59, 0.0);
    after = await readHandles(page);
    expect(after[1]).toBe(before[0]);
    expect(ordered(after)).toBe(true);
  });

  test('the keyboard is clamped by the same bounds it advertises', async ({ page }) => {
    // ⚠️ `aria-valuemin`/`aria-valuemax` are the NEIGHBOURS, not the window: the
    // control tells assistive technology exactly the range it will accept, and
    // `End`/`Home` land on those numbers. A clamp that the keyboard did not
    // honour would be a lie told to a screen reader.
    const before = await readHandles(page);
    const start = page.locator('.ths__handle').nth(0);

    await start.focus();
    expect(Number(await start.getAttribute('aria-valuemin'))).toBe(0);
    expect(Number(await start.getAttribute('aria-valuemax'))).toBe(before[1]);

    await page.keyboard.press('End');
    expect((await readHandles(page))[0]).toBe(before[1]);

    const end = page.locator('.ths__handle').nth(2);
    await end.focus();
    expect(Number(await end.getAttribute('aria-valuemin'))).toBe(before[1]);
    expect(Number(await end.getAttribute('aria-valuemax'))).toBe(AUDIO_DURATION_SECONDS);

    await page.keyboard.press('Home');
    const after = await readHandles(page);
    expect(after[2]).toBe(before[1]);
    expect(ordered(after)).toBe(true);
  });
});
