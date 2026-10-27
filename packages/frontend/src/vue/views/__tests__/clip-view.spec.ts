import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createRouter, createMemoryHistory, type Router } from 'vue-router';
import { defineComponent } from 'vue';
import { PiniaColada } from '@pinia/colada';
import type { Clip } from '#/domain/clips/clip.entity';
import type { Episode, EpisodeDetail, EpisodeWaveform } from '#/domain/episodes/episode.entity';
import { NetworkError, NotFoundError } from '#/domain/errors';
import vuetify from '@/plugins/vuetify';
import ClipView from '@/views/ClipView.vue';
import type { PlaybackAudio, PlaybackAudioEvent } from '@/stores/playback.store';
import type { QueuedClip } from '@/stores/queue.store';
import { freshPinia, stubBrowserApis } from '@/components/__tests__/mount-with-vuetify';

/**
 * The clip permalink.
 *
 * ⚠️ **The vote button is what this file is about.** `GET /clips/:id` carries
 * `up`, so every screen shows a count on the permalink and in the player for a
 * clip opened by URL, and there is no other source for it. What this file
 * asserts is that the button is here and that it shows the server's number.
 *
 * The second thing worth guarding is that a clip that is gone **moves the
 * address**. Two ids (175 and 176) were deleted by hand years ago and their
 * permalinks are still shared, so the error state has to be linkable and
 * reloadable.
 *
 * Real Pinia Colada, mocked use cases — the shape `queries/__tests__` uses. The
 * `enabled` flag is genuine wiring and a hand-rolled query stub would not have it.
 */
const mocks = vi.hoisted(() => ({
  getClip: vi.fn(),
  listClips: vi.fn(),
  createClip: vi.fn(),
  registerPlay: vi.fn(),
  voteClip: vi.fn(),
  addTag: vi.fn(),
  listTags: vi.fn(),
}));

vi.mock('#/config/clips.config', () => ({
  getClipUseCase: { execute: mocks.getClip },
  listClipsUseCase: { execute: mocks.listClips },
  createClipUseCase: { execute: mocks.createClip },
  registerPlayUseCase: { execute: mocks.registerPlay },
  voteClipUseCase: { execute: mocks.voteClip },
  addTagUseCase: { execute: mocks.addTag },
}));

vi.mock('#/config/tags.config', () => ({
  listTagsUseCase: { execute: mocks.listTags },
}));

/**
 * ⚠️ **This is what actually caught `GET /episodes/0`.** The real
 * `episodeQueryOptions`/`episodeWaveformQueryOptions` are backed by
 * `#/config/episodes.config`, left un-mocked above, so an id of `0` would
 * have gone through the real use case and hit `vitest.setup.ts`'s forbidden
 * `fetch` — which rejects into the query's error state and asserts nothing.
 * Mocking the query-options factories instead, the same shape as
 * `episode-view.spec.ts`, makes the id itself observable: `fetchedIds` only
 * grows when Colada actually ran the query function, which is exactly what
 * `enabled` gates.
 */
const episodeEndpoint = vi.hoisted(() => ({
  fetchedIds: [] as number[],
  waveformFetchedIds: [] as number[],
  answer: undefined as unknown,
  waveformAnswer: undefined as unknown,
}));

vi.mock('@/queries/episodes.query', () => ({
  episodeQueryOptions: (episodeId: number) => ({
    key: ['episodes', 'detail', episodeId],
    query: () => {
      episodeEndpoint.fetchedIds.push(episodeId);
      return Promise.resolve(episodeEndpoint.answer);
    },
  }),
  episodeWaveformQueryOptions: (episodeId: number) => ({
    key: ['episodes', 'waveform', episodeId],
    query: () => {
      episodeEndpoint.waveformFetchedIds.push(episodeId);
      return Promise.resolve(episodeEndpoint.waveformAnswer);
    },
  }),
}));

const EPISODE: Episode = {
  id: 63,
  title: 'Episodio 86 (Spanish Zombies)',
  cover: 'https://example.invalid/cover.jpg',
  file: 'https://example.invalid/Episodio086.mp3',
  originalUrl: 'https://example.invalid/episodio-86',
  date: new Date(2012, 10, 18),
};

/** ⚠️ `up` but no `points`. That is the whole shape the API sends. */
const CLIP: Clip = {
  id: 178,
  title: 'La mulata del clítor...',
  start: 792,
  end: 870,
  episode: EPISODE,
  tags: ['Mulata'],
  up: 15,
};

const EPISODE_DETAIL: EpisodeDetail = { ...EPISODE, clips: [] };
const WAVEFORM: EpisodeWaveform = { from: 792, to: 870, peaks: [] };

const Blank = defineComponent({ template: '<div />' });

/** jsdom does not implement `HTMLMediaElement.play()`, which is why the
 *  playback store takes a factory at all. */
