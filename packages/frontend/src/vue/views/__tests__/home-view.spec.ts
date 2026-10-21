import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed, ref, type Ref } from 'vue';
import type { ClipListItem } from '#/domain/clips/clip.entity';
import type { Episode } from '#/domain/episodes/episode.entity';
import { NetworkError } from '#/domain/errors';
import vuetify from '@/plugins/vuetify';
import HomeView from '@/views/HomeView.vue';
import { freshPinia, stubBrowserApis, testRouter } from '@/components/__tests__/mount-with-vuetify';

/**
 * The library screen. Everything it does with the network lives one layer down
 * (`useInfiniteList` + the use case), so what is left to assert is exactly what
 * this file owns: **the defaults, the copy and the wiring.**
 *
 * ⚠️ The empty state is a joke somebody wrote, not filler
 * (`packages/frontend/CLAUDE.md`: "the empty states are jokes, not strings").
 * The assertion is character-for-character on purpose — a "tidied" version of
 * that sentence is a content change, and nothing else in the app would catch it.
 *
 * ⚠️ What this suite does not assert: **the paginator**, because there is none.
 * The sentinel and the total-under-the-filter counter take its place, and the
 * `.grav-pagination` / page-size assertions belong to the admin list now.
 */

interface ListHarness {
  filters: Ref<{ search: string; order: string; tags: string[] }>;
  items: Ref<ClipListItem[] | undefined>;
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
}));

vi.mock('@/composables/use-infinite-list', () => ({
  useInfiniteList: (options: Record<string, unknown>) => {
    harness.options = options;
    return harness.list;
  },
  DEFAULT_BATCH_SIZE: 24,
}));

vi.mock('@/queries/clips.query', () => ({
  useVoteClip: () => ({ mutateAsync: vi.fn() }),
  useRegisterPlay: () => ({ mutate: vi.fn() }),
  useAddTag: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/queries/tags.query', () => ({
  useTagList: () => ({
    data: computed(() => [
      { tag: 'Mulata', count: 3 },
      { tag: 'Gazpacho', count: 1 },
    ]),
    isPending: computed(() => false),
  }),
}));

const EPISODE: Episode = {
  id: 63,
  title: 'Episodio 86 (Spanish Zombies)',
  cover: 'https://example.invalid/cover.png',
  file: 'https://example.invalid/Episodio086.mp3',
  originalUrl: 'https://example.invalid/episodio-86',
  date: new Date(2012, 10, 18),
};

const CLIP: ClipListItem = {
  id: 178,
  title: 'La mulata del clítor...',
  start: 792,
  end: 870,
  episode: EPISODE,
  tags: ['Mulata'],
  up: 15,
  points: 15,
};

