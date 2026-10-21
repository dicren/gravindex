import { describe, expect, it } from 'vitest';
import {
  boundsFor,
  clamp,
  isOrdered,
  isWithin,
  nudge,
  pickHandle,
  pixelToValue,
  ratioToValue,
  reclampToRange,
  setHandle,
  snapToStep,
  valueToPercent,
  valueToPixel,
  valueToRatio,
  valuesEqual,
  zoomBy,
  zoomToSelection,
  type SliderRange,
  type SliderValues,
} from '@/utils/slider-logic';

/**
 * The arithmetic behind the editor's three-handle timeline, tested with no DOM
 * at all — which is the whole reason it is a module and not a method on the
 * component. Ported from the standalone prototype that retired this risk.
 */

/** A real gravina82 episode: 2 h 47 m. */
const EPISODE: SliderRange = { min: 0, max: 10_020 };
const RECT = { left: 100, width: 800 };

describe('clamp / snapToStep', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('returns the lower bound when the window is inverted', () => {
    expect(clamp(5, 10, 0)).toBe(10);
  });

  it('snaps to the grid anchored at the origin', () => {
    expect(snapToStep(3.4, 1, 0)).toBe(3);
    expect(snapToStep(3.6, 1, 0)).toBe(4);
    expect(snapToStep(7, 5, 0)).toBe(5);
    expect(snapToStep(8, 5, 0)).toBe(10);
  });

  it('anchors the grid at a zoomed origin, not at zero', () => {
    // Window starting at 601 with step 2: the grid is 601, 603, 605…
    expect(snapToStep(604.4, 2, 601)).toBe(605);
    expect(snapToStep(603.4, 2, 601)).toBe(603);
  });

  it('is a no-op for a zero or negative step', () => {
    expect(snapToStep(3.4, 0, 0)).toBe(3.4);
  });
});

describe('pixel <-> value mapping', () => {
  it('maps the track edges to the range edges', () => {
    expect(pixelToValue(100, RECT, EPISODE)).toBe(0);
    expect(pixelToValue(900, RECT, EPISODE)).toBe(10_020);
  });

  it('maps the midpoint to the middle of the range', () => {
    expect(pixelToValue(500, RECT, EPISODE)).toBe(5010);
  });

  it('clamps pointer positions outside the track', () => {
    expect(pixelToValue(-500, RECT, EPISODE)).toBe(0);
    expect(pixelToValue(5000, RECT, EPISODE)).toBe(10_020);
  });

  it('round-trips value -> pixel -> value', () => {
    for (const v of [0, 1, 600, 5010, 10_019, 10_020]) {
      expect(pixelToValue(valueToPixel(v, RECT, EPISODE), RECT, EPISODE)).toBeCloseTo(v, 6);
    }
  });

  it('survives a zero-width track (pre-layout / display:none)', () => {
    expect(pixelToValue(400, { left: 0, width: 0 }, EPISODE)).toBe(0);
    expect(valueToRatio(500, { min: 5, max: 5 })).toBe(0);
  });

  it('maps a zoomed window, not the whole episode', () => {
    const zoomed: SliderRange = { min: 600, max: 800 };
    expect(pixelToValue(100, RECT, zoomed)).toBe(600);
    expect(pixelToValue(500, RECT, zoomed)).toBe(700);
    expect(valueToPercent(700, zoomed)).toBe(50);
  });

  it('clamps percentages for values outside the window', () => {
    expect(valueToPercent(0, { min: 600, max: 800 })).toBe(0);
    expect(valueToPercent(9000, { min: 600, max: 800 })).toBe(100);
  });

  it('ratioToValue clamps its input', () => {
    expect(ratioToValue(-1, EPISODE)).toBe(0);
    expect(ratioToValue(2, EPISODE)).toBe(10_020);
  });
});

describe('boundsFor', () => {
  const values: SliderValues = [100, 200, 300];

  it('bounds the start handle by the range and the playhead', () => {
    expect(boundsFor(values, 0, EPISODE)).toEqual({ lo: 0, hi: 200 });
  });

  it('bounds the playhead by both neighbours', () => {
    expect(boundsFor(values, 1, EPISODE)).toEqual({ lo: 100, hi: 300 });
  });

  it('bounds the end handle by the playhead and the range', () => {
    expect(boundsFor(values, 2, EPISODE)).toEqual({ lo: 200, hi: 10_020 });
  });
});

