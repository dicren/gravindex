<script setup lang="ts">
/**
 * Choosing the tags for a clip you are publishing: the chosen ones as removable
 * chips, a search field, and **every tag on the site** under it with its use
 * count — plus the option to invent one that does not exist yet.
 *
 * ⚠️ **This replaces `TagSelector` in the editor (2026-08-22), and the reason is
 * that the site already had this control.** `TagSelector` wrapped
 * `TagAutocomplete`, i.e. a Vuetify `<v-combobox>`, whose menu is a `<v-list>`
 * painted on `surface` — and in the gravinero theme `surface` is `#ffffff`
 * (`gravinero-theme.ts`, the white admin card). So the editor's tag field opened
 * a **white rectangle** on the dark stage. Painting it was not a matter of a
 * scoped rule either: the menu is teleported to `<body>`, outside the
 * `.control-graviner` wrapper that styles the field, which is exactly why the
 * field looked right and the menu never could.
 *
 * The answer was not to paint that overlay but to stop having one. `FilterRail`
 * shows all 102 tags with their counts, in a dark list (`TagFilter.vue`) —
 * anybody who has filtered the library once already knows this control. Two
 * screens, one idea.
 *
 * ⚠️ **The row markup is deliberately the same as `TagFilter`'s**, down to the
 * class names, because the two are the same object in two places; the difference
 * is what the surrounding chrome does with a click (this one *adds a tag to a
 * draft*, that one *filters a list*) and that this one can invent a tag, which a
 * filter must never do.
 *
 * Three rules:
 *
 * - ⚠️ **A tag is matched byte for byte by the backend.** `foldForSearch` folds
 *   accents to MATCH, never to send — 12 of the ~100 real tags carry an accent
 *   or an eñe, and the folded form would match nothing on the wire.
 * - ⚠️ **It replaces the array rather than mutating it.** `v-model` targets are
 *   watched deeply elsewhere in this app and an in-place `push` is the easiest
 *   way to get that wrong.
 * - **Adding a tag that is already chosen is a no-op, not an error** — the list
 *   never offers one that is already on screen, so getting here means it was
 *   typed out in full.
 */
import { computed, ref } from 'vue';

import type { Tag } from '#/domain/tags/tag.entity';
import { useCompactLayout } from '@/composables/use-compact-layout';
import { useTagList } from '@/queries/tags.query';
import { foldForSearch } from '@/utils/fold-accents';

/**
 * How many tags the phone's band offers before "+ los 102".
 *
 * ⚠️ Chosen by height, not by taste: at ~34 px a chip and roughly three a row,
 * eight fit in two rows plus the "ver todos" — 68 px against the 160 px the
 * vertical list costs, on a screen where the whole form has to share 707 px with
 * the timeline.
 */
const BAND_SIZE = 8;

const model = defineModel<Tag[]>({ required: true });

const props = withDefaults(
  defineProps<{
    /** The accessible name of the search field. */
    ariaLabel?: string;
    /**
     * ⚠️ Goes on the INPUT, not on the root.
     *
     * `TagSelector` took an `id` and let it fall through to its root `<div>`, so
     * the editor's `<label for="editor-tags">` pointed at a container and
     * clicking the word "Tags" focused nothing. Naming the prop for what it
     * addresses makes that unrepeatable.
     */
    inputId?: string;
  }>(),
  { ariaLabel: 'Buscar o inventar un tag', inputId: undefined },
);

const tagList = useTagList();

/**
 * ⚠️ **The narrow form is chosen here, not with a media query**, and that rule
 * is the app's (`use-compact-layout.ts`): the rail and the mobile sheet hold the
 * same controls, so drawing both and hiding one puts all 102 tags in the
 * document twice — invisible to somebody looking, very audible to a screen
 * reader, and double the `Tab` stops. The same applies to this list and its
 * band, which are the same tags in two shapes.
 */
const compact = useCompactLayout();

/** Narrow, the long list is opened on purpose rather than always there. */
const showAll = ref(false);

const search = ref('');

const chosen = computed(() => new Set(model.value));

/** ⚠️ Sorted by count descending, tie-broken by the API's own order — which is
 *  code-point, so the tie-break is stable and reproducible rather than whatever
 *  the sort implementation does with equal keys. The wire order is pinned by a
 *  backend test for its own reasons; the re-sort happens here, over 102 rows. */
const byUse = computed(() =>
  [...(tagList.data.value ?? [])]
    .sort((a, b) => b.count - a.count)
    .filter((row) => !chosen.value.has(row.tag)),
);

