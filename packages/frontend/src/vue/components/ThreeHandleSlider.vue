<script setup lang="ts">
/**
 * The clip editor's timeline: **three handles on one track** — start, playhead,
 * end — over the episode's running time.
 *
 * ⚠️ This is the riskiest piece of the frontend, and it exists because nothing
 * off the shelf does it: Vuetify's range slider tops out at two thumbs. It was
 * built and proven as a standalone prototype first —
 * pointer, touch, keyboard and ARIA — and ported here whole.
 *
 * The component is deliberately thin. Every decision that could be arithmetic
 * lives in `@/utils/slider-logic`, which is why the interesting cases (collision,
 * ordering, zoom re-clamping) are tested without a DOM at all.
 *
 * Three findings from the prototype are load-bearing and easy to undo by
 * accident:
 *
 * 1. ⚠️ **Zoom needs no remount.** `min`/`max` are reactive props and the
 *    positions are a `computed` over them, so narrowing the window re-renders
 *    the SAME nodes. Remounting the slider on every zoom (a `sliderKey` bump)
 *    would throw away focus and tooltips, so it must not come back; a test
 *    asserts the track is the same DOM node before and after.
 * 2. ⚠️ **Handle collision was a deadlock, not a tie-break.** See `pickHandle`.
 * 3. ⚠️ **`setPointerCapture` throws in Chrome** when the pointer id is not an
 *    active pointer — jsdom never sees it, the real browser does, and it aborted
 *    the very first tap. It is wrapped, with a regression test.
 *
 * ⚠️ **Recorded deviation: handles clamp, they do not cross.** Letting `start`
 * and `end` swap places and re-inverting them on play is not kept. With three
 * handles a swap is
 * undefined — the playhead has no inverted equivalent — so each handle stops at
 * its neighbour and `start <= playhead <= end` holds at all times, mid-drag
 * included. The saved cut is identical either way.
 */
import { computed, ref, watch } from 'vue';
import {
  HANDLE_INDEXES,
  boundsFor,
  nudge,
  pickHandle,
  pixelToValue,
  reclampToRange,
  setHandle,
  valueToPercent,
  valuesEqual,
  type HandleIndex,
  type SliderRange,
  type SliderValues,
} from '@/utils/slider-logic';
import { formatHhmmss } from '@/utils/timecode';

const props = withDefaults(
  defineProps<{
    /** `[start, playhead, end]`, in seconds. Always ordered. */
    modelValue: SliderValues;
    /** Visible window. Zoom moves these; the component never mutates them. */
    min: number;
    max: number;
    step?: number;
    /** Multiplier applied to `step` for Shift+Arrow. */
    shiftStep?: number;
    /** Multiplier applied to `step` for PageUp/PageDown. */
    pageStep?: number;
    disabled?: boolean;
    /** Accessible names, in handle order. */
    labels?: readonly [string, string, string];
    /** Value -> display string, for the tooltips and `aria-valuetext`. */
    format?: (value: number) => string;
  }>(),
  {
    step: 1,
    shiftStep: 5,
    pageStep: 10,
    disabled: false,
    labels: () => ['Inicio del corte', 'Punto de reproducción', 'Final del corte'] as const,
    format: formatHhmmss,
  },
);

const emit = defineEmits<{
  /** Fired continuously while dragging / on every key press. */
  'update:modelValue': [values: SliderValues];
  /** Fired once the interaction settles: pointerup, key, nudge, zoom re-clamp. */
  change: [values: SliderValues];
  /** The handle the user is working with, for an external nudge to target. */
  'update:activeHandle': [index: HandleIndex];
  'drag-start': [index: HandleIndex];
  'drag-end': [index: HandleIndex];
}>();

const trackEl = ref<HTMLElement | null>(null);
const handleEls = ref<Array<HTMLElement | null>>([null, null, null]);
const activeHandle = ref<HandleIndex>(0);
const draggingHandle = ref<HandleIndex | null>(null);

const range = computed<SliderRange>(() => ({ min: props.min, max: props.max }));