describe('setHandle and the ordering invariant', () => {
  const values: SliderValues = [100, 200, 300];

  it('moves a handle to a legal value', () => {
    expect(setHandle(values, 1, 250, EPISODE, 1)).toEqual([100, 250, 300]);
  });

  it('snaps to the step grid', () => {
    expect(setHandle(values, 1, 250.7, EPISODE, 1)).toEqual([100, 251, 300]);
    expect(setHandle(values, 1, 253, EPISODE, 5)).toEqual([100, 255, 300]);
  });

  // ⚠️ Handles clamp instead of crossing, and nothing swaps `start`/`end`
  // afterwards: the assertions below pin that.
  it('refuses to let start pass the playhead', () => {
    expect(setHandle(values, 0, 900, EPISODE, 1)).toEqual([200, 200, 300]);
  });

  it('refuses to let end pass the playhead', () => {
    expect(setHandle(values, 2, 0, EPISODE, 1)).toEqual([100, 200, 200]);
  });

  it('refuses to let the playhead pass either neighbour', () => {
    expect(setHandle(values, 1, -999, EPISODE, 1)).toEqual([100, 100, 300]);
    expect(setHandle(values, 1, 9999, EPISODE, 1)).toEqual([100, 300, 300]);
  });

  it('clamps to the visible range, not to the episode', () => {
    const zoomed: SliderRange = { min: 150, max: 400 };
    expect(setHandle([160, 200, 300], 0, 0, zoomed, 1)).toEqual([150, 200, 300]);
    expect(setHandle([160, 200, 300], 2, 99_999, zoomed, 1)).toEqual([160, 200, 400]);
  });

  it('keeps the invariant for every handle and every target, exhaustively', () => {
    const start: SliderValues = [100, 200, 300];
    for (const index of [0, 1, 2] as const) {
      for (let target = -50; target <= 450; target += 7) {
        expect(isOrdered(setHandle(start, index, target, EPISODE, 1))).toBe(true);
      }
    }
  });

  it('never mutates the input tuple', () => {
    const original: SliderValues = [100, 200, 300];
    setHandle(original, 0, 999, EPISODE, 1);
    expect(original).toEqual([100, 200, 300]);
  });
});

describe('nudge arithmetic', () => {
  const values: SliderValues = [600, 640, 780];

  it('applies the ±1 / ±5 / ±10 deltas of the editor buttons', () => {
    expect(nudge(values, 0, -1, EPISODE, 1)[0]).toBe(599);
    expect(nudge(values, 0, -5, EPISODE, 1)[0]).toBe(595);
    expect(nudge(values, 0, -10, EPISODE, 1)[0]).toBe(590);
    expect(nudge(values, 0, 10, EPISODE, 1)[0]).toBe(610);
  });

  it('stops at the neighbour instead of overshooting', () => {
    // start is 40 s from the playhead; +10 four times reaches it and stops.
    let v: SliderValues = values;
    for (let i = 0; i < 6; i += 1) v = nudge(v, 0, 10, EPISODE, 1);
    expect(v).toEqual([640, 640, 780]);
    expect(isOrdered(v)).toBe(true);
  });

  it('stops at the range floor', () => {
    expect(nudge([3, 640, 780], 0, -10, EPISODE, 1)[0]).toBe(0);
  });

  it('stops at the range ceiling', () => {
    expect(nudge([600, 640, 10_018], 2, 10, EPISODE, 1)[2]).toBe(10_020);
  });

  it('is reversible when nothing clamps', () => {
    expect(nudge(nudge(values, 1, 5, EPISODE, 1), 1, -5, EPISODE, 1)).toEqual(values);
  });
});

