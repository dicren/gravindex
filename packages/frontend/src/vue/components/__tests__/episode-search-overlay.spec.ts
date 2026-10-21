import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { computed, defineComponent, ref } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import type { EpisodeListItem } from '#/domain/episodes/episode.entity';
import vuetify from '@/plugins/vuetify';
import EpisodeSearchOverlay from '@/components/EpisodeSearchOverlay.vue';
import { freshPinia, stubBrowserApis } from './mount-with-vuetify';

/**
 * `Añadir corte` — the floating episode search that replaced the picker screen.
 *
 * ⚠️ **Choosing an episode stopped being a screen**: the header's button opens
 * this over whatever you were looking at. `/creator` is still a real route, and
 * that is what makes browser-back close it
 * and a direct link open it over the library rather than a blank page.
 *
 * The three things the design called out are the three blocks below: **focus is
 * trapped and given back**, **`Esc` closes**, and the search is **title-only and
 * says so**.
 */

const episodes = vi.hoisted(() => ({
  results: [] as EpisodeListItem[],
  queries: [] as Record<string, unknown>[],
}));

vi.mock('@/queries/episodes.query', () => ({
  useEpisodeList: (query: () => Record<string, unknown>) => {
    const data = ref({ results: episodes.results, total: episodes.results.length });
    // Record what the overlay asked for, once per read.
    episodes.queries.push(query());
    return { data, isPending: computed(() => false), error: computed(() => null) };
  },
}));

function episode(id: number, title: string, clipCount = 0): EpisodeListItem {
  return {
    id,
    title,
    cover: 'https://example.test/c.jpg',
    file: 'https://example.test/e.mp3',
    originalUrl: 'https://example.test/e',
    date: new Date(2011, 3, 28),
    clipCount,
  };
}

const Blank = defineComponent({ render: () => null });

let router: Router;

