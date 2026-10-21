import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, defineComponent } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

import { startAnalytics } from '@/analytics/start-analytics';
import { useConsentStore } from '@/stores/consent.store';
import { freshPinia } from '@/components/__tests__/mount-with-vuetify';

/**
 * The wire between the decision and the tag, which is where the requirement
 * actually lives: "nothing loads before consent", "a reload does not ask again",
 * "withdrawal stops events". Each of those is a sequence, not a state, so each
 * is a test here rather than in the store's spec or the adapter's.
 */

const MEASUREMENT_ID = 'G-TESTID1234';
const CONSENT_KEY = 'gravindex.analytics-consent';

interface GtagWindow {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
}

const gtagWindow = () => window as Window & GtagWindow;

const scripts = () => [...document.querySelectorAll('script[data-grav-analytics]')];

const pageViews = () =>
  (gtagWindow().dataLayer ?? [])
    .map((entry) => Array.from(entry as ArrayLike<unknown>))
    .filter((call) => call[1] === 'page_view');

const Blank = defineComponent({ template: '<div />' });

function testRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Blank },
      { path: '/about', name: 'about', component: Blank },
      { path: '/123', name: 'clip', component: Blank },
    ],
  });
}

/** Start the app's analytics wiring the way `App.vue` does. */
async function start(stored?: 'granted' | 'denied') {
  localStorage.clear();
  if (stored !== undefined) localStorage.setItem(CONSENT_KEY, stored);

  freshPinia();
  const router = testRouter();
  await router.push('/');
  await router.isReady();

  const stop = startAnalytics(router);
  await nextTick();

  return { router, stop, consent: useConsentStore() };
}

beforeEach(() => {
  vi.stubEnv('VITE_GA4_ID', MEASUREMENT_ID);
});

afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
  for (const script of scripts()) script.remove();
  delete gtagWindow().dataLayer;
  delete gtagWindow().gtag;
  delete (window as unknown as Record<string, unknown>)[`ga-disable-${MEASUREMENT_ID}`];
});

describe('a first visit', () => {
  it('loads nothing at all until the visitor accepts', async () => {
    const { router, stop } = await start();

    // Starting the app is not consent...
    expect(scripts()).toHaveLength(0);
    expect(gtagWindow().gtag).toBeUndefined();
    expect(document.cookie).toBe('');

    // ...and neither is using it. Three navigations, still nothing.
    await router.push('/about');
    await router.push('/123');
    await router.push('/');

    expect(scripts()).toHaveLength(0);
    expect(gtagWindow().dataLayer).toBeUndefined();
    expect(document.cookie).toBe('');

    stop();
  });

  it('loads exactly one tag when it does accept, and counts that page once', async () => {
    const { consent, stop } = await start();

    consent.accept();
    await nextTick();

    expect(scripts()).toHaveLength(1);
    expect(pageViews()).toHaveLength(1);
    expect(pageViews()[0]?.[2]).toEqual({ page_location: window.location.href });

    stop();
  });

  it('counts one page view per navigation after that', async () => {
    const { router, consent, stop } = await start();

    consent.accept();
    await nextTick();
    expect(pageViews()).toHaveLength(1);

    await router.push('/about');
    expect(pageViews()).toHaveLength(2);
    expect(pageViews()[1]?.[2]).toEqual({ page_location: 'http://localhost:3000/about' });

    await router.push('/123');
    expect(pageViews()).toHaveLength(3);

    stop();
  });
});

describe('coming back later', () => {
  it('loads without asking again when consent was stored', async () => {
    const { consent, stop } = await start('granted');

    // ⚠️ Loaded before any interaction, and the banner never appears: that is
    // what "the choice persists" has to mean on the second visit.
    expect(scripts()).toHaveLength(1);
    expect(consent.isPromptVisible).toBe(false);
    expect(pageViews()).toHaveLength(1);

    stop();
  });

  it('loads nothing, and asks nothing, when the answer was no', async () => {
    const { router, consent, stop } = await start('denied');

    expect(scripts()).toHaveLength(0);
    expect(gtagWindow().gtag).toBeUndefined();
    expect(consent.isPromptVisible).toBe(false);

    await router.push('/about');
    expect(gtagWindow().dataLayer).toBeUndefined();

    stop();
  });
});

describe('withdrawing consent', () => {
  it('unloads the tag and stops sending, mid-session', async () => {
    const { router, consent, stop } = await start('granted');
    expect(scripts()).toHaveLength(1);

    consent.reject();
    await nextTick();

    expect(scripts()).toHaveLength(0);
    expect(gtagWindow().gtag).toBeUndefined();
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${MEASUREMENT_ID}`]).toBe(
      true,
    );

    await router.push('/about');
    expect(gtagWindow().dataLayer).toBeUndefined();

    stop();
  });

  it('can be reversed, and the page the visitor is on is counted again', async () => {
    const { consent, stop } = await start('granted');

    consent.reject();
    await nextTick();
    consent.accept();
    await nextTick();

    expect(scripts()).toHaveLength(1);
    expect(pageViews()).toHaveLength(1);

    stop();
  });
});

describe('with no measurement id', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_GA4_ID', '');
  });

  it('does nothing at all, even for a visitor who accepted before', async () => {
    // The id can disappear from a build: the app must not break, and there is
    // nothing to load with or without a stored decision.
    const { router, consent, stop } = await start('granted');

    expect(scripts()).toHaveLength(0);
    expect(gtagWindow().gtag).toBeUndefined();
    expect(consent.isPromptVisible).toBe(false);

    await router.push('/about');
    expect(gtagWindow().dataLayer).toBeUndefined();

    stop();
  });
});

describe('the teardown it returns', () => {
  it('stops both the consent watcher and the router hook', async () => {
    const { router, consent, stop } = await start();

    stop();

    consent.accept();
    await nextTick();
    await router.push('/about');

    expect(scripts()).toHaveLength(0);
    expect(gtagWindow().dataLayer).toBeUndefined();
  });
});
