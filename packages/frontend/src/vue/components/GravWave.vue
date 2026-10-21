<script setup lang="ts">
/**
 * The waveform: a progress bar with a shape.
 *
 * ⚠️ **Measured when the caller has one, drawn otherwise.** `GET
 * /episodes/:id/waveform` computes real peaks offline, server-side, from the
 * downloaded mp3 (`packages/backend/src/waveform/`) — the browser never
 * decodes audio, and this component still never looks at any. When `peaks` is
 * empty (the episode has not been measured yet, or the query is still
 * loading) it falls back to the ORIGINAL deterministic placeholder below,
 * exactly as this component has always drawn one.
 *
 * ⚠️ **The placeholder is deterministic, and seeded by the clip id.** Two
 * things follow, and both matter more than they look: the same clip always
 * draws the same shape, so nothing shimmers between renders — and two
 * different clips draw *different* shapes, so the player visibly changes when
 * the queue advances. A single shared shape passed both of those tests except
 * the one that matters.
 *
 * The played part is the same drawing clipped, exactly as the mockups build it
 * (and as the measured shape is too), so the two halves can never drift apart.
 *
 * ⚠️ Decorative: `aria-hidden`, and never the only thing saying where playback
 * is. The player prints `mm:ss / mm:ss` beside it, which is the accessible
 * version of the same fact.
 */
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    /** `0..1`. Clamped, so a rounding error cannot draw past either end. */
    progress?: number;
    /** Seeds the PLACEHOLDER shape. Any stable number per clip does; the id is
     *  the one every caller already has. Ignored once `peaks` carries real data. */
    seed?: number;
    /** Bars for the PLACEHOLDER. 128 in the mockups; ignored once `peaks`
     *  carries real data — a measured slice draws exactly as many bars as it
     *  has bytes. */
    bars?: number;
    /** Measured peaks, `0..255` each, already decoded from `GET
     *  /episodes/:id/waveform`. Empty (the default) draws the placeholder. */
    peaks?: readonly number[];
  }>(),
  { progress: 0, seed: 1, bars: 128, peaks: () => [] },
);

const BAR_WIDTH = 2;
const BAR_GAP = 1;
const HEIGHT = 40;

/**
 * A tiny LCG rather than `Math.random`.
 *
 * ⚠️ The point is that it is **reproducible**: `Math.random()` would redraw the
 * shape on every re-render, which with a progress bar updating four times a
 * second is a wall of noise. Numerical quality is irrelevant here — this picks
 * the height of a rectangle.
 */
function lcg(seed: number): () => number {
  let state = (seed * 2654435761) % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 48271) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

/** The measured shape: one bar per byte, height scaled `0..255` -> `0..HEIGHT`.
 *  A floor of 0.06 keeps true silence a thin visible line rather than a gap —
 *  the same role the placeholder's `0.12` floor plays below. */
function measuredShape(peaks: readonly number[]): { x: number; y: number; height: number }[] {
  return peaks.map((value, i) => {
    const fraction = Math.max(0.06, Math.min(1, value / 255));
    const height = fraction * HEIGHT;
    return { x: i * (BAR_WIDTH + BAR_GAP), y: (HEIGHT - height) / 2, height };
  });
}

function placeholderShape(): { x: number; y: number; height: number }[] {
  const random = lcg(props.seed || 1);
  const rects: { x: number; y: number; height: number }[] = [];

  for (let i = 0; i < props.bars; i += 1) {
    // A slow envelope on top of the noise, so the result reads as speech rather
    // than as static. The two sine terms are the mockups' own (`build.py`).
    const envelope = 0.45 + 0.35 * Math.sin(i / 7.3) + 0.2 * Math.sin(i / 2.1 + 1.7);
    const value = Math.max(0.12, Math.min(1, envelope * (0.55 + 0.65 * random())));
    const height = value * HEIGHT;
    rects.push({ x: i * (BAR_WIDTH + BAR_GAP), y: (HEIGHT - height) / 2, height });
  }

  return rects;
}

const shape = computed(() =>
  props.peaks.length > 0 ? measuredShape(props.peaks) : placeholderShape(),
);

const viewWidth = computed(() => shape.value.length * (BAR_WIDTH + BAR_GAP));

/** The clip rectangle for the played half, as a `clip-path` inset. */
const playedInset = computed(() => {
  const fraction = Math.min(Math.max(props.progress, 0), 1);
  return `inset(0 ${(1 - fraction) * 100}% 0 0)`;
});
</script>

<template>
  <span class="grav-wave" aria-hidden="true">
    <svg
      class="grav-wave__svg"
      :viewBox="`0 0 ${viewWidth} ${HEIGHT}`"
      preserveAspectRatio="none"
      focusable="false"
    >
      <rect
        v-for="(bar, index) of shape"
        :key="index"
        :x="bar.x"
        :y="bar.y"
        :width="BAR_WIDTH"
        :height="bar.height"
        rx="1"
      />
    </svg>

    <!-- The same drawing, clipped. Two `<svg>`s rather than one with a mask so
         each half takes its colour from an ordinary `currentColor`. -->
    <span class="grav-wave__played" :style="{ clipPath: playedInset }">
      <svg
        class="grav-wave__svg"
        :viewBox="`0 0 ${viewWidth} ${HEIGHT}`"
        preserveAspectRatio="none"
        focusable="false"
      >
        <rect
          v-for="(bar, index) of shape"
          :key="index"
          :x="bar.x"
          :y="bar.y"
          :width="BAR_WIDTH"
          :height="bar.height"
          rx="1"
        />
      </svg>
    </span>
  </span>
</template>

<style scoped>
.grav-wave {
  position: relative;
  display: block;
  height: 100%;
  min-width: 0;
  /* The unplayed bars. The caller sets `color` for these and
     `--grav-wave-played` for the rest. */
  color: var(--grav-wave-idle, rgba(220, 192, 142, 0.32));
}

.grav-wave__svg {
  display: block;
  width: 100%;
  height: 100%;
  fill: currentColor;
}

.grav-wave__played {
  position: absolute;
  inset: 0;
  color: var(--grav-wave-played, var(--grav-brown));
}
</style>
