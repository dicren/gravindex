<script setup lang="ts">
/**
 * `Diecisiete años` — every month of the catalogue in one strip, no scrolling.
 *
 * ⚠️ **The whole point is that it fits.** The months share the width with
 * `flex: 1 1 0`, so 208 of them come out at ~3 px on a desktop and ~1,7 px on a
 * phone. An earlier design scrolled it horizontally at a fixed 11 px a month;
 * that made it a second list rather than a map, and horizontal scrolling is the
 * gesture that discovers worst on a phone.
 *
 * ⚠️ **A year is the button, and the whole grid of months inside it is that
 * button's face.** 21 px per year on a phone is under any tap-target
 * recommendation, so the ribbon is never the only way to change year — the
 * `‹ año ›` stepper beside it is (`EpisodeCalendar.vue`). A missed tap lands on
 * the neighbouring year, which costs one more tap to fix.
 *
 * ⚠️ **No drag, on either size.** A scrub across seventeen years was built and
 * removed: nothing announced it, and on a phone it fought the vertical scroll
 * for the same finger. Everything it did, the stepper does.
 *
 * ⚠️ **Below 720 px the gaps go to zero and the bricks fuse into a silhouette.**
 * Same DOM, same data: at 1,7 px a month cannot hold a mark per episode, so the
 * month becomes the mark and the strip reads as a wave — which is the shape this
 * site already uses to draw audio. The red survives, so 2010–2011 is still
 * visibly where the cuts are.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { monthOf, type EpisodeCalendar, type MonthKey } from '@/composables/use-episode-calendar';
import { MONTH_NAMES } from '@/utils/format-date';

const props = defineProps<{
  calendar: EpisodeCalendar;
  /** The year the calendar below is showing — the window is drawn over it. */
  year: number;
}>();

const emit = defineEmits<{ 'update:year': [year: number] }>();

const trackEl = ref<HTMLElement | null>(null);
const brushEl = ref<HTMLElement | null>(null);
/** What the readout says: the hovered month, or the year as a whole. */
const hovered = ref<MonthKey | null>(null);

const key = (year: number, month: number): MonthKey =>
  `${year}-${month < 10 ? `0${month}` : month}`;

/**
 * The months of a year that actually exist in the data.
 *
 * ⚠️ The range comes from the catalogue rather than from a calendar year, so the
 * strip starts at the first episode and ends at the last, and a filtered
 * catalogue genuinely shrinks it — with `Solo con cortes` the ribbon covers only
 * the years that have a clip, which is the fact rather than a bug.
 */
const monthsOf = (year: number): number[] => {
  const present: number[] = [];
  for (let month = 1; month <= 12; month += 1) {
    if (props.calendar.months.has(key(year, month))) present.push(month);
  }

  const isFirst = year === props.calendar.years[0];
  const isLast = year === props.calendar.years[props.calendar.years.length - 1];

  // ⚠️ A year with nothing in it still draws its twelve columns. The strip is a
  // TIME axis — every year has to be the same width, or the silence of 2010
  // collapses to nothing and the years stop being evenly spaced, which is the
  // one thing this drawing is for. Only the two ends stop where the data does,
  // because the podcast genuinely did not exist before April 2009.
  const from = isFirst ? (present[0] ?? 1) : 1;
  const to = isLast ? (present[present.length - 1] ?? 12) : 12;

  return Array.from({ length: to - from + 1 }, (unused, index) => from + index);
};

const columns = computed(() =>
  props.calendar.years.map((year) => ({
    year,
    months: monthsOf(year).map((month) => {
      const monthKey = key(year, month);
      const bucket = props.calendar.months.get(monthKey);
      return {
        key: monthKey,
        episodes: bucket?.episodes ?? [],
      };
    }),
  })),
);

const episodesIn = (year: number): number =>
  columns.value
    .find((column) => column.year === year)
    ?.months.reduce((sum, month) => sum + month.episodes.length, 0) ?? 0;