const percents = computed<[number, number, number]>(() => [
  valueToPercent(props.modelValue[0], range.value),
  valueToPercent(props.modelValue[1], range.value),
  valueToPercent(props.modelValue[2], range.value),
]);

/** True when a handle's value sits outside the zoomed window (pinned at an edge). */
const offscreen = computed<[boolean, boolean, boolean]>(() => [
  props.modelValue[0] < props.min || props.modelValue[0] > props.max,
  props.modelValue[1] < props.min || props.modelValue[1] > props.max,
  props.modelValue[2] < props.min || props.modelValue[2] > props.max,
]);

function commit(next: SliderValues, settled: boolean): void {
  if (!valuesEqual(next, props.modelValue)) emit('update:modelValue', next);
  if (settled) emit('change', next);
}

function setActive(index: HandleIndex): void {
  if (activeHandle.value !== index) {
    activeHandle.value = index;
    emit('update:activeHandle', index);
  }
}

/**
 * Zoom is a *reactive range*, so changing `min`/`max` re-renders positions with
 * no remount. The one thing that does need handling is values falling outside
 * the new window: they are re-clamped, `change` is emitted so the parent can
 * persist the correction, and any handle still outside is flagged in the
 * template rather than drawn as though it were where it is not.
 */
watch(
  () => [props.min, props.max, props.step] as const,
  () => {
    const fitted = reclampToRange(props.modelValue, range.value, props.step);
    if (!valuesEqual(fitted, props.modelValue)) commit(fitted, true);
  },
);

function rectOf(el: HTMLElement): { left: number; width: number } {
  const r = el.getBoundingClientRect();
  return { left: r.left, width: r.width };
}

function capturePointer(track: HTMLElement, pointerId: number): void {
  if (typeof track.setPointerCapture !== 'function') return;
  try {
    track.setPointerCapture(pointerId);
  } catch {
    // Not capturable; the drag proceeds on bubbled events.
  }
}

function releasePointer(track: HTMLElement, pointerId: number): void {
  if (typeof track.releasePointerCapture !== 'function') return;
  try {
    if (typeof track.hasPointerCapture === 'function' && !track.hasPointerCapture(pointerId))
      return;
    track.releasePointerCapture(pointerId);
  } catch {
    // Already released, or never captured.
  }
}

function onPointerDown(event: PointerEvent): void {
  const track = trackEl.value;
  if (props.disabled || track === null || event.button !== 0) return;

  const pointerValue = pixelToValue(event.clientX, rectOf(track), range.value);
  const index = pickHandle(pointerValue, props.modelValue);

  setActive(index);
  draggingHandle.value = index;
  handleEls.value[index]?.focus();

  // Capture on the track, not the thumb: the pointer routinely leaves a 25 px
  // thumb within the first frame of a drag.
  //
  // ⚠️ Chrome throws `NotFoundError` ("no active pointer with the given id")
  // when the pointer is already gone by the time the handler runs — a
  // synthesised event, a very fast tap, an assistive tool. Capture is an
  // optimisation, not a requirement, so losing it must never abort the drag.
  capturePointer(track, event.pointerId);

  emit('drag-start', index);
  commit(setHandle(props.modelValue, index, pointerValue, range.value, props.step), false);
  event.preventDefault();
}

function onPointerMove(event: PointerEvent): void {
  const track = trackEl.value;
  const index = draggingHandle.value;
  if (index === null || track === null) return;

  const pointerValue = pixelToValue(event.clientX, rectOf(track), range.value);
  commit(setHandle(props.modelValue, index, pointerValue, range.value, props.step), false);
  event.preventDefault();
}

function endDrag(event: PointerEvent): void {
  const index = draggingHandle.value;
  if (index === null) return;
  draggingHandle.value = null;

  const track = trackEl.value;
  if (track !== null) releasePointer(track, event.pointerId);
  emit('drag-end', index);
  emit('change', props.modelValue);
}