const matching = computed(() => {
  const needle = foldForSearch(search.value);
  if (needle === '') return byUse.value;
  return byUse.value.filter((row) => foldForSearch(row.tag).includes(needle));
});

/**
 * What Enter would create: the typed text, when it is not already a tag and not
 * already chosen.
 *
 * ⚠️ **Without this row the combobox fails silently.** With
 * `hide-no-data` on it, typing a tag nobody has used yet opens an
 * EMPTY white menu — the one moment the control had something to say ("Intro
 * lo crea") and the one moment it said nothing at all.
 *
 * ⚠️ Compared byte for byte against the real tags, deliberately: `Cacas` and
 * `cacas` are two different tags to this backend, so folding here would hide
 * the fact that the capitalised one exists and quietly propose the other.
 */
const inventable = computed<Tag | null>(() => {
  const typed = search.value.trim();
  if (typed === '') return null;
  if (chosen.value.has(typed)) return null;
  if ((tagList.data.value ?? []).some((row) => row.tag === typed)) return null;
  return typed;
});

/**
 * What the phone's band shows: the most used, or what the search narrowed to.
 *
 * ⚠️ Typing filters the band **in place** — nothing opens, nothing overlays.
 * That is the whole point of the shape on a phone, where a floating menu and the
 * virtual keyboard compete for the same half of the screen.
 */
const banded = computed(() =>
  search.value === '' ? matching.value.slice(0, BAND_SIZE) : matching.value,
);

/** Narrow and idle: the band is a sample, so say how many it is a sample of. */
const hiddenCount = computed(() => Math.max(0, matching.value.length - banded.value.length));

function add(tag: Tag): void {
  const trimmed = tag.trim();
  if (trimmed === '' || chosen.value.has(trimmed)) return;
  model.value = [...model.value, trimmed];
  search.value = '';
}

function remove(tag: Tag): void {
  model.value = model.value.filter((one) => one !== tag);
}

/**
 * Enter takes the first suggestion, or invents what was typed.
 *
 * ⚠️ The order matters: enter takes the first suggestion, so typing `gaz` and
 * pressing Enter gives you `Gazpacho`, not a second tag called `gaz`. Inventing
 * only happens when nothing matched.
 */
function onEnter(): void {
  const first = matching.value[0];
  if (first !== undefined) {
    add(first.tag);
    return;
  }
  if (inventable.value !== null) add(inventable.value);
}
</script>

<template>
  <div class="tagpicker">
    <div v-if="model.length > 0" class="tagpicker__chips">
      <span v-for="tag of model" :key="tag" class="tagpicker__chip">
        {{ tag }}
        <button type="button" :aria-label="`Quitar el tag ${tag}`" @click="remove(tag)">
          <v-icon icon="mdi-close" size="x-small" aria-hidden="true" />
        </button>
      </span>
    </div>

    <label class="grav-field">
      <v-icon icon="mdi-magnify" size="14" aria-hidden="true" />
      <input
        :id="props.inputId"
        v-model="search"
        type="search"
        autocomplete="off"
        :aria-label="props.ariaLabel"
        placeholder="busca uno, o inventa el tuyo y pulsa Intro…"
        @keydown.enter.prevent="onEnter"
      />
    </label>

    <p v-if="tagList.isLoading.value" class="tagpicker__hint">Cargando tags…</p>

    <!-- ── Narrow: a band of chips, no vertical list ────────────────────────
         ⚠️ The same tags in the same order; only the packing changes. Eight
         across two rows of 34 px against 160 px of 12 px checkboxes, and every
         one of them big enough for a thumb. -->
    <template v-else-if="compact && !showAll">
      <div class="tagpicker__band">
        <button
          v-if="inventable"
          type="button"
          class="tagpicker__chip-btn tagpicker__chip-btn--new"
          @click="add(inventable)"
        >
          <v-icon icon="mdi-plus" size="11" aria-hidden="true" />
          Inventar «{{ inventable }}»
        </button>

        <button
          v-for="row of banded"
          :key="row.tag"
          type="button"
          class="tagpicker__chip-btn"
          @click="add(row.tag)"
        >
          {{ row.tag }} <em>{{ row.count }}</em>
        </button>

        <button
          v-if="hiddenCount > 0"
          type="button"
          class="tagpicker__chip-btn tagpicker__chip-btn--more"
          @click="showAll = true"
        >
          + los {{ matching.length }}
        </button>
      </div>

      <p v-if="banded.length === 0 && inventable === null" class="tagpicker__hint">
        Ningún tag se llama así.
      </p>
    </template>

    <div v-else class="tagpicker__list grav-scroll-brown">
      <button
        v-if="inventable"
        type="button"
        class="tagpicker__item tagpicker__item--new"
        @click="add(inventable)"
      >
        <span class="tagpicker__box"><v-icon icon="mdi-plus" size="9" aria-hidden="true" /></span>
        <span class="tagpicker__name">Inventar el tag «{{ inventable }}» — pulsa Intro</span>
      </button>

      <button
        v-for="row of matching"
        :key="row.tag"
        type="button"
        class="tagpicker__item"
        @click="add(row.tag)"
      >
        <span class="tagpicker__box" />
        <span class="tagpicker__name">{{ row.tag }}</span>
        <b>{{ row.count }}</b>
      </button>

      <p v-if="matching.length === 0 && inventable === null" class="tagpicker__hint">
        Ningún tag se llama así.
      </p>
    </div>

    <p class="tagpicker__hint">
      Ordenados por uso. Se comparan tal cual se escriben, con sus tildes y sus mayúsculas.
    </p>
  </div>
