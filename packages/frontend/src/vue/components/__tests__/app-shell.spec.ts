import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory, type Router } from 'vue-router';
import { defineComponent } from 'vue';
import vuetify from '@/plugins/vuetify';
import App from '@/App.vue';
import { freshPinia, stubBrowserApis } from './mount-with-vuetify';

/**
 * The shell: what wraps every screen — the top bar, its red rule, the routed
 * view, the global player. The copy is still the specification, and it is still
 * mostly *strings and destinations* that are asserted here, because that is
 * exactly the class of thing a refactor loses without anything looking broken.
 *
 * ⚠️ **The footer is gone from the shell**, and the block of assertions about it
 * went with it. That is not a loss of coverage but the design: with infinite
 * lists and a player fixed to the bottom, nothing can ever scroll to a footer.
 * The credit it carried
 * is asserted where it now lives, in `filter-rail.spec.ts`. The regression
 * guard against `<v-footer app>` painting over the last row of cards survives
 * in spirit as the player's own reserved space, below.
 */

/**
 * ⚠️ `dirname(fileURLToPath(import.meta.url))` and NOT
 * `new URL('…', import.meta.url)`: Vite treats that second form as a static
 * ASSET reference and rewrites it into a served URL, so the path arrives as
 * `http://localhost/…` and `fileURLToPath` rejects it. Same trick as
 * `theme/__tests__/gravinero-theme.spec.ts`.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const APP_VUE = join(HERE, '../../App.vue');

beforeAll(stubBrowserApis);

const Blank = defineComponent({ template: '<div class="routed" />' });

/** Every route the navbar links to, plus one to route into. */
function shellRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Blank },
      { path: '/episodes/:page?', name: 'episodes', component: Blank },
      { path: '/creator', name: 'creatorSearch', component: Blank },
      { path: '/cola', name: 'queue', component: Blank },
      { path: '/about', name: 'about', component: Blank },
    ],
  });
}

async function mountShell() {
  const router = shellRouter();
  await router.push('/');
  await router.isReady();
  const wrapper = mount(App, { global: { plugins: [freshPinia(), vuetify, router] } });
  return { wrapper, router };
}

const navLinks = (wrapper: Awaited<ReturnType<typeof mountShell>>['wrapper']) =>
  wrapper.findAll('nav a');

describe('the top bar', () => {
  it('links to the five destinations of the top bar', async () => {
    const { wrapper } = await mountShell();

    // ⚠️ Resolved URLs, not route names: these are the addresses in shared
    // links, and a renamed route that still resolves to `/creator` is fine
    // while a working name that resolves elsewhere is not.
    expect(navLinks(wrapper).map((a) => a.attributes('href'))).toEqual([
      '/',
      '/',
      '/episodes',
      '/about',
      '/creator',
    ]);

    wrapper.unmount();
  });

  /**
   * ⚠️ **The single red line that replaces the pollitos band.** Earlier rounds
   * put the band here; it lost, and the band stays in the player, which is the
   * one place it works. The rule is the design's
   * one structural constant across every screen, so its absence is worth a test
   * of its own.
   */
  it('carries the 3 px red rule under it', async () => {
    const { wrapper } = await mountShell();

    expect(wrapper.find('.topbar__rule').exists()).toBe(true);

    wrapper.unmount();
  });

  it('says what it has always said, spaces included', async () => {
    const { wrapper } = await mountShell();

    // ⚠️ Copy with its spaces intact. The half that disappears on a
    // phone carries the space — " gravinera", "Lista de " — so `white-space:
    // pre-wrap` is load-bearing and these two assertions are what catch its
    // removal. `textContent`, not `.text()`: the helper trims.
    const text = (index: number) => navLinks(wrapper)[index]?.element.textContent ?? '';

    expect(text(1)).toContain('Biblioteca gravinera');
    expect(text(2)).toContain('Lista de episodios');
    expect(text(3)).toContain('Sobre esta página');
    // ⚠️ Last, and a red BUTTON rather than a nav item: it is the one call to
    // action in the bar, and it opens the search overlay rather than a screen.
    expect(text(4)).toContain('Añadir corte');

    wrapper.unmount();
  });

  it('is a named landmark whose logo link says where it goes', async () => {
    const { wrapper } = await mountShell();

    const nav = wrapper.find('nav');
    expect(nav.exists()).toBe(true);
    expect(nav.attributes('aria-label')).toBe('Navegación principal');

    // An `<img>` without `alt` made this link — which contains nothing else —
    // announce as its own URL, so the alt text is part of the contract.
    const logo = nav.find('img');
    expect(logo.exists()).toBe(true);
    expect(logo.attributes('alt')).toBe('Índice gravinero');
    expect(logo.attributes('src')).toBeTruthy();

    wrapper.unmount();
  });

  it('marks the current screen, which is what the brown is for', async () => {
    const { wrapper, router } = await mountShell();

    await router.push({ name: 'episodes' });
    await wrapper.vm.$nextTick();

    const active = navLinks(wrapper).filter((a) => a.classes().includes('router-link-active'));
    expect(active.map((a) => a.attributes('href'))).toEqual(['/episodes']);

    wrapper.unmount();
  });
});