function onKeyDown(index: HandleIndex, event: KeyboardEvent): void {
  if (props.disabled) return;
  setActive(index);

  const step = props.step;
  const { lo, hi } = boundsFor(props.modelValue, index, range.value);
  let next: SliderValues;

  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      next = nudge(
        props.modelValue,
        index,
        -(event.shiftKey ? step * props.shiftStep : step),
        range.value,
        step,
      );
      break;
    case 'ArrowRight':
    case 'ArrowUp':
      next = nudge(
        props.modelValue,
        index,
        event.shiftKey ? step * props.shiftStep : step,
        range.value,
        step,
      );
      break;
    case 'PageDown':
      next = nudge(props.modelValue, index, -step * props.pageStep, range.value, step);
      break;
    case 'PageUp':
      next = nudge(props.modelValue, index, step * props.pageStep, range.value, step);
      break;
    case 'Home':
      next = setHandle(props.modelValue, index, lo, range.value, step);
      break;
    case 'End':
      next = setHandle(props.modelValue, index, hi, range.value, step);
      break;
    default:
      return;
  }

  event.preventDefault();
  commit(next, true);
}

/** Imperative nudge, so an external ± button can act on whatever is selected. */
function nudgeActive(delta: number): void {
  if (props.disabled) return;
  commit(nudge(props.modelValue, activeHandle.value, delta, range.value, props.step), true);
}

function focusHandle(index: HandleIndex): void {
  setActive(index);
  handleEls.value[index]?.focus();
}

function setHandleRef(index: HandleIndex, el: unknown): void {
  handleEls.value[index] = el instanceof HTMLElement ? el : null;
}

function boundsOf(index: HandleIndex): { lo: number; hi: number } {
  return boundsFor(props.modelValue, index, range.value);
}

defineExpose({ nudgeActive, focusHandle, activeHandle });
</script>

