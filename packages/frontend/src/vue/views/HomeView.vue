<script setup lang="ts">
/**
 * The library — search, sort, tag filter, and a stream of clip rows on the dark
 * stage. Route `/`, name `home`.
 *
 * ⚠️ **This screen is the pattern the other list views copy**, and the shape is
 * unchanged: a composable owns the filter state and the URL,
 * a Pinia Colada query owns the request, and the view owns layout and copy and
 * nothing else. The composable is `useInfiniteList` — `useFilteredList` is the
 * admin list's — over the same filter core, so the URL contract, the 500 ms
 * debounce and request cancellation are shared with it.
 *
 * What this screen is made of:
 *
 * - **Rows, not cards.** A clip is a row on the stage.
 * - **A sentinel, not a paginator.** Where `24 de 180` used to stand is the
 *   total under the current filter — `180 cortes`, `19 cortes`.
 * - **"Más votados"**, because there is nothing to weigh against an upvote.
 *   ⚠️ **The URL values are unchanged** — `order=points` is in links people
 *   have shared.
 * - **The default sort is `clip.createdAt`**, not the domain's
 *   `DEFAULT_CLIP_ORDER` (`points`). Those are two different defaults: the
 *   domain constant is what the BACKEND falls back to, and this screen sends
 *   an explicit `clip.createdAt`.
 *
 * ⚠️ The empty-state line is a **joke someone wrote**, not filler. It is the
 * only empty state the site has ever had.
 *
 * ⚠️ This component also answers `/creator`, which no longer has a view of its
 * own: the search overlay draws over whatever was underneath, and a direct hit
 * on that URL has to open it over the library rather than over a blank page.
 */
import { computed } from 'vue';

import type { ClipListItem, ClipOrder } from '#/domain/clips/clip.entity';
import type { Tag } from '#/domain/tags/tag.entity';
import { useInfiniteList } from '@/composables/use-infinite-list';
import { listClipsUseCase } from '#/config/clips.config';
import { clipKeys } from '@/queries/query-keys';
import { useTagList } from '@/queries/tags.query';
import ClipRowItem from '@/components/ClipRowItem.vue';
import FilterRail from '@/components/FilterRail.vue';
import InfiniteMore from '@/components/InfiniteMore.vue';
import TagFilter from '@/components/TagFilter.vue';

/** ⚠️ Exactly the three the backend whitelists. The VALUES are the wire
 *  format and travel in the query string; the labels are what the UI shows. */
const ORDER_OPTIONS: readonly { value: ClipOrder; title: string }[] = [
  { value: 'points', title: 'Más votados' },
  { value: 'clip.createdAt', title: 'Añadidos recientemente' },
  { value: 'episode.date', title: 'Fecha del capítulo' },
];

/**
 * ⚠️ A `type`, not an `interface`, and it has to be: `useListFilters` takes
 * `TFilters extends Readonly<Record<string, FilterValue>>`, and TypeScript only
 * gives an *implicit index signature* to type aliases.
 */
type LibraryFilters = {
  search: string;
  order: ClipOrder;
  tags: Tag[];
};

/**
 * ⚠️ Destructured, and that is not style: these are refs, so a template writing
 * `list.filters.value.search` would work but would be unreadable — a ref
 * returned at the top level of `setup` is unwrapped in the template, a ref
 * inside a plain object is not.
 */
const {
  filters,
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
} = useInfiniteList<LibraryFilters, ClipListItem>({
  id: 'clips',
  // ⚠️ `as ClipOrder` is not decoration: without it the literal widens to
  // `string` and the closed union stops protecting the request.
  defaultFilters: { search: '', order: 'clip.createdAt' as ClipOrder, tags: [] as Tag[] },
  key: (query) => clipKeys.list(query),
  // ⚠️ The signal is taken and passed down. Dropping it compiles, works, and
  // leaves every superseded search running to completion — the bug the e2e
  // suite measures because nothing on screen can show it.
  fetchPage: (query, signal) => listClipsUseCase.execute(query, signal),
});

/** ⚠️ Destructured for the same reason the list is: a ref returned at the top
 *  level of `setup` unwraps in the template, one inside an object does not. */
const { data: tagRows, isPending: tagsPending } = useTagList();

