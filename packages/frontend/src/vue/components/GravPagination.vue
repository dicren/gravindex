<script setup lang="ts">
/**
 * Page navigation plus the page-size selector, for any list built on
 * `useFilteredList`.
 *
 * ⚠️ **The page buttons are sized by Vuetify, not measured.** Measuring the DOM
 * on mount and on every window resize (`offsetWidth` of four refs, a
 * `correctiveValue = 15` fudge, a recalculation whenever the current page gained
 * a digit) would decide how many page buttons fit. Vuetify's `total-visible`
 * gives the same answer without the layout reads, and `useDisplay()` supplies
 * the breakpoint. The *behaviour* is: first/previous/next/last, a page-size
 * selector, and both values living in the URL because the parent puts them there.
 *
 * ⚠️ Changing the page size keeps you roughly where you were, via
 * `((page - 1) * limit - 1) / newLimit`, rounded up. From page 1 it yields 0, which is out of range and therefore
 * leaves the page alone; that is why the formula looks off by one and is not.
 *
 * ⚠️ **The four slots exist for the LABELS, not for the glyphs.** Vuetify's own
 * aria strings are English ("Previous page"), so first/prev/next/last are
 * overridden here in Spanish — and the only way to be sure the override reaches
 * the rendered button is to render the button. Now that `@mdi/font` is
 * installed the contents are `v-icon`s (`chevron-double-left`, `chevron-left`,
 * `chevron-right`, `chevron-double-right`), but the slots stay: dropping
 * them would silently hand the controls their English names back.
 */
import { computed } from 'vue';
import { useDisplay } from 'vuetify';

const page = defineModel<number>('page', { required: true });
const limit = defineModel<number>('limit', { required: true });

const props = withDefaults(
  defineProps<{
    /** Matching rows ignoring pagination. */
    total: number;
    /** The library and episode grids both offer these. */
    limitOptions?: readonly number[];
  }>(),
  { limitOptions: () => [12, 24, 48] },
);

const { mobile } = useDisplay();

const lastPage = computed(() => (props.total === 0 ? 1 : Math.ceil(props.total / limit.value)));
const totalVisible = computed(() => (mobile.value ? 3 : 7));

/** ⚠️ Built as `{ title, value }` rather than bare numbers with a `#selection`
 *  slot: Vuetify 4 types a slot's `item` as the RAW item, so the slot version
 *  reads `internalItem.value` and only compiles by accident. */
const limitItems = computed(() =>
  props.limitOptions.map((option) => ({ title: `${option} por página`, value: option })),
);

function goTo(next: number): void {
  if (next < 1 || next > lastPage.value) return;
  page.value = next;
  // Every page change scrolls to the top: a grid of cards is taller
  // than the viewport, so landing mid-page on the new results is disorienting.
  window.scrollTo(0, 0);
}

function changeLimit(next: number | null): void {
  if (next === null) return;
  const wanted = Math.ceil(((page.value - 1) * limit.value - 1) / next);
  limit.value = next;
  if (wanted !== page.value) goTo(wanted);
}
</script>

<template>
  <div class="grav-pagination">
    <!-- ⚠️ `.control-graviner` is what makes the dropdown chevron brown
         (`$brown-gravinero`). That token was
         unobservable while `menu-icon=""` suppressed the icon entirely; with
         `@mdi/font` installed the default `$dropdown` alias renders and the
         theme finally reaches it. -->
    <div class="grav-pagination__limit control-graviner">
      <v-select
        :model-value="limit"
        :items="limitItems"
        density="compact"
        hide-details
        aria-label="Clips por página"
        @update:model-value="changeLimit"
      />
    </div>

    <v-pagination
      :model-value="page"
      :length="lastPage"
      :total-visible="totalVisible"
      :disabled="props.total === 0"
      density="comfortable"
      variant="flat"
      color="surface"
      active-color="primary"
      show-first-last-page
      aria-label="Paginación"
      page-aria-label="Ir a la página {0}"
      current-page-aria-label="Página actual, página {0}"
      first-aria-label="Primera página"
      previous-aria-label="Página anterior"
      next-aria-label="Página siguiente"
      last-aria-label="Última página"
      @update:model-value="goTo"
    >
      <template #first="control">
        <v-btn
          variant="text"
          size="small"
          :disabled="control.disabled"
          :aria-label="control['aria-label']"
          @click="control.onClick"
        >
          <v-icon icon="mdi-chevron-double-left" aria-hidden="true" />
        </v-btn>
      </template>
      <template #prev="control">
        <v-btn
          variant="text"
          size="small"
          :disabled="control.disabled"
          :aria-label="control['aria-label']"
          @click="control.onClick"
        >
          <v-icon icon="mdi-chevron-left" aria-hidden="true" />
        </v-btn>
      </template>
      <template #next="control">
        <v-btn
          variant="text"
          size="small"
          :disabled="control.disabled"
          :aria-label="control['aria-label']"
          @click="control.onClick"
        >
          <v-icon icon="mdi-chevron-right" aria-hidden="true" />
        </v-btn>
      </template>
      <template #last="control">
        <v-btn
          variant="text"
          size="small"
          :disabled="control.disabled"
          :aria-label="control['aria-label']"
          @click="control.onClick"
        >
          <v-icon icon="mdi-chevron-double-right" aria-hidden="true" />
        </v-btn>
      </template>
    </v-pagination>
  </div>
</template>

<style scoped>
.grav-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.grav-pagination__limit {
  flex: 0 0 auto;
  min-width: 9.5rem;
}

/* On a phone the pager centres its controls. */
@media (max-width: 768px) {
  .grav-pagination {
    justify-content: center;
  }
}
</style>
