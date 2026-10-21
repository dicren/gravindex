<script setup lang="ts">
/**
 * The episode list drawn by date: seventeen years in a strip, one year of days
 * under it, and the day you pick as a layer over the top.
 *
 * ⚠️ **The year is the only state that travels**, and it travels in the PATH
 * (`/episodes/calendario/:year?`), not in the query string. `use-list-filters.ts`
 * rebuilds the whole query from its own filters on every commit, so a `?a=2011`
 * beside them would be wiped the moment somebody typed in the search box — and
 * inside them it would be counted by `activeFilterCount` and cleared by
 * `Limpiar filtros`, neither of which is true of a year.
 *
 * ⚠️ **Changing the year REPLACES**, exactly as every filter on this site does
 * (`router.replace({ query })` in the filter core). Only entering the calendar
 * pushes, so one press of Back leaves it however many years were walked through.
 *
 * ⚠️ **It opens on the last year there is**, which is the same "newest first"
 * `GET /episodes` has always answered with. Where everything else lives is what
 * the ribbon is for.
 */
import { computed, nextTick, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';

import { useCompactLayout } from '@/composables/use-compact-layout';
import {
  useEpisodeCalendar,
  yearOf,
  type DayKey,
  type EpisodeCalendarFilters,
  type MonthKey,
} from '@/composables/use-episode-calendar';
import CalendarDayPanel from '@/components/CalendarDayPanel.vue';
import CalendarMonth from '@/components/CalendarMonth.vue';
import CalendarRibbon from '@/components/CalendarRibbon.vue';

const props = defineProps<{ filters: EpisodeCalendarFilters }>();

const route = useRoute();
const router = useRouter();
const compact = useCompactLayout();

const { calendar, isPending, error, refetch } = useEpisodeCalendar(computed(() => props.filters));

const openDay = ref<DayKey | null>(null);
const anchor = ref<HTMLElement | null>(null);
const monthsEl = ref<HTMLElement | null>(null);
const stickyEl = ref<HTMLElement | null>(null);
const panel = ref<InstanceType<typeof CalendarDayPanel> | null>(null);
/**
 * Scroll room under the last month while the sheet is up.
 *
 * ⚠️ **Without it the feature silently fails at the bottom of the year.** The
 * sheet is fixed over the last ~250 px of the screen, so December — the last
 * thing on the page — cannot be lifted above it: the page runs out of scroll
 * first, and the day somebody just tapped stays hidden behind the panel that is
 * describing it. Reserving the sheet's own height gives the page somewhere to
 * go.
 */
const sheetRoom = ref(0);

const years = computed(() => calendar.value.years);
const lastYear = computed(() => years.value[years.value.length - 1] ?? new Date().getFullYear());

/**
 * The year on screen: what the path asks for, clamped to what exists.
 *
 * ⚠️ An out-of-range year in a shared link is corrected rather than refused. The
 * catalogue grows, and a link to `2027` sent next year should land somewhere
 * sensible instead of on an empty grid.
 */
const year = computed(() => {
  const asked = Number(route.params.year);
  if (!Number.isInteger(asked) || years.value.length === 0) return lastYear.value;
  const first = years.value[0] ?? asked;
  return Math.min(Math.max(asked, first), lastYear.value);
});

/** ⚠️ `replace`, never `push` — see the header. */
function setYear(next: number): void {
  if (next === year.value) return;
  void router
    .replace({ name: 'episodesCalendar', params: { year: String(next) }, query: route.query })
    .catch(() => {});
}

/**
 * Write the resolved year into the address once the data says what it is.
 *
 * ⚠️ Entering pushes `/episodes/calendario` with no year, so the push does not
 * have to wait for six requests; this is what makes the address canonical
 * afterwards, and it replaces so the two are one history entry.
 */
watch(
  [() => route.params.year, years],
  ([asked, list]) => {
    if (list.length === 0) return;
    if (String(asked ?? '') === String(year.value)) return;
    void router
      .replace({
        name: 'episodesCalendar',
        params: { year: String(year.value) },
        query: route.query,
      })
      .catch(() => {});
  },
  { immediate: true },
);

const monthKeys = computed((): MonthKey[] =>
  Array.from(
    { length: 12 },
    (unused, index) => `${year.value}-${index < 9 ? `0${index + 1}` : index + 1}`,
  ),
);

const episodesThisYear = computed(() =>
  monthKeys.value.reduce(
    (sum, key) => sum + (calendar.value.months.get(key)?.episodes.length ?? 0),
    0,
  ),
);

const openBucket = computed(() =>
  openDay.value === null ? undefined : calendar.value.days.get(openDay.value),
);

const openIndex = computed(() =>
  openDay.value === null ? -1 : calendar.value.dayKeys.indexOf(openDay.value),
);

const hasPrev = computed(() => openIndex.value > 0);
const hasNext = computed(
  () => openIndex.value >= 0 && openIndex.value < calendar.value.dayKeys.length - 1,
);

const cellFor = (day: DayKey): HTMLElement | null =>
  monthsEl.value?.querySelector<HTMLElement>(`[data-day="${day}"]`) ?? null;

async function openAt(day: DayKey): Promise<void> {
  openDay.value = day;
  await nextTick();
  anchor.value = cellFor(day);
  await bringIntoView(day);
}

function closePanel(): void {
  const was = openDay.value;
  openDay.value = null;
  anchor.value = null;
  sheetRoom.value = 0;
  if (was !== null) cellFor(was)?.focus({ preventScroll: true });
}

function toggle(day: DayKey): void {
  if (openDay.value === day) closePanel();
  else void openAt(day);
}

/**
 * `‹ ›` — the previous or next day that HAS an episode, skipping every empty one
 * in between.
 *
 * ⚠️ **It walks the whole catalogue, not the year on screen.** From the last day
 * of 2011 the next one is in 2012, so the year changes underneath and the panel
 * re-anchors to its new cell; stopping at the boundary would make the button lie
 * about what it does. It can also cross a long silence in one press — a stretch
 * of months with no episodes — which is the same promise honestly kept.
 */
async function step(delta: -1 | 1): Promise<void> {
  const next = calendar.value.dayKeys[openIndex.value + delta];
  if (next === undefined) return;

  if (yearOf(next) !== year.value) {
    openDay.value = next;
    await router
      .replace({
        name: 'episodesCalendar',
        params: { year: String(yearOf(next)) },
        query: route.query,
      })
      .catch(() => {});
    await nextTick();
    anchor.value = cellFor(next);
    await bringIntoView(next);
    return;
  }

  await openAt(next);
}

/**
 * Scroll so the month of the open day sits in the band the sheet does not cover.
 *
 * ⚠️ **Compact layout only.** The sheet is anchored to the bottom of the screen,
 * so opening a day in November while looking at January leaves the marked cell
 * off-screen — the layer and the thing it describes with no visible relation.
 * On a desktop the popover is pinned to the cell and there is nothing to solve.
 *
 * ⚠️ It runs after the panel has laid out, because the sheet's height depends on
 * what is inside it: `nextTick` for the DOM, then a frame for the layout.
 */
/**
 * Grow the page by the sheet's own height and wait for it to happen.
 *
 * ⚠️ The scroll below is computed against a page that has to be able to travel
 * that far — and without this it cannot, because the sheet is fixed over the
 * last ~250 px and December is the last thing on the page.
 */
async function reserveSheetRoom(): Promise<void> {
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const sheet = panel.value?.root;
  if (!(sheet instanceof HTMLElement)) return;

  sheetRoom.value = Math.round(sheet.getBoundingClientRect().height) + 16;
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

/** A vertical span, which is all any of the arithmetic below cares about. */
interface Span {
  readonly top: number;
  readonly bottom: number;
}

/**
 * The strip of viewport that no fixed furniture is covering.
 *
 * ⚠️ **Measured off `.topbar`, never off `--v-layout-top`.** That variable is
 * Vuetify's, and this site's header is a plain sticky element (`AppHeader.vue`),
 * not a `<v-app-bar>` — so the variable is EMPTY, and reading it gives a band
 * starting at 0, which puts content under the 59 px header.
 */
function visibleBand(): Span {
  const GAP = 8;
  const bar = document.querySelector('.topbar');
  const barBottom = bar === null ? 0 : Math.max(0, bar.getBoundingClientRect().bottom);

  if (compact.value) {
    // The year stepper is sticky under a nav bar that scrolls away on a phone,
    // and the sheet is what closes the band from below.
    const stickyBottom = stickyEl.value?.getBoundingClientRect().bottom ?? 0;
    const sheet = panel.value?.root;
    const sheetTop =
      sheet instanceof HTMLElement ? sheet.getBoundingClientRect().top : window.innerHeight;
    return { top: Math.max(barBottom, stickyBottom) + GAP, bottom: sheetTop - GAP };
  }

  // ⚠️ The player's own top edge, not `innerHeight - height`: the two agree only
  // while it is sitting exactly at the bottom.
  const player = document.querySelector('.player-dock, .player');
  const playerTop = player === null ? window.innerHeight : player.getBoundingClientRect().top;
  return { top: barBottom + GAP, bottom: Math.min(window.innerHeight, playerTop) - GAP };
}

/** How far the page has to move for `span` to sit inside `band`. */
function fitDelta(span: Span, band: Span): number {
  // ⚠️ Taller than the band: show the TOP. For a month that is its name and its
  // first weeks; for the panel, the heading that says which day it is.
  if (span.bottom - span.top > band.bottom - band.top) return span.top - band.top;
  if (span.bottom > band.bottom) return span.bottom - band.bottom;
  if (span.top < band.top) return span.top - band.top;
  return 0;
}

const shift = (span: Span, delta: number): Span => ({
  top: span.top - delta,
  bottom: span.bottom - delta,
});

/**
 * Scroll so the open day's whole month is on screen — and, in the wide layout,
 * the panel with it.
 *
 * ⚠️ **The month is the target, not the panel.** Keeping the popover out from
 * under the header was not enough on its own: it left the month it belongs to
 * half off the bottom of the screen, so the layer was legible and the thing it
 * described was not. The two are fitted together where they both fit, and the
 * MONTH wins when they do not.
 *
 * ⚠️ It runs after the panel has laid out, because the sheet's height depends on
 * what is inside it: `nextTick` for the DOM, then a frame for the layout.
 */
async function bringIntoView(day: DayKey): Promise<void> {
  if (compact.value) await reserveSheetRoom();
  else sheetRoom.value = 0;

  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const monthEl = monthsEl.value?.querySelector<HTMLElement>(`[data-month="${day.slice(0, 7)}"]`);
  if (monthEl == null) return;

  const band = visibleBand();
  if (band.bottom - band.top <= 0) return;

  const month = monthEl.getBoundingClientRect();
  let delta = fitDelta(month, band);

  // ⚠️ Only in the wide layout is the panel part of what has to fit. As a sheet
  // it is pinned to the bottom of the screen and the band already stops at it.
  const pop = compact.value ? null : panel.value?.root;
  if (pop instanceof HTMLElement) {
    const together: Span = {
      top: Math.min(month.top, pop.getBoundingClientRect().top),
      bottom: Math.max(month.bottom, pop.getBoundingClientRect().bottom),
    };
    const both = fitDelta(together, band);
    const monthAfter = shift(month, both);
    // Fit both when both fit; otherwise the month is the one that must be whole.
    delta = monthAfter.top >= band.top && monthAfter.bottom <= band.bottom ? both : delta;
  }

  if (delta === 0) return;

  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  window.scrollBy({ top: delta, behavior: reduced ? 'auto' : 'smooth' });
}

/**
 * Coming back from an episode lands on the calendar as it was left: the same day
 * open, at the same scroll position.
 *
 * ⚠️ **In `history.state`, not in the URL.** The open day is not something
 * anybody shares — the address is "the calendar, by 2011" and stays that way —
 * but it IS something the back button owes you, and history state is exactly
 * the per-entry scratch space for that. The alternative, a `?dia=` beside the
 * filters, would also be erased by the filter core's own `router.replace`
 * (see the header).
 *
 * ⚠️ **The scroll is restored here rather than left to the router.**
 * `scrollBehavior` hands back the saved position while this screen is still
 * empty — six requests have not answered and the twelve month grids are not
 * drawn — so the browser clamps it to the top of a short page. By the time
 * there is a page to scroll, the router has long finished.
 */
const RESTORE_KEY = 'gravindexCalendar';

interface CalendarMemory {
  readonly day: DayKey | null;
  readonly scroll: number;
}

function readMemory(): CalendarMemory | null {
  const state: unknown = window.history.state;
  if (typeof state !== 'object' || state === null) return null;
  const saved: unknown = (state as Record<string, unknown>)[RESTORE_KEY];
  if (typeof saved !== 'object' || saved === null) return null;
  const { day, scroll } = saved as Record<string, unknown>;
  return {
    day: typeof day === 'string' ? day : null,
    scroll: typeof scroll === 'number' ? scroll : 0,
  };
}

onBeforeRouteLeave(() => {
  const memory: CalendarMemory = { day: openDay.value, scroll: Math.round(window.scrollY) };
  // ⚠️ Spread, never replace: `back`, `current`, `forward`, `position` and
  // `scroll` in there are vue-router's own bookkeeping.
  window.history.replaceState({ ...(window.history.state ?? {}), [RESTORE_KEY]: memory }, '');
});

/** Once per entry into the screen, and only when the data has arrived. */
let restored = false;

watch(
  () => calendar.value.dayKeys,
  async (keys) => {
    if (restored || keys.length === 0) return;
    restored = true;

    const memory = readMemory();
    if (memory === null) return;

    if (memory.day !== null && keys.includes(memory.day)) {
      openDay.value = memory.day;
      await nextTick();
      anchor.value = cellFor(memory.day);
      // The sheet's own room, or the page cannot reach the saved position.
      if (compact.value) await reserveSheetRoom();
    }

    if (memory.scroll <= 0) return;
    await nextTick();
    requestAnimationFrame(() => {
      // ⚠️ Instant, and last: the panel places itself and pulls itself into
      // view on the way, and an exact position beats a helpful one.
      window.scrollTo({ top: memory.scroll, behavior: 'auto' });
    });
  },
  { immediate: true },
);

/** A filter change can retire the open day, and a panel over a day nothing is
 *  drawing is a panel describing the previous screen. */
watch(
  () => calendar.value.dayKeys,
  (keys) => {
    if (openDay.value !== null && !keys.includes(openDay.value)) closePanel();
  },
);

/**
 * ⚠️ The panel closes when the year moves AWAY from the day it is showing, not
 * whenever the year moves. `step()` crossing from December into January changes
 * the year precisely *because* of the open day, and a blanket close there would
 * shut the panel on the very press that was meant to advance it.
 */
watch(year, () => {
  if (openDay.value !== null && yearOf(openDay.value) !== year.value) closePanel();
});
</script>

<template>
  <div class="cal">
    <div v-if="error" class="cal__error">
      <p>No se han podido cargar los episodios.</p>
      <button type="button" class="cal__retry" @click="refetch()">Reintentar</button>
    </div>

    <p v-else-if="isPending" class="cal__loading grav-mono">cargando el calendario…</p>

    <p v-else-if="years.length === 0" class="cal__empty">Ningún episodio se llama así.</p>

    <template v-else>
      <div ref="stickyEl" class="cal__sticky">
        <div class="cal__step">
          <button
            type="button"
            class="cal__arrow"
            :disabled="year <= (years[0] ?? year)"
            aria-label="Año anterior"
            @click="setYear(year - 1)"
          >
            <v-icon icon="mdi-chevron-left" size="18" aria-hidden="true" />
          </button>
          <span class="cal__year grav-stage-title">{{ year }}</span>
          <button
            type="button"
            class="cal__arrow"
            :disabled="year >= lastYear"
            aria-label="Año siguiente"
            @click="setYear(year + 1)"
          >
            <v-icon icon="mdi-chevron-right" size="18" aria-hidden="true" />
          </button>
        </div>
        <span class="cal__count grav-mono">{{ episodesThisYear }} episodios</span>
      </div>

      <CalendarRibbon :calendar="calendar" :year="year" @update:year="setYear" />
      <p class="cal__hint grav-mono">Pulsa un año en la cinta, o usa las flechas.</p>

      <div
        ref="monthsEl"
        class="cal__months"
        :style="sheetRoom > 0 ? { paddingBottom: `${sheetRoom}px` } : undefined"
      >
        <CalendarMonth
          v-for="key of monthKeys"
          :key="key"
          :data-month="key"
          :month-key="key"
          :days="calendar.days"
          :bucket="calendar.months.get(key)"
          :open-day="openDay"
          @pick="toggle"
        />

        <CalendarDayPanel
          v-if="openDay !== null && openBucket !== undefined"
          ref="panel"
          :day="openDay"
          :episodes="openBucket.episodes"
          :clip-count="openBucket.clipCount"
          :anchor="anchor"
          :has-prev="hasPrev"
          :has-next="hasNext"
          :compact="compact"
          @close="closePanel"
          @step="step"
        />
      </div>

      <p class="cal__legend grav-mono">
        <span class="cal__key cal__key--ep" aria-hidden="true" /> hubo episodio
        <span class="cal__key cal__key--cut" aria-hidden="true" /> además ya se ha cortado
      </p>

      <p v-if="episodesThisYear === 0" class="cal__empty">
        {{ year }} no trae ningún episodio con estos filtros.
      </p>
    </template>
  </div>
</template>

<style scoped>
.cal {
  /* The popover is placed against this box. */
  position: relative;
  min-width: 0;
}

.cal__sticky {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-bottom: 0.6rem;
}

.cal__step {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.cal__arrow {
  width: 34px;
  height: 34px;
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

.cal__arrow[disabled] {
  opacity: 0.3;
  cursor: default;
}

.cal__year {
  font-size: 1.5rem;
  line-height: 1;
  min-width: 3.1rem;
  text-align: center;
}

.cal__count {
  font-size: 0.72rem;
  color: var(--grav-stage-ink-muted);
}

.cal__hint {
  font-size: 0.66rem;
  color: var(--grav-stage-ink-faint);
  margin: 0.35rem 0 0;
}

.cal__months {
  display: grid;
  /* ⚠️ Capped, not free: four columns of `1fr` on a wide screen give 60 px day
     cells, and a calendar whose days are the size of buttons stops reading as a
     month. Capped too tightly they read as four separate grids instead of one —
     15 rem is where the gutters stay smaller than the months. */
  grid-template-columns: repeat(4, minmax(0, 15rem));
  justify-content: space-between;
  gap: 0.9rem;
  margin-top: 0.9rem;
}

.cal__legend {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  font-size: 0.68rem;
  color: var(--grav-stage-ink-faint);
  margin: 1rem 0 0;
}

.cal__key {
  width: 11px;
  height: 11px;
  border-radius: 2px;
  display: inline-block;
}

.cal__key--ep {
  background: rgb(220 192 142 / 0.28);
  border: 1px solid var(--grav-hairline-strong);
}

.cal__key--cut {
  background: rgb(var(--v-theme-primary));
  margin-left: 0.6rem;
}

.cal__empty,
.cal__loading {
  padding: 3rem 0;
  text-align: center;
  color: var(--grav-stage-ink-muted);
}

.cal__loading {
  font-size: 0.75rem;
  color: var(--grav-stage-ink-faint);
}

.cal__error {
  max-width: 32rem;
  margin: 2rem auto;
  padding: 1rem 1.2rem;
  border: 1px solid var(--grav-hairline-strong);
  border-left: 4px solid rgb(var(--v-theme-error));
  border-radius: 5px;
  background: var(--grav-stage-panel);
}

.cal__error p {
  margin: 0 0 0.7rem;
}

.cal__retry {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.82rem;
  border: 1px solid var(--grav-hairline-strong);
  border-radius: 4px;
  padding: 0.28rem 0.6rem;
  color: #d9d4cd;
  background: none;
  cursor: pointer;
}

@media (max-width: 980px) {
  .cal__months {
    grid-template-columns: repeat(3, minmax(0, 15rem));
  }
}

@media (max-width: 720px) {
  /* ⚠️ On a phone the year stepper is the ONE thing that stays put. The ribbon
     is the map you consult before diving in — 60 px of permanent chrome for
     something looked at once every few minutes — and the search box scrolls
     away too, because inside the calendar what changes constantly is the year. */
  .cal__sticky {
    position: sticky;
    top: 0;
    /* ⚠️ Below `FilterRail`'s sheet, which is `z-index: 2`. Being positioned is
       already enough to sit over the month grids; anything higher puts the year
       stepper on top of the filters panel it should be under. */
    z-index: 1;
    background: var(--grav-gradient);
    border-bottom: 1px solid var(--grav-hairline-strong);
    margin: 0 -0.7rem 0.6rem;
    padding: 0.3rem 0.7rem;
  }

  .cal__months {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    justify-content: stretch;
    gap: 0.5rem 0.55rem;
    margin-top: 0.7rem;
  }
}
</style>