describe('pickHandle', () => {
  it('picks the nearest handle', () => {
    const values: SliderValues = [100, 500, 900];
    expect(pickHandle(110, values)).toBe(0);
    expect(pickHandle(480, values)).toBe(1);
    expect(pickHandle(1000, values)).toBe(2);
  });

  it('breaks a straddle tie toward the lower index', () => {
    // Exactly midway between 100 and 500.
    expect(pickHandle(300, [100, 500, 900])).toBe(0);
  });

  describe('collapsed handles', () => {
    it('gives the leftmost handle to a press on its left', () => {
      expect(pickHandle(400, [500, 500, 500])).toBe(0);
      expect(pickHandle(400, [500, 500, 900])).toBe(0);
    });

    it('gives the rightmost handle to a press on its right', () => {
      expect(pickHandle(600, [500, 500, 500])).toBe(2);
      expect(pickHandle(600, [100, 500, 500])).toBe(2);
    });

    it('gives an exact hit to the lower index, by fiat', () => {
      expect(pickHandle(500, [500, 500, 500])).toBe(0);
    });

    it('never deadlocks: a fully collapsed slider can always be pulled apart', () => {
      // ⚠️ THE bug this rule exists for. With "highest index wins", three
      // handles on one second meant `start` could never move again.
      const collapsed: SliderValues = [500, 500, 500];
      const left = pickHandle(0, collapsed);
      const right = pickHandle(10_020, collapsed);
      expect(setHandle(collapsed, left, 0, EPISODE, 1)).toEqual([0, 500, 500]);
      expect(setHandle(collapsed, right, 10_020, EPISODE, 1)).toEqual([500, 500, 10_020]);
    });

    it('still resolves when only two of the three collide', () => {
      expect(pickHandle(0, [500, 500, 900])).toBe(0);
      // 690 is nearer the collapsed pair than to `end`, and lies to its right,
      // so the pair's upper member — the one with room — wins.
      expect(pickHandle(690, [500, 500, 900])).toBe(1);
    });

    it('treats a three-way straddle as a straddle, not a collapse', () => {
      // 700 is equidistant from all three, but they are not collapsed.
      expect(pickHandle(700, [500, 500, 900])).toBe(0);
    });
  });
});

describe('zoom', () => {
  it('fits the selection with a 10% margin on each side', () => {
    expect(zoomToSelection([600, 640, 800], 10_020)).toEqual({ min: 580, max: 820 });
  });

  it('clips the fitted window to the episode', () => {
    expect(zoomToSelection([0, 10, 100], 10_020).min).toBe(0);
    expect(zoomToSelection([9900, 9950, 10_020], 10_020).max).toBe(10_020);
  });

  it('widens by the requested amount on each side', () => {
    expect(zoomBy({ min: 600, max: 800 }, 60, 10_020)).toEqual({ min: 540, max: 860 });
  });

  it('clips widening at the episode bounds', () => {
    expect(zoomBy({ min: 30, max: 10_000 }, 600, 10_020)).toEqual({ min: 0, max: 10_020 });
  });

  it('refuses to collapse or invert the window', () => {
    const r = zoomBy({ min: 500, max: 501 }, -100, 10_020);
    expect(r.max).toBeGreaterThan(r.min);
  });

  describe('reclampToRange', () => {
    it('leaves values inside the window untouched', () => {
      expect(reclampToRange([600, 640, 780], { min: 500, max: 900 }, 1)).toEqual([600, 640, 780]);
    });

    it('pins values that fall outside the new window', () => {
      expect(reclampToRange([100, 640, 9000], { min: 600, max: 800 }, 1)).toEqual([600, 640, 800]);
    });

    it('keeps the ordering invariant when the window excludes everything', () => {
      const out = reclampToRange([100, 200, 300], { min: 5000, max: 5100 }, 1);
      expect(out).toEqual([5000, 5000, 5000]);
      expect(isOrdered(out)).toBe(true);
    });

    it('keeps the invariant across a randomised sweep of windows', () => {
      const values: SliderValues = [1234, 5678, 9012];
      for (let min = 0; min <= 10_000; min += 331) {
        for (const span of [1, 50, 1000, 9999]) {
          const range = { min, max: Math.min(10_020, min + span) };
          const out = reclampToRange(values, range, 1);
          expect(isOrdered(out)).toBe(true);
          expect(isWithin(out, range)).toBe(true);
        }
      }
    });

    it('re-snaps onto the grid of the new origin', () => {
      expect(reclampToRange([601, 640, 781], { min: 600, max: 800 }, 5)).toEqual([600, 640, 780]);
    });
  });
});

describe('valuesEqual', () => {
  it('compares by value, so an unchanged commit emits nothing', () => {
    expect(valuesEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(valuesEqual([1, 2, 3], [1, 2, 4])).toBe(false);
  });
});
