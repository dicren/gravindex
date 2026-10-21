import { createRouter, createMemoryHistory, type Router } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent } from 'vue';

/**
 * The three things every component in this package needs before it will mount,
 * in one place instead of copied into six spec files.
 *
 * ⚠️ Not a test file: Vitest only collects `*.spec.ts`, so this sits alongside
 * them the way `core/application/clips/__tests__/clip-repository.stub.ts` does.
 */

/**
 * ⚠️ jsdom has neither `matchMedia` nor `ResizeObserver`, and Vuetify's
 * `useDisplay` reads the first on setup — so a `<v-pagination>` or anything
 * inside `<v-app>` throws on mount without these. The stub reports "not
 * mobile", which is the layout the assertions are written against.
 */
export function stubBrowserApis(): void {
  // ⚠️ jsdom reports 1024px and Vuetify's default `mobileBreakpoint` is `lg`
  // (1280), so every component under test believes it is on a phone — a
  // `<v-pagination>` then renders three page buttons instead of seven. The
  // `resize` event is not optional: Vuetify reads `window.innerWidth` ONCE when
  // `createVuetify` runs, which is at import time, long before this hook.
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  window.dispatchEvent(new Event('resize'));

  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof window.ResizeObserver;
  }
  // ⚠️ Vuetify's overlay positioning reads the BARE global `visualViewport`, so
  // an undefined one is a `ReferenceError` rather than a falsy check — every
  // test that opens a menu (any combobox Enter) dies without this.
  if (!('visualViewport' in window)) {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        width: 1024,
        height: 768,
        offsetLeft: 0,
        offsetTop: 0,
        scale: 1,
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
  }
}

/** A fresh Pinia for each test, so stores never leak state between them. */
export function freshPinia(): ReturnType<typeof createPinia> {
  const pinia = createPinia();
  setActivePinia(pinia);
  return pinia;
}

const Blank = defineComponent({ template: '<div />' });

/**
 * A router with just the routes the components under test link to.
 *
 * ⚠️ Deliberately not `@/router`: that one lazy-imports every view, so a card
 * test would pull the editor and the whole episode screen into the module graph
 * to render one `<RouterLink>`.
 */
export function testRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Blank },
      { path: '/episodes/:page?', name: 'episodes', component: Blank },
      // The calendar is the same screen drawn by date; the view switch and the
      // year stepper both navigate to it.
      { path: '/episodes/calendario/:year?', name: 'episodesCalendar', component: Blank },
      { path: '/episode/:title', name: 'episode', component: Blank },
      // ⚠️ The rows and the chassis link to these three as well: an
      // episode row offers `Cortar`, the header offers `Añadir corte`, and the
      // player's pill IS the link to the queue. A router without them makes
      // every one of those a "No match" at mount time.
      { path: '/creator', name: 'creatorSearch', component: Blank },
      { path: '/creator/:title', name: 'creator', component: Blank },
      { path: '/cola', name: 'queue', component: Blank },
      { path: '/about', name: 'about', component: Blank },
      { path: '/:id', name: 'clip', component: Blank },
    ],
  });
}