class FakeAudio implements PlaybackAudio {
  src = '';
  currentTime = 0;
  loadCalls = 0;
  private readonly listeners = new Map<PlaybackAudioEvent, (() => void)[]>();
  private pausedFlag = true;

  get paused(): boolean {
    return this.pausedFlag;
  }

  play(): Promise<void> {
    this.pausedFlag = false;
    this.emit('play');
    this.emit('playing');
    return Promise.resolve();
  }

  pause(): void {
    this.pausedFlag = true;
    this.emit('pause');
  }

  load(): void {
    this.loadCalls += 1;
  }

  addEventListener(type: PlaybackAudioEvent, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(): void {}

  private emit(type: PlaybackAudioEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

function queued(id: number): QueuedClip {
  return {
    kind: 'clip',
    id,
    title: `Corte ${id}`,
    start: 0,
    end: 30,
    src: 'https://example.invalid/otro.mp3',
    episodeId: 1,
    episodeTitle: 'Otro episodio',
    cover: 'https://example.invalid/otra.jpg',
    up: 0,
  };
}

/** The routes this screen can reach, including the real error route. */
function viewRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Blank },
      { path: '/episode/:title', name: 'episode', component: Blank },
      { path: '/creator/:title', name: 'creator', component: Blank },
      { path: '/cola', name: 'queue', component: Blank },
      { path: '/error/404', name: 'error404', component: Blank },
      { path: '/error', name: 'errorUnknown', component: Blank },
      { path: '/:id', name: 'clip', component: ClipView },
    ],
  });
}

async function mountAt(path: string): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = viewRouter();
  await router.push(path);
  await router.isReady();

  const wrapper = mount(ClipView, {
    global: { plugins: [freshPinia(), PiniaColada, vuetify, router] },
  });
  await flushPromises();
  return { wrapper, router };
}

beforeAll(stubBrowserApis);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listTags.mockResolvedValue([]);
  episodeEndpoint.fetchedIds = [];
  episodeEndpoint.waveformFetchedIds = [];
  episodeEndpoint.answer = EPISODE_DETAIL;
  episodeEndpoint.waveformAnswer = WAVEFORM;
});

/**
 * ⚠️ **Regression test for a real bug (2026-08-20):** opening a permalink fired
 * `GET /episodes/0` and `GET /episodes/0/waveform` before the clip had even
 * answered. `episodeId` falls back to `0` (`?? 0`) while `clip` is still
 * `undefined` — that fallback itself is fine, it exists so the two queries
 * always have a number to key on — but without `enabled: clip.value !==
 * undefined` guarding them, Colada fetched eagerly on that placeholder `0`
 * instead of waiting for the clip to say which episode this is.
 */
describe('the episode and waveform queries', () => {
  it('wait for the clip to answer, and never fetch episode 0', async () => {
    let resolveClip: (clip: Clip) => void = () => {};
    mocks.getClip.mockReturnValue(
      new Promise<Clip>((resolve) => {
        resolveClip = resolve;
      }),
    );

    const { wrapper } = await mountAt('/178');

    // The clip has not answered yet — the episode is not known, so nothing
    // must have been fetched. Not even under the `0` placeholder.
    expect(episodeEndpoint.fetchedIds).toEqual([]);
    expect(episodeEndpoint.waveformFetchedIds).toEqual([]);

    resolveClip(CLIP);
    await flushPromises();

    // Now that the clip says which episode this is, both queries run — for
    // the real id, and only once each.
    expect(episodeEndpoint.fetchedIds).toEqual([63]);
    expect(episodeEndpoint.waveformFetchedIds).toEqual([63]);

    wrapper.unmount();
  });
});

describe('the vote button this screen finally has', () => {
  it('draws the count the endpoint now sends', async () => {
    mocks.getClip.mockResolvedValue(CLIP);
    const { wrapper } = await mountAt('/178');

    expect(wrapper.find('.clip-hero').exists()).toBe(true);
    expect(wrapper.text()).toContain('La mulata del clítor...');

    // ⚠️ ONE button, thumb up — there is no second control to look for.
    const voteButtons = wrapper
      .findAll('button')
      .filter((button) => button.attributes('aria-label')?.startsWith('Votar') === true);
    expect(voteButtons).toHaveLength(1);
    expect(voteButtons[0]?.attributes('aria-label')).toBe('Votar a favor (15 votos)');
    expect(voteButtons[0]?.text()).toBe('15');

    wrapper.unmount();
  });

  it('shows the actions with words, not just glyphs', async () => {
    // ⚠️ This is the one screen with room for them, and the one a stranger
    // arrives at with no idea what the icons mean.
    mocks.getClip.mockResolvedValue(CLIP);
    const { wrapper } = await mountAt('/178');

    const text = wrapper.text();
    expect(text).toContain('Escuchar');
    expect(text).toContain('A la cola');
    expect(text).toContain('Compartir');
    expect(text).toContain('Descargar');
    // Where the cut sits inside the episode, in `hh:mm:ss` — these are
    // positions in a two-hour file, not a clip's own `mm:ss`.
    expect(text).toContain('Del episodio completo: 00:13:12 → 00:14:30');

    wrapper.unmount();
  });

  it('gives the clip its own `<h1>` — here the clip title IS the page', async () => {
    mocks.getClip.mockResolvedValue(CLIP);
    const { wrapper } = await mountAt('/178');

    expect(wrapper.find('h1.clip-hero__title').text()).toBe('La mulata del clítor...');

    wrapper.unmount();
  });
});

