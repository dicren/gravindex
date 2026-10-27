<script setup lang="ts">
/**
 * The shell: header, red rule, routed view, global player, toasts.
 *
 * ⚠️ **The footer is gone from here**, and that is a consequence of the design
 * rather than a tidy-up: with infinite lists and a player fixed to the bottom,
 * nothing can ever scroll to a footer. The credit it carried — who owns the
 * content, which build this is, the analytics preference — moved into the filter
 * rail (`FilterRail.vue`) and, for the screens with no rail, onto `/about`.
 *
 * ⚠️ **`<GlobalPlayer>` is mounted ONCE, here, exactly like the notification
 * host.** It reads the queue and playback stores and owns no state of its own,
 * so a second one would be a second set of controls over one audio element. The
 * body's bottom padding is what keeps the last row of every list above it.
 *
 * ⚠️ `<NotificationHost>` and `<ConsentBanner>` are unchanged and mounted once
 * for the same reason: the store is a queue with no opinion about the DOM, and
 * two banners would be two questions about one decision.
 *
 * ⚠️ `startAnalytics` is the app's ONLY analytics wiring and deliberately lives
 * at the shell level rather than in `main.ts`: it needs the router (page views)
 * and a store (the consent decision), and it must be torn down with the app that
 * owns them. It loads NOTHING by itself — with no `VITE_GA4_ID`, or with no
 * decision recorded, it watches a flag that never turns on and the site makes
 * not one request to Google.
 *
 * ⚠️ `startAppUpdates` is here for exactly the same reasons, and it draws
 * NOTHING. It keeps the app on the newest build and applies a new one silently —
 * there is no "a new version is available" notice anywhere in this app, by
 * decision. It needs the router and the playback store because it must not
 * reload the page while a three-hour episode is sounding or while somebody has
 * an unpublished cut open in the editor; see `pwa/start-app-updates.ts`. In a
 * dev build it registers nothing at all.
 *
 * ⚠️ `startMediaSession` is here for the same reason, and it draws nothing
 * either. It projects the queue and the player onto `navigator.mediaSession` —
 * the lock screen's title, cover and transport — which is the ONLY way the
 * browser offers a next button while the screen is off. It is mounted at the
 * shell because what it describes outlives every screen; where there is no
 * media session it returns a no-op and the app is untouched.
 *
 * ⚠️ `<EpisodeSearchOverlay>` is mounted here for the same reason and one more:
 * `Añadir corte` opens over the screen you were on, so it cannot live inside any
 * of them. It watches the route rather than a flag, which is what makes
 * browser-back close it.
 *
 * ⚠️ `useQueueHydration` runs here because the queue survives a reload as a list
 * of ids and something has to turn them back into clips before the player can
 * show one. It is idempotent and silent — see the composable.
 *
 * ⚠️ `startPlaybackReconciliation` is the app's half of "a system pause is not a
 * stop". It listens for the page coming back (`visibilitychange`, `resume`,
 * `pageshow`) and puts intention and element state together again, so a phone
 * call, disconnected headphones or a frozen tab no longer need a reload to keep
 * listening. It also arms the hidden-page watchdog. Nothing is drawn; in a
 * browser that fires none of those events it costs three listeners and nothing
 * else. See `stores/playback.store.ts`.
 */
import { onUnmounted } from 'vue';
import { useRouter } from 'vue-router';

import AppHeader from '@/components/AppHeader.vue';
import ConsentBanner from '@/components/ConsentBanner.vue';
import EpisodeSearchOverlay from '@/components/EpisodeSearchOverlay.vue';
import GlobalPlayer from '@/components/GlobalPlayer.vue';
import NotificationHost from '@/components/NotificationHost.vue';
import { useQueueHydration } from '@/composables/use-queue-hydration';
import { startAnalytics } from '@/analytics/start-analytics';
import { startMediaSession } from '@/media-session/start-media-session';
import { startPlaybackReconciliation } from '@/stores/playback.store';
import { startAppUpdates } from '@/pwa/start-app-updates';

const stopAnalytics = startAnalytics(useRouter());
onUnmounted(stopAnalytics);

const stopAppUpdates = startAppUpdates(useRouter());
onUnmounted(stopAppUpdates);

const stopMediaSession = startMediaSession();
onUnmounted(stopMediaSession);

const stopReconciliation = startPlaybackReconciliation();
onUnmounted(stopReconciliation);

useQueueHydration();
</script>

<template>
  <v-app>
    <AppHeader />

    <v-main class="shell">
      <!-- The 300 ms cross-fade on every navigation (`transitions.css`). `mode="out-in"` matters: without it the outgoing
           and incoming views are laid out side by side mid-fade and the page
           jumps. -->
      <RouterView v-slot="{ Component }">
        <Transition name="component-fade" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </v-main>

    <GlobalPlayer />

    <!-- ⚠️ Mounted at the shell, not inside a view, because it draws OVER
         whatever screen is underneath — that is the whole of option B. It shows
         itself when the route is `creatorSearch` and renders nothing otherwise.
    -->
    <EpisodeSearchOverlay />

    <NotificationHost />

    <ConsentBanner />
  </v-app>
</template>

<style scoped>
/* ⚠️ 78 px of player plus 3 px of air, and the padding is what keeps the last
   row of an infinite list reachable. There is no footer to absorb it any more,
   so without this the final clip of every list sits under the transport that
   plays it. (The 3 px used to be the player's top border; it is the progress
   bar now, drawn INSIDE those 78 px — the spare 3 px stayed because the seek
   handle straddles that line and wants room above it.) */
.shell {
  padding-bottom: 81px;
}
</style>
