import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, type App } from 'vue';
import { createPinia } from 'pinia';
import { PiniaColada, type DefineQueryOptions } from '@pinia/colada';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import type { DomainError } from '#/domain/errors';
import {
  useFilteredList,
  type ListPage,
  type ListQuery,
  type UseFilteredListReturn,
} from '../use-filtered-list';

/**
 * ⚠️ These are the four behaviours the list has to keep. Each one is something
 * people rely on, and each is invisible in a screenshot.
 *
 *   the 500 ms debounce · `limit` remembered per endpoint · page reset on a
 *   filter change · defaults absent from the URL
 *
 * Everything runs on fake timers, because the debounce IS the unit under test:
 * `advanceTimersByTimeAsync` is used rather than a plain `flushPromises` since
 * it drains microtasks between ticks, so one helper settles both the timer and
 * the query promise behind it.
 */
const DEBOUNCE_MS = 500;

interface Row {
  readonly id: number;
}

/** One fake endpoint. `root` is what separates two of them in the cache. */
function makeEndpoint(root: string) {
  const fetchPage = vi.fn(
    async (query: Readonly<Record<string, unknown>>): Promise<ListPage<Row>> => ({
      results: [{ id: 1 }, { id: 2 }],
      total: 37,
      ...(query.empty === true ? { results: [], total: 0 } : {}),
    }),
  );

  function queryOptions<TFilters>(
    query: ListQuery<TFilters>,
  ): DefineQueryOptions<ListPage<Row>, DomainError> {
    return {
      key: [root, 'list', query],
      query: () => fetchPage(query as Readonly<Record<string, unknown>>),
    };
  }

  return { fetchPage, queryOptions };
}

let app: App | undefined;
let router: Router;

async function settle(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/**
 * Tear the mounted app down and forget it.
 *
 * ⚠️ A function, not two statements inline. `app` is assigned from inside other
 * closures, so within a single test TypeScript narrows it to `undefined` after
 * `app = undefined` and never widens it back — a later `app?.unmount()` then
 * reads `.unmount` off `never`. Doing it here restores the declared type, which
 * is the honest fix rather than a cast.
 */
function unmountApp(): void {
  app?.unmount();
  app = undefined;
}

async function mountList<T>(setup: () => T, initialUrl = '/'): Promise<T> {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: defineComponent({ render: () => null }) },
      { path: '/episodes', name: 'episodes', component: defineComponent({ render: () => null }) },
    ],
  });
  await router.push(initialUrl);
  await router.isReady();

  let result: T | undefined;
  app = createApp(
    defineComponent({
      setup() {
        result = setup();
        return () => null;
      },
    }),
  );
  app.use(createPinia());
  app.use(PiniaColada);
  app.use(router);
  app.mount(document.createElement('div'));
  await settle();
  return result as T;
}

interface ClipFilters extends Record<string, string | number | readonly string[]> {
  search: string;
  order: string;
  tags: readonly string[];
}

const CLIP_DEFAULTS: ClipFilters = { search: '', order: 'clip.createdAt', tags: [] };

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  unmountApp();
  vi.useRealTimers();
});

describe('useFilteredList — the 500 ms debounce', () => {
  it('⚠️ coalesces a burst of filter changes into ONE request', async () => {
    const endpoint = makeEndpoint('clips');
    const list = await mountList(() =>
      useFilteredList<ClipFilters, Row>({
        id: 'clips',
        defaultFilters: CLIP_DEFAULTS,
        defaultLimit: 12,
        queryOptions: endpoint.queryOptions,
      }),
    );

    expect(endpoint.fetchPage).toHaveBeenCalledTimes(1); // the initial load

    // Someone typing "zombi" — five keystrokes inside the window.
    for (const search of ['z', 'zo', 'zom', 'zomb', 'zombi']) {
      list.filters.value = { ...list.filters.value, search };
      await settle(50);
    }
    // Still nothing: the window has not closed.
    expect(endpoint.fetchPage).toHaveBeenCalledTimes(1);

    await settle(DEBOUNCE_MS);

    expect(endpoint.fetchPage).toHaveBeenCalledTimes(2);
    expect(endpoint.fetchPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'zombi', page: 1, limit: 12 }),
    );
  });

  it('does NOT debounce paging — turning a page is a deliberate click', async () => {
    const endpoint = makeEndpoint('clips');
    const list = await mountList(() =>
      useFilteredList<ClipFilters, Row>({
        id: 'clips',
        defaultFilters: CLIP_DEFAULTS,
        defaultLimit: 12,
        queryOptions: endpoint.queryOptions,
      }),
    );

    list.page.value = 3;
    await settle();

    expect(endpoint.fetchPage).toHaveBeenCalledTimes(2);
    expect(endpoint.fetchPage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));
  });

  it('sends the empty filter as absent, so "" and "no search" are one request', async () => {
    const endpoint = makeEndpoint('clips');
    const list = await mountList(() =>
      useFilteredList<ClipFilters, Row>({
        id: 'clips',
        defaultFilters: CLIP_DEFAULTS,
        defaultLimit: 12,
        queryOptions: endpoint.queryOptions,
      }),
    );

    expect(endpoint.fetchPage).toHaveBeenLastCalledWith({
      order: 'clip.createdAt',
      page: 1,
      limit: 12,
    });
    expect(list.appliedQuery.value).not.toHaveProperty('search');
    expect(list.appliedQuery.value).not.toHaveProperty('tags');
  });
});

