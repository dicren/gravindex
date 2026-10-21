<script setup lang="ts">
/**
 * The toast container — the missing half of `notifications.store.ts`.
 *
 * ⚠️ Until this component existed, **every notice in the app was invisible**.
 * The store worked, the screens pushed into it correctly, and nothing rendered:
 * "¡No puedes votar dos veces!", "Enlace copiado al portapapeles." and every API
 * error reached the queue and died there. One host, mounted once in the shell,
 * is what turns that queue into a user interface.
 *
 * ⚠️ **Plain text, and it must stay that way.** Rendering these strings as HTML
 * (`v-html`) would be a stored-XSS sink: they are built from API error payloads,
 * which quote user-submitted clip titles and free-text tags typed by anonymous
 * visitors. Both halves below are interpolations, so Vue
 * escapes them, and `__tests__/notification-host.spec.ts` fails if markup ever
 * renders as markup again. Do not reach for `v-html`, a sanitiser, or a
 * "just this one bold bit" exception: `title` IS that bold bit, as its own
 * element.
 *
 * ── Where it sits, and why it moved (2026-08-26) ─────────────────────────────
 *
 * ⚠️ **Recorded deviation: the notices are anchored to the TOP.** A bottom-edge
 * placement became wrong once the player was fixed to the bottom of every
 * screen: `bottom: 2.5rem` (1.5 rem on a phone)
 * against a 78 px transport at `z-index: 4` meant a notice did not sit *near*
 * the player, it sat **on top of the play button** — and the bottom edge was by
 * then carrying the player and the consent banner as well. The top edge carries
 * one thing, the 3 px red rule, and the notice hangs from it.
 *
 * ⚠️ **56 px of bar + 3 px of rule + 12 px of air = the 71 px below.** On a
 * phone the bar is `position: static` and scrolls away (`AppHeader.vue`), so
 * that number stops meaning "under the rule" and becomes a plain inset from the
 * top of the window — which is the reason it is a single value for both and not
 * a media query: the notice never covers the navigation in either case.
 *
 * ⚠️ **One panel, both widths.** `min(25rem, calc(100vw - 24px))` is the whole
 * of the responsive behaviour: a column against the right edge on a desktop,
 * the width of the screen minus its margins on a phone. No breakpoint, because
 * there is nothing to switch — the design is the same object at two sizes.
 *
 * Three behaviours are deliberate and worth keeping:
 *
 * - **click anywhere to pin** (`noRemoveNotification`) — the reader is still
 *   reading, so the countdown stops. It stays a mouse affordance: there is no
 *   keyboard equivalent, and the close button is the
 *   real control. That is why the toast is a plain `<div>` and not a `<button>`
 *   with a second button nested inside it.
 * - **a close button** (`removeNotification`), now with an accessible name —
 *   an unlabelled `<button>` announces as nothing at all.
 * - **a three-line cap with a scroll** for the one enormous API error.
 *
 * ⚠️ **One live region, and it is this container — not the toasts.** The region
 * has to be in the DOM *before* the text arrives for a screen reader to notice
 * the change, which a per-toast `role="alert"` cannot guarantee (it is inserted
 * already populated). Keeping it here also means exactly one live region
 * instead of one per toast nested inside another, which is where assistive
 * technologies start disagreeing with each other. `aria-atomic="false"` so a
 * second notice does not re-announce the first.
 *
 * ⚠️ The container is `pointer-events: none` and the toasts re-enable it: it is
 * a column laid over the right-hand end of every list row — the share, download
 * and queue buttons — and without that it would swallow clicks on whatever sits
 * in the gaps between notices.
 */
import { useNotificationsStore, type NotificationLevel } from '@/stores/notifications.store';

const notifications = useNotificationsStore();

/**
 * The level, as a word.
 *
 * ⚠️ **It replaces the decorative `mdi-` icon**, and that is the point rather
 * than a saving: the icon was `aria-hidden` and said nothing, so severity was
 * carried by colour alone for anyone who does not read colour. league-gothic in
 * caps is also how the rest of the site sets its labels — the nav, the buttons
 * and every title are the same face.
 */
const LEVEL_LABEL: Record<NotificationLevel, string> = {
  info: 'Info',
  success: 'Hecho',
  warning: 'Aviso',
  error: 'Error',
};

/**
 * The level's colour, straight out of the theme.
 *
 * ⚠️ A custom property rather than four classes, and **never a hex**: the four
 * levels resolve to `--v-theme-info|success|warning|error`, i.e. to the palette
 * that `gravinero-theme.ts` defines. The
 * component names no colour at all, which is what
 * `theme/__tests__/gravinero-theme.spec.ts` requires of every component.
 */
