<script setup lang="ts">
/**
 * One month, as a grid of days.
 *
 * ⚠️ **The week starts on Monday**, which is what a Spanish calendar does and
 * what `WEEKDAY_NAMES` is ordered for. `Date.getDay()` counts from Sunday, hence
 * the `+ 6 % 7` in two places here.
 *
 * ⚠️ **A day is a button only when it has something.** An empty day is inert
 * text: 2,8 episodes a month means ~27 of the 30 cells are empty, and making
 * them all focusable would put 365 dead stops in the tab order of one year.
 *
 * ⚠️ **Red means "already cut from", brown means "there was an episode".** The
 * same two tones the ribbon uses, so the year grid and the strip above it agree
 * without a legend.
 */
import { computed } from 'vue';

import {
  monthOf,
  yearOf,
  type CalendarBucket,
  type DayKey,
  type MonthKey,
} from '@/composables/use-episode-calendar';
import { MONTH_NAMES } from '@/utils/format-date';

const props = defineProps<{
  monthKey: MonthKey;
  days: ReadonlyMap<DayKey, CalendarBucket>;
  bucket: CalendarBucket | undefined;
  /** The day whose panel is open, so this grid can mark it. */
  openDay: DayKey | null;
}>();

const emit = defineEmits<{ pick: [day: DayKey] }>();

const WEEKDAY_INITIALS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;

const year = computed(() => yearOf(props.monthKey));
const month = computed(() => monthOf(props.monthKey));
const label = computed(() => MONTH_NAMES[month.value - 1]?.slice(0, 3).toUpperCase() ?? '');

const pad = (value: number): string => (value < 10 ? `0${value}` : String(value));

/** How many blanks before the 1st, with the week starting on Monday. */
const leading = computed(() => (new Date(year.value, month.value - 1, 1).getDay() + 6) % 7);

const cells = computed(() => {
  const total = new Date(year.value, month.value, 0).getDate();
  return Array.from({ length: total }, (unused, index) => {
    const day = index + 1;
    const key: DayKey = `${props.monthKey}-${pad(day)}`;
    const bucket = props.days.get(key);
    return {
      day,
      key,
      episodes: bucket?.episodes.length ?? 0,
      clipCount: bucket?.clipCount ?? 0,
    };
  });
});

const nameOf = (day: number): string =>
  `${day} de ${MONTH_NAMES[month.value - 1]?.toLowerCase() ?? ''} de ${year.value}`;
</script>

<template>
  <div class="cm" :class="{ 'has-eps': (props.bucket?.episodes.length ?? 0) > 0 }">
    <div class="cm__name">
      <span>{{ label }}</span>
      <span v-if="props.bucket" class="cm__n grav-mono">{{ props.bucket.episodes.length }}</span>
    </div>

    <div class="cm__grid">
      <div v-for="initial of WEEKDAY_INITIALS" :key="initial" class="cm__dow grav-mono">
        {{ initial }}
      </div>

      <div v-for="blank of leading" :key="`pad-${blank}`" class="cm__d is-pad" aria-hidden="true" />

      <template v-for="cell of cells" :key="cell.key">
        <button
          v-if="cell.episodes > 0"
          type="button"
          class="cm__d grav-mono"
          :class="{
            'has-clips': cell.clipCount > 0,
            'has-ep': cell.clipCount === 0,
            'is-on': cell.key === props.openDay,
          }"
          :data-day="cell.key"
          :aria-expanded="cell.key === props.openDay"
          :aria-label="`${nameOf(cell.day)}: ${cell.episodes === 1 ? '1 episodio' : `${cell.episodes} episodios`}`"
          @click="emit('pick', cell.key)"
        >
          {{ cell.day }}
        </button>
        <div v-else class="cm__d grav-mono">{{ cell.day }}</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.cm {
  border-radius: 4px;
  padding: 0.15rem 0.2rem 0.25rem;
  border: 1px solid transparent;
}

.cm__name {
  font-family: var(--grav-font-title);
  font-size: 1rem;
  letter-spacing: 0.06em;
  color: var(--grav-stage-ink-muted);
  margin-bottom: 0.25rem;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.4rem;
}

.cm.has-eps .cm__name {
  color: var(--grav-brown);
}

.cm__n {
  font-size: 0.62rem;
  color: var(--grav-stage-ink-faint);
  margin-left: auto;
}

.cm__grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 2px;
}

.cm__dow {
  font-size: 0.56rem;
  text-align: center;
  color: var(--grav-stage-ink-faint);
  padding-bottom: 1px;
  opacity: 0.75;
}

.cm__d {
  aspect-ratio: 1;
  border-radius: 2px;
  font-size: 0.6rem;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--grav-stage-ink-faint);
  border: 1px solid transparent;
  padding: 0;
  background: none;
  opacity: 0.6;
}

.cm__d.is-pad {
  visibility: hidden;
}

.cm__d.has-ep,
.cm__d.has-clips {
  opacity: 1;
  color: var(--grav-stage-ink);
  cursor: pointer;
}

.cm__d.has-ep {
  background: rgb(220 192 142 / 0.28);
  border-color: var(--grav-hairline-strong);
}

.cm__d.has-clips {
  background: rgb(var(--v-theme-primary));
  border-color: var(--grav-link);
}

.cm__d.has-ep:hover,
.cm__d.has-clips:hover {
  border-color: var(--grav-brown);
}

.cm__d.is-on {
  box-shadow: inset 0 0 0 1px var(--grav-brown);
  border-color: var(--grav-brown);
}

.cm__d:focus-visible {
  outline: 2px solid var(--grav-brown);
  outline-offset: 1px;
}

@media (max-width: 720px) {
  .cm {
    padding: 0;
  }

  .cm__name {
    font-size: 1.05rem;
  }

  .cm__d {
    font-size: 0.63rem;
  }
}
</style>