function makeList(overrides: Partial<Record<keyof ListHarness, unknown>> = {}): ListHarness {
  const list: ListHarness = {
    filters: ref({ search: '', order: 'clip.createdAt', tags: [] as string[] }),
    items: ref<ClipListItem[] | undefined>([CLIP]),
    total: ref(180),
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

function mountHome(list: ListHarness) {
  harness.list = list;
  return mount(HomeView, { global: { plugins: [freshPinia(), vuetify, testRouter()] } });
}

beforeAll(stubBrowserApis);
beforeEach(() => {
  harness.options = undefined;
});

describe('the library’s defaults', () => {
  it('declares the defaults, once, where the URL logic can see them', () => {
    const wrapper = mountHome(makeList());

    expect(harness.options).toMatchObject({
      // ⚠️ Namespaced: a shared key would make changing `limit` here change it on
      // the episode grid too.
      id: 'clips',
      defaultFilters: { search: '', order: 'clip.createdAt', tags: [] },
    });
    // ⚠️ NOT the domain's `DEFAULT_CLIP_ORDER` (`points`) — that is what the
    // *backend* falls back to; this screen has always sent `clip.createdAt`.
    expect(harness.options?.defaultFilters).not.toMatchObject({ order: 'points' });

    wrapper.unmount();
  });

  it('offers exactly the three sort keys the backend whitelists', () => {
    const wrapper = mountHome(makeList());
    const text = wrapper.text();

    // ⚠️ "Más votados", not "Más valorados": with one positive vote there is
    // nothing to weigh against it. The URL VALUES are unchanged — `order=points`
    // is in shared links — which is why the label is what this asserts.
    expect(text).toContain('Más votados');
    expect(text).not.toContain('Más valorados');
    expect(text).toContain('Añadidos recientemente');
    expect(text).toContain('Fecha del capítulo');

    wrapper.unmount();
  });

  it('carries the search placeholder and the tag filter', () => {
    const wrapper = mountHome(makeList());

    expect(wrapper.find('[placeholder="¡Busca tu momento…!"]').exists()).toBe(true);
    expect(wrapper.find('[placeholder="Filtrar tags…"]').exists()).toBe(true);
    // All 102 offered, ordered by use — the count comes from the API now.
    expect(wrapper.text()).toContain('Tags · 2');

    wrapper.unmount();
  });
});

describe('what the screen shows', () => {
  it('renders a row per clip and the total under the current filter', () => {
    const wrapper = mountHome(makeList());

    expect(wrapper.findAll('.i-row')).toHaveLength(1);
    expect(wrapper.text()).toContain('La mulata del clítor...');
    // ⚠️ The total, never "24 de 180": the counter says how many clips match,
    // not how many are loaded.
    expect(wrapper.text()).toContain('180 cortes');
    expect(wrapper.text()).not.toContain('de 180');

    wrapper.unmount();
  });

  it('has no paginator at all', () => {
    const wrapper = mountHome(makeList());

    expect(wrapper.find('.grav-pagination').exists()).toBe(false);
    expect(wrapper.find('.more').exists()).toBe(true);

    wrapper.unmount();
  });

  it('asks for the next batch when the sentinel says so', async () => {
    const list = makeList();
    const wrapper = mountHome(list);

    // The keyboard path, which is also the fallback when there is no
    // `IntersectionObserver`.
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Cargar más'))
      ?.trigger('click');

    expect(list.loadMore).toHaveBeenCalled();

    wrapper.unmount();
  });

  it('says it is loading while there is nothing to show yet', () => {
    const wrapper = mountHome(makeList({ isPending: ref(true), items: ref(undefined) }));

    expect(wrapper.text()).toContain('cargando cortes…');
    expect(wrapper.findAll('.i-row')).toHaveLength(0);

    wrapper.unmount();
  });

  it('renders the empty state with the app’s own joke, verbatim', () => {
    const wrapper = mountHome(makeList({ items: ref([]), total: ref(0) }));

    // ⚠️ Content, not filler. Do not rewrite, improve or translate this line.
    expect(wrapper.find('.library__empty').text()).toBe(
      'Esto está más vacío que la petaca de Melocotón Cane',
    );
    expect(wrapper.findAll('.i-row')).toHaveLength(0);

    wrapper.unmount();
  });

  it('offers a way back from a failed load instead of spinning forever', async () => {
    // ⚠️ A failed request must not leave the spinner going behind a 2.5 s toast.
    const list = makeList({ error: ref(new NetworkError('offline')), items: ref(undefined) });
    const wrapper = mountHome(list);

    expect(wrapper.text()).toContain('No se han podido cargar los cortes.');

    const retry = wrapper.findAll('button').find((b) => b.text() === 'Reintentar');
    await retry?.trigger('click');
    expect(list.refetch).toHaveBeenCalled();

    wrapper.unmount();
  });
});

describe('the wiring the other screens copy', () => {
  it('turns a tag clicked on a row into the whole tag filter', async () => {
    const list = makeList();
    const wrapper = mountHome(list);

    const chip = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === 'Filtrar por el tag Mulata');
    await chip?.trigger('click');

    // ⚠️ Replaces rather than appends — one click narrows to that tag alone.
    expect(list.filters.value.tags).toEqual(['Mulata']);

    wrapper.unmount();
  });

  it('hands "Limpiar filtros" straight to the composable that owns the URL', async () => {
    const list = makeList({ activeFilterCount: ref(1) });
    const wrapper = mountHome(list);

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Limpiar filtros')
      ?.trigger('click');

    // The view holds no filter state of its own to clear.
    expect(list.reset).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  // ⚠️ An inert control is furniture: with nothing set there is nothing to
  // clear, and offering it anyway teaches people it does nothing.
  it('hides "Limpiar filtros" when no filter is set', () => {
    const wrapper = mountHome(makeList({ activeFilterCount: ref(0) }));

    expect(wrapper.text()).not.toContain('Limpiar filtros');

    wrapper.unmount();
  });
});
