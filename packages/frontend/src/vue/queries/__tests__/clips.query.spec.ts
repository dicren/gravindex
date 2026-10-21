import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, type App, type Plugin } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { PiniaColada } from '@pinia/colada';
import { flushPromises } from '@vue/test-utils';
import type { ClipListItem } from '#/domain/clips/clip.entity';
import type { ClipPage } from '#/domain/clips/clip.repository';
import type { Episode, EpisodeDetail } from '#/domain/episodes/episode.entity';
import { useAddTag, useClipList, useCreateClip, useVoteClip } from '../clips.query';
import { useInfiniteList } from '@/composables/use-infinite-list';
import { clipKeys } from '../query-keys';
import { useEpisode } from '../episodes.query';
import { useTagList } from '../tags.query';

/**
 * ⚠️ What this file is really guarding: **the one place the app does NOT
 * invalidate.** Voting patches the counters from the server's own
 * `{ add, delete }` and refetches nothing, because a whole page of clips
 * reloading to learn that a number went up by one is a visible regression on
 * the most-used control in the app. Every other write invalidates. Both halves
 * are easy to "tidy" into each other, so both are asserted.
 */
const mocks = vi.hoisted(() => ({
  listClips: vi.fn(),
  getClip: vi.fn(),
  createClip: vi.fn(),
  registerPlay: vi.fn(),
  voteClip: vi.fn(),
  addTag: vi.fn(),
  listEpisodes: vi.fn(),
  getEpisode: vi.fn(),
  listTags: vi.fn(),
}));

vi.mock('#/config/clips.config', () => ({
  listClipsUseCase: { execute: mocks.listClips },
  getClipUseCase: { execute: mocks.getClip },
  createClipUseCase: { execute: mocks.createClip },
  registerPlayUseCase: { execute: mocks.registerPlay },
  voteClipUseCase: { execute: mocks.voteClip },
  addTagUseCase: { execute: mocks.addTag },
}));

vi.mock('#/config/episodes.config', () => ({
  listEpisodesUseCase: { execute: mocks.listEpisodes },
  getEpisodeUseCase: { execute: mocks.getEpisode },
}));

vi.mock('#/config/tags.config', () => ({
  listTagsUseCase: { execute: mocks.listTags },
}));

const EPISODE: Episode = {
  id: 63,
  title: 'Episodio 86 (Spanish Zombies)',
  cover: 'https://example.invalid/cover.jpg',
  file: 'https://example.invalid/episode.mp3',
  originalUrl: 'https://example.invalid/episodio-86',
  date: new Date('2013-05-02T00:00:00.000Z'),
};

function clipListItem(overrides: Partial<ClipListItem> = {}): ClipListItem {
  return {
    id: 178,
    title: 'La canción del zombi',
    start: 792,
    end: 870,
    episode: EPISODE,
    tags: ['Absurdo'],
    up: 5,
    // ⚠️ `points` equals `up`: every vote is positive, so there is nothing for
    // the sort key to subtract.
    points: 5,
    ...overrides,
  };
}

function clipPage(...results: ClipListItem[]): ClipPage {
  return { results, total: results.length };
}

function episodeDetail(): EpisodeDetail {
  return {
    ...EPISODE,
    clips: [
      { id: 178, title: 'La canción del zombi', start: 792, end: 870, tags: [], up: 5 },
      { id: 179, title: 'Otro corte', start: 10, end: 20, tags: [], up: 0 },
    ],
  };
}

let app: App | undefined;

/**
 * A router for the infinite-list case only. ⚠️ `useListFilters` reads and writes
 * `route.query` — that IS the list's URL contract — so anything built on it
 * needs one installed; the plain `useQuery` cases below do not.
 */
function memoryRouter(): Router {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', name: 'home', component: defineComponent({ render: () => null }) }],
  });
  void router.push('/');
  return router;
}

/** Runs a composable inside a real app, which is what `useQuery` needs. */
function withSetup<T>(composable: () => T, extraPlugins: Plugin[] = []): T {
  let result: T | undefined;
  app = createApp(
    defineComponent({
      setup() {
        result = composable();
        return () => null;
      },
    }),
  );
  app.use(createPinia());
  app.use(PiniaColada);
  for (const plugin of extraPlugins) app.use(plugin);
  app.mount(document.createElement('div'));
  return result as T;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listClips.mockResolvedValue(clipPage(clipListItem()));
  mocks.getEpisode.mockResolvedValue(episodeDetail());
  mocks.listTags.mockResolvedValue([{ tag: 'Absurdo', count: 3 }]);
});

afterEach(() => {
  app?.unmount();
  app = undefined;
});

