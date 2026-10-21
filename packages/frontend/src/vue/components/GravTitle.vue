<script setup lang="ts">
/**
 * The gravinero title: league-gothic, uppercase, hard black drop shadow.
 *
 * It exists as a component rather than a bare class because a title has
 * semantics a class cannot carry — the heading level is an accessibility
 * decision (one `h1` per page, no skipped levels) and it is independent of how
 * big the thing looks. Conflating the two is how headings end up as a mix of
 * `p` and `h2`.
 *
 * On the dark stage it inherits the page's white ink; dropped inside a
 * `<v-card>` it turns red and loses the shadow. That card rule lives in
 * `gravinero.css` so no caller has to know.
 */
const SIZE_CLASS = {
  lg: 'grav-title--lg',
  md: 'grav-title--md',
  sm: 'grav-title--sm',
} as const;

withDefaults(
  defineProps<{
    /** Heading level. Pick it for the document outline, not for the size. */
    level?: 1 | 2 | 3 | 4 | 5 | 6;
    /** Type scale: `lg` is the page-title size, `md` the section size, `sm` the subsection size. */
    size?: keyof typeof SIZE_CLASS;
  }>(),
  { level: 2, size: 'lg' },
);
</script>

<template>
  <component :is="`h${level}`" class="grav-title" :class="SIZE_CLASS[size]">
    <slot />
  </component>
</template>
