<script setup lang="ts">
/**
 * The 232 px filter rail, and the sticky header + sheet it becomes on a phone.
 *
 * ⚠️ **One component for both, because they are one control.** The desktop rail
 * and the mobile sheet hold the same filters; building them separately is how
 * a filter ends up existing on one and not the other. The `search` slot is
 * lifted into the sticky header on a phone (it is the one control that must
 * always be reachable) and everything else goes in the sheet behind `Filtros`.
 *
 * ⚠️ **Only ONE of the two is in the DOM at a time**, decided by
 * `useCompactLayout` rather than by CSS. Rendering both and hiding one would put
 * every one of the 102 tag checkboxes in the document twice — invisible to a
 * sighted visitor, very visible to a screen reader, and twice the work for every
 * keyboard `Tab` through the filters.
 *
 * ⚠️ **Recorded deviation: the sheet now COVERS the list, as a fixed panel —
 * it no longer pushes it down.** The original rule called for pushing, on the
 * reasoning that covering hides what a filter did;
 * once the tag list started filling the available height (below), a pushed
 * sheet routinely ran taller than the screen with no way back to "Limpiar
 * filtros" or the credit short of scrolling past an open-ended tag list. A
 * fixed panel that stops short of the very bottom — see `.rail__sheet`'s
 * `bottom: 25vh` — reads as a screen laid OVER the library rather than the
 * library itself, which is the same signal "first row under the control"
 * was trying to give, achieved without a variable-height panel.
 *
 * ⚠️ **The credit moved here.** With an infinite list and a fixed player the
 * footer is unreachable — you can never scroll past the end of a list that keeps
 * growing — so `⌨️ con ❤️ por dicren` lives at the end of the rail. It is the
 * one place the site says who owns the content, so it could not simply be
 * dropped.
 */
import { onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { useCompactLayout } from '@/composables/use-compact-layout';

const props = withDefaults(
  defineProps<{
    /** Drawn on the mobile `Filtros` button. `0` hides the badge. */
    activeFilters?: number;
    /** Hidden when nothing is set — an inert "Limpiar filtros" is furniture. */
    canClear?: boolean;
    /**
     * Whether the phone header stays pinned while the page scrolls.
     *
     * ⚠️ **The calendar turns it off**, and it is the only caller that does.
     * Two sticky bars at `top: 0` overlap — there is only one top — and on a
     * 660 px screen a second one costs a fifth of what is left after the nav
     * and the player. Inside the calendar the control somebody reaches for
     * again and again is the year, not the search, so the year keeps the spot
     * and this scrolls away (`EpisodeCalendar.vue`).
     */
    stickyHead?: boolean;
  }>(),
  // ⚠️ `stickyHead: true` has to be spelled out. Vue casts an ABSENT Boolean
  // prop to `false`, not to `undefined`, so a `props.stickyHead === false` test
  // with no default here quietly unpinned the search header on every screen —
  // including the two that never mention this prop.
  { activeFilters: 0, canClear: false, stickyHead: true },
);

const emit = defineEmits<{ clear: [] }>();

const version = __APP_VERSION__;
const route = useRoute();
const compact = useCompactLayout();

const sheetOpen = ref(false);
const headEl = ref<HTMLElement | null>(null);

/**
 * Where the sheet's top edge goes: the bottom of the phone header, measured.
 *
 * ⚠️ **It was a hard-coded `top: 116px`** — the nav bar's 59 plus this header's
 * 58, true only at the very top of an unscrolled page. Scroll with the sheet
 * open and the nav bar leaves, the header goes with it, and the sheet hangs 116
 * px down the screen with nothing above it. On the calendar, where the header
 * does not stick at all by default, it was hanging there from the start.
 */
const sheetTop = ref(116);

/**
 * ⚠️ **The header pins itself whenever the sheet is open**, whatever
 * `stickyHead` says. A filter panel you can scroll away from — leaving its own
 * search box and its own `Filtros` button behind — is a panel with no way back;
 * and the calendar's reason for releasing the header (there is only one `top:
 * 0`, and the year stepper wants it) stops applying the moment the sheet covers
 * the year stepper anyway.
 */
const headPinned = ref(false);

let frame = 0;

function measureSheetTop(): void {
  const head = headEl.value;
  if (head === null) return;
  sheetTop.value = Math.round(head.getBoundingClientRect().bottom);
}

function onScroll(): void {
  if (frame !== 0) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    measureSheetTop();
  });
}

