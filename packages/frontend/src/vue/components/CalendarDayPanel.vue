<script setup lang="ts">
/**
 * The day a visitor picked, as a layer over the calendar — never as a slice of
 * it.
 *
 * ⚠️ **Floating on both sizes, and floating on BOTH for the same reason.** A
 * list dropped between two rows of months splits the year in two and pushes the
 * later months off the screen; and a phone-wide panel is worse still, because
 * most days here hold exactly one episode and a whole screen with one row in it
 * reads as a screen that failed to load. So: a popover pinned to its day when
 * there is room, and a sheet over a scrim when there is not.
 *
 * ⚠️ **The sheet stops short of the player**, which is never covered: it is the
 * site's one transport and a three-hour episode may be playing.
 *
 * ⚠️ **What is inside is `EpisodeRowItem`, whole.** Same cover, same title, same
 * `fecha · N cortes`, same two actions. A second drawing of the same episode is
 * a second place to fix things.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

import type { EpisodeListItem } from '#/domain/episodes/episode.entity';
import type { DayKey } from '@/composables/use-episode-calendar';
import EpisodeRowItem from '@/components/EpisodeRowItem.vue';
import { formatDayWithWeekday } from '@/utils/format-date';

const props = defineProps<{
  day: DayKey;
  episodes: readonly EpisodeListItem[];
  clipCount: number;
  /** The day cell that opened it — what the popover points at. */
  anchor: HTMLElement | null;
  /** Whether `‹` and `›` have anywhere to go. */
  hasPrev: boolean;
  hasNext: boolean;
  /** Sheet below the breakpoint, popover above it. */
  compact: boolean;
}>();

const emit = defineEmits<{ close: []; step: [delta: -1 | 1] }>();

const root = ref<HTMLElement | null>(null);
const arrow = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLElement | null>(null);

const heading = computed(() => {
  const [year, month, day] = props.day.split('-').map(Number);
  return formatDayWithWeekday(new Date(year ?? 0, (month ?? 1) - 1, day ?? 1));
});

const meta = computed(() => {
  const count = props.episodes.length;
  const clips = props.clipCount;
  return `${count === 1 ? '1 episodio' : `${count} episodios`} · ${
    clips === 0 ? 'sin cortes' : clips === 1 ? '1 corte' : `${clips} cortes`
  }`;
});

/**
 * Place the popover against its day.
 *
 * ⚠️ Wide layout only, and measured: it is flipped above the cell when it would
 * otherwise fall out of the bottom of the calendar, which the page clips. On a
 * phone the CSS pins it to three edges and none of this runs.
 */
function place(): void {
  const panel = root.value;
  const beak = arrow.value;
  if (panel === null || beak === null) return;

  if (props.compact || props.anchor === null) {
    panel.style.left = '';
    panel.style.top = '';
    beak.style.left = '';
    panel.classList.remove('is-below', 'is-above');
    return;
  }

  const parent = panel.offsetParent;
  if (!(parent instanceof HTMLElement)) return;

  const base = parent.getBoundingClientRect();
  const box = props.anchor.getBoundingClientRect();
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;

  const left = Math.max(
    4,
    Math.min(box.left - base.left + box.width / 2 - width / 2, parent.clientWidth - width - 4),
  );
  const below = box.bottom - base.top + 10;
  const fitsBelow = below + height <= parent.offsetHeight;

  panel.classList.toggle('is-below', fitsBelow);
  panel.classList.toggle('is-above', !fitsBelow);
  panel.style.left = `${left}px`;
  panel.style.top = `${fitsBelow ? below : box.top - base.top - height - 10}px`;

  const centre = box.left - base.left + box.width / 2 - left;
  beak.style.left = `${Math.max(12, Math.min(centre - 7, width - 26))}px`;
}

watch(
  () => [props.day, props.anchor, props.compact],
  () => void nextTick(place),
  { immediate: true },
);

/**
 * ⚠️ **A press anywhere else closes it**, in the wide layout — the popover is not
 * modal and nothing dims the page, so the calendar behind it stays live and
 * clicking into it has to mean something. On a phone there is no outside: the
 * scrim covers everything and has its own handler.
 *
 * ⚠️ A press on a day cell is left alone, because that cell's own click either
 * opens another day or closes this one; closing here first would make the second
 * of those a close-then-reopen.
 */