describe('useVoteClip', () => {
  it('⚠️ moves the counters in the cached list WITHOUT refetching it', async () => {
    mocks.voteClip.mockResolvedValue({ status: 'recorded', added: 1, removed: 0 });

    const api = withSetup(() => ({
      list: useClipList(() => ({ page: 1, limit: 12 })),
      vote: useVoteClip(),
    }));
    await flushPromises();
    expect(mocks.listClips).toHaveBeenCalledTimes(1);

    await api.vote.mutateAsync({ clipId: 178, value: 1 });
    await flushPromises();

    expect(api.list.data.value?.results[0]).toMatchObject({ up: 6, points: 6 });
    // The whole point: one list request for the life of the test.
    expect(mocks.listClips).toHaveBeenCalledTimes(1);
  });

  // ⚠️ There is nothing to change your mind to, and `-1` is a 400. What is
  // asserted is the invariant that matters — `points` is emitted from `up`, so a
  // patched row can never leave the default sort key disagreeing with the number
  // beside it.
  it('keeps points and up the same number after a vote', async () => {
    mocks.voteClip.mockResolvedValue({ status: 'recorded', added: 1, removed: 0 });

    const api = withSetup(() => ({
      list: useClipList(() => ({ page: 1, limit: 12 })),
      vote: useVoteClip(),
    }));
    await flushPromises();

    await api.vote.mutateAsync({ clipId: 178, value: 1 });
    await flushPromises();

    const patched = api.list.data.value?.results[0];
    expect(patched?.points).toBe(patched?.up);
  });

  it('leaves everything alone when the server says you already voted', async () => {
    mocks.voteClip.mockResolvedValue({ status: 'already-voted' });

    const api = withSetup(() => ({
      list: useClipList(() => ({ page: 1, limit: 12 })),
      vote: useVoteClip(),
    }));
    await flushPromises();

    await api.vote.mutateAsync({ clipId: 178, value: 1 });
    await flushPromises();

    expect(api.list.data.value?.results[0]).toMatchObject({ up: 5, points: 5 });
    expect(mocks.listClips).toHaveBeenCalledTimes(1);
  });

  it('patches an episode page too, where clips carry up but no points', async () => {
    mocks.voteClip.mockResolvedValue({ status: 'recorded', added: 1, removed: 0 });

    const api = withSetup(() => ({
      episode: useEpisode(() => 63),
      vote: useVoteClip(),
    }));
    await flushPromises();

    await api.vote.mutateAsync({ clipId: 178, value: 1 });
    await flushPromises();

    expect(api.episode.data.value?.clips[0]).toMatchObject({ id: 178, up: 6 });
    // The clip nobody voted on is untouched.
    expect(api.episode.data.value?.clips[1]).toMatchObject({ id: 179, up: 0 });
    expect(mocks.getEpisode).toHaveBeenCalledTimes(1);
  });

  /**
   * ⚠️ **The shape the library actually stores, which is not the one above.**
   * Every public list is a Colada `useInfiniteQuery`, so its entry holds
   * `{ pages, pageParams }` rather than a single `ClipPage` — and a patch
   * written for the page shape alone skips it in silence: no error, no refetch,
   * and the number under the thumb frozen until something else invalidates.
   *
   * That is exactly what happened, and it survived the whole suite: the two
   * tests above use `useClipList`, which only the ADMIN list still uses, and
   * the e2e vote tests drive the episode page, whose cache is a plain query.
   * Between them they covered every list shape except the one on `/`.
   */
  it('⚠️ patches the INFINITE library list, whose entry holds batches, not a page', async () => {
    mocks.voteClip.mockResolvedValue({ status: 'recorded', added: 1, removed: 0 });
    // Three clips over two batches of two, so the patch has to reach past the
    // first batch as well as into it.
    mocks.listClips.mockImplementation((query: { page?: number }) =>
      Promise.resolve(
        query.page === 1
          ? { results: [clipListItem(), clipListItem({ id: 300, up: 1, points: 1 })], total: 3 }
          : { results: [clipListItem({ id: 301, up: 2, points: 2 })], total: 3 },
      ),
    );

    const router = memoryRouter();
    await router.isReady();
    const api = withSetup(
      () => ({
        list: useInfiniteList<Record<string, never>, ClipListItem>({
          id: 'vote-patch',
          defaultFilters: {},
          key: (query) => clipKeys.list(query),
          fetchPage: (query, signal) => mocks.listClips(query, signal) as Promise<ClipPage>,
          batchSize: 2,
        }),
        vote: useVoteClip(),
      }),
      [router],
    );
    await flushPromises();
    api.list.loadMore();
    await flushPromises();
    expect(api.list.items.value).toHaveLength(3);

    await api.vote.mutateAsync({ clipId: 300, value: 1 });
    await flushPromises();

    expect(api.list.items.value?.map((clip) => [clip.id, clip.up, clip.points])).toEqual([
      [178, 5, 5],
      [300, 2, 2],
      [301, 2, 2],
    ]);
    // Still no refetch: two batches asked for, two requests made.
    expect(mocks.listClips).toHaveBeenCalledTimes(2);
    mocks.listClips.mockReset();
  });

  it('does not touch a page that does not contain the clip', async () => {
    mocks.listClips.mockResolvedValue(clipPage(clipListItem({ id: 42, up: 2, points: 2 })));
    mocks.voteClip.mockResolvedValue({ status: 'recorded', added: 1, removed: 0 });

    const api = withSetup(() => ({
      list: useClipList(() => ({ page: 1, limit: 12 })),
      vote: useVoteClip(),
    }));
    await flushPromises();

    await api.vote.mutateAsync({ clipId: 178, value: 1 });
    await flushPromises();

    expect(api.list.data.value?.results[0]).toMatchObject({ id: 42, up: 2, points: 2 });
  });
});

