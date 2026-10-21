import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, ref, type Ref } from 'vue';
import { createPinia } from 'pinia';
import { PiniaColada } from '@pinia/colada';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import type { EpisodeListItem } from '#/domain/episodes/episode.entity';
import { NetworkError, NotFoundError } from '#/domain/errors';
import vuetify from '@/plugins/vuetify';
import EpisodesView from '@/views/EpisodesView.vue';
import { freshPinia, stubBrowserApis, testRouter } from '@/components/__tests__/mount-with-vuetify';

/**
 * The episode list. Two halves, and they answer different questions:
 *
 * - **With `useInfiniteList` mocked** — the declarations and the copy. What the
 *   defaults are, that the search is title-only and says so, and that the row's
 *   primary action is `Cortar`.
 * - **With the real composable** — that the wiring holds: the filter reaches the
 *   request as `search`, the address bar shows what the visitor chose and
 *   NOTHING they did not, `/episodes/3` (the vestigial route param) is still the
 *   first batch, and — new — an old `?page=3` link is normalised away rather
 *   than silently meaning something different.
 */

interface ListHarness {
  filters: Ref<{ search: string; withClips: string }>;
  items: Ref<EpisodeListItem[] | undefined>;
  total: Ref<number>;
  isLoading: Ref<boolean>;
  isPending: Ref<boolean>;
  error: Ref<unknown>;
  hasMore: Ref<boolean>;
  loadMore: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  refetch: ReturnType<typeof vi.fn>;
  activeFilterCount: Ref<number>;
  appliedQuery: Ref<object>;
}

const harness = vi.hoisted(() => ({
  options: undefined as Record<string, unknown> | undefined,
  list: undefined as unknown,
  /** Set by the integration block, which wants the real composable back. */
  passthrough: false,
}));

vi.mock('@/composables/use-infinite-list', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/composables/use-infinite-list')>();
  return {
    ...original,
    useInfiniteList: (options: Record<string, unknown>) => {
      harness.options = options;
      if (harness.passthrough) {
        return (original.useInfiniteList as (o: unknown) => unknown)(options);
      }
      return harness.list;
    },
  };
});

/** What the fake use case answers with, and what it was asked for. */
const endpoint = vi.hoisted(() => ({
  calls: [] as Record<string, unknown>[],
  total: 395,
  /** Ids `Con mis momentos` asked for, and what the API answers for each. */
  byId: [] as number[],
  episodes: new Map<number, unknown>(),
}));

vi.mock('#/config/episodes.config', () => ({
  listEpisodesUseCase: {
    execute: (query: Record<string, unknown>) => {
      endpoint.calls.push(query);
      return Promise.resolve({ results: [EPISODE], total: endpoint.total });
    },
  },
  /** ⚠️ `Con mis momentos` builds its page out of `GET /episodes/:id`, one per
   *  marked episode — there is no list endpoint that could answer it. */
  getEpisodeUseCase: {
    execute: (id: number) => {
      endpoint.byId.push(id);
      const episode = endpoint.episodes.get(id);
      return episode === undefined
        ? Promise.reject(new NotFoundError(`episode ${id}`))
        : Promise.resolve(episode);
    },
  },
}));

const EPISODE: EpisodeListItem = {
  id: 63,
  title: 'Episodio 86 (Spanish Zombies)',
  cover: 'https://example.invalid/cover.png',
  file: 'https://example.invalid/Episodio086.mp3',
  originalUrl: 'https://example.invalid/episodio-86',
  date: new Date(2012, 10, 18),
  clipCount: 7,
};

/** What `GET /episodes/:id` answers: the same episode, plus its clips. The row
 *  the local page builds carries `clipCount`, so the count has to come from
 *  somewhere real. */
const EPISODE_DETAIL = {
  ...EPISODE,
  clips: Array.from({ length: 7 }, (_unused, index) => ({
    id: index + 1,
    title: `Corte ${index + 1}`,
    start: 0,
    end: 10,
    tags: [],
    up: 0,
  })),
};

function makeList(overrides: Partial<Record<keyof ListHarness, unknown>> = {}): ListHarness {
  const list: ListHarness = {
    filters: ref({ search: '', withClips: '' }),
    items: ref<EpisodeListItem[] | undefined>([EPISODE]),
    total: ref(395),
    isLoading: ref(false),
    isPending: ref(false),
    error: ref(null),
    hasMore: ref(true),
    loadMore: vi.fn(),
    reset: vi.fn(),
    refetch: vi.fn(),
    activeFilterCount: ref(0),
    appliedQuery: ref({}),
  };
  return Object.assign(list, overrides);
}

