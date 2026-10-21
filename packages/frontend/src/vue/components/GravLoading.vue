<script setup lang="ts">
/**
 * The site's loader: two rings rippling outward from the centre.
 *
 * The geometry (200 × 200, 4 px rings, one second, `cubic-bezier(0, .2, .8, 1)`,
 * the second ring half a cycle behind) is the look the site keeps while it
 * loads, so keep it when restyling.
 *
 * ⚠️ The second ring takes the theme's `primary`, not the literal `#f70050` of
 * the loading.io snippet this effect was copied from: that bright pink belongs to
 * no part of the gravinero palette. A raw hex in a component is also exactly what
 * `theme/__tests__/gravinero-theme.spec.ts` exists to prevent.
 *
 * `role="status"` and the visually-hidden label exist so a screen reader
 * announces the wait: the rings are empty `<div>`s and would otherwise say
 * nothing while a page loads.
 */
withDefaults(defineProps<{ label?: string }>(), { label: 'Cargando…' });
</script>

<template>
  <div class="grav-loading" role="status" aria-live="polite">
    <div class="grav-loading__ripple">
      <div></div>
      <div></div>
    </div>
    <span class="grav-loading__label">{{ label }}</span>
  </div>
</template>

<style scoped>
.grav-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}

.grav-loading__ripple {
  position: relative;
  width: 200px;
  height: 200px;
}

.grav-loading__ripple div {
  box-sizing: content-box;
  position: absolute;
  border-width: 4px;
  border-style: solid;
  opacity: 1;
  border-radius: 50%;
  animation: grav-ripple 1s cubic-bezier(0, 0.2, 0.8, 1) infinite;
}

.grav-loading__ripple div:nth-child(1) {
  border-color: rgb(var(--v-theme-on-background));
}

.grav-loading__ripple div:nth-child(2) {
  border-color: rgb(var(--v-theme-primary));
  animation-delay: -0.5s;
}

/* Announced, never seen — the ripple already says "loading" to everyone else. */
.grav-loading__label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@keyframes grav-ripple {
  0% {
    top: 96px;
    left: 96px;
    width: 0;
    height: 0;
    opacity: 1;
  }

  100% {
    top: 18px;
    left: 18px;
    width: 156px;
    height: 156px;
    opacity: 0;
  }
}
</style>