const levelStyle = (level: NotificationLevel) => ({
  '--grav-notification-level': `rgb(var(--v-theme-${level}))`,
});
</script>

<template>
  <div
    class="grav-notifications"
    role="status"
    aria-live="polite"
    aria-atomic="false"
    data-testid="notification-host"
  >
    <TransitionGroup name="notifications" tag="div" class="grav-notifications__list">
      <div
        v-for="item of notifications.items"
        :key="item.id"
        class="grav-notification grav-panel"
        :class="`grav-notification--${item.level}`"
        :style="levelStyle(item.level)"
        @click="notifications.pin(item.id)"
      >
        <span class="grav-notification__level">{{ LEVEL_LABEL[item.level] }}</span>

        <p class="grav-notification__body grav-scroll-brown">
          <strong v-if="item.title" class="grav-notification__title">{{ item.title }}</strong>
          <span class="grav-notification__text">{{ item.text }}</span>
        </p>

        <button
          type="button"
          class="grav-notification__close"
          aria-label="Cerrar notificación"
          @click.stop="notifications.dismiss(item.id)"
        >
          <v-icon icon="mdi-close" size="16" aria-hidden="true" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
/* ⚠️ Above the sticky bar's `z-index: 5` and above the `creator` overlay's 20,
   because a notice raised while either is on screen has to be readable — a
   failed write behind the thing that caused it is a notice nobody sees. The two
   never actually meet: the column starts 12 px below the rule. */
.grav-notifications {
  position: fixed;
  top: 71px;
  right: 12px;
  width: min(25rem, calc(100vw - 24px));
  z-index: 1000;
  pointer-events: none;
}

.grav-notifications__list {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

/* `.grav-panel` — the stage panel with its brown hairline — is the ground, and
   reusing it is the decision rather than an economy: the clip permalink's hero
   and the editor are made of the same object, so a notice reads as a piece of
   this site instead of as a Material toast in the theme's colours. What is
   added here is the level's 2 px cap, the drop shadow (it floats over a list,
   not over a page) and the row layout. */
.grav-notification {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
  border-top: 2px solid var(--grav-notification-level);
  box-shadow: 0 10px 24px rgb(0 0 0 / 55%);
  cursor: pointer;
}

/* ⚠️ `min-width` so the four words line their bodies up: `INFO` is a letter
   shorter than the other three and a stack of notices otherwise starts its text
   at two different x positions. */
.grav-notification__level {
  flex: 0 0 auto;
  min-width: 3.1rem;
  font-family: var(--grav-font-title);
  font-size: 1rem;
  line-height: 1.35;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--grav-notification-level);
}

/* A notice is capped at three lines and scrolls the rest, so one enormous API
   error cannot take the screen. ⚠️ `.grav-scroll-brown`, not `.grav-scroll`:
   the latter is drawn for a white card and paints a `#f5f5f5` track, which on
   this panel is a bright bar down the side of the text. */
.grav-notification__body {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: 0.92rem;
  line-height: 1.45;
  max-height: 4.5rem;
  overflow-y: auto;
  overflow-wrap: anywhere;
  color: rgba(var(--v-theme-on-stage-panel), 0.88);
}

.grav-notification__title {
  display: block;
  font-weight: 600;
  color: var(--grav-brown);
}

/* ⚠️ **The global button reset does NOT reach this one, and the reason is a
   trap worth knowing**: `gravinero.css` resets `button:not([class*='v-'])` to
   keep Vuetify's own buttons out of it — and every class in this design system
   starts with `gra`**`v-`**, so a `<button class="grav-…">` is excluded by the
   very guard that protects `<v-btn>`. Without the three declarations below the
   close button renders as the UA's grey box on the panel, which is exactly how
   it first looked. */
.grav-notification__close {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  background: none;
  border: 0;
  border-radius: 3px;
  color: var(--grav-brown);
  opacity: 0.75;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.grav-notification__close:hover,
.grav-notification__close:focus-visible {
  opacity: 1;
}

/* ── Enter / leave ────────────────────────────────────────────────────────
 * Animating `max-height` from 0 never actually runs (there is no height to
 * interpolate towards). A notice arrives from the edge it is anchored to, and `move` is what stops the survivors from jumping
 * when one in the middle of the stack is dismissed.
 */
.notifications-enter-active,
.notifications-leave-active,
.notifications-move {
  transition:
    opacity 200ms ease,
    transform 200ms ease;
}

.notifications-enter-from,
.notifications-leave-to {
  opacity: 0;
  transform: translateX(1.5rem);
}

@media (prefers-reduced-motion: reduce) {
  .notifications-enter-active,
  .notifications-leave-active,
  .notifications-move {
    transition: none;
  }
}
</style>