describe('useCreateClip', () => {
  it('⚠️ DOES invalidate: the library, the episode it was cut from, and the tags', async () => {
    mocks.createClip.mockResolvedValue({ id: 183 });

    const api = withSetup(() => ({
      list: useClipList(() => ({ page: 1, limit: 12 })),
      episode: useEpisode(() => 63),
      tags: useTagList(),
      create: useCreateClip(),
    }));
    await flushPromises();
    expect(mocks.listClips).toHaveBeenCalledTimes(1);
    expect(mocks.getEpisode).toHaveBeenCalledTimes(1);
    expect(mocks.listTags).toHaveBeenCalledTimes(1);

    await api.create.mutateAsync({
      episodeId: 63,
      title: 'Nuevo corte',
      start: 10,
      end: 20,
      tags: ['Absurdo'],
    });
    await flushPromises();

    expect(mocks.listClips).toHaveBeenCalledTimes(2);
    expect(mocks.getEpisode).toHaveBeenCalledTimes(2);
    // A brand-new tag has to appear in the autocomplete.
    expect(mocks.listTags).toHaveBeenCalledTimes(2);
  });

  it('does not refetch an episode the clip was not cut from', async () => {
    mocks.createClip.mockResolvedValue({ id: 183 });

    const api = withSetup(() => ({
      episode: useEpisode(() => 63),
      create: useCreateClip(),
    }));
    await flushPromises();

    await api.create.mutateAsync({
      episodeId: 99,
      title: 'Nuevo corte',
      start: 10,
      end: 20,
      tags: [],
    });
    await flushPromises();

    expect(mocks.getEpisode).toHaveBeenCalledTimes(1);
  });
});

describe('useAddTag', () => {
  it('⚠️ DOES invalidate when the tag actually landed', async () => {
    mocks.addTag.mockResolvedValue({ status: 'added', tag: 'Zombies' });

    const api = withSetup(() => ({
      list: useClipList(() => ({ page: 1, limit: 12 })),
      tags: useTagList(),
      addTag: useAddTag(),
    }));
    await flushPromises();

    await api.addTag.mutateAsync({ clipId: 178, tag: 'Zombies' });
    await flushPromises();

    expect(mocks.listClips).toHaveBeenCalledTimes(2);
    expect(mocks.listTags).toHaveBeenCalledTimes(2);
  });

  it('invalidates nothing when the clip already carried the tag', async () => {
    // ⚠️ A 409 is an ordinary outcome, not a failure — and nothing changed on
    // the server, so refetching would redraw identical data twice.
    mocks.addTag.mockResolvedValue({ status: 'already-present', tag: 'Absurdo' });

    const api = withSetup(() => ({
      list: useClipList(() => ({ page: 1, limit: 12 })),
      tags: useTagList(),
      addTag: useAddTag(),
    }));
    await flushPromises();

    await api.addTag.mutateAsync({ clipId: 178, tag: 'Absurdo' });
    await flushPromises();

    expect(mocks.listClips).toHaveBeenCalledTimes(1);
    expect(mocks.listTags).toHaveBeenCalledTimes(1);
  });
});

describe('cache keys', () => {
  it('gives two filters two entries, and reuses the entry for a repeated filter', async () => {
    const api = withSetup(() => ({
      first: useClipList(() => ({ page: 1, limit: 12, search: 'zombi' })),
      second: useClipList(() => ({ page: 1, limit: 12, search: 'gravina' })),
      // ⚠️ Same filter as `first`, written in a different key order. `toCacheKey`
      // sorts object keys, so this must NOT be a third request — that is the
      // duplicate suppression, done by the cache key.
      third: useClipList(() => ({ search: 'zombi', limit: 12, page: 1 })),
    }));
    await flushPromises();

    expect(mocks.listClips).toHaveBeenCalledTimes(2);
    expect(api.first.data.value).toEqual(api.third.data.value);
  });
});