describe('useFilteredList — page reset', () => {
  it('⚠️ sends the visitor back to page 1 when a filter changes', async () => {
    const endpoint = makeEndpoint('clips');
    const list = await mountList(() =>
      useFilteredList<ClipFilters, Row>({
        id: 'clips',
        defaultFilters: CLIP_DEFAULTS,
        defaultLimit: 12,
        queryOptions: endpoint.queryOptions,
      }),
    );

    list.page.value = 7;
    await settle();
    expect(list.page.value).toBe(7);

    list.filters.value = { ...list.filters.value, search: 'zombi' };
    // Immediately, not after the debounce: the paginator must not sit on page 7
    // for half a second while the results underneath it change.
    expect(list.page.value).toBe(1);

    await settle(DEBOUNCE_MS);
    expect(endpoint.fetchPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'zombi', page: 1 }),
    );
  });

  it('resets the page only once for a burst, never firing a page-7 request', async () => {
    const endpoint = makeEndpoint('clips');
    const list = await mountList(() =>
      useFilteredList<ClipFilters, Row>({
        id: 'clips',
        defaultFilters: CLIP_DEFAULTS,
        defaultLimit: 12,
        queryOptions: endpoint.queryOptions,
      }),
    );

    list.page.value = 7;
    await settle();
    endpoint.fetchPage.mockClear();

    list.filters.value = { ...list.filters.value, search: 'z' };
    list.filters.value = { ...list.filters.value, search: 'zo' };
    await settle(DEBOUNCE_MS);
    // ⚠️ Drained twice on purpose. The regression this guards against fired its
    // stray request DURING the window, so a single advance could leave the count
    // at 1 for the wrong reason — the extra settle lets everything pending land
    // before the count is believed.
    await settle(DEBOUNCE_MS);

    expect(endpoint.fetchPage).toHaveBeenCalledTimes(1);
    expect(endpoint.fetchPage).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'zo', page: 1 }),
    );
    // The two things that must never have gone out: the stale page, and the
    // half-typed search the debounce exists to swallow.
    const sent = endpoint.fetchPage.mock.calls.map(([query]) => query);
    expect(sent).not.toContainEqual(expect.objectContaining({ page: 7 }));
    expect(sent).not.toContainEqual(expect.objectContaining({ search: 'z' }));
  });
});