function onPointerDown(event: PointerEvent): void {
  if (props.compact || root.value === null) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (root.value.contains(target)) return;
  if (target instanceof Element && target.closest('.cm__d') !== null) return;
  emit('close');
}

window.addEventListener('pointerdown', onPointerDown);
onBeforeUnmount(() => window.removeEventListener('pointerdown', onPointerDown));

/**
 * ⚠️ **Arrow keys do what `‹ ›` do, while this is open.** Listened for on the
 * window rather than on the panel, because the focus may well be back on the day
 * cell that opened it — the panel is not modal on a desktop and does not trap.
 *
 * ⚠️ A keystroke aimed at a text box is never stolen: the search field sits on
 * the same screen, and `←` inside it means "move the caret".
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
    return;
  }
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement)
  ) {
    return;
  }

  const delta = event.key === 'ArrowLeft' ? -1 : 1;
  if (delta === -1 ? !props.hasPrev : !props.hasNext) return;
  event.preventDefault();
  emit('step', delta);
}

window.addEventListener('keydown', onKeydown);
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

/**
 * A sideways swipe on the sheet steps a day, the same as the two buttons.
 *
 * ⚠️ **The one gesture on this screen, and it duplicates visible controls** —
 * which is what makes it different from the ribbon drag that was removed. Losing
 * it costs nothing: `‹ ›` are right there.
 *
 * ⚠️ `touch-action: pan-y` on the panel, or the browser claims the gesture and
 * the vertical scroll inside a busy day stops working.
 */
const SWIPE_SLOP_PX = 12;
const SWIPE_TRIGGER_PX = 48;

let start: { x: number; y: number } | null = null;
let horizontal = false;
/** Set when a swipe fired, so the `click` it ends with is swallowed once. */
let swallowClick = false;

function onSwipeStart(event: PointerEvent): void {
  if (!props.compact || event.pointerType === 'mouse') return;
  start = { x: event.clientX, y: event.clientY };
  horizontal = false;
}

function onPointerMove(event: PointerEvent): void {
  if (start === null) return;
  const dx = event.clientX - start.x;
  const dy = event.clientY - start.y;
  if (!horizontal && Math.abs(dx) > SWIPE_SLOP_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
    horizontal = true;
  }
}

function onPointerUp(event: PointerEvent): void {
  if (start === null) return;
  const dx = event.clientX - start.x;
  const wasHorizontal = horizontal;
  start = null;
  horizontal = false;
  if (!wasHorizontal || Math.abs(dx) < SWIPE_TRIGGER_PX) return;

  // Left is forward, the way a page turns.
  const delta = dx < 0 ? 1 : -1;
  if (delta === -1 ? !props.hasPrev : !props.hasNext) return;
  swallowClick = true;
  emit('step', delta);
}

function onPointerCancel(): void {
  start = null;
  horizontal = false;
}

/** ⚠️ Or letting go over `Cortar` at the end of a swipe navigates to the editor. */
function onClickCapture(event: MouseEvent): void {
  if (!swallowClick) return;
  swallowClick = false;
  event.preventDefault();
  event.stopPropagation();
}

defineExpose({ root, focusClose: () => closeButton.value?.focus({ preventScroll: true }) });
</script>

<template>
  <div v-if="props.compact" class="pop-scrim" @click="emit('close')" />

  <div
    ref="root"
    class="pop"
    :class="{ 'is-sheet': props.compact }"
    role="dialog"
    :aria-label="heading"
    @pointerdown="onSwipeStart"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @click.capture="onClickCapture"
  >
    <div class="pop__head">
      <div class="pop__nav">
        <button
          type="button"
          class="pop__step"
          :disabled="!props.hasPrev"
          aria-label="Día anterior con episodio"
          @click="emit('step', -1)"
        >
          <v-icon icon="mdi-chevron-left" size="17" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="pop__step"
          :disabled="!props.hasNext"
          aria-label="Día siguiente con episodio"
          @click="emit('step', 1)"
        >
          <v-icon icon="mdi-chevron-right" size="17" aria-hidden="true" />
        </button>
      </div>

      <div class="pop__titles">
        <h3 class="pop__date">{{ heading }}</h3>
        <span class="pop__meta grav-mono">{{ meta }}</span>
      </div>

      <button
        ref="closeButton"
        type="button"
        class="pop__close"
        aria-label="Cerrar"
        @click="emit('close')"
      >
        <v-icon icon="mdi-close" size="16" aria-hidden="true" />
      </button>
    </div>

    <div class="pop__body">
      <EpisodeRowItem v-for="episode of props.episodes" :key="episode.id" :episode="episode" />
    </div>

    <span ref="arrow" class="pop__arrow" aria-hidden="true" />
  </div>