</template>

<style scoped>
.tagpicker__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 0.5rem;
}

/* ⚠️ A plain span with a real `<button>` inside, not a `<v-chip closable>`:
   Vuetify's own close affordance carries the English `$vuetify.close` label, and
   the tag's NAME is the useful half of "Quitar el tag Briñate" — a shared
   "Cerrar" on eight chips names none of them. */
.tagpicker__chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: rgb(var(--v-theme-primary));
  color: var(--grav-stage-ink);
  border-radius: 3px;
  padding: 0.12rem 0.3rem 0.12rem 0.5rem;
  font-size: 0.8rem;
}

.tagpicker__chip button {
  display: inline-flex;
  align-items: center;
  line-height: 1;
  cursor: pointer;
  opacity: 0.75;
}

.tagpicker__chip button:hover,
.tagpicker__chip button:focus-visible {
  opacity: 1;
}

/* ⚠️ A fixed ceiling rather than the rail's `flex: 1 1 auto`: this list sits in
   a form on the stage, not in a column that owns the viewport's height, so it
   has nothing to grow into. Six rows and a half: enough to read as a list of
   what exists, cut mid-row so it reads as scrollable, and short enough that
   "Publicar corte" stays on screen on a laptop. */
.tagpicker__list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 10rem;
  overflow-y: auto;
  padding-right: 3px;
  margin-top: 0.4rem;
}

.tagpicker__item {
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

.tagpicker__item:hover,
.tagpicker__item:focus-visible {
  background: rgb(220 192 142 / 0.1);
}

.tagpicker__item--new {
  color: var(--grav-brown);
  border: 1px dashed var(--grav-hairline-strong);
}

/* Long names — up to 41 characters in production — ellipsize rather than
   wrapping to a second line and doubling the row's height. */
.tagpicker__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tagpicker__item b {
  margin-left: auto;
  font-family: var(--grav-font-mono);
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  color: var(--grav-stage-ink-faint);
  padding-left: 0.4rem;
}

.tagpicker__box {
  width: 12px;
  height: 12px;
  border: 1px solid var(--grav-field-border);
  border-radius: 2px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  color: var(--grav-brown);
}

.tagpicker__item--new .tagpicker__box {
  border-color: var(--grav-brown);
}

/* ── The narrow band ────────────────────────────────────────────────────── */
.tagpicker__band {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.4rem;
}

/* ⚠️ 34 px tall. Below the 44 px a finger wants, and deliberately: these are
   secondary — the search field above them is the primary way in, and forty-four
   would push the publish button off a phone screen for a control you can also
   reach by typing three letters. */
.tagpicker__chip-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 34px;
  padding: 0 0.6rem;
  border: 1px solid var(--grav-hairline-strong);
  border-radius: 20px;
  font-size: 0.78rem;
  color: #d6d0c8;
  cursor: pointer;
}

.tagpicker__chip-btn:hover,
.tagpicker__chip-btn:focus-visible {
  border-color: var(--grav-brown);
  color: var(--grav-brown);
}

.tagpicker__chip-btn em {
  font-family: var(--grav-font-mono);
  font-style: normal;
  font-size: 0.66rem;
  font-variant-numeric: tabular-nums;
  color: var(--grav-stage-ink-faint);
}

.tagpicker__chip-btn--new,
.tagpicker__chip-btn--more {
  border-style: dashed;
  color: var(--grav-brown);
}

.tagpicker__hint {
  font-size: 0.72rem;
  color: var(--grav-stage-ink-faint);
  margin: 0.45rem 0 0;
  line-height: 1.4;
}
</style>
