// Driving the clip editor's three-handle timeline from a test.
//
// ⚠️ The handles are NOT grabbed by hovering them: they overlap (all three sit on
// `0` when the screen opens), so Playwright's actionability check reports one
// intercepting the other and the drag never starts. The component is built for
// exactly this — the TRACK takes the press and `pickHandle` decides which handle
// the gesture belongs to — so the helpers below press the track at a value and
// let the component choose, which is also what a real pointer does.

import type { Page } from '@playwright/test';

export type HandleValues = [number, number, number];

export async function readHandles(page: Page): Promise<HandleValues> {
  const values = await page
    .locator('.ths__handle')
    .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-value'))));
  return [values[0] ?? Number.NaN, values[1] ?? Number.NaN, values[2] ?? Number.NaN];
}

/** The left offsets the component computed, as percentages of the track. Zoom
 *  changes these without changing the values, which is the point. */
export async function readHandlePercents(page: Page): Promise<string[]> {
  return page
    .locator('.ths__handle')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).style.left));
}

/**
 * The visible window (the zoom), read off the two OUTER handles.
 *
 * ⚠️ Not off the playhead. Every handle advertises its NEIGHBOURS as
 * `aria-valuemin`/`aria-valuemax` — which is the clamp, and is what makes the
 * control honest to a screen reader — so the middle handle's bounds are `start`
 * and `end`, not the window. Only handle 0's minimum and handle 2's maximum are
 * the window's own edges.
 */
export async function readRange(page: Page): Promise<{ min: number; max: number }> {
  const handles = page.locator('.ths__handle');
  return {
    min: Number(await handles.nth(0).getAttribute('aria-valuemin')),
    max: Number(await handles.nth(2).getAttribute('aria-valuemax')),
  };
}

interface TrackBox {
  x: number;
  y: number;
  width: number;
}

async function trackBox(page: Page): Promise<TrackBox> {
  const track = page.locator('.ths__track');
  /**
   * ⚠️ **Centred in the viewport, not merely scrolled into view.**
   * `scrollIntoViewIfNeeded` does the minimum, which can leave the track's top
   * edge just below the fold — and the top bar is `position: sticky`,
   * 59 px of it, so a press aimed at the middle of a 78 px track then lands on
   * the header instead and the drag never starts. Nothing throws; the handles
   * simply do not move, which is the shape of failure this comment exists to
   * stop the next reader debugging from scratch.
   */
  await track.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  const box = await track.boundingBox();
  if (box === null) throw new Error('the timeline track has no box');
  return { x: box.x, y: box.y + box.height / 2, width: box.width };
}

function xFor(box: TrackBox, fraction: number): number {
  return box.x + box.width * fraction;
}

/**
 * Press at `from`, drag to `to`, release. Both are fractions of the visible
 * window, so the handle the gesture picks up is the one nearest `from` —
 * deterministic once the values are known.
 *
 * `onStep` is called after each intermediate move, which is how the ordering
 * invariant gets asserted DURING the gesture and not only at the end of it.
 */
export async function dragOnTrack(
  page: Page,
  from: number,
  to: number,
  onStep?: () => Promise<void>,
): Promise<void> {
  const box = await trackBox(page);
  const steps = 6;

  await page.mouse.move(xFor(box, from), box.y);
  await page.mouse.down();
  if (onStep) await onStep();

  for (let step = 1; step <= steps; step++) {
    const fraction = from + ((to - from) * step) / steps;
    await page.mouse.move(xFor(box, fraction), box.y);
    if (onStep) await onStep();
  }

  await page.mouse.up();
}
