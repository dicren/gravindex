<script setup lang="ts">
/**
 * The episode list. Route `/episodes/:page?`, name `episodes`.
 *
 * ⚠️ **The `:page?` parameter is vestigial and stays that way.** Paging never
 * travelled in it — it was in the query string — and there is no paging in the
 * URL at all. Do not start reading it.
 *
 * ⚠️ **`Cortar` is the primary action on this screen, not "ver".** Only 61 of
 * the 395 episodes have ever had a clip cut from them. Ordering newest-first and
 * printing `sin cortes` on every row makes that visible instead of hiding it.
 * The `Solo con cortes · 61` toggle is the other
 * half of the same idea.
 *
 * ⚠️ **The search hint is load-bearing copy.** `GET /episodes?search=` matches
 * the episode TITLE and nothing else — decided again on 2026-08-18 rather than
 * widened — so *gazpacho* will not find the Episodio 53 that contains that clip.
 * The hint under the box is what stops that from reading as a broken search.
 */
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import type { EpisodeListItem } from '#/domain/episodes/episode.entity';
import { listEpisodesUseCase } from '#/config/episodes.config';
import { useInfiniteList } from '@/composables/use-infinite-list';
import type { ListPage, ListQuery } from '@/composables/use-list-filters';
import { useEpisodeList } from '@/queries/episodes.query';
import { fetchMarkedEpisodes } from '@/queries/marked-episodes';
import { episodeKeys } from '@/queries/query-keys';
import { useMomentsStore } from '@/stores/moments.store';
import type { EpisodeCalendarFilters } from '@/composables/use-episode-calendar';
import EpisodeCalendar from '@/components/EpisodeCalendar.vue';
import EpisodeRowItem from '@/components/EpisodeRowItem.vue';
import FilterRail from '@/components/FilterRail.vue';
import InfiniteMore from '@/components/InfiniteMore.vue';

/**
 * ⚠️ `withClips` is a STRING here, not a boolean, and that is the filter core's
 * constraint rather than a preference: a filter value has to survive a round
 * trip through a query string without a per-field codec, so it is `''` (all) or
 * `'true'` (only the ones with clips). The repository takes the boolean.
 */
type EpisodeFilters = {
  search: string;
  withClips: string;
  /**
   * `Con mis momentos`, the third state of the `Mostrar` control (2026-08-26).
   *
   * ⚠️ **The server cannot answer this one, and that asymmetry is the whole
   * design.** `withClips` is a fact about the site — 61 of 395 episodes have
   * ever been cut from — and the API knows it. Marks live in this browser and
   * nowhere else (`stores/moments.store.ts`), so with this on the list stops
   * coming from `GET /episodes` and is assembled here, by id. Everything else
   * — the URL sync, the debounce, `Limpiar filtros`, the infinite sentinel —
   * keeps working, because only `fetchPage` changed.
   */
  mine: string;
};

const route = useRoute();
const router = useRouter();
const moments = useMomentsStore();

/**
 * The `Con mis momentos` page, built in the browser.
 *
 * ⚠️ The fetching lives in `queries/marked-episodes.ts`, shared with the
 * calendar view: both need every marked episode ordered the way `GET /episodes`
 * orders them, and the two screens disagreeing about what "mis momentos" means
 * is exactly what sharing it prevents. All this adds is the page slice.
 */
async function fetchMinePage(
  query: ListQuery<EpisodeFilters>,
  signal: AbortSignal,
): Promise<ListPage<EpisodeListItem>> {
  const matching = await fetchMarkedEpisodes(
    moments.episodeIds,
    String(query.search ?? ''),
    signal,
  );

  const from = (query.page - 1) * query.limit;
  return { results: matching.slice(from, from + query.limit), total: matching.length };
}

const {
  filters,
  appliedQuery,
  items,
  total,
  isPending,
  isLoading,
  error,
  hasMore,
  loadMore,
  reset,
  refetch,
  activeFilterCount,
} = useInfiniteList<EpisodeFilters, EpisodeListItem>({
  id: 'episodes',
  defaultFilters: { search: '', withClips: '', mine: '' },
  key: (query) => episodeKeys.list(query),
  // ⚠️ The branch is here and only here: `mine` rides in the cache key like any
  // other filter, so the two modes are two cache entries and switching back is
  // instant, exactly as switching `withClips` already was.
  fetchPage: (query, signal) =>
    query.mine === 'true'
      ? fetchMinePage(query, signal)
      : listEpisodesUseCase.execute(
          {
            page: query.page,
            limit: query.limit,
            search: query.search,
            withClips: query.withClips === 'true',
          },
          signal,
        ),
});