function stopWatchingScroll(): void {
  window.removeEventListener('scroll', onScroll);
  if (frame !== 0) cancelAnimationFrame(frame);
  frame = 0;
}

watch(sheetOpen, (open) => {
  headPinned.value = open;
  if (!open) {
    stopWatchingScroll();
    return;
  }
  // A tick, so the header has taken its pinned position before it is measured.
  requestAnimationFrame(() => {
    measureSheetTop();
    window.addEventListener('scroll', onScroll, { passive: true });
  });
});

onBeforeUnmount(stopWatchingScroll);

// Navigating away closes it: the sheet is part of this screen's chrome, and
// leaving it open across a route change leaves a filter panel over a page with
// no filters.
watch(
  () => route.fullPath,
  () => (sheetOpen.value = false),
);
</script>

<template>
  <!-- ── Phone: the sticky search header ──────────────────────────────────
       ⚠️ Sticky, while the nav bar above it scrolls away. On a phone the
       search box is the primary control and the nav is three links you use
       once. -->
  <template v-if="compact">
    <div
      ref="headEl"
      class="rail__mobilehead"
      :class="{ 'is-loose': !props.stickyHead && !headPinned }"
    >
      <slot name="search" />

      <button
        type="button"
        class="rail__filterbtn"
        :class="{ 'is-open': sheetOpen }"
        :aria-expanded="sheetOpen"
        aria-controls="filter-sheet"
        @click="sheetOpen = !sheetOpen"
      >
        <v-icon icon="mdi-filter-variant" size="16" aria-hidden="true" />
        Filtros
        <b v-if="props.activeFilters > 0">{{ props.activeFilters }}</b>
      </button>
    </div>

    <div v-show="sheetOpen" id="filter-sheet" class="rail__sheet" :style="{ top: `${sheetTop}px` }">
      <slot />
      <button v-if="props.canClear" type="button" class="rail__clear" @click="emit('clear')">
        Limpiar filtros
      </button>

      <!-- ⚠️ The credit belongs on a phone too. It is the one place the app says
           who owns the content, and with only one layout in the DOM it would
           otherwise simply not exist below 720 px. -->
      <p class="rail__credit">
        ⌨️ con &hearts; por dicren para
        <a href="https://gravina82.com" target="_blank" rel="noopener noreferrer">gravina82</a
        ><br />
        <a href="https://github.com/DiCrEn/gravindex" target="_blank" rel="noopener noreferrer"
          >v{{ version }}</a
        >
        · todo el contenido es de gravina82
      </p>
    </div>
  </template>

  <!-- ── Desktop: the rail ────────────────────────────────────────────── -->
  <aside v-else class="rail" aria-label="Filtros">
    <slot name="search" />
    <slot />

    <button v-if="props.canClear" type="button" class="rail__clear" @click="emit('clear')">
      Limpiar filtros
    </button>

    <p class="rail__credit">
      ⌨️ con &hearts; por dicren para
      <a href="https://gravina82.com" target="_blank" rel="noopener noreferrer">gravina82</a><br />
      <a href="https://github.com/DiCrEn/gravindex" target="_blank" rel="noopener noreferrer"
        >v{{ version }}</a
      >
      · todo el contenido es de gravina82
    </p>
  </aside>
</template>

<style scoped>
/* ⚠️ Sticky on desktop, offset by the topbar's 56 px + its 3 px red rule PLUS
   the same 1.1rem `.library` already puts above the rail at rest — matching
   that resting offset exactly is what keeps the rail from visibly jumping the
   instant it starts sticking; a bare `top: 59px` snaps flush against the
   header and reads as the top margin disappearing.
   ⚠️ A real `height`, not `max-height`: it hands `TagFilter`'s list genuine
   extra space to flex-grow into (see that component). `overflow-y: auto` is
   the LAST resort here, not the usual case — it only shows once the tag list
   has already shrunk to its own one-row minimum and still doesn't fit.
   ⚠️ The 81px is `App.vue`'s `.shell` padding-bottom (the fixed player's 78px
   + 3px of air) — without subtracting it too, the sticky box runs the full
   viewport height and the credit at its end renders under the player instead
   of above it. */
.rail {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  position: sticky;
  top: calc(59px + 1.1rem);
  height: calc(100vh - 59px - 81px - 2.2rem);
  overflow-y: auto;
}

.rail__clear {
  align-self: flex-start;
  font-size: 0.82rem;
  color: rgb(var(--v-theme-warning));
  border-bottom: 1px solid rgb(255 194 0 / 0.4);
  cursor: pointer;
}

