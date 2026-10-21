<script setup lang="ts">
/**
 * The library's tag filter: a search box, then **all 102 tags**, each with a
 * checkbox and its use count, scrolling inside the rail.
 *
 * ⚠️ **All of them, always, and that was argued about.** An earlier proposal hid
 * the 50 single-use tags behind the search box; it was rejected — *"si no, nadie
 * se va a acordar de los tags ocultos"*. The
 * distribution is what makes this the right control and a chip cloud the wrong
 * one: ten tags carry 49 % of the 382 tag rows and half the tags are used once,
 * so a cloud is either enormous or a lie about what exists.
 *
 * ⚠️ **Ordered by use, not by the order the API returns.** `GET /tags` answers
 * in code-point order and that is pinned by a test for a real reason — a
 * different Postgres locale reshuffles every accented tag — so the re-sort
 * happens here, over 102 rows, for free.
 *
 * ⚠️ **Selected tags pin to the top**, above a dashed rule. Without it, choosing
 * a tag from the bottom of a 102-row scroller means it is no longer on screen
 * and the only evidence of the filter is the list changing.
 *
 * ⚠️ The search box folds accents to MATCH but never to send: tags are compared
 * byte for byte by the backend, and `foldForSearch` output would match nothing.
 */
import { computed, ref } from 'vue';

import type { Tag, TagCount } from '#/domain/tags/tag.entity';
import { foldForSearch } from '@/utils/fold-accents';

const props = withDefaults(
  defineProps<{
    /** Every tag with its count, straight from `GET /tags`. */
    tags: readonly TagCount[];
    /** The tags currently filtering the list. */
    modelValue: readonly Tag[];
    loading?: boolean;
  }>(),
  { loading: false },
);

const emit = defineEmits<{ 'update:modelValue': [tags: Tag[]] }>();

const search = ref('');

const selected = computed(() => new Set(props.modelValue));

/** ⚠️ Sorted by count descending, tie-broken by the API's own order — which is
 *  code-point, so the tie-break is stable and reproducible rather than whatever
 *  the sort implementation does with equal keys. */
const byUse = computed(() => [...props.tags].sort((a, b) => b.count - a.count));

const matching = computed(() => {
  const needle = foldForSearch(search.value);
  const rest = byUse.value.filter((row) => !selected.value.has(row.tag));
  if (needle === '') return rest;
  return rest.filter((row) => foldForSearch(row.tag).includes(needle));
});

/** The chosen ones, in the order they were chosen — so the list does not
 *  reshuffle under the cursor as counts differ. */
const chosen = computed(() =>
  props.modelValue.map((tag) => byUse.value.find((row) => row.tag === tag) ?? { tag, count: 0 }),
);

function toggle(tag: Tag): void {
  // ⚠️ A NEW array every time. `useListFilters` watches deeply and a mutation in
  // place is a change it cannot always see.
  emit(
    'update:modelValue',
    selected.value.has(tag)
      ? props.modelValue.filter((one) => one !== tag)
      : [...props.modelValue, tag],
  );
}
</script>

<template>
  <div class="tagfilter">
    <h4 class="tagfilter__heading">Tags · {{ props.tags.length }}</h4>

    <label class="tagfilter__search grav-field">
      <v-icon icon="mdi-magnify" size="14" aria-hidden="true" />
      <input v-model="search" type="search" placeholder="Filtrar tags…" aria-label="Filtrar tags" />
    </label>

    <p v-if="props.loading" class="tagfilter__hint">Cargando tags…</p>

    <div v-else class="tagfilter__list grav-scroll-brown">
      <!-- Pinned, above a dashed rule. -->
      <div v-if="chosen.length > 0" class="tagfilter__chosen">
        <button
          v-for="row of chosen"
          :key="row.tag"
          type="button"
          class="tagfilter__item is-on"
          :aria-pressed="true"
          @click="toggle(row.tag)"
        >
          <span class="tagfilter__box"
            ><v-icon icon="mdi-check" size="9" aria-hidden="true"
          /></span>
          <span class="tagfilter__name">{{ row.tag }}</span>
          <b>{{ row.count }}</b>
        </button>
      </div>

      <button
        v-for="row of matching"
        :key="row.tag"
        type="button"
        class="tagfilter__item"
        :aria-pressed="false"
        @click="toggle(row.tag)"
      >
        <span class="tagfilter__box" />
        <span class="tagfilter__name">{{ row.tag }}</span>
        <b>{{ row.count }}</b>
      </button>

      <p v-if="matching.length === 0 && chosen.length === 0" class="tagfilter__hint">
        Ningún tag se llama así.
      </p>
    </div>

    <p class="tagfilter__hint">Los {{ props.tags.length }}, ordenados por uso.</p>
  </div>
</template>

<style scoped>
/* ⚠️ The one flexible piece of the rail (`FilterRail.vue`): grows to soak up
   whatever height `.rail` isn't using for its fixed-size siblings, and shrinks
   with it as the viewport gets shorter. `min-height: 0` is required, not
   decorative — a flex item's default `min-height: auto` would refuse to
   shrink past the LIST's natural content size, defeating `.tagfilter__list`'s
   own min-height below. */
.tagfilter {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

.tagfilter__heading {
  font-size: 0.68rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--grav-brown);
  margin: 0 0 0.5rem;
  font-weight: 600;
}

.tagfilter__search {
  margin-bottom: 0.4rem;
}

/* ⚠️ Fills whatever the rail has left, down to one row (`min-height`) before
   `.rail`'s own scrollbar takes over — replaces a flat `max-height: 232px`
   that ignored the viewport entirely. `overflow-y` stays local: the list
   scrolls on its own long before the fixed rows around it (search, sort,
   "Limpiar filtros", the credit) ever lose space to it. */
.tagfilter__list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1 1 auto;
  min-height: 2rem;
  overflow-y: auto;
  padding-right: 3px;
}

.tagfilter__chosen {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-bottom: 0.35rem;
  margin-bottom: 0.35rem;
  border-bottom: 1px dashed rgb(220 192 142 / 0.25);
}

.tagfilter__item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.22rem 0.4rem;
  border-radius: 3px;
  font-size: 0.82rem;
  color: #d6d0c8;
  min-width: 0;
  cursor: pointer;
  text-align: left;
}

.tagfilter__item:hover,
.tagfilter__item:focus-visible {
  background: rgb(220 192 142 / 0.1);
}

/* Long names — up to 41 characters in production — ellipsize rather than
   wrapping to a second line and doubling the row's height. */
.tagfilter__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tagfilter__item b {
  margin-left: auto;
  font-family: var(--grav-font-mono);
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  color: var(--grav-stage-ink-faint);
  padding-left: 0.4rem;
}

.tagfilter__box {
  width: 12px;
  height: 12px;
  border: 1px solid var(--grav-field-border);
  border-radius: 2px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  color: var(--grav-on-brown);
}

.tagfilter__item.is-on {
  background: rgb(var(--v-theme-primary));
  color: var(--grav-stage-ink);
}

.tagfilter__item.is-on b {
  color: rgb(255 255 255 / 0.75);
}

.tagfilter__item.is-on .tagfilter__box {
  background: var(--grav-brown);
  border-color: var(--grav-brown);
}

.tagfilter__hint {
  font-size: 0.72rem;
  color: var(--grav-stage-ink-faint);
  margin: 0.45rem 0 0;
  line-height: 1.4;
}
</style>