/**
 * `Lista | Calendario` — the one control the calendar adds to this screen.
 *
 * ⚠️ **A view switch, not a filter**, which is why it sits beside the count
 * rather than in the rail: it changes the SHAPE of the list, not which episodes
 * are in it. Both routes render this view; only the middle of the screen
 * changes.
 */
const showingCalendar = computed(() => route.name === 'episodesCalendar');

/**
 * ⚠️ **Entering PUSHES** — one entry, so Back leaves the calendar for the list —
 * and it carries the query along, or the filters would be dropped on the way in.
 * Everything after that replaces (`EpisodeCalendar.vue`).
 *
 * ⚠️ **No year on the way in.** The last available one is not known until six
 * requests have answered, and a push that waits for them is a button that does
 * nothing for a second; the calendar replaces the resolved year in as soon as it
 * has it.
 */
function openCalendar(): void {
  if (showingCalendar.value) return;
  void router.push({ name: 'episodesCalendar', query: route.query }).catch(() => {});
}

/**
 * ⚠️ `back()` when there is somewhere to go back to, so the calendar leaves no
 * trace in the history — the same shape `EpisodeSearchOverlay.close()` uses.
 * `replace` covers a cold entry straight onto a shared calendar link.
 */
function openList(): void {
  if (!showingCalendar.value) return;
  if (window.history.state?.back != null) router.back();
  else void router.replace({ name: 'episodes', query: route.query }).catch(() => {});
}

/**
 * ⚠️ The APPLIED query, not the live filters: the calendar costs six requests,
 * so it must move with the 500 ms debounce rather than with each keystroke.
 */
const calendarFilters = computed<EpisodeCalendarFilters>(() => ({
  search: String(appliedQuery.value.search ?? ''),
  withClips: appliedQuery.value.withClips === 'true',
  mine: appliedQuery.value.mine === 'true',
}));

const countLabel = computed(() => (total.value === 1 ? '1 episodio' : `${total.value} episodios`));

/**
 * The two numbers on the toggle — `Todos · 395` / `Solo con cortes · 61`.
 *
 * ⚠️ **They are the point of this screen, not decoration.** Only 61 of the 395
 * episodes have ever been cut from, and the design puts both numbers on the
 * control so the gap is visible before you filter rather than after.
 *
 * ⚠️ Two extra requests of ONE row each, and they cannot come from the list
 * itself: it only ever knows the total under the filter currently applied, so
 * whichever side is switched off has no number. `limit: 1` because only `total`
 * is read — the endpoint answers the unpaginated count whatever the page size.
 * Both share the ordinary episode cache keys, so switching the toggle back and
 * forth costs nothing after the first look.
 */
const allCount = useEpisodeList(() => ({ page: 1, limit: 1 }));
const withClipsCount = useEpisodeList(() => ({ page: 1, limit: 1, withClips: true }));

const onlyWithClips = computed(() => filters.value.withClips === 'true');
const onlyMine = computed(() => filters.value.mine === 'true');
const showingAll = computed(() => !onlyWithClips.value && !onlyMine.value);

/**
 * The three states of `Mostrar`, set as one.
 *
 * ⚠️ **Exclusive by construction, because the control already was.** The two
 * halves ask different questions — "has the site cut this?" and "have I marked
 * this?" — and crossing them would mean merging a server-paginated list with a
 * local one for a combination nobody asked for. A third button in the control
 * that exists says the same thing and answers it with `?mine=true`.
 */
function show(mode: 'all' | 'clips' | 'mine'): void {
  filters.value = {
    ...filters.value,
    withClips: mode === 'clips' ? 'true' : '',
    mine: mode === 'mine' ? 'true' : '',
  };
}

