<script setup lang="ts">
/**
 * The cookie banner — hand-rolled, no library (root `AGENTS.md`, "Analytics").
 *
 * ⚠️ **It is a gate, not a notice.** GA4 is not in `index.html` and nothing is
 * requested from Google until somebody presses "Aceptar": the tag is loaded by
 * `analytics/start-analytics.ts` *after* the decision, never gated after the
 * fact. This component's whole job is to be the thing that decision comes from.
 *
 * ⚠️ **Both answers cost one click and look the same.** Same component, same
 * size, same variant, same colour, side by side, neither pre-selected — the only
 * difference is the word on them. There is no "aceptar todo" shortcut with a
 * "gestionar preferencias" maze behind it, because there is exactly one thing
 * to decide.
 *
 * ⚠️ **It is not a dialog.** No `role="dialog"`, no `aria-modal`, no overlay, no
 * focus trap: the site is entirely usable with the banner on screen, which is
 * the point — a visitor who wants to read a clip and never answer can. It is a
 * named region, so a screen-reader user can find it, and Escape puts it away
 * WITHOUT recording anything (see `dismissPrompt`: a dismissal is not consent).
 *
 * ⚠️ **Nothing renders when there is no `VITE_GA4_ID`.** No id means no tag, no
 * cookie and therefore nothing to consent to; a banner asking about cookies that
 * do not exist would be a lie told in good faith. That is the normal state in
 * development and in this repository, where no id is committed.
 *
 * The fixed-overlay mechanics are `NotificationHost.vue`'s, deliberately: the
 * container spans the viewport and is `pointer-events: none` so its padding
 * cannot swallow clicks on the page underneath, the panel turns them back on,
 * and the z-index stays below the app bar so it can never cover the navigation.
 */
import { nextTick, useId, useTemplateRef, watch } from 'vue';

import GravTitle from '@/components/GravTitle.vue';
import { useConsentStore } from '@/stores/consent.store';

const consent = useConsentStore();

const titleId = useId();
const panel = useTemplateRef<HTMLElement>('panel');

/**
 * Move focus into the banner when it is REOPENED from the footer, and only
 * then — the watcher is not `immediate`, so the banner a first-time visitor
 * meets never steals focus from the page they came to read. Reopening, by
 * contrast, is something the visitor just asked for with a click, and a
 * keyboard user needs to land where they sent themselves.
 *
 * ⚠️ The region itself takes focus (`tabindex="-1"`), not one of the buttons:
 * focusing "Aceptar" would put a thumb on the scale, and focusing "Rechazar"
 * would put it on the other one.
 */
watch(
  () => consent.isPromptVisible,
  async (visible) => {
    if (!visible) return;
    await nextTick();
    panel.value?.focus();
  },
);
</script>

<template>
  <Transition name="consent">
    <div v-if="consent.isPromptVisible" class="grav-consent">
      <section
        ref="panel"
        class="grav-consent__panel bg-surface elevation-8"
        tabindex="-1"
        :aria-labelledby="titleId"
        data-testid="consent-banner"
        @keydown.esc="consent.dismissPrompt()"
      >
        <div class="grav-consent__copy">
          <GravTitle :id="titleId" :level="2" size="sm" class="grav-consent__title">
            Cookies de analítica
          </GravTitle>
          <p class="grav-consent__text">
            Uso Google Analytics para saber cuánta gente pasa por aquí y qué páginas mira. Para eso
            guarda cookies en tu navegador. Si lo rechazas no se carga nada y la web funciona igual;
            puedes cambiar de opinión cuando quieras desde el pie de página.
          </p>
        </div>

        <!-- ⚠️ Identical props on both. If one ever grows an `elevation`, a
             bigger `size` or a brighter colour, the choice stops being a choice
             and `__tests__/consent-banner.spec.ts` fails. -->
        <div class="grav-consent__actions">
          <v-btn
            color="primary"
            variant="flat"
            size="large"
            data-testid="consent-accept"
            @click="consent.accept()"
          >
            Aceptar
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            size="large"
            data-testid="consent-reject"
            @click="consent.reject()"
          >
            Rechazar
          </v-btn>
        </div>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
/* Below the app bar's stacking order, exactly as the toasts are: the banner
   sits at the bottom of the viewport and the navigation at the top, so they
   never meet — and a z-index above it would put a cookie banner over the site's
   navigation the first time anything grew tall enough. */
.grav-consent {
  position: fixed;
  inset-inline: 0;
  bottom: 0;
  z-index: 1000;
  display: flex;
  justify-content: center;
  padding: 1rem;
  /* The container spans the viewport; without this its padding would swallow
     clicks on whatever sits under the gaps around the panel. */
  pointer-events: none;
}

.grav-consent__panel {
  pointer-events: auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem 1.5rem;
  width: 100%;
  max-width: 64rem;
  padding: 1.25rem 1.5rem;
  border-radius: 4px;
  /* It floats over a dark gradient rather than over a page. */
  box-shadow: 0 4px 12px rgb(0 0 0 / 45%);
}

/* Focused programmatically when reopened; the browser's own ring is the only
   thing that tells a keyboard user they arrived. */
.grav-consent__panel:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

.grav-consent__copy {
  flex: 1 1 22rem;
}

/* A title on a light card surface is red and drops the stage's hard shadow.
   This panel is one, so its title follows the same treatment. */
.grav-consent__title {
  margin-bottom: 0.35rem;
  color: rgb(var(--v-theme-primary));
  text-shadow: none;
}

.grav-consent__text {
  margin: 0;
  line-height: 1.5;
}

.grav-consent__actions {
  display: flex;
  flex: 0 0 auto;
  gap: 0.75rem;
}

/* ── Enter / leave ────────────────────────────────────────────────────────── */
.consent-enter-active,
.consent-leave-active {
  transition:
    opacity 200ms ease,
    transform 200ms ease;
}

.consent-enter-from,
.consent-leave-to {
  opacity: 0;
  transform: translateY(1rem);
}

@media (prefers-reduced-motion: reduce) {
  .consent-enter-active,
  .consent-leave-active {
    transition: none;
  }
}

/* The mobile breakpoint the rest of the app steps down at. The
   two buttons go full width and share the row rather than being squeezed to the
   corner — on a phone that is what keeps them the same size as each other. */
@media (max-width: 768px) {
  .grav-consent {
    padding: 0.75rem;
  }

  .grav-consent__panel {
    padding: 1rem;
  }

  .grav-consent__actions {
    flex: 1 1 100%;
  }

  .grav-consent__actions .v-btn {
    flex: 1 1 0;
  }
}
</style>