/**
 * ⚠️ **`Escuchar` has to sound, and for a while it did not** (fixed
 * 2026-08-19). It fell through to `queue.enqueue`, which appends and starts
 * playback only when the queue was empty — so the bug was invisible on a fresh
 * visit and total for anyone who had queued anything: the button played nothing
 * and silently added a row to a list on another page.
 */
describe('the `Escuchar` button', () => {
  it('plays immediately, slotting the clip in after whatever was sounding', async () => {
    mocks.getClip.mockResolvedValue(CLIP);
    const { wrapper } = await mountAt('/178');

    const { useQueueStore } = await import('@/stores/queue.store');
    const { usePlaybackStore, setAudioElementFactory, resetAudioElementFactory } =
      await import('@/stores/playback.store');
    setAudioElementFactory(() => new FakeAudio());

    const queue = useQueueStore();
    const playback = usePlaybackStore();
    // Somebody arrives with a queue already going — the case that was broken.
    queue.enqueue(queued(1));
    queue.enqueue(queued(2));
    expect(playback.currentClipId).toBe(1);

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Escuchar')
      ?.trigger('click');

    expect(playback.isPlaying(178)).toBe(true);
    expect(queue.keys).toEqual(['c1', 'c178', 'c2']);

    resetAudioElementFactory();
    wrapper.unmount();
  });
});

describe('a clip that is not there', () => {
  // ⚠️ 175 and 176 are the two ids deleted by hand in production years ago;
  // 9999 never existed. All three are 404s a visitor can still arrive at from a
  // link somebody shared.
  it.each([175, 176, 9999])('sends %i to the 404 route, changing the URL', async (id) => {
    mocks.getClip.mockRejectedValue(new NotFoundError('clip not found'));
    const { wrapper, router } = await mountAt(`/${id}`);

    // ⚠️ The address MOVES, so the error can be linked and reloaded.
    expect(router.currentRoute.value.name).toBe('error404');
    expect(router.currentRoute.value.fullPath).toBe('/error/404');

    wrapper.unmount();
  });

  it('does not put the failed id in the history — back goes somewhere useful', async () => {
    mocks.getClip.mockRejectedValue(new NotFoundError('clip not found'));
    const { wrapper, router } = await mountAt('/9999');

    // `replace`, not `push`: with `push`, "back" would land on the broken id,
    // fail again and bounce forward — a trap you cannot leave.
    expect(router.options.history.state.back).not.toBe('/9999');

    wrapper.unmount();
  });

  it('never asks the API about a segment that is not a number', async () => {
    const { wrapper, router } = await mountAt('/melocoton');

    // ⚠️ `/:id` is catch-all-ish: any single unmatched segment lands here. The
    // backend's `ParseIntPipe` would answer 400, which routes to the GENERIC
    // error page — so parsing first is what keeps the visible behaviour a 404.
    expect(mocks.getClip).not.toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe('error404');

    wrapper.unmount();
  });
});

describe('a load that broke rather than a clip that is gone', () => {
  it('stays on the permalink and offers a retry', async () => {
    mocks.getClip.mockRejectedValue(new NetworkError('offline'));
    const { wrapper, router } = await mountAt('/178');

    // ⚠️ Deliberately NOT the error route: throwing someone off the clip they
    // asked for because the wifi blinked loses the address they arrived with.
    expect(router.currentRoute.value.name).toBe('clip');
    expect(wrapper.text()).toContain('No se ha podido cargar el corte.');

    mocks.getClip.mockResolvedValue(CLIP);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Reintentar')
      ?.trigger('click');
    await flushPromises();

    expect(wrapper.find('.clip-hero').exists()).toBe(true);

    wrapper.unmount();
  });
});

describe('a tag clicked on the card', () => {
  it('navigates to the library filtered by it', async () => {
    mocks.getClip.mockResolvedValue(CLIP);
    const { wrapper, router } = await mountAt('/178');

    const chip = wrapper
      .findAll('button')
      .find((button) => button.attributes('aria-label') === 'Filtrar por el tag Mulata');
    await chip?.trigger('click');
    await flushPromises();

    // ⚠️ On the library a tag click narrows the filter in place; here it has to
    // navigate. That difference is why `ClipCard` emits instead of routing.
    expect(router.currentRoute.value.name).toBe('home');
    expect(router.currentRoute.value.query.tags).toEqual(['Mulata']);

    wrapper.unmount();
  });
});