const countLabel = computed(() => (total.value === 1 ? '1 corte' : `${total.value} cortes`));

/**
 * A tag clicked on a row. On this screen it *becomes the filter*: a
 * single-tag replacement rather than an append, so one click narrows to that
 * tag alone.
 */
function filterByTag(tag: Tag): void {
  filters.value = { ...filters.value, tags: [tag] };
}
</script>

<template>
  <div class="library">
    <FilterRail
      :active-filters="activeFilterCount"
      :can-clear="activeFilterCount > 0"
      @clear="reset"
    >
      <template #search>
        <label class="grav-field">
          <v-icon icon="mdi-magnify" size="15" aria-hidden="true" />
          <input
            v-model="filters.search"
            type="search"
            placeholder="¡Busca tu momento…!"
            aria-label="Buscar cortes"
          />
        </label>
      </template>

      <div>
        <h4 class="grav-rail-heading">Ordenar por</h4>
        <div class="grav-seg">
          <button
            v-for="option of ORDER_OPTIONS"
            :key="option.value"
            type="button"
            :class="{ 'is-on': filters.order === option.value }"
            :aria-pressed="filters.order === option.value"
            @click="filters = { ...filters, order: option.value }"
          >
            {{ option.title }}
          </button>
        </div>
      </div>

      <TagFilter v-model="filters.tags" :tags="tagRows ?? []" :loading="tagsPending" />
    </FilterRail>

    <main class="library__main">
      <div class="library__head">
        <h1 class="grav-stage-title library__title">Biblioteca gravinera</h1>
        <span class="library__count grav-mono">{{ countLabel }}</span>
      </div>

      <!-- ⚠️ A failed request gets its own error branch. Without one, the spinner
           would run forever behind a 2.5 s toast that was gone before anyone read it. -->
      <div v-if="error" class="library__error">
        <p>No se han podido cargar los cortes.</p>
        <button type="button" class="library__retry" @click="refetch()">Reintentar</button>
      </div>

      <p v-else-if="isPending" class="library__hint grav-mono">cargando cortes…</p>

      <!-- ⚠️ A joke about a character's hip flask, not a string to improve or
           translate. -->
      <p v-else-if="items?.length === 0" class="library__empty">
        Esto está más vacío que la petaca de Melocotón Cane
      </p>

      <template v-else>
        <div class="grav-list">
          <ClipRowItem
            v-for="clip of items"
            :key="clip.id"
            :clip="clip"
            :heading-level="2"
            @select-tag="filterByTag"
          />
        </div>

        <InfiniteMore :has-more="hasMore" :loading="isLoading" noun="cortes" @load="loadMore" />
      </template>
    </main>
  </div>
</template>

<style scoped>
/* The chassis: 232 px rail + the list. Both list screens use it, and the phone
   layout collapses it to one column — the rail turns into the sticky header and
   the sheet, which `FilterRail` owns. */
.library {
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
  gap: 1.1rem;
  padding: 1.1rem;
}

.library__main {
  min-width: 0;
}

.library__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.library__title {
  font-size: 1.5rem;
}

.library__count {
  font-size: 0.75rem;
  color: var(--grav-brown);
}

.library__empty {
  padding: 3rem 0;
  text-align: center;
  color: var(--grav-stage-ink-muted);
}

.library__hint {
  padding: 2rem 0;
  text-align: center;
  font-size: 0.75rem;
  color: var(--grav-stage-ink-faint);
}

.library__error {
  max-width: 32rem;
  margin: 2rem auto;
  padding: 1rem 1.2rem;
  border: 1px solid var(--grav-hairline-strong);
  border-left: 4px solid rgb(var(--v-theme-error));
  border-radius: 5px;
  background: var(--grav-stage-panel);
}

.library__error p {
  margin: 0 0 0.7rem;
}

.library__retry {
  font-size: 0.85rem;
  color: rgb(var(--v-theme-warning));
  border: 1px solid rgb(255 194 0 / 0.4);
  border-radius: 4px;
  padding: 0.3rem 0.8rem;
  cursor: pointer;
}

@media (max-width: 720px) {
  .library {
    grid-template-columns: minmax(0, 1fr);
    padding: 0;
    gap: 0;
  }

  .library__main {
    padding: 0.8rem 0.7rem 0;
  }
}
</style>