describe('useFilteredList — the URL', () => {
  it('⚠️ keeps DEFAULTS out of the address bar', async () => {
    const endpoint = makeEndpoint('clips');
    await mountList(() =>
      useFilteredList<ClipFilters, Row>({
        id: 'clips',
        defaultFilters: CLIP_DEFAULTS,
        defaultLimit: 12,
        queryOptions: endpoint.queryOptions,
      }),
    );

    // Defaults stay out of the address: the library lives at `/`, not at
    // `/?search=&order=clip.createdAt&page=1&limit=12`.
    expect(router.currentRoute.value.fullPath).toBe('/');
  });

  it('puts every NON-default in the address bar', async () => {
    const endpoint = makeEndpoint('clips');
    const list = await mountList(() =>
      useFilteredList<ClipFilters, Row>({
        id: 'clips',
        defaultFilters: CLIP_DEFAULTS,
        defaultLimit: 12,
        queryOptions: endpoint.queryOptions,
      }),
    );

    list.filters.value = { ...list.filters.value, search: 'zombi', tags: ['Absurdo', 'Música'] };
    await settle(DEBOUNCE_MS);

    const query = router.currentRoute.value.query;
    expect(query.search).toBe('zombi');
    expect(query.tags).toEqual(['Absurdo', 'Música']);
    // `order` is untouched, so it stays out.
    expect(query.order).toBeUndefined();
    expect(query.page).toBeUndefined();
    expect(query.limit).toBeUndefined();

    list.page.value = 3;
    list.limit.value = 24;
    await settle();
    expect(router.currentRoute.value.query.page).toBe('3');
    expect(router.currentRoute.value.query.limit).toBe('24');
  });

  it('scrubs redundant defaults out of an incoming link', async () => {
    const endpoint = makeEndpoint('clips');
    await mountList(
      () =>
        useFilteredList<ClipFilters, Row>({
          id: 'clips',
          defaultFilters: CLIP_DEFAULTS,
          defaultLimit: 12,
          queryOptions: endpoint.queryOptions,
        }),
      '/?search=&order=clip.createdAt&page=1&limit=12',
    );
    await settle();

    expect(router.currentRoute.value.fullPath).toBe('/');
  });

  it('reads a shared link back into the filters', async () => {
    const endpoint = makeEndpoint('clips');
    const list = await mountList(
      () =>
        useFilteredList<ClipFilters, Row>({
          id: 'clips',
          defaultFilters: CLIP_DEFAULTS,
          defaultLimit: 12,
          queryOptions: endpoint.queryOptions,
        }),
      '/?search=zombi&order=points&tags=Absurdo&tags=M%C3%BAsica&page=2&limit=24',
    );

    expect(list.filters.value).toEqual({
      search: 'zombi',
      order: 'points',
      // ⚠️ Tags stay strings. Coercing anything numeric-looking would turn the tag
      // `82` into the number 82.
      tags: ['Absurdo', 'Música'],
    });
    expect(list.page.value).toBe(2);
    expect(list.limit.value).toBe(24);
    expect(endpoint.fetchPage).toHaveBeenCalledWith({
      search: 'zombi',
      order: 'points',
      tags: ['Absurdo', 'Música'],
      page: 2,
      limit: 24,
    });
  });

  it('adopts an external URL change — Back, or the navbar link home', async () => {
    const endpoint = makeEndpoint('clips');
    const list = await mountList(
      () =>
        useFilteredList<ClipFilters, Row>({
          id: 'clips',
          defaultFilters: CLIP_DEFAULTS,
          defaultLimit: 12,
          queryOptions: endpoint.queryOptions,
        }),
      '/?search=zombi',
    );
    expect(list.filters.value.search).toBe('zombi');

    // The navbar's "Inicio": same route, empty query.
    await router.push('/');
    await settle();

    expect(list.filters.value).toEqual(CLIP_DEFAULTS);
    expect(list.page.value).toBe(1);
    expect(endpoint.fetchPage).toHaveBeenLastCalledWith({
      order: 'clip.createdAt',
      page: 1,
      limit: 12,
    });
  });

  it('reset() clears the filters, the page and the URL — but keeps the page size', async () => {
    const endpoint = makeEndpoint('clips');
    const list = await mountList(
      () =>
        useFilteredList<ClipFilters, Row>({
          id: 'clips',
          defaultFilters: CLIP_DEFAULTS,
          defaultLimit: 12,
          queryOptions: endpoint.queryOptions,
        }),
      '/?search=zombi&page=4&limit=24',
    );

    list.reset();
    await settle();

    expect(list.filters.value).toEqual(CLIP_DEFAULTS);
    expect(list.page.value).toBe(1);
    // ⚠️ The page size is a preference, not a filter — "Limpiar" leaves it alone.
    expect(list.limit.value).toBe(24);
    expect(router.currentRoute.value.fullPath).toBe('/?limit=24');
  });
});