/**
 * ⚠️ **Marking or forgetting a moment has to reach a list this browser built.**
 * The `mine` page is a cache entry like any other, so without this, coming back
 * from an episode you just marked would redraw the list as it was before the
 * mark — with no request in flight to correct it, because the key never changed.
 * Only while the filter is on: everything else on this screen is the server's.
 */
watch(
  // ⚠️ The signature is watched unconditionally and the MODE is checked inside.
  // Folding `onlyMine` into the source instead makes switching the filter on
  // look like a change of marks, and refetches the server list that is on its
  // way out — one wasted request, on the one interaction that already costs
  // several.
  () => moments.episodeIds.join(','),
  () => {
    if (onlyMine.value) void refetch();
  },
);
</script>

<template>
  <div class="episodes">
    <FilterRail
      :active-filters="activeFilterCount"
      :can-clear="activeFilterCount > 0"
      :sticky-head="!showingCalendar"
      @clear="reset"
    >
      <template #search>
        <label class="grav-field">
          <v-icon icon="mdi-magnify" size="15" aria-hidden="true" />
          <input
            v-model="filters.search"
            type="search"
            placeholder="Por título…"
            aria-label="Buscar episodio por título"
          />
        </label>
      </template>

      <div>
        <p class="episodes__hint">Busca solo en el título del episodio.</p>

        <h4 class="grav-rail-heading">Mostrar</h4>
        <div class="grav-seg">
          <button
            type="button"
            :class="{ 'is-on': showingAll }"
            :aria-pressed="showingAll"
            @click="show('all')"
          >
            Todos<span v-if="allCount.data.value" class="grav-mono">
              · {{ allCount.data.value.total }}</span
            >
          </button>
          <button
            type="button"
            :class="{ 'is-on': onlyWithClips }"
            :aria-pressed="onlyWithClips"
            @click="show('clips')"
          >
            Solo con cortes<span v-if="withClipsCount.data.value" class="grav-mono">
              · {{ withClipsCount.data.value.total }}</span
            >
          </button>

          <!-- ⚠️ **The only count on this screen that costs no request**: the
               marks are already in the browser. It is also the only one that is
               about the reader rather than about the podcast, which is what the
               note under the control says out loud — a list that empties itself
               on somebody else's machine has to explain itself, or it reads as a
               broken filter. -->
          <button
            type="button"
            :class="{ 'is-on': onlyMine }"
            :aria-pressed="onlyMine"
            data-test="only-mine"
            @click="show('mine')"
          >
            Con mis momentos<span class="grav-mono"> · {{ moments.episodeCount }}</span>
          </button>
        </div>

        <p v-if="onlyMine" class="episodes__hint episodes__hint--mine">
          Tus momentos están en este navegador. Aquí no salen los de nadie más, ni los tuyos si
          entras desde otro sitio.
        </p>
      </div>
    </FilterRail>

    <main class="episodes__main">
      <div class="episodes__head">
        <h1 class="grav-stage-title episodes__title">Lista de episodios</h1>
        <div class="episodes__head-right">
          <span class="episodes__count grav-mono">{{ countLabel }}</span>
          <div class="episodes__view" role="group" aria-label="Forma de ver la lista">
            <button
              type="button"
              :class="{ 'is-on': !showingCalendar }"
              :aria-pressed="!showingCalendar"
              @click="openList"
            >
              <v-icon icon="mdi-format-list-bulleted" size="14" aria-hidden="true" />
              Lista
            </button>
            <button
              type="button"
              data-test="view-calendar"
              :class="{ 'is-on': showingCalendar }"
              :aria-pressed="showingCalendar"
              @click="openCalendar"
            >
              <v-icon icon="mdi-calendar-month" size="14" aria-hidden="true" />
              Calendario
            </button>
          </div>
        </div>
      </div>

      <EpisodeCalendar v-if="showingCalendar" :filters="calendarFilters" />

      <div v-else-if="error" class="episodes__error">
        <p>No se han podido cargar los episodios.</p>
        <button type="button" class="q-btn" @click="refetch()">Reintentar</button>
      </div>

      <p v-else-if="isPending" class="episodes__loading grav-mono">cargando episodios…</p>

      <!-- ⚠️ Three empty states, because there are three ways to be empty and
           only one of them is "no matches". A visitor who has never marked
           anything is not looking at a failed search, and telling them that
           `Ningún episodio se llama así` when they typed nothing is how a new
           feature reads as a broken one. -->
      <p
        v-else-if="items?.length === 0 && onlyMine && moments.episodeCount === 0"
        class="episodes__empty"
      >
        Todavía no has marcado ningún momento. Mientras escuchas un episodio, dale al botón de
        marcar y aparecerá aquí.
      </p>

      <p v-else-if="items?.length === 0" class="episodes__empty">Ningún episodio se llama así.</p>

      <template v-else>
        <div class="grav-list">
          <EpisodeRowItem v-for="episode of items" :key="episode.id" :episode="episode" />
        </div>

        <InfiniteMore :has-more="hasMore" :loading="isLoading" noun="episodios" @load="loadMore" />
      </template>
    </main>
  </div>