async function mountOverlay(url = '/creator'): Promise<VueWrapper> {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Blank },
      { path: '/creator', name: 'creatorSearch', component: Blank },
      { path: '/creator/:title', name: 'creator', component: Blank },
    ],
  });
  await router.push(url);
  await router.isReady();

  const wrapper = mount(EpisodeSearchOverlay, {
    global: { plugins: [freshPinia(), vuetify, router] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

beforeAll(stubBrowserApis);
beforeEach(() => {
  episodes.results = [
    episode(99, 'Episodio 53', 7),
    episode(120, 'Episodio 153 (Chorradas varias)'),
    episode(140, 'Episodio 135 (Cuñadismo)'),
  ];
  episodes.queries = [];
});

describe('when to show itself', () => {
  it('renders nothing on any other route', async () => {
    const wrapper = await mountOverlay('/');

    expect(wrapper.find('.pal').exists()).toBe(false);

    wrapper.unmount();
  });

  it('opens on /creator, over whatever was underneath', async () => {
    const wrapper = await mountOverlay('/creator');

    expect(wrapper.find('.pal').exists()).toBe(true);
    expect(wrapper.find('[role="dialog"]').attributes('aria-modal')).toBe('true');

    wrapper.unmount();
  });
});

describe('the results', () => {
  it('lists episodes with their date and clip count', async () => {
    const wrapper = await mountOverlay();

    const items = wrapper.findAll('.pal__item');
    expect(items).toHaveLength(3);
    expect(items[0]?.text()).toContain('Episodio 53');
    expect(items[0]?.text()).toContain('28 de Abril de 2011');
    expect(items[0]?.text()).toContain('7 cortes');
    // ⚠️ `sin cortes`, not `0 cortes`: 334 of the 395 episodes have none, and
    // this screen exists partly to show that.
    expect(items[1]?.text()).toContain('sin cortes');

    wrapper.unmount();
  });

  it('preselects the first one', async () => {
    const wrapper = await mountOverlay();

    expect(wrapper.findAll('.pal__item')[0]?.classes()).toContain('is-on');

    wrapper.unmount();
  });

  /**
   * ⚠️ **Title-only, and the hint is load-bearing copy.** `GET /episodes?search=`
   * matches the episode title and nothing else — decided again on 2026-08-18
   * rather than widened — so *gazpacho* will not find the Episodio 53 that
   * contains that clip.
   */
  it('says the search only covers the title', async () => {
    const wrapper = await mountOverlay();

    expect(wrapper.find('.pal__foot').text()).toContain('busca solo en el título');

    wrapper.unmount();
  });

  it('asks for a short list rather than a page of a grid', async () => {
    await mountOverlay();

    expect(episodes.queries[0]).toMatchObject({ limit: 8, page: 1 });
  });

  it('says so when nothing matches', async () => {
    episodes.results = [];
    const wrapper = await mountOverlay();

    expect(wrapper.text()).toContain('Ningún episodio se llama así.');

    wrapper.unmount();
  });
});

describe('the keyboard', () => {
  it('moves the selection with the arrows and cuts with Enter', async () => {
    const wrapper = await mountOverlay();
    const dialog = wrapper.find('.pal');

    await dialog.trigger('keydown', { key: 'ArrowDown' });
    expect(wrapper.findAll('.pal__item')[1]?.classes()).toContain('is-on');

    await dialog.trigger('keydown', { key: 'ArrowUp' });
    expect(wrapper.findAll('.pal__item')[0]?.classes()).toContain('is-on');

    await dialog.trigger('keydown', { key: 'Enter' });
    await flushPromises();

    // ⚠️ The frozen `<id>-<slug>` form, so the editor's URL matches every other
    // link to an episode.
    expect(router.currentRoute.value.fullPath).toBe('/creator/99-Episodio-53');

    wrapper.unmount();
  });

  it('does not walk past either end of the list', async () => {
    const wrapper = await mountOverlay();
    const dialog = wrapper.find('.pal');

    for (let i = 0; i < 6; i += 1) await dialog.trigger('keydown', { key: 'ArrowDown' });
    expect(wrapper.findAll('.pal__item')[2]?.classes()).toContain('is-on');

    for (let i = 0; i < 6; i += 1) await dialog.trigger('keydown', { key: 'ArrowUp' });
    expect(wrapper.findAll('.pal__item')[0]?.classes()).toContain('is-on');

    wrapper.unmount();
  });

  it('closes on Escape', async () => {
    const wrapper = await mountOverlay();

    await wrapper.find('.pal').trigger('keydown', { key: 'Escape' });
    await flushPromises();

    // ⚠️ Nothing behind it in this test's history, so it falls back to the
    // library rather than leaving the visitor on a blank page.
    expect(router.currentRoute.value.name).toBe('home');

    wrapper.unmount();
  });

  it('closes on a click outside the panel', async () => {
    const wrapper = await mountOverlay();

    await wrapper.find('.pal').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('home');

    wrapper.unmount();
  });

  it('clicking a result cuts that episode', async () => {
    const wrapper = await mountOverlay();

    await wrapper.findAll('.pal__item')[1]?.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe('/creator/120-Episodio-153-Chorradas-varias');

    wrapper.unmount();
  });
});

describe('focus', () => {
  it('lands in the field when it opens', async () => {
    const wrapper = await mountOverlay();

    expect(document.activeElement).toBe(wrapper.find('.pal__field input').element);

    wrapper.unmount();
  });

  /**
   * ⚠️ **Trapped while open.** One field and a list of buttons, so the cycle is
   * two elements wide: Tab from the last goes to the first, and Shift+Tab from
   * the first goes to the last. Without it, tabbing walks out of the dialog and
   * into the page it is covering.
   */
  it('cycles rather than escaping into the page behind', async () => {
    const wrapper = await mountOverlay();
    const focusable = (wrapper.element as HTMLElement).querySelectorAll<HTMLElement>(
      'input, button',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    last?.focus();
    await wrapper.find('.pal').trigger('keydown', { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first?.focus();
    await wrapper.find('.pal').trigger('keydown', { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    wrapper.unmount();
  });
});
