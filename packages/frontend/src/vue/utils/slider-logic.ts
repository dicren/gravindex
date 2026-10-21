/**
 * All the maths of the editor's three-handle timeline, as pure functions.
 *
 * Nothing here touches the DOM or Vue: `ThreeHandleSlider.vue` is a thin
 * rendering shell over this module, which is what makes the hard cases (handle
 * collision, ordering, zoom re-clamping) testable without a browser — and what
 * let the control be prototyped and proven before it was ported in.
 *
 * ⚠️ Vuetify's range slider does two thumbs, and the editor needs three
 * (start · playhead · end). The behaviours below are the parts of the control
 * the editor depends on, restated as arithmetic.
 */

export type HandleIndex = 0 | 1 | 2;
export type SliderValues = readonly [number, number, number];

/** The visible window of the slider. Zoom changes this, not the values. */
export interface SliderRange {
  readonly min: number;
  readonly max: number;
}

/** Only the bits of `DOMRect` the mapping needs, so tests can fake it. */
export interface TrackRect {
  readonly left: number;
  readonly width: number;
}

export const HANDLE_INDEXES: readonly HandleIndex[] = [0, 1, 2];

export function clamp(value: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return value < lo ? lo : value > hi ? hi : value;
}

/** Round `value` onto the step grid anchored at `origin`. */
export function snapToStep(value: number, step: number, origin: number): number {
  if (!(step > 0)) return value;
  const snapped = origin + Math.round((value - origin) / step) * step;
  // Kill float drift so `0.1`-ish steps still compare equal in tests.
  return Number.parseFloat(snapped.toPrecision(12));
}

/** value -> 0..1 within the visible range (clamped). Degenerate range -> 0. */
export function valueToRatio(value: number, range: SliderRange): number {
  const span = range.max - range.min;
  if (span <= 0) return 0;
  return clamp((value - range.min) / span, 0, 1);
}

/** 0..1 -> value within the visible range. */
export function ratioToValue(ratio: number, range: SliderRange): number {
  return range.min + clamp(ratio, 0, 1) * (range.max - range.min);
}

/** Percentage input for `left:` positioning. */
export function valueToPercent(value: number, range: SliderRange): number {
  return valueToRatio(value, range) * 100;
}

/** Pointer x (client coords) -> value in the visible range. */
export function pixelToValue(clientX: number, rect: TrackRect, range: SliderRange): number {
  if (rect.width <= 0) return range.min;
  return ratioToValue((clientX - rect.left) / rect.width, range);
}

/** Inverse of `pixelToValue`, for assertions and for hit-test debugging. */
export function valueToPixel(value: number, rect: TrackRect, range: SliderRange): number {
  return rect.left + valueToRatio(value, range) * rect.width;
}

/**
 * The movement bounds of one handle: its neighbours, falling back to the range.
 *
 * ⚠️ This is what makes `start <= playhead <= end` hold **by construction**
 * rather than by a corrective pass afterwards. It is a recorded deviation:
 * handles never cross, so nothing swaps `start`/`end` back afterwards. With
 * THREE handles a swap is undefined (the playhead has no inverted equivalent),
 * and the saved cut is identical either way.
 */
export function boundsFor(
  values: SliderValues,
  index: HandleIndex,
  range: SliderRange,
): { lo: number; hi: number } {
  const lo = index === 0 ? range.min : values[index - 1]!;
  const hi = index === 2 ? range.max : values[index + 1]!;
  return { lo, hi };
}

export function isOrdered(values: SliderValues): boolean {
  return values[0] <= values[1] && values[1] <= values[2];
}

export function isWithin(values: SliderValues, range: SliderRange): boolean {
  return values.every((v) => v >= range.min && v <= range.max);
}

