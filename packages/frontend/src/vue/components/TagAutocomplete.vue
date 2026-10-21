<script setup lang="ts">
/**
 * One tag input: type, get suggestions from every tag on the site, pick one or
 * invent a new one.
 *
 * ⚠️ **It has one caller left: `ClipTagList`** — the `+ añadir tag` on a clip
 * row and on the permalink, where the whole control is one line inside a row.
 *
 * It was built as the seam three screens shared: the library filtered with it,
 * the card wrote with it, the editor tagged a new clip with it. Two of those are
 * gone and neither left because the sharing was wrong. The library's filter
 * lives in `TagFilter`, which shows all 102 tags with their counts visible at
 * once, and the editor's field is `TagPicker` (2026-08-22) for the same reason
 * plus one more, below. What is left is the one place the shape
 * genuinely fits: a single line, opened on demand, that submits one tag.
 *
 * Three decisions worth knowing before changing it:
 *
 * - **A combobox, not an autocomplete**, so free text is a first-class answer:
 *   a clip's first tag has to be inventable or the vocabulary can never grow.
 *   `auto-select-first` is what keeps that from being annoying — typing `gaz`
 *   and pressing Enter gives you `Gazpacho`, the first suggestion.
 * - ⚠️ **`multiple`, even though exactly one tag is submitted at a time.** A
 *   single-value `v-combobox` rewrites its `model-value` on **every keystroke**
 *   (`search`'s setter does `model.value = [transformItem(search)]`), so typing
 *   `brinate` fired seven submissions and put `?tags=b&tags=r&…` in the
 *   address bar — found in the browser, not in review. In `multiple` mode the
 *   model only moves on a real selection: Enter, or a click in the menu. The
 *   watcher below drains it back to empty immediately, so nothing is ever
 *   "selected" here; submitting is the whole interaction.
 * - **`no-filter`, with the filtering done here.** Vuetify's own matcher is
 *   accent-*sensitive*, and 12 of the ~100 real tags carry an accent or an eñe.
 *   `filterTags` is a plain function so that rule is asserted directly rather
 *   than through an open menu.
 * - **The list comes from Pinia Colada** (`useTagList`), which is the whole
 *   cache: there is no hand-rolled `localStorage` TTL to keep in sync. Two of
 *   these mounted at once make one request.
 *
 * ⚠️ **The menu is painted through `contentClass`, and it has to be** (added
 * 2026-08-22). Vuetify renders it as a `<v-list>` on `surface`, which in the
 * gravinero theme is `#ffffff` — the white admin card — so on the dark stage it
 * opened as a white rectangle. `.control-graviner` cannot reach it: the overlay
 * is **teleported to `<body>`**, outside this component's tree entirely, which
 * is precisely why the field looked right and the menu never did. `contentClass`
 * is the one hook that travels with it, and `.grav-menu` therefore lives in
 * `gravinero.css` as a global rule rather than in a scoped block here.
 *
 * ⚠️ **The editor does NOT use this component any more** — it uses `TagPicker`,
 * which has no overlay at all. This one survives for `ClipTagList`, where the
 * control is one line inside a row and a full tag list does not fit.
 *
 * ⚠️ The menu chevron is Vuetify's own `$dropdown` alias, not a glyph written
 * here. It was suppressed (`menu-icon=""`) while `@mdi/font` was missing and an
 * icon would have been an empty 24 px box; with the font installed it comes
 * back, and inside a `.control-graviner` wrapper it is painted
 * `$brown-gravinero`, the colour the theme gives dropdown chevrons.
 */
import { ref, computed, watch } from 'vue';
import type { Tag } from '#/domain/tags/tag.entity';
import { useTagList } from '@/queries/tags.query';
import { filterTags } from '@/utils/filter-tags';

const props = withDefaults(
  defineProps<{
    placeholder?: string;
    /** Tags already chosen: never suggested twice. */
    exclude?: readonly Tag[];
    density?: 'default' | 'comfortable' | 'compact';
    /** The write in flight, if the wrapper is doing one. */
    busy?: boolean;
    autofocus?: boolean;
    /** The accessible name. The design has no visible labels, only placeholders. */
    ariaLabel?: string;
  }>(),
  {
    placeholder: 'Añadir tag',
    exclude: () => [],
    density: 'default',
    busy: false,
    autofocus: false,
    ariaLabel: undefined,
  },
);

const emit = defineEmits<{ submit: [tag: Tag] }>();

const tagList = useTagList();

const search = ref('');
/**
 * ⚠️ Write-only, and always drained back to `[]`: the combobox pushes a tag in,
 * the watcher takes it straight out again and reports it. Nothing stays
 * selected, which is why the field always looks empty.
 */
const selected = ref<Tag[]>([]);

/** ⚠️ `GET /tags` answers `{ tag, count }`, and this widget
 *  offers NAMES: the count belongs to the library's filter, where it means
 *  something, and next to a free-text input it would only look like part of the
 *  tag. The order the API returns is kept — it is the one the site has always
 *  shown a tag list in. */
const tagNames = computed(() => (tagList.data.value ?? []).map((row) => row.tag));

const items = computed(() => filterTags(tagNames.value, search.value, props.exclude));

watch(selected, (value) => {
  if (value.length === 0) return;
  const submitted = [...value];
  // Clearing re-enters this watcher with an empty array, which returns at once.
  selected.value = [];
  search.value = '';
  for (const tag of submitted) {
    const trimmed = tag.trim();
    if (trimmed !== '') emit('submit', trimmed);
  }
});
</script>

<template>
  <v-combobox
    v-model="selected"
    v-model:search="search"
    :items="items"
    :placeholder="placeholder"
    :aria-label="ariaLabel ?? placeholder"
    :density="density"
    :loading="tagList.isLoading.value || busy"
    :disabled="busy"
    :autofocus="autofocus"
    :menu-props="{ contentClass: 'grav-menu' }"
    multiple
    no-filter
    auto-select-first
    clear-on-select
    hide-no-data
    hide-details
    autocomplete="off"
  />
</template>