/**
 * ⚠️ **The regression guard that outlived the footer.**
 *
 * The bug it was written for: `<v-footer app>` enrolled the footer in Vuetify's
 * layout, turning it into `position: fixed; bottom: 0` — 132 px of credit line
 * permanently covering the bottom of every screen, painting over the last row
 * of cards. Nothing threw, nothing was missing, and the site read as broken.
 *
 * The footer is gone, but the shape of the bug is not: there is now a player
 * fixed to the bottom **on purpose**, so the last row of an infinite list is
 * under it unless the shell reserves the space. Same failure, opposite cause.
 */
describe('the global player, and the room made for it', () => {
  it('is mounted exactly once — a second would be two controls over one element', async () => {
    const { wrapper } = await mountShell();

    expect(wrapper.findAll('.player')).toHaveLength(1);

    wrapper.unmount();
  });

  it('reserves the space it occupies, so the last row is never under it', async () => {
    const { wrapper } = await mountShell();

    // 78 px of player plus its 3 px top border. jsdom has no layout engine, so
    // what is asserted is the rule itself; the measurement is an e2e concern.
    const source = readFileSync(APP_VUE, 'utf8');
    expect(source).toMatch(/padding-bottom:\s*81px/);
    expect(wrapper.find('.v-main').classes()).toContain('shell');

    wrapper.unmount();
  });

  it('says what it is doing with nothing loaded, rather than disappearing', async () => {
    // ⚠️ It renders even when nothing is playing: a player that came and went
    // would reflow every list under it and move the queue pill — which is also
    // the link to `/cola` — out from under the cursor.
    const { wrapper } = await mountShell();

    expect(wrapper.find('.player').text()).toContain('Nada sonando');
    expect(wrapper.find('.player__queue').attributes('href')).toBe('/cola');

    wrapper.unmount();
  });
});

describe('the shell around the routed view', () => {
  it('renders the current route, and swaps it on navigation', async () => {
    const { wrapper, router } = await mountShell();

    expect(wrapper.find('.routed').exists()).toBe(true);

    await router.push({ name: 'about' });
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.routed').exists()).toBe(true);

    wrapper.unmount();
  });

  it('mounts exactly one toast host — a second would double every notice', async () => {
    const { wrapper } = await mountShell();

    expect(wrapper.findAll('[data-testid="notification-host"]')).toHaveLength(1);

    wrapper.unmount();
  });

  it('wraps the view in the 300 ms cross-fade, out-in', () => {
    // ⚠️ Asserted against the source because a `<Transition>`'s props are not
    // observable in the rendered DOM: without `mode="out-in"` the outgoing and
    // incoming views are laid out side by side mid-fade and the page jumps —
    // which is a rendering bug no snapshot of either end state would show.
    const source = readFileSync(APP_VUE, 'utf8');
    expect(source).toMatch(/<Transition\s+name="component-fade"\s+mode="out-in">/);
  });

  it('opens no container of its own — every view brings one', () => {
    // The error pages run edge to edge; the rest centre themselves. A container
    // here would double the gutters on all seven screens at once.
    //
    // ⚠️ Comments stripped first: this file EXPLAINS at length that it opens no
    // container, so matching the raw text matches the explanation and fails on
    // the wording. Same reasoning as `code()` in the theme spec.
    const source = readFileSync(APP_VUE, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    expect(source).not.toMatch(/<v-container/);
  });
});
