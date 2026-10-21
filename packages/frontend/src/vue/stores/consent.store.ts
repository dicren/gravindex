import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { isAnalyticsConfigured } from '@/analytics/ga4';

/**
 * What the visitor decided. `unknown` is the state of somebody who has not been
 * asked yet, or who closed the banner without choosing — it is **not** consent,
 * and it is not a refusal either, so the banner comes back on the next visit.
 */
export type ConsentDecision = 'granted' | 'denied';
export type ConsentStatus = ConsentDecision | 'unknown';

/**
 * ⚠️ Namespaced, and deliberately nowhere near `gravindex.voter-token`. The two
 * are different things with different lifetimes: one is an anonymous
 * deduplication hint for votes, the other an analytics decision. Nothing reads
 * both (root `AGENTS.md`, "Identity"), and withdrawing consent does not touch
 * the token.
 */
const STORAGE_KEY = 'gravindex.analytics-consent';

function isDecision(value: unknown): value is ConsentDecision {
  return value === 'granted' || value === 'denied';
}

/**
 * ⚠️ Reading `localStorage` can throw before you ever call a method on it —
 * Safari with "block all cookies", a sandboxed iframe — so the property access
 * itself is inside the `try`. Same shape as
 * `core/infrastructure/identity/local-storage-voter-token.provider.ts`.
 */
function readStoredStatus(): ConsentStatus {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isDecision(stored) ? stored : 'unknown';
  } catch {
    return 'unknown';
  }
}

function writeStoredStatus(status: ConsentDecision): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, status);
  } catch {
    // Private windows, quota, disabled storage. The decision still holds for
    // this page — it simply will not survive a reload, and being asked again is
    // the safe end of that failure.
  }
}

/**
 * The analytics consent decision, and whether the banner is on screen.
 *
 * ⚠️ **Client state with no server behind it**, which is why it is a plain Pinia
 * store next to `notifications.store.ts` and `playback.store.ts` rather than
 * anything in `core/` (`packages/frontend/AGENTS.md`, "Where Pinia Colada
 * lives"). Nothing about a cookie choice is ever sent anywhere.
 *
 * ⚠️ **This store has no side effects on Google.** It records a decision;
 * `analytics/start-analytics.ts` watches it and is the only thing that loads or
 * unloads the tag. Keeping the two apart is what lets the decision be tested
 * without a DOM and the loading be tested without a store — and it means no
 * caller can flip the flag while forgetting the tag, or the other way round.
 */
export const useConsentStore = defineStore('consent', () => {
  const status = ref<ConsentStatus>(readStoredStatus());

  /**
   * Is there anything to consent TO? With no `VITE_GA4_ID` the app loads no
   * analytics and sets no cookie, so asking would be theatre — a banner about
   * cookies that do not exist. Everything below is gated on this.
   */
  const configured = computed(() => isAnalyticsConfigured());

  /**
   * Banner visibility, and the reason it is separate from `status`: the banner
   * opens on a first visit (nothing decided) AND whenever the footer asks for it
   * again (a decision exists and is being revisited). Closing it without
   * choosing changes nothing that is stored.
   */
  const promptOpen = ref(status.value === 'unknown');

  const granted = computed(() => status.value === 'granted');
  const decided = computed(() => status.value !== 'unknown');
  const isPromptVisible = computed(() => configured.value && promptOpen.value);

  /** Yes. The tag loads from here, and not one moment earlier. */
  function accept(): void {
    status.value = 'granted';
    promptOpen.value = false;
    writeStoredStatus('granted');
  }

  /**
   * No — and the same click is the withdrawal path, chosen from the reopened
   * banner. `start-analytics.ts` reacts by unloading the tag and clearing what
   * it can.
   */
  function reject(): void {
    status.value = 'denied';
    promptOpen.value = false;
    writeStoredStatus('denied');
  }

  /** The footer's "Cambiar": show the banner again, decide nothing yet. */
  function askAgain(): void {
    promptOpen.value = true;
  }

  /**
   * Put the banner away without answering (Escape). ⚠️ Nothing is stored, so
   * this is not a silent "no": the next visit asks again, and until then no
   * analytics loads. A dismissal must never be read as consent.
   */
  function dismissPrompt(): void {
    promptOpen.value = false;
  }

  return {
    status,
    configured,
    granted,
    decided,
    isPromptVisible,
    accept,
    reject,
    askAgain,
    dismissPrompt,
  };
});