describe('useFilteredList — the remembered page size', () => {
  it('⚠️ persists per endpoint and does NOT leak between them', async () => {
    const clips = makeEndpoint('clips');
    const list = await mountList(() =>
      useFilteredList<ClipFilters, Row>({
        id: 'clips',
        defaultFilters: CLIP_DEFAULTS,
        defaultLimit: 12,
        queryOptions: clips.queryOptions,
      }),
    );

    list.limit.value = 48;
    await settle();
    unmountApp();

    // A different endpoint, same browser. Each list keeps its own page size, so
    // changing it on one must not change it on the other.
    const episodes = makeEndpoint('episodes');
    const episodeList = await mountList(
      () =>
        useFilteredList<{ search: string }, Row>({
          id: 'episodes',
          defaultFilters: { search: '' },
          defaultLimit: 12,
          queryOptions: episodes.queryOptions,
        }),
      '/episodes',
    );
    expect(episodeList.limit.value).toBe(12);
    // ⚠️ …and its own key is untouched by the other endpoint's choice.
    expect(localStorage.getItem('gravindex.list-limit.clips')).toBe('48');
    unmountApp();

    // …and the library still remembers its own.
    const again = await mountList(() =>
      useFilteredList<ClipFilters, Row>({
        id: 'clips',
        defaultFilters: CLIP_DEFAULTS,
        defaultLimit: 12,
        queryOptions: makeEndpoint('clips').queryOptions,
      }),
    );
    expect(again.limit.value).toBe(48);
  });

  it('lets the URL win over the remembered size, and remembers what it saw', async () => {
    const endpoint = makeEndpoint('clips');
    localStorage.setItem('gravindex.list-limit.clips', '48');

    const list = await mountList(
      () =>
        useFilteredList<ClipFilters, Row>({
          id: 'clips',
          defaultFilters: CLIP_DEFAULTS,
          defaultLimit: 12,
          queryOptions: endpoint.queryOptions,
        }),
      '/?limit=24',
    );

    expect(list.limit.value).toBe(24);
    // ⚠️ …and the second half of this test's own name, which was never asserted
    // and was not in fact true. The ref is *initialised* from the URL, and an
    // initial value is not a change, so the watcher that persists the page size
    // never fired on a full page load: `/?limit=24` was honoured for that visit
    // and forgotten on the next one — while the identical address reached from
    // inside the app went through the route watcher and WAS remembered. Both are
    // remembered now, so one address has one behaviour.
    expect(localStorage.getItem('gravindex.list-limit.clips')).toBe('24');
  });

  it('does not persist a page size the visitor never chose', async () => {
    // ⚠️ The other half of the fix above: only a `limit` that actually arrived
    // in the address is written. Persisting the default on arrival would turn
    // "this visitor prefers 48" into "this visitor once opened the page", and
    // would then survive a later change to `defaultLimit` in the view.
    const endpoint = makeEndpoint('clips');
    await mountList(() =>
      useFilteredList<ClipFilters, Row>({
        id: 'clips',
        defaultFilters: CLIP_DEFAULTS,
        defaultLimit: 12,
        queryOptions: endpoint.queryOptions,
      }),
    );

    expect(localStorage.getItem('gravindex.list-limit.clips')).toBeNull();
  });

  it('does not persist at all when asked not to', async () => {
    const endpoint = makeEndpoint('clips');
    const list = await mountList(() =>
      useFilteredList<ClipFilters, Row>({
        id: 'ephemeral',
        defaultFilters: CLIP_DEFAULTS,
        defaultLimit: 12,
        persistLimit: false,
        queryOptions: endpoint.queryOptions,
      }),
    );

    list.limit.value = 48;
    await settle();

    expect(localStorage.getItem('gravindex.list-limit.ephemeral')).toBeNull();
  });
});

describe('useFilteredList — what the view reads', () => {
  it('exposes the page, the total and the last page', async () => {
    const endpoint = makeEndpoint('clips');
    const list: UseFilteredListReturn<ClipFilters, Row> = await mountList(() =>
      useFilteredList<ClipFilters, Row>({
        id: 'clips',
        defaultFilters: CLIP_DEFAULTS,
        defaultLimit: 12,
        queryOptions: endpoint.queryOptions,
      }),
    );

    expect(list.items.value).toEqual([{ id: 1 }, { id: 2 }]);
    expect(list.total.value).toBe(37);
    expect(list.lastPage.value).toBe(4);
    expect(list.isPending.value).toBe(false);
    expect(list.error.value).toBeNull();
  });

  it('answers lastPage 1 rather than 0 when nothing matched', async () => {
    const endpoint = makeEndpoint('clips');
    endpoint.fetchPage.mockResolvedValue({ results: [], total: 0 });

    const list = await mountList(() =>
      useFilteredList<ClipFilters, Row>({
        id: 'clips',
        defaultFilters: CLIP_DEFAULTS,
        defaultLimit: 12,
        queryOptions: endpoint.queryOptions,
      }),
    );

    expect(list.items.value).toEqual([]);
    expect(list.lastPage.value).toBe(1);
  });

  it('surfaces a domain error instead of throwing at the view', async () => {
    const endpoint = makeEndpoint('clips');
    const { RequestRejectedError } = await import('#/domain/errors');
    endpoint.fetchPage.mockRejectedValue(new RequestRejectedError('order must be one of …'));

    const list = await mountList(() =>
      useFilteredList<ClipFilters, Row>({
        id: 'clips',
        defaultFilters: CLIP_DEFAULTS,
        defaultLimit: 12,
        queryOptions: endpoint.queryOptions,
      }),
    );
    await settle();

    // ⚠️ Why the error taxonomy exists: a view can branch on this and say what
    // the server said, instead of "the server is unreachable".
    expect(list.error.value?.code).toBe('REQUEST_REJECTED');
    expect(list.error.value?.message).toBe('order must be one of …');
  });
});