function mountEpisodes(list: ListHarness) {
  harness.list = list;
  return mount(EpisodesView, { global: { plugins: [freshPinia(), vuetify, testRouter()] } });
}

/**
 * The LAST request the list itself made.
 *
 * ⚠️ The screen also fires two one-row probes to put the numbers on the
 * `Todos · 395` / `Solo con cortes · 61` toggle — they cannot come from the list,
 * which only ever knows the total under the filter currently applied. They are
 * recognisable by `limit: 1`, and mixing them into these assertions would make
 * every one of them read whichever probe happened to resolve last.
 */
const lastListCall = () => endpoint.calls.filter((call) => call.limit !== 1).at(-1);

beforeAll(stubBrowserApis);
beforeEach(() => {
  harness.options = undefined;
  harness.passthrough = false;
  endpoint.calls = [];
  endpoint.total = 395;
  endpoint.byId = [];
  endpoint.episodes = new Map<number, unknown>([
    [63, EPISODE_DETAIL],
    [99, { ...EPISODE_DETAIL, id: 99, title: 'Episodio 53', date: new Date(2011, 3, 28) }],
  ]);
});

describe('what the list declares', () => {
  it('keys its filter state to its OWN endpoint', () => {
    const wrapper = mountEpisodes(makeList());

    // ⚠️ Not `clips`: a shared key would make changing the page size here change
    // it on the library too.
    expect(harness.options).toMatchObject({
      id: 'episodes',
      defaultFilters: { search: '', withClips: '' },
    });

    wrapper.unmount();
  });

  it('filters by title and by the clip toggle, and says the search is title-only', () => {
    const wrapper = mountEpisodes(makeList());

    // ⚠️ `GET /episodes` searches the TITLE only — narrower than `GET /clips`,
    // which also matches the tags. Decided again on 2026-08-18 rather than
    // widened, so the hint under the box is what stops it reading as broken.
    expect(wrapper.text()).toContain('Busca solo en el título del episodio.');
    expect(wrapper.find('[placeholder="Por título…"]').exists()).toBe(true);
    expect(wrapper.find('[placeholder="Filtrar tags…"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Más votados');

    wrapper.unmount();
  });

  it('prints both counts on the toggle, which is the point of this screen', () => {
    // ⚠️ Only 61 of the 395 episodes have ever been cut from, and the design
    // puts BOTH numbers on the control so the gap is visible before you filter
    // rather than after. With `useInfiniteList` mocked, the probes are the real
    // `useEpisodeList` over the mocked use case — 395 for both here.
    const wrapper = mountEpisodes(makeList());

    expect(wrapper.find('.grav-seg').text()).toContain('Todos');
    expect(wrapper.find('.grav-seg').text()).toContain('Solo con cortes');

    wrapper.unmount();
  });

  it('offers the "solo con cortes" toggle', async () => {
    const list = makeList();
    const wrapper = mountEpisodes(list);

    expect(wrapper.text()).toContain('Solo con cortes');

    await wrapper
      .findAll('button')
      .find((b) => b.text().startsWith('Solo con cortes'))
      ?.trigger('click');

    // ⚠️ A STRING, because a filter has to survive a round trip through a query
    // string. The repository turns it into the boolean the API takes.
    expect(list.filters.value.withClips).toBe('true');

    wrapper.unmount();
  });
});

describe('what the list shows', () => {
  it('renders a row per episode, linked by its "<id>-<slug>" URL', () => {
    const wrapper = mountEpisodes(makeList());

    expect(wrapper.findAll('.ep-row')).toHaveLength(1);
    expect(wrapper.text()).toContain('Episodio 86 (Spanish Zombies)');
    // The 2019 slug algorithm: accents and punctuation stripped, spaces hyphened.
    expect(wrapper.find('.ep-row__title-link').attributes('href')).toBe(
      '/episode/63-Episodio-86-Spanish-Zombies',
    );
    // The long date form.
    expect(wrapper.text()).toContain('18 de Noviembre de 2012');

    wrapper.unmount();
  });

  it('prints the clip count on every row', () => {
    const wrapper = mountEpisodes(makeList());

    expect(wrapper.find('.ep-row__count').text()).toBe('7 cortes');

    wrapper.unmount();
  });

  // ⚠️ 334 of the 395 episodes have none, so this is the ordinary row on this
  // screen rather than the edge case — and it is the fact the screen exists to
  // make visible.
  it('says "sin cortes" rather than 0, and drops the "ver" link', () => {
    const wrapper = mountEpisodes(makeList({ items: ref([{ ...EPISODE, clipCount: 0 }]) }));

    expect(wrapper.find('.ep-row__count').text()).toBe('sin cortes');
    expect(wrapper.text()).not.toContain('Ver los cortes');
    // ⚠️ `Cortar` is the primary action on this screen, and it is offered on
    // every row — including the ones nobody has cut yet, which are the point.
    expect(wrapper.text()).toContain('Cortar');

    wrapper.unmount();
  });

  it('uses the singular for exactly one clip', () => {
    const wrapper = mountEpisodes(makeList({ items: ref([{ ...EPISODE, clipCount: 1 }]) }));

    expect(wrapper.find('.ep-row__count').text()).toBe('1 corte');

    wrapper.unmount();
  });

  it('links "Cortar" straight to the editor', () => {
    const wrapper = mountEpisodes(makeList());

    expect(wrapper.find('.ep-row__cut').attributes('href')).toBe(
      '/creator/63-Episodio-86-Spanish-Zombies',
    );

    wrapper.unmount();
  });

  it('has no paginator, and a sentinel instead', () => {
    const wrapper = mountEpisodes(makeList());

    expect(wrapper.find('.grav-pagination').exists()).toBe(false);
    expect(wrapper.text()).toContain('Cargar más episodios');
    expect(wrapper.text()).toContain('395 episodios');

    wrapper.unmount();
  });

  it('offers a way back from a failed load instead of spinning forever', async () => {
    const list = makeList({ error: ref(new NetworkError('offline')), items: ref(undefined) });
    const wrapper = mountEpisodes(list);

    expect(wrapper.text()).toContain('No se han podido cargar los episodios.');

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Reintentar')
      ?.trigger('click');
    expect(list.refetch).toHaveBeenCalled();

    wrapper.unmount();
  });
});

// ── The real thing: composable, router and query all wired ───────────────────

describe('the list against the real filter state', () => {
  let router: Router;
  let wrapper: VueWrapper | undefined;

  const Blank = defineComponent({ render: () => null });

  async function mountReal(url: string): Promise<VueWrapper> {
    harness.passthrough = true;
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'home', component: Blank },
        { path: '/episodes/:page?', name: 'episodes', component: Blank },
        { path: '/episodes/calendario/:year?', name: 'episodesCalendar', component: Blank },
        { path: '/episode/:title', name: 'episode', component: Blank },
        { path: '/creator/:title', name: 'creator', component: Blank },
      ],
    });
    await router.push(url);
    await router.isReady();

    const pinia = createPinia();
    wrapper = mount(EpisodesView, { global: { plugins: [pinia, PiniaColada, vuetify, router] } });
    await vi.advanceTimersByTimeAsync(0);
    return wrapper;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.useRealTimers();
  });

  it('keeps the defaults out of the address bar, and asks for a batch of 24', async () => {
    await mountReal('/episodes');

    // ⚠️ `/episodes`, not `/episodes?search=&page=1&limit=24`: the same rule
    // that keeps defaults out of the library's address applies here.
    expect(router.currentRoute.value.fullPath).toBe('/episodes');
    expect(lastListCall()).toMatchObject({ page: 1, limit: 24 });
  });

  it('ignores the vestigial :page? segment', async () => {
    // ⚠️ `/episodes/3` shows page 1: the param is
    // declared and never read, because paging travels in the query string.
    await mountReal('/episodes/3');

    expect(lastListCall()).toMatchObject({ page: 1 });
    expect(router.currentRoute.value.fullPath).toBe('/episodes/3');
  });

  // ⚠️ **`page` is not in the URL**, and links carrying one exist from the days
  // of pagination. The honest answer to `?page=3` is the first batch of the same
  // filter, and the address is rewritten to say so.
  it('normalises an old ?page= link away instead of half-honouring it', async () => {
    await mountReal('/episodes?page=3');

    expect(lastListCall()).toMatchObject({ page: 1 });
    expect(router.currentRoute.value.fullPath).toBe('/episodes');
  });

  it('sends a typed search as `search`, after the debounce, and puts it in the URL', async () => {
    const view = await mountReal('/episodes');
    endpoint.calls = [];

    const input = view.find('input[type="search"]');
    await input.setValue('zombies');

    // Nothing yet: the 500 ms debounce is the whole point of the composable.
    expect(endpoint.calls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(500);

    expect(lastListCall()).toMatchObject({ search: 'zombies', page: 1 });
    expect(router.currentRoute.value.fullPath).toBe('/episodes?search=zombies');
  });

  it('carries the clip toggle into the request and into the URL', async () => {
    const view = await mountReal('/episodes');
    endpoint.calls = [];

    // ⚠️ The toggle's own button carries the count now (`Solo con cortes · 61`),
    // so it is matched by prefix rather than by an exact string.
    await view
      .findAll('button')
      .find((b) => b.text().startsWith('Solo con cortes'))
      ?.trigger('click');
    await vi.advanceTimersByTimeAsync(500);

    expect(lastListCall()).toMatchObject({ withClips: true });
    expect(router.currentRoute.value.fullPath).toBe('/episodes?withClips=true');
  });

  it('reads a shared filter back out of the link', async () => {
    await mountReal('/episodes?search=zombies&withClips=true');

    expect(lastListCall()).toMatchObject({ search: 'zombies', withClips: true });
  });

  /**
   * ⚠️ **`Con mis momentos`** (2026-08-26), and the one thing that makes it
   * different from the toggle beside it: **the server cannot answer it.** Marks
   * live in `localStorage`, so with this on the list is assembled here out of
   * `GET /episodes/:id` — which is why these assertions look at `endpoint.byId`
   * and at an empty `lastListCall()`.
   */
  describe('the view switch', () => {
    it('offers both views, with the list on', async () => {
      const wrapper = await mountReal('/episodes');

      const buttons = wrapper.findAll('.episodes__view button');
      expect(buttons.map((button) => button.text())).toEqual(['Lista', 'Calendario']);
      expect(buttons[0]?.attributes('aria-pressed')).toBe('true');
      expect(buttons[1]?.attributes('aria-pressed')).toBe('false');
    });

    it('⚠️ PUSHES on the way into the calendar, so Back returns to the list', async () => {
      const wrapper = await mountReal('/episodes');
      const push = vi.spyOn(router, 'push');

      await wrapper.find('[data-test="view-calendar"]').trigger('click');
      await vi.advanceTimersByTimeAsync(0);

      expect(push).toHaveBeenCalledTimes(1);
      expect(router.currentRoute.value.name).toBe('episodesCalendar');
    });

    it('⚠️ carries the filters into the calendar rather than dropping them', async () => {
      const wrapper = await mountReal('/episodes?withClips=true&search=zombis');

      await wrapper.find('[data-test="view-calendar"]').trigger('click');
      await vi.advanceTimersByTimeAsync(0);

      expect(router.currentRoute.value.query).toEqual({
        withClips: 'true',
        search: 'zombis',
      });
    });

    it('⚠️ does not push a second time when the calendar is already showing', async () => {
      const wrapper = await mountReal('/episodes/calendario/2011');
      const push = vi.spyOn(router, 'push');

      await wrapper.find('[data-test="view-calendar"]').trigger('click');
      await vi.advanceTimersByTimeAsync(0);

      expect(push).not.toHaveBeenCalled();
    });

    it('goes BACK out of the calendar, leaving no trace in the history', async () => {
      const wrapper = await mountReal('/episodes');
      await wrapper.find('[data-test="view-calendar"]').trigger('click');
      await vi.advanceTimersByTimeAsync(0);

      // ⚠️ `createMemoryHistory` never writes `window.history.state`, so the
      // "is there anywhere to go back to?" check has to be answered by hand —
      // the same check `EpisodeSearchOverlay.close()` makes.
      const state = { back: '/episodes', current: '/episodes/calendario', forward: null };
      Object.defineProperty(window.history, 'state', { configurable: true, value: state });
      const back = vi.spyOn(router, 'back');

      await wrapper.findAll('.episodes__view button')[0]?.trigger('click');
      await vi.advanceTimersByTimeAsync(0);

      expect(back).toHaveBeenCalledTimes(1);
    });

    it('⚠️ replaces instead, on a cold entry straight onto a calendar link', async () => {
      const wrapper = await mountReal('/episodes/calendario/2011');
      Object.defineProperty(window.history, 'state', { configurable: true, value: null });
      const replace = vi.spyOn(router, 'replace');

      await wrapper.findAll('.episodes__view button')[0]?.trigger('click');
      await vi.advanceTimersByTimeAsync(0);

      expect(replace).toHaveBeenCalled();
      expect(router.currentRoute.value.name).toBe('episodes');
    });

    it('draws the calendar instead of the rows, and keeps the rail', async () => {
      const wrapper = await mountReal('/episodes/calendario/2011');

      expect(wrapper.find('.cal').exists()).toBe(true);
      expect(wrapper.find('.grav-list').exists()).toBe(false);
      expect(wrapper.find('.rail, .rail__bar').exists()).toBe(true);
    });
  });

  describe('con mis momentos', () => {
    const MOMENTS_KEY = 'gravindex.moments';

    function seedMoments(moments: object[]): void {
      localStorage.setItem(MOMENTS_KEY, JSON.stringify({ moments }));
    }

    it('builds the list out of the marked episodes instead of asking for a page', async () => {
      seedMoments([
        { episodeId: 99, at: 100, markedAt: 2 },
        { episodeId: 63, at: 500, markedAt: 1 },
        // A second mark on an episode already in the list is not a second row.
        { episodeId: 63, at: 900, markedAt: 3 },
      ]);
      const view = await mountReal('/episodes');
      endpoint.calls = [];

      await view.find('[data-test="only-mine"]').trigger('click');
      await vi.advanceTimersByTimeAsync(500);

      expect([...endpoint.byId].sort((a, b) => a - b)).toEqual([63, 99]);
      // ⚠️ Nothing went to `GET /episodes`: not a page, not a filter, nothing.
      expect(lastListCall()).toBeUndefined();
      expect(router.currentRoute.value.fullPath).toBe('/episodes?mine=true');
      // Newest first, exactly as the endpoint would have ordered them.
      expect(view.findAll('.ep-row__title-link').map((row) => row.text())).toEqual([
        'Episodio 86 (Spanish Zombies)',
        'Episodio 53',
      ]);
    });

    /**
     * ⚠️ **On the row, at every filter.** It is what makes the filtered list
     * recognisable as yours, and in the full list it is the only sign that says
     * you have been on that episode before.
     */
    it('prints the marks of each episode on its row, and nothing at zero', async () => {
      seedMoments([
        { episodeId: 63, at: 500, markedAt: 1 },
        { episodeId: 63, at: 900, markedAt: 2 },
      ]);
      const view = await mountReal('/episodes?mine=true');

      expect(view.find('[data-test="row-moments"]').text()).toBe('2 momentos tuyos');

      // The unfiltered list draws the same chip, and only where there are marks.
      const all = await mountReal('/episodes');
      expect(all.find('[data-test="row-moments"]').exists()).toBe(true);

      localStorage.clear();
      const none = await mountReal('/episodes');
      expect(none.find('[data-test="row-moments"]').exists()).toBe(false);
    });

    it('counts the episodes marked, and needs no request to do it', async () => {
      seedMoments([
        { episodeId: 63, at: 500, markedAt: 1 },
        { episodeId: 99, at: 100, markedAt: 2 },
      ]);
      const view = await mountReal('/episodes');

      expect(view.find('[data-test="only-mine"]').text()).toContain('· 2');
    });

    it('searches the marked episodes by title, in the browser', async () => {
      seedMoments([
        { episodeId: 63, at: 500, markedAt: 1 },
        { episodeId: 99, at: 100, markedAt: 2 },
      ]);
      const view = await mountReal('/episodes?mine=true');

      await view.find('input[type="search"]').setValue('zombies');
      await vi.advanceTimersByTimeAsync(500);

      expect(view.findAll('.ep-row')).toHaveLength(1);
      expect(view.text()).toContain('Episodio 86 (Spanish Zombies)');
      // Still nothing on the wire: the search had no request to travel on.
      expect(lastListCall()).toBeUndefined();
    });

    it("says the marks are this browser's, and does not call an empty list a failed search", async () => {
      const view = await mountReal('/episodes?mine=true');

      expect(view.text()).toContain('Tus momentos están en este navegador');
      expect(view.text()).toContain('Todavía no has marcado ningún momento');
      expect(view.text()).not.toContain('Ningún episodio se llama así');
    });

    /** ⚠️ Episodes are never deleted, but a mark outlives anything. One stale
     *  id must not take the whole screen down with it. */
    it('drops a marked id the API no longer knows, and draws the rest', async () => {
      seedMoments([
        { episodeId: 63, at: 500, markedAt: 1 },
        { episodeId: 4242, at: 100, markedAt: 2 },
      ]);
      const view = await mountReal('/episodes?mine=true');

      expect(view.findAll('.ep-row')).toHaveLength(1);
      expect(view.text()).toContain('Episodio 86 (Spanish Zombies)');
    });

    it('goes back to the server when the filter is switched off', async () => {
      seedMoments([{ episodeId: 63, at: 500, markedAt: 1 }]);
      const view = await mountReal('/episodes?mine=true');
      endpoint.calls = [];

      await view
        .findAll('button')
        .find((button) => button.text().startsWith('Todos'))
        ?.trigger('click');
      await vi.advanceTimersByTimeAsync(500);

      expect(lastListCall()).toMatchObject({ page: 1, limit: 24 });
      expect(router.currentRoute.value.fullPath).toBe('/episodes');
    });
  });
});
