import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { ClipListItem, EpisodeClip } from '#/domain/clips/clip.entity';
import type { Episode } from '#/domain/episodes/episode.entity';
import vuetify from '@/plugins/vuetify';
import ClipRowItem from '@/components/ClipRowItem.vue';
import {
  usePlaybackStore,
  type PlaybackAudio,
  type PlaybackAudioEvent,
} from '@/stores/playback.store';
import { useQueueStore } from '@/stores/queue.store';
import { freshPinia, stubBrowserApis, testRouter } from './mount-with-vuetify';

/**
 * The clip row — **the unit the whole site is made of**, and the replacement for
 * the white `ClipCard`.
 *
 * ⚠️ **The first thing this file asserts is that a row does not play.** That is
 * the decision the whole row turns on: with
 * a global player carrying the queue, there is one transport, at the bottom of
 * the screen, and a play button on every row would be a second one. The button
 * here says `Cola`.
 *
 * Four screens render this component, which is why `episode` is a separate prop:
 * a clip inside `GET /episodes/:id` genuinely carries none, because the screen
 * showing it already IS the episode.
 */

const mutations = vi.hoisted(() => ({ vote: vi.fn() }));
// ⚠️ `useClipActions().download` calls this use case directly (not a Pinia
// Colada mutation — a one-shot side effect, nothing to cache). Mocked here for
// the same reason `useVoteClip` is: no real `fetch`, and `vitest.setup.ts`
// makes the default one throw.
const downloadClipAudio = vi.hoisted(() => vi.fn());

