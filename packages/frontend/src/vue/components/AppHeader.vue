<script setup lang="ts">
/**
 * The top bar: 56 px, the red logo, three nav items, and `Añadir corte` as
 * a red button on the right. Under it, a **3 px red rule** across the full
 * width.
 *
 * ⚠️ **The rule is the top edge, not the pollitos band.** The band stays in the
 * player, which is the one place it works: at the bottom of the screen it reads
 * as a footer's texture, and at the top it competed with the logo for the same
 * 56 px.
 *
 * ⚠️ **Two logos, two jobs.** The existing red `logo.png` is here; the
 * caricatures are in the player. Neither is a replacement for the other.
 *
 * ⚠️ **The copy is verbatim, spaces included.** "Biblioteca gravinera" and
 * "Lista de episodios" are single labels whose first half disappears on a phone,
 * which is why the hidden halves carry a leading or trailing space and why the
 * items are `white-space: pre-wrap` — without it the browser collapses those
 * spaces and the desktop label reads "Bibliotecagravinera".
 *
 * ⚠️ **`Añadir corte` opens the search overlay**, and it is a real router link
 * to `/creator` rather than a button that toggles a flag: browser-back has to
 * close it, and a direct hit on `/creator` has to open it over the library.
 * The overlay itself is `EpisodeSearchOverlay`,
 * mounted by the shell.
 *
 * ⚠️ **Not a `<v-app-bar>`.** That component joins Vuetify's layout and makes
 * its height a prop that `--v-layout-top` is computed from; this bar is a plain
 * sticky element and the shell owns the spacing, which is one fewer measurement
 * to keep in step.
 *
 * ⚠️ **`Al azahar` is a `<button>`, not a `RouterLink`.** Unlike `Añadir corte`
 * it has no destination until it has one: the id is drawn at click time (see
 * `use-random-clip.ts`), so there is nothing for a link to point at up front.
 */
import { RouterLink } from 'vue-router';

import { useRandomClip } from '@/composables/use-random-clip';

/** ⚠️ Relative, not aliased: `@` is `src/vue`, so `@/assets/logo.png` resolves
 *  to a directory that does not exist. */
import logoUrl from '../../assets/logo.png';

const { loading: pickingRandomClip, goToRandomClip } = useRandomClip();
</script>

<template>
  <header class="topbar">
    <!-- ⚠️ `role="navigation"` comes free with `<nav>`, but the accessible NAME
         does not: with two `<nav>`s on a page an unnamed one is announced as
         just "navigation". The label is in Spanish, like the rest of the site. -->
    <nav class="topbar__bar" aria-label="Navegación principal">
      <RouterLink class="topbar__logo topbar__wide" :to="{ name: 'home' }">
        <!-- ⚠️ The logo needs an `alt`: without one, this link — which contains
             nothing else — announces as its own URL. -->
        <img :src="logoUrl" alt="Índice gravinero" />
      </RouterLink>

      <div class="topbar__items">
        <RouterLink class="topbar__item" :to="{ name: 'home' }">
          Biblioteca<span class="topbar__wide"> gravinera</span>
        </RouterLink>

        <RouterLink class="topbar__item" :to="{ name: 'episodes' }">
          <span class="topbar__wide">Lista de </span>episodios
        </RouterLink>

        <RouterLink class="topbar__item topbar__wide" :to="{ name: 'about' }">
          Sobre esta página
        </RouterLink>
      </div>

      <button
        type="button"
        class="topbar__random"
        :disabled="pickingRandomClip"
        @click="goToRandomClip"
      >
        <v-icon icon="mdi-dice-multiple" size="18" aria-hidden="true" />
        Al azahar
      </button>

      <RouterLink class="topbar__cut" :to="{ name: 'creatorSearch' }">Añadir corte</RouterLink>
    </nav>

    <div class="topbar__rule" />
  </header>
</template>

<style scoped>
.topbar {
  position: sticky;
  top: 0;
  z-index: 5;
}

.topbar__bar {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  height: 56px;
  padding: 0 1rem;
  background: var(--grav-gradient);
}

.topbar__logo {
  flex: 0 0 auto;
  line-height: 0;
}

.topbar__logo img {
  display: block;
  width: 62px;
  height: 40px;
  object-fit: contain;
}

.topbar__items {
  display: flex;
  align-items: center;
  gap: 1.1rem;
  flex: 1;
  min-width: 0;
}

.topbar__item {
  font-family: var(--grav-font-title);
  font-size: 1.3rem;
  text-transform: uppercase;
  color: var(--grav-stage-ink);
  text-decoration: none;
  text-shadow: var(--grav-title-shadow);
  white-space: pre-wrap;
  transition: color 0.3s ease;
}

.topbar__item:hover,
.topbar__item:focus-visible,
.topbar__item.router-link-active {
  color: var(--grav-brown);
}

.topbar__cut {
  font-family: var(--grav-font-title);
  font-size: 1.2rem;
  text-transform: uppercase;
  background: rgb(var(--v-theme-primary));
  color: var(--grav-stage-ink);
  padding: 0.25rem 0.85rem;
  border-radius: 3px;
  text-decoration: none;
  white-space: nowrap;
  flex: 0 0 auto;
}

/* Same weight as `Añadir corte`, in the theme's other accent so the two do not
   read as one action: brown fill (nav hover/active, chevrons) rather than the
   primary red (titles, tags, the CTA that writes something). */
.topbar__random {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: var(--grav-font-title);
  font-size: 1.2rem;
  text-transform: uppercase;
  background: var(--grav-brown);
  color: var(--grav-on-brown);
  border: none;
  padding: 0.25rem 0.85rem;
  border-radius: 3px;
  white-space: nowrap;
  flex: 0 0 auto;
  cursor: pointer;
}

.topbar__random:disabled {
  cursor: default;
  opacity: 0.7;
}

/* The single red line the whole design hangs off. */
.topbar__rule {
  height: 3px;
  background: rgb(var(--v-theme-primary));
}

/* ⚠️ The nav BAR scrolls away on a phone; the list's own sticky header and the
   player do not. Three items in 1.3 rem
   league-gothic plus a red button do not fit across 390 px, so the halves and
   the logo go, at the design's breakpoint. */
@media (max-width: 720px) {
  .topbar {
    position: static;
  }

  .topbar__wide {
    display: none;
  }

  .topbar__bar {
    gap: 0.75rem;
  }

  .topbar__item {
    font-size: 1.15rem;
  }

  .topbar__cut,
  .topbar__random {
    font-size: 1.05rem;
    padding: 0.2rem 0.6rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .topbar__item {
    transition: none;
  }
}
</style>