</template>

<style scoped>
.episodes {
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
  gap: 1.1rem;
  padding: 1.1rem;
}

.episodes__main {
  min-width: 0;
}

.episodes__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.episodes__title {
  font-size: 1.5rem;
}

/* ⚠️ Announced, never seen, below 720 px. `Lista de episodios` says nothing a
   visitor who tapped `LISTA DE EPISODIOS` in the nav does not already know, and
   on a phone it cost a whole line above the controls that do the work — two
   lines once the calendar added its year stepper. The heading stays in the
   document, because a screen with no `h1` is a screen with no title. */
@media (max-width: 720px) {
  .episodes__title {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* With the heading out of the way there is a whole line to use: the count at
     one end, the view switch at the other, the way the wide layout already
     reads. Hanging both off the right edge left half the row empty. */
  .episodes__head-right {
    flex: 1 1 100%;
    justify-content: space-between;
  }
}

.episodes__head-right {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}

.episodes__count {
  font-size: 0.75rem;
  color: var(--grav-brown);
}

/* The view switch. Two states, one width apiece, beside the count it changes
   the shape of. */
.episodes__view {
  display: inline-flex;
  border: 1px solid var(--grav-hairline-strong);
  border-radius: 4px;
  overflow: hidden;
}

.episodes__view button {
  display: inline-flex;
  align-items: center;
  gap: 0.32rem;
  font-size: 0.78rem;
  font-weight: 500;
  padding: 0.22rem 0.6rem;
  color: var(--grav-stage-ink-muted);
  background: none;
  border: 0;
  cursor: pointer;
}

.episodes__view button + button {
  border-left: 1px solid var(--grav-hairline-strong);
}

.episodes__view button.is-on {
  background: rgb(220 192 142 / 0.16);
  color: var(--grav-brown);
}

.episodes__view button:focus-visible {
  outline: 2px solid var(--grav-brown);
  outline-offset: -2px;
}

.episodes__hint {
  font-size: 0.72rem;
  color: var(--grav-stage-ink-faint);
  margin: 0 0 1.1rem;
  line-height: 1.4;
}

/* ⚠️ Under the control rather than over it, and only while the filter is on:
   it explains a list that is already on screen. */
.episodes__hint--mine {
  margin: 0.5rem 0 0;
}

.episodes__empty,
.episodes__loading {
  padding: 3rem 0;
  text-align: center;
  color: var(--grav-stage-ink-muted);
}

.episodes__loading {
  font-size: 0.75rem;
  color: var(--grav-stage-ink-faint);
}

.episodes__error {
  max-width: 32rem;
  margin: 2rem auto;
  padding: 1rem 1.2rem;
  border: 1px solid var(--grav-hairline-strong);
  border-left: 4px solid rgb(var(--v-theme-error));
  border-radius: 5px;
  background: var(--grav-stage-panel);
}

.episodes__error p {
  margin: 0 0 0.7rem;
}

.q-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.82rem;
  border: 1px solid var(--grav-hairline-strong);
  border-radius: 4px;
  padding: 0.28rem 0.6rem;
  color: #d9d4cd;
  cursor: pointer;
}

@media (max-width: 720px) {
  .episodes {
    grid-template-columns: minmax(0, 1fr);
    padding: 0;
    gap: 0;
  }

  .episodes__main {
    padding: 0.8rem 0.7rem 0;
  }
}
</style>