/** Move one handle to `raw`, snapped to the step grid and clamped to its bounds. */
export function setHandle(
  values: SliderValues,
  index: HandleIndex,
  raw: number,
  range: SliderRange,
  step: number,
): SliderValues {
  const { lo, hi } = boundsFor(values, index, range);
  const snapped = snapToStep(raw, step, range.min);
  const next = clamp(snapped, lo, hi);
  const out: [number, number, number] = [values[0], values[1], values[2]];
  out[index] = next;
  return out;
}

/** Relative move, used by the keyboard and by the imperative nudge. */
export function nudge(
  values: SliderValues,
  index: HandleIndex,
  delta: number,
  range: SliderRange,
  step: number,
): SliderValues {
  return setHandle(values, index, values[index] + delta, range, step);
}

/**
 * Which handle a pointer press grabs.
 *
 * Nearest wins. The interesting case is a tie, and there are two kinds:
 *
 *  - **Collapsed handles** (tied handles share a value). ⚠️ Picking blindly
 *    deadlocks the control: if all three sit on the same second and the highest
 *    index always won, `start` could never be pulled back out again. So the tie
 *    goes to the handle that has room in the direction of the press — leftmost
 *    when pressing left of the cluster, rightmost when pressing right of it.
 *  - **Straddled handles** (pointer exactly midway between two *different*
 *    values). Both can move toward the pointer, so the choice is arbitrary and
 *    fixed by fiat: the lower index wins.
 *
 * A press landing exactly on a collapsed cluster (no direction at all) also
 * goes to the lower index.
 */
export function pickHandle(pointerValue: number, values: SliderValues): HandleIndex {
  const distances = values.map((v) => Math.abs(v - pointerValue));
  const best = Math.min(...distances);
  const tied = HANDLE_INDEXES.filter((i) => distances[i] === best);

  const first = tied[0]!;
  if (tied.length === 1) return first;

  const last = tied[tied.length - 1]!;
  const collapsed = values[first] === values[last];
  if (!collapsed) return first;

  const clusterValue = values[first];
  if (pointerValue > clusterValue) return last;
  return first;
}

/**
 * Re-fit the values after the visible range changed (zoom in, zoom out, reset).
 *
 * Clamping is applied per handle and then swept left-to-right so the ordering
 * invariant survives even when the new window excludes several handles at once.
 * Always returns a new tuple.
 */
export function reclampToRange(
  values: SliderValues,
  range: SliderRange,
  step: number,
): SliderValues {
  const out: [number, number, number] = [values[0], values[1], values[2]];
  for (const i of HANDLE_INDEXES) {
    out[i] = clamp(snapToStep(out[i]!, step, range.min), range.min, range.max);
  }
  // Ordering pass: a snap can only nudge by half a step, but a clamp against a
  // narrow window can genuinely invert neighbours.
  if (out[1] < out[0]) out[1] = out[0];
  if (out[2] < out[1]) out[2] = out[1];
  return out;
}

export function valuesEqual(a: SliderValues, b: SliderValues): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/**
 * Zoom around the current selection: fit `[start, end]` with a 10% margin on
 * each side, clipped to the episode.
 */
export function zoomToSelection(
  values: SliderValues,
  duration: number,
  marginRatio = 0.1,
): SliderRange {
  const margin = (values[2] - values[0]) * marginRatio;
  return {
    min: Math.max(0, Math.floor(values[0] - margin)),
    max: Math.min(duration, Math.ceil(values[2] + margin)),
  };
}

/**
 * Widen (positive `amount`) or narrow (negative) the window by `amount` seconds
 * on each side.
 */
export function zoomBy(range: SliderRange, amount: number, duration: number): SliderRange {
  const min = Math.max(0, range.min - amount);
  const max = Math.min(duration, range.max + amount);
  // Never let the window collapse or invert.
  if (max - min < 1) {
    const centre = clamp((range.min + range.max) / 2, 0, duration);
    return { min: Math.max(0, centre - 0.5), max: Math.min(duration, centre + 0.5) };
  }
  return { min, max };
}
