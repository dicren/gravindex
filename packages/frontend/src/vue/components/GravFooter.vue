<script setup lang="ts">
/**
 * The credit line at the bottom of every page.
 *
 * ⚠️ Both sentences are verbatim, the upside-down © and the `&hearts;`
 * included. This is the one place the app says who owns the content, and the
 * attribution to gravina82 is not decoration — the root `AGENTS.md` opens with
 * it. Do not tidy the phrasing.
 *
 * ⚠️ The version is `__APP_VERSION__`, a build-time constant defined in
 * `vite.config.ts` from this package's `package.json`. It is used instead of
 * `process.env`, which cannot survive into a browser bundle. The
 * link around it points at the repository, so "which build am I looking at" is
 * answerable from the page itself — that is the whole point of printing it.
 *
 * ⚠️ The third line is NEW, and it is the half of the consent decision that
 * makes it a decision rather than a one-off ambush: a choice you cannot revisit
 * is not a choice. It states the current answer in words and reopens the banner,
 * from which either option is one click away — including "Rechazar" after having
 * accepted, which is the withdrawal path (the tag is unloaded and its cookies
 * cleared; see `analytics/ga4.ts`).
 *
 * It renders only when there is a `VITE_GA4_ID`. With none, the app loads no
 * analytics at all, so there is no preference to change and saying so would
 * invent one.
 */
import { useConsentStore, type ConsentStatus } from '@/stores/consent.store';

const version = __APP_VERSION__;

const consent = useConsentStore();

/** Three states, because "sin decidir" is a real one: the banner was closed
 *  without an answer, and nothing was loaded or stored. */
const CONSENT_WORDING: Record<ConsentStatus, string> = {
  granted: 'aceptadas',
  denied: 'rechazadas',
  unknown: 'sin decidir',
};
</script>

<template>
  <!--
    ⚠️ NO `app` prop, and it was the first thing tried. `<v-footer app>` joins
    Vuetify's layout, which makes it `position: fixed; bottom: 0` — so a credit
    line 132 px tall sat permanently over the bottom of the library grid,
    hiding a row of cards on every screen. A plain footer is the last element
    in the document and scrolls away with everything else: inside `<v-app>`'s
    flex column it does exactly that, and still sits at the
    bottom of the viewport when a page is short.
  -->
  <v-footer class="grav-footer">
    <div class="grav-footer__inner">
      <p>
        Todo el contenido de esta web es propiedad de
        <a href="https://gravina82.com" target="_blank" rel="noopener noreferrer">gravina82</a>.
      </p>
      <p>
        <span class="grav-copyleft">&copy;</span> Índice gravinero
        <a href="https://github.com/DiCrEn/gravindex" target="_blank" rel="noopener noreferrer"
          >v. {{ version }}</a
        >
        by Dicren with &hearts;
      </p>
      <p v-if="consent.configured" class="grav-footer__consent">
        Cookies de analítica: {{ CONSENT_WORDING[consent.status] }}.
        <!-- ⚠️ A real `<button>`, not an `<a>` with no `href`: an anchor without
             `href` is not reachable from a keyboard. The visible word is short because the footer is a
             credit line; `aria-label` says the whole thing, and CONTAINS the
             visible word so voice control still works (WCAG 2.5.3). -->
        <button
          type="button"
          class="grav-footer__consent-button"
          aria-label="Cambiar preferencia de cookies de analítica"
          @click="consent.askAgain()"
        >
          Cambiar
        </button>
      </p>
    </div>
  </v-footer>
</template>

<style scoped>
/* `.grav-footer` (theme) owns the colours, the padding and the centring; it
   also has to beat the stage's bright-red link rule, which is why its selector
   there carries the same `:not([class*='v-'])` guard. This block only makes the
   Vuetify footer stop painting a surface behind it and stretch full width. */
.grav-footer {
  background: transparent;
}

.grav-footer__inner {
  width: 100%;
}

/* Styled as the footer's own links are — the theme's `.grav-footer a` rule
   cannot reach a `<button>`, and this has to read as part of the credit line
   rather than as a call to action. */
.grav-footer__consent-button {
  color: var(--grav-footer-link);
  text-decoration: underline;
  cursor: pointer;
}

.grav-footer__consent-button:hover,
.grav-footer__consent-button:focus-visible {
  color: var(--grav-footer-link-hover);
}
</style>