.rail__credit {
  margin-top: 0.5rem;
  padding-top: 0.9rem;
  border-top: 1px solid rgb(220 192 142 / 0.16);
  font-size: 0.75rem;
  color: #6f6860;
  line-height: 1.5;
}

/* ⚠️ Restated rather than inherited from `.grav-footer a`: that rule is scoped
   to the footer, and the stage's bright-red link colour would make a credit
   line the loudest thing in the rail. */
.rail__credit a {
  color: #857d74;
  text-decoration: none;
}

.rail__credit a:hover,
.rail__credit a:focus-visible {
  color: var(--grav-brown);
}

/* ⚠️ No `display: none` pairs any more: only one of the two layouts is ever
   rendered (see the note at the top). What is left here is placement. */
@media (max-width: 720px) {
  .rail__mobilehead {
    display: flex;
    position: sticky;
    top: 0;
    z-index: 3;
    gap: 0.5rem;
    align-items: center;
    padding: 0.55rem 0.7rem;
    background: var(--grav-stage-edge);
    border-bottom: 1px solid rgb(220 192 142 / 0.18);
    box-shadow: 0 8px 14px rgb(0 0 0 / 0.45);
  }

  /* ⚠️ There is only one `top: 0`. The calendar pins its year stepper there
     instead, so this one lets go rather than sitting behind it. */
  .rail__mobilehead.is-loose {
    position: static;
    box-shadow: none;
  }

  .rail__mobilehead :deep(.grav-field) {
    flex: 1;
  }

  /* ⚠️ `position: fixed`, not `sticky`. Sticky kept the sheet IN the
     document's scroll flow, which caused two problems together: dragging
     anywhere on it also scrolled the library underneath (nothing about
     "sticky" stops that — it is a scroll-position trick, not a modal), and
     its resting (pre-stick) offset didn't match the `top` it snapped to,
     so on a fresh, unscrolled visit — the common case, since `Filtros` is
     reachable from the very top of the page — the sheet rendered lower
     than this math assumed and its tail ran under the fixed player.
     `position: fixed` fixes both: detached from the page, a drag over it
     cannot scroll the page behind it, and `top`/`bottom` below are exact,
     not scroll-dependent.
     ⚠️ `top: 116px` is the topbar (59px, `position: static` below 720px —
     see `AppHeader.vue` — so it never leaves the top of the DOCUMENT) plus
     this sheet's own sticky search header. `bottom: 25vh` is the requested
     reveal: a quarter of the screen stays uncovered above the player, so
     the library is visibly still there underneath rather than the sheet
     reading as its own screen. `overflow-y: auto` is the same last resort
     as the desktop `.rail` — it only engages if the tag list (its own
     flex-grow, see `TagFilter.vue`) has already shrunk to one row and the
     rest still doesn't fit.
     ⚠️ `overscroll-behavior-y: contain` is doing real work, not `fixed`
     alone: once a drag reaches the END of a scroll region — this sheet's
     own `overflow-y`, or the tag list's inside it — the browser's default
     is to CHAIN the rest of the gesture to the next scrollable ancestor,
     which is the library underneath. `contain` stops the chain at this
     box, so the drag simply ends instead of scrolling the page it covers. */
  .rail__sheet {
    display: flex;
    position: fixed;
    /* ⚠️ A fallback only: the real value is measured off the header and written
       inline, because where that header sits depends on the scroll and on
       whether this screen let it stick at all. */
    top: 116px;
    left: 0;
    right: 0;
    bottom: 25vh;
    z-index: 2;
    flex-direction: column;
    gap: 0.9rem;
    padding: 0.8rem 0.7rem 0.9rem;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    background: var(--grav-stage-panel-side);
    border-bottom: 1px solid rgb(220 192 142 / 0.18);
    box-shadow: 0 10px 18px rgb(0 0 0 / 0.45);
  }

  .rail__filterbtn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--grav-brown);
    border: 1px solid rgb(220 192 142 / 0.45);
    border-radius: 4px;
    padding: 0.4rem 0.6rem;
    white-space: nowrap;
    cursor: pointer;
  }

  .rail__filterbtn b {
    font-family: var(--grav-font-mono);
    font-size: 0.7rem;
    background: rgb(var(--v-theme-primary));
    color: var(--grav-stage-ink);
    border-radius: 10px;
    padding: 0 0.3rem;
  }

  .rail__filterbtn.is-open {
    background: var(--grav-brown);
    border-color: var(--grav-brown);
    color: var(--grav-on-brown);
  }
}
</style>
