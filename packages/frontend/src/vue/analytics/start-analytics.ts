import { watch } from 'vue';
import type { Router } from 'vue-router';

import { useConsentStore } from '@/stores/consent.store';
import { loadAnalytics, trackPageView, unloadAnalytics } from './ga4';

/**
 * The one wire between the decision and the tag.
 *
 * `consent.store.ts` records what the visitor chose and knows nothing about
 * Google; `ga4.ts` loads and unloads the tag and knows nothing about Pinia. This
 * function is the join, and it is the ONLY place either half is triggered — so
 * "analytics follows consent" is a property of one twelve-line watcher instead
 * of a rule every caller has to remember.
 *
 * Mounted once, from `App.vue`. It returns its own teardown.
 *
 * ⚠️ One `page_view` per navigation, and nothing else: no play events, no
 * vote events, no clip or tag content — see `ga4.ts` on why.
 */
export function startAnalytics(router: Router): () => void {
  const consent = useConsentStore();

  /**
   * ⚠️ The initial navigation can reach `afterEach` *after* this function has
   * already sent a page view for the same URL (the router's first resolution is
   * asynchronous, and a visitor whose consent is restored from storage is
   * tracked the moment the watcher runs). Both paths produce the same absolute
   * URL, so remembering the last one is what keeps the entry screen from being
   * counted twice.
   */
  let lastTracked: string | null = null;

  function track(pageLocation: string): void {
    if (pageLocation === lastTracked) return;
    lastTracked = pageLocation;
    trackPageView(pageLocation);
  }

  const stopWatching = watch(
    () => consent.granted,
    (granted) => {
      if (granted) {
        loadAnalytics();
        track(window.location.href);
      } else {
        // Withdrawal. ⚠️ `lastTracked` is cleared too: accepting again on the
        // same page must record that page, and the dedupe above would otherwise
        // swallow it.
        lastTracked = null;
        unloadAnalytics();
      }
    },
    // `immediate`, because a returning visitor's consent comes out of
    // `localStorage` before the first frame — that is the "a reload does not ask
    // again" half of the requirement, and it must load without a click.
    { immediate: true },
  );

  const stopHook = router.afterEach((to) => {
    if (!consent.granted) return;
    // ⚠️ Built from the resolved route rather than read off `window.location`:
    // the hook runs after the URL has changed, but only the route object is
    // guaranteed to be the one that was just navigated to.
    track(new URL(to.fullPath, window.location.origin).href);
  });

  return () => {
    stopWatching();
    stopHook();
  };
}