const clipsIn = (year: number): number =>
  columns.value
    .find((column) => column.year === year)
    ?.months.reduce(
      (sum, month) => sum + month.episodes.reduce((count, row) => count + row.clipCount, 0),
      0,
    ) ?? 0;

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

const clipLabel = (count: number): string =>
  count === 0 ? 'sin cortes' : plural(count, 'corte', 'cortes');

const monthLabel = (monthKey: MonthKey): string => {
  const bucket = props.calendar.months.get(monthKey);
  const name = MONTH_NAMES[monthOf(monthKey) - 1] ?? '';
  return `${name.toLowerCase()} de ${monthKey.slice(0, 4)} · ${plural(
    bucket?.episodes.length ?? 0,
    'episodio',
    'episodios',
  )} · ${clipLabel(bucket?.clipCount ?? 0)}`;
};

const readout = computed(() =>
  hovered.value !== null
    ? monthLabel(hovered.value)
    : `${props.year} · ${plural(episodesIn(props.year), 'episodio', 'episodios')} · ${clipLabel(
        clipsIn(props.year),
      )}`,
);

/**
 * The window, laid over the track as ONE rectangle.
 *
 * ⚠️ Not a tint on each of the year's months: they sit a pixel or two apart, so
 * a per-column highlight comes out striped and reads as twelve marks instead of
 * one span.
 *
 * ⚠️ Measured rather than computed. The columns share the width with
 * `flex: 1 1 0` and the year groups are weighted by how many months they hold,
 * so where a year actually lands is the layout's answer, not arithmetic this
 * component can repeat.
 */
function placeBrush(): void {
  const track = trackEl.value;
  const brush = brushEl.value;
  if (track === null || brush === null) return;

  const group = track.querySelector<HTMLElement>(`[data-year="${props.year}"]`);
  if (group === null) {
    brush.style.display = 'none';
    return;
  }

  const base = track.getBoundingClientRect();
  const box = group.getBoundingClientRect();
  brush.style.display = '';
  brush.style.left = `${box.left - base.left - 2}px`;
  brush.style.width = `${box.width + 4}px`;
}

let observer: ResizeObserver | undefined;

onMounted(() => {
  placeBrush();
  if (typeof ResizeObserver !== 'function' || trackEl.value === null) return;
  observer = new ResizeObserver(() => placeBrush());
  observer.observe(trackEl.value);
});

onBeforeUnmount(() => observer?.disconnect());

watch([() => props.year, columns], () => void Promise.resolve().then(placeBrush));
</script>

<template>
  <div class="gv">
    <div class="gv__head">
      <span class="gv__label">Diecisiete años</span>
      <span class="gv__read grav-mono">{{ readout }}</span>
    </div>

    <div class="gv__stage">
      <div ref="trackEl" class="gv__track">
        <button
          v-for="column of columns"
          :key="column.year"
          type="button"
          class="gv__year"
          :class="{ 'is-on': column.year === props.year }"
          :style="{ '--n': column.months.length }"
          :data-year="column.year"
          :aria-pressed="column.year === props.year"
          :aria-label="`${column.year}: ${plural(episodesIn(column.year), 'episodio', 'episodios')}`"
          @click="emit('update:year', column.year)"
          @mouseleave="hovered = null"
        >
          <span
            v-for="month of column.months"
            :key="month.key"
            class="gv__m"
            :title="monthLabel(month.key)"
            @mouseenter="hovered = month.key"
          >
            <span
              v-for="episode of month.episodes"
              :key="episode.id"
              class="gv__b"
              :class="{ 'has-clips': episode.clipCount > 0 }"
            />
          </span>
        </button>
      </div>
      <div ref="brushEl" class="gv__brush" aria-hidden="true" />
    </div>

    <div class="gv__axis" aria-hidden="true">
      <div
        v-for="column of columns"
        :key="column.year"
        class="gv__yr grav-mono"
        :class="{ 'is-on': column.year === props.year, 'is-tick': column.year % 5 === 0 }"
        :style="{ '--n': column.months.length }"
      >
        {{ column.year }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.gv {
  background: var(--grav-stage-panel-deep);
  border: 1px solid var(--grav-hairline);
  border-radius: 5px;
  padding: 0.55rem 0.6rem 0.45rem;
}

.gv__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.8rem;
  flex-wrap: wrap;
  margin-bottom: 0.45rem;
}