vi.mock('@/queries/clips.query', () => ({
  useVoteClip: () => ({ mutateAsync: mutations.vote }),
  useRegisterPlay: () => ({ mutate: vi.fn() }),
  useAddTag: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('#/config/episodes.config', () => ({
  downloadClipAudioUseCase: { execute: downloadClipAudio },
}));

// `saveFile` pokes the DOM (a Blob URL, a synthetic click) that jsdom does not
// implement — irrelevant to what this component is responsible for, which is
// only that it asks the use case for the right clip.
vi.mock('@/utils/save-file', () => ({ saveFile: vi.fn() }));

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
  tags: ['Mulata', 'Canciones'],
  up: 15,
  points: 15,
};

/** A clip as `GET /episodes/:id` sends it: no episode of its own. */
const EPISODE_CLIP: EpisodeClip = {
  id: 179,
  title: 'Otro corte',
  start: 10,
  end: 70,
  tags: [],
  up: 0,
};

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

  private emit(type: PlaybackAudioEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

beforeAll(stubBrowserApis);
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

function mountRow(props: Record<string, unknown> = {}) {
  return mount(ClipRowItem, {
    props: { clip: CLIP, ...props },
    global: { plugins: [freshPinia(), vuetify, testRouter()] },
  });
}

describe('a row queues rather than plays', () => {
  it('offers `Cola` and no play button at all', () => {
    const wrapper = mountRow();

    expect(wrapper.find('.i-row__queue').text()).toBe('Cola');
    // ⚠️ The absence IS the design. A play button here would be a second
    // transport competing with the one at the bottom of the screen.
    expect(wrapper.find('.mdi-play').exists()).toBe(false);
    expect(wrapper.find('.mdi-pause').exists()).toBe(false);

    wrapper.unmount();
  });

  it('appends the clip to the queue when pressed', async () => {
    const wrapper = mountRow();
    const queue = useQueueStore();

    await wrapper.find('.i-row__queue').trigger('click');

    expect(queue.keys).toEqual(['c178']);
    // ⚠️ `src` is the EPISODE's mp3: a clip has no audio file of its own.
    expect(queue.entries.get('c178')).toMatchObject({
      kind: 'clip',
      id: 178,
      src: 'https://example.invalid/Episodio086.mp3',
      up: 15,
    });

    wrapper.unmount();
  });

  it('says `En la cola` and goes inert once it is queued', async () => {
    const pinia = freshPinia();
    // ⚠️ Something else has to be playing first: queueing into an EMPTY queue
    // starts playback, and the row the player is on shows the third state
    // (`Reproduciendo`) rather than this one.
    useQueueStore().enqueue({
      kind: 'clip',
      id: 1,
      title: 'Otro',
      start: 0,
      end: 10,
      src: 'x',
      episodeId: 1,
      episodeTitle: 'y',
      cover: 'z',
      up: 0,
    });

    const wrapper = mount(ClipRowItem, {
      props: { clip: CLIP },
      global: { plugins: [pinia, vuetify, testRouter()] },
    });

    await wrapper.find('.i-row__queue').trigger('click');
    await wrapper.vm.$nextTick();

    const button = wrapper.find('.i-row__queue');
    // ⚠️ Inert rather than hidden: the state is worth saying, and a button that
    // vanishes on click loses the visitor's place in the list.
    expect(button.exists()).toBe(true);
    expect(button.text()).toBe('En la cola');
    expect(button.attributes('disabled')).toBeDefined();

    wrapper.unmount();
  });
});

describe('the row that is playing', () => {
  it('marks itself four ways, and its queue button says `Reproduciendo`', async () => {
    const pinia = freshPinia();
    const wrapper = mount(ClipRowItem, {
      props: { clip: CLIP },
      global: { plugins: [pinia, vuetify, testRouter()] },
    });

    const { setAudioElementFactory, resetAudioElementFactory } =
      await import('@/stores/playback.store');
    setAudioElementFactory(() => new FakeAudio());
    usePlaybackStore().play({ kind: 'clip', id: 178, src: EPISODE.file, start: 792, end: 870 });
    await wrapper.vm.$nextTick();

    expect(wrapper.classes()).toContain('is-playing');
    /**
     * ⚠️ **And no line above the title.** `sonando ahora` used to be the fourth
     * mark; it was also the only thing in a row that changed its HEIGHT, so the
     * whole list shifted 16 px every time a clip advanced. The words moved into
     * the button, which does not move (2026-08-19). Colour, the tinted ground,
     * the inset rule and that button are the four marks now.
     */
    expect(wrapper.find('.i-row__now').exists()).toBe(false);

    /**
     * ⚠️ **It used to disappear here, and that was the bug** (2026-08-19). The
     * reasoning was sound — this clip is already out of the queue — and the
     * result was one row 8 rem narrower than every other, which slid its share
     * and download icons out of the column they share with the rest of the
     * list. The third state is the fix: same button, same width, inert.
     */
    const button = wrapper.find('.i-row__queue');
    expect(button.exists()).toBe(true);
    expect(button.text()).toBe('Reproduciendo');
    expect(button.attributes('disabled')).toBeDefined();

    resetAudioElementFactory();
    wrapper.unmount();
  });

  /** ⚠️ The label follows playback rather than the highlight: the row stays
   *  marked while paused, and a paused clip must not claim to be sounding. */
  it('says `En pausa` while the clip it is on is paused', async () => {
    const pinia = freshPinia();
    const wrapper = mount(ClipRowItem, {
      props: { clip: CLIP },
      global: { plugins: [pinia, vuetify, testRouter()] },
    });

    const { setAudioElementFactory, resetAudioElementFactory } =
      await import('@/stores/playback.store');
    setAudioElementFactory(() => new FakeAudio());
    const playback = usePlaybackStore();
    playback.play({ kind: 'clip', id: 178, src: EPISODE.file, start: 792, end: 870 });
    playback.pause();
    await wrapper.vm.$nextTick();

    expect(wrapper.classes()).toContain('is-playing');
    expect(wrapper.find('.i-row__now').exists()).toBe(false);
    expect(wrapper.find('.i-row__queue').text()).toBe('En pausa');
    expect(wrapper.find('.i-row__queue').attributes('disabled')).toBeDefined();

    resetAudioElementFactory();
    wrapper.unmount();
  });
});

describe('what a row shows', () => {
  it('carries the title, the episode, the date, the tags and the duration', () => {
    const wrapper = mountRow();

    expect(wrapper.find('.i-row__title').text()).toBe('La mulata del clítor...');
    expect(wrapper.text()).toContain('Episodio 86 (Spanish Zombies)');
    expect(wrapper.text()).toContain('18/11/2012');
    expect(wrapper.find('.i-row__time').text()).toBe('01:18');
    expect(wrapper.findAll('.i-row__tag').map((t) => t.text())).toEqual(['Mulata', 'Canciones']);

    wrapper.unmount();
  });

  it('links the title to the permalink people have been sharing since 2019', () => {
    const wrapper = mountRow();

    expect(wrapper.find('.i-row__title-link').attributes('href')).toBe('/178');

    wrapper.unmount();
  });

  it('links the episode by its frozen "<id>-<slug>" URL', () => {
    const wrapper = mountRow();

    expect(wrapper.find('.i-row__episode').attributes('href')).toBe(
      '/episode/63-Episodio-86-Spanish-Zombies',
    );

    wrapper.unmount();
  });

  it('hides the episode line when the screen already is the episode', () => {
    const wrapper = mountRow({ clip: EPISODE_CLIP, episode: EPISODE, compact: true });

    expect(wrapper.find('.i-row__episode').exists()).toBe(false);
    // ...and still queues, using the episode it was handed.
    expect(wrapper.find('.i-row__queue').exists()).toBe(true);

    wrapper.unmount();
  });

  it('shows one vote count, thumb up', () => {
    const wrapper = mountRow();

    expect(wrapper.find('.i-row__count').text()).toBe('15');
    expect(wrapper.findAll('.mdi-thumb-up')).toHaveLength(1);
    // ⚠️ One vote, and it is positive.
    expect(wrapper.find('.mdi-thumb-down').exists()).toBe(false);

    wrapper.unmount();
  });
});

describe('the actions', () => {
  it('votes through the mutation, not by hand', async () => {
    mutations.vote.mockResolvedValue({ status: 'recorded', added: 1, removed: 0 });
    const wrapper = mountRow();

    await wrapper.find('.i-row__vote').trigger('click');

    expect(mutations.vote).toHaveBeenCalledWith({ clipId: 178, value: 1 });

    wrapper.unmount();
  });

  it('emits the tag it was asked to filter by, rather than routing itself', async () => {
    // ⚠️ The library BECOMES the filter; every other screen navigates. Which of
    // those it is belongs to the screen, not to a component four of them share
    // — and a component four of them share must not branch on `$route.path`.
    const wrapper = mountRow();

    await wrapper.findAll('.i-row__tag')[0]?.trigger('click');

    expect(wrapper.emitted('select-tag')).toEqual([['Mulata']]);

    wrapper.unmount();
  });

  /**
   * ⚠️ **Recorded deviation from the accepted design (2026-08-20): download is
   * no longer inert.** The design assumed a real download needed a server-side
   * re-encode; a clip is in fact cut client-side
   * from `Range` reads of the episode's mp3 (`core/application/audio/mp3-
   * frames.ts`), and this row's job is just to hand the use case the right
   * episode, alongside `enqueue()`.
   */
  it('downloads by handing the use case this row’s clip and episode', async () => {
    downloadClipAudio.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), filename: 'x.mp3' });
    const wrapper = mountRow();
    const buttons = wrapper.findAll('button');

    const download = buttons.find(
      (b) => b.attributes('aria-label') === 'Descargar La mulata del clítor...',
    );
    expect(download).toBeDefined();
    await download?.trigger('click');

    expect(downloadClipAudio).toHaveBeenCalledWith({
      episodeId: EPISODE.id,
      episodeTitle: EPISODE.title,
      clipTitle: CLIP.title,
      start: CLIP.start,
      end: CLIP.end,
    });

    wrapper.unmount();
  });

  /**
   * ⚠️ The use case is left unresolved on purpose — this is the ONLY way to
   * observe the button mid-download rather than after it has already finished.
   */
  it('shows a loading state while the download is in flight, and clears it after', async () => {
    let resolveDownload!: (file: { bytes: Uint8Array; filename: string }) => void;
    downloadClipAudio.mockReturnValue(
      new Promise((resolve) => {
        resolveDownload = resolve;
      }),
    );
    const wrapper = mountRow();
    // ⚠️ Found ONCE, by its initial aria-label: the label itself changes while
    // downloading, so re-querying by it after the click would find nothing.
    const download = wrapper.get('[aria-label="Descargar La mulata del clítor..."]');

    expect(download.attributes('disabled')).toBeUndefined();
    expect(download.find('.grav-pulse').exists()).toBe(false);

    await download.trigger('click');

    expect(download.attributes('aria-label')).toBe('Descargando La mulata del clítor...…');
    expect(download.attributes('disabled')).toBeDefined();
    expect(download.find('.grav-pulse').exists()).toBe(true);

    resolveDownload({ bytes: new Uint8Array([1]), filename: 'x.mp3' });
    await flushPromises();

    expect(download.attributes('aria-label')).toBe('Descargar La mulata del clítor...');
    expect(download.attributes('disabled')).toBeUndefined();
    expect(download.find('.grav-pulse').exists()).toBe(false);

    wrapper.unmount();
  });
});

describe('playback', () => {
  it('starts immediately when the queue was empty', async () => {
    const pinia = freshPinia();
    const wrapper = mount(ClipRowItem, {
      props: { clip: CLIP },
      global: { plugins: [pinia, vuetify, testRouter()] },
    });

    // Swap the element so `play()` is drivable at all — jsdom's is not.
    const { setAudioElementFactory, resetAudioElementFactory } =
      await import('@/stores/playback.store');
    const audio = new FakeAudio();
    setAudioElementFactory(() => audio);

    try {
      await wrapper.find('.i-row__queue').trigger('click');

      // ⚠️ The derived rule: otherwise a first visit begins in silence.
      expect(usePlaybackStore().currentClipId).toBe(178);
      expect(audio.src).toBe('https://example.invalid/Episodio086.mp3');
      expect(audio.currentTime).toBe(792);
    } finally {
      resetAudioElementFactory();
      wrapper.unmount();
    }
  });
});