</template>

<style scoped>
.pop-scrim {
  position: fixed;
  inset: 0;
  z-index: 19;
  background: rgb(0 0 0 / 0.55);
}

.pop {
  position: absolute;
  z-index: 20;
  width: 23rem;
  max-width: calc(100% - 8px);
  background: var(--grav-stage-panel);
  border: 1px solid var(--grav-hairline-strong);
  border-radius: 6px;
  box-shadow: 0 14px 34px rgb(0 0 0 / 0.55);
}

.pop__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.55rem;
  border-bottom: 1px solid var(--grav-hairline);
}

.pop__nav {
  display: flex;
  gap: 2px;
  flex: 0 0 auto;
}

.pop__step,
.pop__close {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  border-radius: 4px;
  border: 1px solid var(--grav-hairline-strong);
  color: var(--grav-brown);
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  padding: 0;
  cursor: pointer;
}

.pop__step[disabled] {
  opacity: 0.28;
  cursor: default;
}

.pop__titles {
  min-width: 0;
  flex: 1 1 auto;
}

.pop__date {
  font-family: var(--grav-font-title);
  font-weight: 400;
  text-transform: uppercase;
  font-size: 1.2rem;
  line-height: 1.05;
  margin: 0;
  color: var(--grav-brown);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pop__meta {
  display: block;
  font-size: 0.66rem;
  color: var(--grav-stage-ink-faint);
}

/* ⚠️ The container `EpisodeRowItem` asks about. Inside a 23 rem popover on a
   1400 px desktop the viewport says "wide" and the row would try to fit its
   cover, title and two actions on one line. */
.pop__body {
  container-type: inline-size;
  max-height: 19rem;
  overflow-y: auto;
  padding: 0 0.55rem;
  scrollbar-width: thin;
  scrollbar-color: rgb(220 192 142 / 0.45) transparent;
}

.pop__body :deep(.ep-row:last-child) {
  border-bottom: 0;
}

/* The beak, in two triangles so the border shows: the outer one is the panel's
   hairline, the inner one its ground. */
.pop__arrow {
  position: absolute;
  width: 0;
  height: 0;
  border: 7px solid transparent;
}

.pop__arrow::after {
  content: '';
  position: absolute;
  left: -7px;
  width: 0;
  height: 0;
  border: 7px solid transparent;
}

.pop.is-below .pop__arrow {
  top: -14px;
  border-bottom-color: var(--grav-hairline-strong);
}

.pop.is-below .pop__arrow::after {
  top: -5px;
  border-bottom-color: var(--grav-stage-panel);
}

.pop.is-above .pop__arrow {
  bottom: -14px;
  border-top-color: var(--grav-hairline-strong);
}

.pop.is-above .pop__arrow::after {
  top: -9px;
  border-top-color: var(--grav-stage-panel);
}

/* ── The sheet ──────────────────────────────────────────────────────────── */

.pop.is-sheet {
  position: fixed;
  left: 8px;
  right: 8px;
  /* Clear of the 78 px player, which nothing here may cover. */
  bottom: calc(78px + 8px);
  top: auto;
  width: auto;
  max-width: none;
  border-radius: 8px;
  /* ⚠️ Or the browser claims the sideways gesture and the list inside stops
     scrolling vertically. */
  touch-action: pan-y;
}

.pop.is-sheet .pop__arrow {
  display: none;
}

.pop.is-sheet .pop__head {
  padding: 0.5rem 0.6rem;
}

.pop.is-sheet .pop__date {
  font-size: 1.3rem;
}

.pop.is-sheet .pop__step,
.pop.is-sheet .pop__close {
  width: 36px;
  height: 36px;
}

.pop.is-sheet .pop__body {
  max-height: 15rem;
  padding: 0 0.6rem;
}
</style>