.gv__label {
  font-size: 0.68rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--grav-brown);
  font-weight: 600;
}

.gv__read {
  font-size: 0.72rem;
  color: var(--grav-stage-ink-muted);
}

.gv__stage {
  position: relative;
  padding: 3px 0;
}

.gv__track {
  display: flex;
  align-items: stretch;
  height: 92px;
}

.gv__year {
  flex: var(--n) 1 0;
  display: flex;
  align-items: stretch;
  gap: 1px;
  padding: 0 1px;
  min-width: 0;
  border: 0;
  border-radius: 2px;
  background: none;
  cursor: pointer;
}

/* Faint banding, so a year is a readable unit before anything is touched. */
.gv__year:nth-child(odd) {
  background: rgb(220 192 142 / 0.022);
}

.gv__year:hover {
  background: rgb(220 192 142 / 0.1);
}

.gv__year:focus-visible {
  outline: 2px solid var(--grav-brown);
  outline-offset: 2px;
}

.gv__m {
  flex: 1 1 0;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column-reverse;
  justify-content: flex-start;
  gap: 1px;
  border-radius: 1px;
}

.gv__year.is-on .gv__m {
  background: rgb(220 192 142 / 0.06);
}

.gv__b {
  /* ⚠️ A definite width, neither stretched nor a percentage: the track is sized
     by its own content, and under that pass an empty span gets its intrinsic
     width — nothing — while a percentage resolves against nothing. */
  width: 100%;
  height: 4px;
  border-radius: 1px;
  background: rgb(220 192 142 / 0.44);
}

.gv__b.has-clips {
  background: var(--grav-link);
}

.gv__brush {
  position: absolute;
  top: 0;
  bottom: 0;
  border: 1px solid var(--grav-brown);
  border-radius: 3px;
  background: rgb(220 192 142 / 0.09);
  pointer-events: none;
  transition:
    left 0.18s ease,
    width 0.18s ease;
}

.gv__axis {
  display: flex;
  margin-top: 0.3rem;
  padding-top: 0.28rem;
  border-top: 1px solid var(--grav-hairline);
}

.gv__yr {
  flex: var(--n) 1 0;
  min-width: 0;
  text-align: center;
  font-size: 0.62rem;
  color: var(--grav-stage-ink-faint);
  overflow: hidden;
}

.gv__yr.is-on {
  color: var(--grav-brown);
  font-weight: 600;
}

/* ⚠️ Under ~900 px a year label owns less than 26 px and `2009` stops fitting,
   so the axis drops to a tick every five years and lets it spill out of its own
   box. The selected year is not ticked back in — it would collide with its
   neighbour, and the readout above already names it. */
@media (max-width: 900px) {
  .gv__yr {
    overflow: visible;
    white-space: nowrap;
    color: transparent;
  }

  .gv__yr.is-tick {
    color: var(--grav-stage-ink-faint);
  }

  /* Needed because `.gv__yr.is-on` outranks the bare `.gv__yr` above: a media
     query changes when a rule applies, never how much it weighs. */
  .gv__yr.is-on:not(.is-tick) {
    color: transparent;
  }
}

@media (max-width: 720px) {
  .gv {
    padding: 0.4rem 0.45rem 0.35rem;
    border-radius: 4px;
  }

  .gv__head {
    margin-bottom: 0.35rem;
  }

  .gv__track {
    height: 60px;
  }

  /* ⚠️ The gaps go to zero and the bricks fuse. Same DOM, same data. */
  .gv__year {
    gap: 0;
    padding: 0;
    border-radius: 0;
  }

  .gv__year:nth-child(odd) {
    background: rgb(220 192 142 / 0.045);
  }

  .gv__m {
    gap: 0;
    border-radius: 0;
  }

  .gv__b {
    height: 3px;
    border-radius: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .gv__brush {
    transition: none;
  }
}
</style>