<template>
  <div
    class="ths"
    :class="{ 'ths--disabled': disabled }"
    @pointermove="onPointerMove"
    @pointerup="endDrag"
    @pointercancel="endDrag"
  >
    <div ref="trackEl" class="ths__track" @pointerdown="onPointerDown">
      <div class="ths__rail"></div>
      <!-- Connect pattern `[false, true, true, false]`: the cut is filled,
           everything outside it is not. -->
      <div
        class="ths__connect ths__connect--lead"
        :style="{ left: `${percents[0]}%`, width: `${Math.max(0, percents[1] - percents[0])}%` }"
      ></div>
      <div
        class="ths__connect ths__connect--tail"
        :style="{ left: `${percents[1]}%`, width: `${Math.max(0, percents[2] - percents[1])}%` }"
      ></div>

      <div
        v-for="i in HANDLE_INDEXES"
        :key="i"
        :ref="(el) => setHandleRef(i, el)"
        class="ths__handle"
        :class="[
          `ths__handle--${i === 0 ? 'start' : i === 1 ? 'playhead' : 'end'}`,
          {
            'ths__handle--active': activeHandle === i,
            'ths__handle--dragging': draggingHandle === i,
            'ths__handle--offscreen': offscreen[i],
          },
        ]"
        :style="{ left: `${percents[i]}%`, zIndex: 10 + i }"
        role="slider"
        aria-orientation="horizontal"
        :tabindex="disabled ? -1 : 0"
        :aria-label="labels[i]"
        :aria-disabled="disabled ? 'true' : undefined"
        :aria-valuemin="boundsOf(i).lo"
        :aria-valuemax="boundsOf(i).hi"
        :aria-valuenow="modelValue[i]"
        :aria-valuetext="format(modelValue[i])"
        :data-handle="i"
        :data-value="modelValue[i]"
        @keydown="onKeyDown(i, $event)"
        @focus="setActive(i)"
      >
        <span class="ths__tooltip">{{ format(modelValue[i]) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * The fill is green with white 25 × 25 handles bordered in the same green, and
 * the playhead is a narrow red bar. `success` and `primary` are those two
 * colours in the gravinero theme.
 */
.ths {
  --ths-rail: rgb(var(--v-theme-surface-variant));
  --ths-fill: rgb(var(--v-theme-success));
  --ths-handle: rgb(var(--v-theme-surface));
  --ths-playhead: rgb(var(--v-theme-primary));
  /* Room for the tooltips above and for the playhead's, which hangs below —
     and, sideways, for the half of an edge handle and of its label that hangs
     past the end of the track. Inset rather than clipped: at `00:00:00` the
     left tooltip was being cut in half by the card. */
  padding: 2.5rem 1.5rem;
  touch-action: none;
  user-select: none;
}

.ths--disabled {
  opacity: 0.5;
  pointer-events: none;
}

.ths__track {
  position: relative;
  height: 12px;
  cursor: pointer;
}

.ths__rail {
  position: absolute;
  inset: 0;
  border-radius: 6px;
  background: var(--ths-rail);
  box-shadow: inset 0 1px 2px rgb(0 0 0 / 18%);
}

.ths__connect {
  position: absolute;
  top: 0;
  bottom: 0;
  background: var(--ths-fill);
}

/* The stretch already played reads dimmer than the stretch still to come. */
.ths__connect--lead {
  opacity: 0.55;
}

.ths__handle {
  position: absolute;
  top: 50%;
  width: 25px;
  height: 25px;
  margin: 0;
  transform: translate(-50%, -50%);
  border-radius: 6px;
  border: 2px solid var(--ths-fill);
  background: var(--ths-handle);
  box-shadow: 0 3px 6px -3px rgb(0 0 0 / 45%);
  cursor: ew-resize;
  touch-action: none;
}

/*
 * The playhead is a bar rather than a block. ⚠️ It is 7 px, not 5: nothing
 * needs to hit it, since the TRACK takes the press and `pickHandle` decides,
 * but 5 px of red on a green fill was hard to even see.
 */
.ths__handle--playhead {
  width: 7px;
  height: 30px;
  border-width: 1px;
  border-radius: 3px;
  border-color: var(--ths-playhead);
  background: var(--ths-playhead);
}

/*
 * Three tooltips over a short cut overlap into mush, so the playhead's label
 * drops below the track (`bottom: -160%`).
 */
.ths__handle--playhead .ths__tooltip {
  bottom: auto;
  top: calc(100% + 8px);
}

.ths__handle:focus-visible {
  outline: 2px solid var(--ths-playhead);
  outline-offset: 3px;
}

.ths__handle--active {
  box-shadow:
    0 0 0 3px rgba(var(--v-theme-success), 35%),
    0 3px 6px -3px rgb(0 0 0 / 45%);
}

.ths__handle--dragging {
  cursor: grabbing;
}

/* A value pinned outside the zoom window: shown at the edge, flagged. */
.ths__handle--offscreen {
  border-style: dashed;
  opacity: 0.6;
}

.ths__tooltip {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  padding: 1px 6px;
  border-radius: 4px;
  background: rgb(var(--v-theme-background));
  color: rgb(var(--v-theme-on-background));
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
  /*
   * ⚠️ **Shown while the handle is being used, not permanently** (owner's
   * review, 2026-08-22). Three labels standing over a track at rest is what the
   * two rules above are already fighting; in the editor they also landed on the
   * episode map sitting directly above, and with the default cut — second zero
   * to the end minus ten minutes — the leftmost one sat on the map's own edge
   * over the legend.
   *
   * ⚠️ Not `--active`, which is sticky: any click leaves a handle active and its
   * label would simply never go away again. Dragging, hover and `:focus-visible`
   * are the three moments somebody is actually moving one, and the last is what
   * keeps the keyboard as well served as the pointer.
   *
   * ⚠️ It stays in the DOM — `visibility`, not `v-if` — because it is the
   * handle's `aria-valuetext` in visible form and removing the node would make
   * the two disagree about whether a value is being announced.
   */
  visibility: hidden;
  opacity: 0;
  transition:
    opacity 90ms ease-out,
    visibility 90ms;
}

.ths__handle--dragging .ths__tooltip,
.ths__handle:hover .ths__tooltip,
.ths__handle:focus-visible .ths__tooltip {
  visibility: visible;
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .ths__tooltip {
    transition: none;
  }
}
</style>
