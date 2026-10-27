import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import vuetify from '@/plugins/vuetify';
import QueueView from '@/views/QueueView.vue';
import {
  resetAudioElementFactory,
  setAudioElementFactory,
  type PlaybackAudio,
  type PlaybackAudioEvent,
} from '@/stores/playback.store';
import { useQueueStore, type QueuedClip, type QueuedEpisode } from '@/stores/queue.store';
import { freshPinia, stubBrowserApis } from '@/components/__tests__/mount-with-vuetify';

/**
 * `/cola` — the queue screen.
 *
 * ⚠️ **The half of this file that matters is the shared link.** Opening one must
 * never overwrite what somebody already had queued: the shared list is shown
 * behind a banner offering `Añadir al final`, `Reemplazar la mía` and
 * `Descartar`. There is no undo for silently
 * replacing a queue, which is why it is three choices and not a prompt.
 *
 * ⚠️ Ids that no longer resolve are dropped **silently**: a shared queue is a
 * suggestion, and refusing the whole thing because one clip was deleted is worse
 * for the visitor than showing the four that are left.
 */

const clipEndpoint = vi.hoisted(() => ({
  /** id -> answer, or a rejection for an id that is gone. */
  answers: new Map<number, unknown>(),
  requested: [] as number[],
}));

vi.mock('#/config/clips.config', () => ({
  getClipUseCase: {
    execute: (id: number) => {
      clipEndpoint.requested.push(id);
      const answer = clipEndpoint.answers.get(id);
      return answer === undefined ? Promise.reject(new Error('gone')) : Promise.resolve(answer);
    },
  },
  listClipsUseCase: { execute: vi.fn() },
  listRelatedClipsUseCase: { execute: vi.fn() },
  createClipUseCase: { execute: vi.fn() },
  registerPlayUseCase: { execute: vi.fn() },
  voteClipUseCase: { execute: vi.fn() },
  addTagUseCase: { execute: vi.fn() },
}));

vi.mock('@/queries/clips.query', () => ({
  useVoteClip: () => ({ mutateAsync: vi.fn() }),
  useRegisterPlay: () => ({ mutate: vi.fn() }),
  useAddTag: () => ({ mutateAsync: vi.fn() }),
}));

// `useClipActions().download` (`use-clip-actions.ts`) calls this use case
// directly, not through a query — see `clip-row.spec.ts` for the same mock.
const downloadClipAudio = vi.hoisted(() => vi.fn());
vi.mock('#/config/episodes.config', () => ({
  downloadClipAudioUseCase: { execute: downloadClipAudio },
}));
vi.mock('@/utils/save-file', () => ({ saveFile: vi.fn() }));

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

function queuedEpisode(id: number, over: Partial<QueuedEpisode> = {}): QueuedEpisode {
  return {
    kind: 'episode',
    id,
    title: `Episodio ${id}`,
    end: 10957,
    src: `https://example.test/episodes/${id}.mp3`,
    cover: 'https://example.test/c.jpg',
    ...over,
  };
}

function queued(id: number, over: Partial<QueuedClip> = {}): QueuedClip {
  return {
    kind: 'clip',
    id,
    title: `Corte ${id}`,
    start: 0,
    end: 60,
    src: 'https://example.test/e.mp3',
    episodeId: 1,
    episodeTitle: 'Episodio 1',
    cover: 'https://example.test/c.jpg',
    up: 0,
    ...over,
  };
}

/** What `GET /clips/:id` answers with, for the shared-link resolution. */
function apiClip(id: number) {
  return {
    id,
    title: `Corte ${id}`,
    start: 0,
    end: 60,
    up: 2,
    episode: {
      id: 1,
      title: 'Episodio 1',
      cover: 'https://example.test/c.jpg',
      file: 'https://example.test/e.mp3',
      originalUrl: 'https://example.test/1',
      date: new Date(2020, 0, 1),
    },
    tags: [],
  };
}

const Blank = defineComponent({ render: () => null });

let router: Router;

async function mountQueue(url = '/cola'): Promise<VueWrapper> {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Blank },
      { path: '/cola', name: 'queue', component: QueueView },
      // ⚠️ A queued EPISODE links here rather than to `/:id` — an episode's URL
      // has never been the bare id (2026-08-25).
      { path: '/episode/:title', name: 'episode', component: Blank },
      { path: '/:id', name: 'clip', component: Blank },
    ],
  });
  await router.push(url);
  await router.isReady();

  const wrapper = mount(QueueView, {
    global: { plugins: [freshPinia(), vuetify, router] },
  });
  await flushPromises();
  return wrapper;
}

beforeAll(stubBrowserApis);
beforeEach(() => {
  localStorage.clear();
  clipEndpoint.answers = new Map();
  clipEndpoint.requested = [];
  setAudioElementFactory(() => new FakeAudio());
});

describe('an empty queue', () => {
  it('shows the app’s own joke, verbatim, and the way back', async () => {
    const wrapper = await mountQueue();

    // ⚠️ Content, not filler. Do not rewrite, improve or translate this line.
    expect(wrapper.find('.queue__empty p').text()).toBe(
      'Esto está más vacío que la petaca de Melocotón Cane',
    );
    expect(wrapper.find('.queue__empty a').attributes('href')).toBe('/');
    // Nothing to share and nothing to empty.
    expect(wrapper.find('[aria-label="Compartir la cola"]').exists()).toBe(false);

    resetAudioElementFactory();
    wrapper.unmount();
  });
});

describe('a queue with clips in it', () => {
  async function mountWithClips(): Promise<VueWrapper> {
    const wrapper = await mountQueue();
    const queue = useQueueStore();
    queue.enqueue(queued(1, { end: 90 }));
    queue.enqueue(queued(2, { end: 30 }));
    await wrapper.vm.$nextTick();
    return wrapper;
  }

  /**
   * Three clips rather than two, for the reorder tests: with only one clip
   * behind the one playing, that clip sits right at `currentIndex + 1` — the
   * one position the rules forbid moving TO, since nothing may land
   * ahead of what is playing. A third clip gives a move the arrows and the
   * drag are still allowed to make.
   */
  async function mountWithThreeClips(): Promise<VueWrapper> {
    const wrapper = await mountQueue();
    const queue = useQueueStore();
    queue.enqueue(queued(1, { end: 90 }));
    queue.enqueue(queued(2, { end: 30 }));
    queue.enqueue(queued(3, { end: 45 }));
    await wrapper.vm.$nextTick();
    return wrapper;
  }

  it('counts the clips and their total running time', async () => {
    const wrapper = await mountWithClips();

    expect(wrapper.find('.queue__meta').text()).toContain('2 cortes');
    expect(wrapper.find('.queue__meta').text()).toContain('02:00 en total');

    resetAudioElementFactory();
    wrapper.unmount();
  });

  it('numbers the rows and marks the one playing', async () => {
    const wrapper = await mountWithClips();

    const rows = wrapper.findAll('.q-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.classes()).toContain('is-playing');
    expect(rows[0]?.find('.q-row__now').text()).toContain('sonando ahora');
    expect(wrapper.findAll('.q-row__num').map((n) => n.text())).toEqual(['1', '2']);

    resetAudioElementFactory();
    wrapper.unmount();
  });

  it('removes a clip from the queue', async () => {
    const wrapper = await mountWithClips();
    const queue = useQueueStore();

    await wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === 'Quitar Corte 2 de la cola')
      ?.trigger('click');

    expect(queue.keys).toEqual(['c1']);

    resetAudioElementFactory();
    wrapper.unmount();
  });

  /**
   * ⚠️ **Recorded regression, fixed 2026-08-20.** Every row here shares ONE
   * `useClipActions()` call — this view is not a per-row component like
   * `ClipRowItem.vue` — so `isDownloading` has to be keyed by clip id. A plain
   * boolean would have lit up (and disabled) every row's download button while
   * only one clip was actually being cut.
   */
  it('shows the loading state on the row being downloaded, and no other', async () => {
    let resolveDownload!: (file: { bytes: Uint8Array; filename: string }) => void;
    downloadClipAudio.mockReturnValue(
      new Promise((resolve) => {
        resolveDownload = resolve;
      }),
    );
    const wrapper = await mountWithClips();
    const buttonFor = (label: string) => wrapper.get(`[aria-label="${label}"]`);

    await buttonFor('Descargar Corte 1').trigger('click');

    expect(buttonFor('Descargando Corte 1…').attributes('disabled')).toBeDefined();
    expect(buttonFor('Descargando Corte 1…').find('.grav-pulse').exists()).toBe(true);
    // ⚠️ The one this regression is about: Corte 2's button is untouched.
    expect(buttonFor('Descargar Corte 2').attributes('disabled')).toBeUndefined();
    expect(buttonFor('Descargar Corte 2').find('.grav-pulse').exists()).toBe(false);

    resolveDownload({ bytes: new Uint8Array([1]), filename: 'x.mp3' });
    await flushPromises();

    expect(buttonFor('Descargar Corte 1').attributes('disabled')).toBeUndefined();

    resetAudioElementFactory();
    wrapper.unmount();
  });

  /**
   * ⚠️ **A drag handle alone is unreachable without a pointer**, and this list
   * exists to be reordered. The arrows are the keyboard's version of the same
   * move.
   *
   * ⚠️ **Three clips, not two.** `Corte 2` sits right at `currentIndex + 1`,
   * the one slot the up-arrow now refuses to leave — moving it up would put it
   * ahead of what is playing. `Corte 3` is the one row still free to move.
   */
  it('reorders from the keyboard', async () => {
    const wrapper = await mountWithThreeClips();
    const queue = useQueueStore();

    await wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === 'Subir Corte 3 en la cola')
      ?.trigger('click');

    expect(queue.keys).toEqual(['c1', 'c3', 'c2']);

    resetAudioElementFactory();
    wrapper.unmount();
  });

  /**
   * ⚠️ **The row right after the one playing cannot move up either.** Nothing
   * may land ahead of `currentIndex` — a clip moved there would never sound
   * again ON ITS OWN, and `next()` only ever advances.
   *
   * ⚠️ **The rule did not move when `previous()` arrived** (2026-10-27); only
   * its reason did. The past is reachable now — by the transport, by the lock
   * screen — so a clip behind the playhead is one press away rather than dead.
   * What stays true, and what this assertion is about, is that nothing
   * AUTOMATIC will ever land on it: a clip parked there needs a button somebody
   * may never press. The rule lives in the view, not in `queue.move`, which is
   * why it is asserted here.
   */
  it('will not let a clip move ahead of the one playing', async () => {
    const wrapper = await mountWithThreeClips();

    const up = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === 'Subir Corte 2 en la cola');

    expect(up?.attributes('disabled')).toBeDefined();

    resetAudioElementFactory();
    wrapper.unmount();
  });

  /**
   * ⚠️ **The drag is on POINTER events, not on HTML5 drag-and-drop**, and this
   * test is the reason the distinction is worth a test at all: the handle used
   * to carry `draggable="true"`, which fires nothing whatsoever for touch. On a
   * phone the asa did nothing while the screen's own hint told people to use
   * it.
   *
   * ⚠️ `document.elementFromPoint` is stubbed because **jsdom does not
   * implement it** — every browser does, so the geometry itself is the e2e
   * suite's job (`test/e2e/specs/11-queue.spec.ts`). What is asserted here is
   * the wiring: a touch-type pointer gesture moves the row.
   *
   * ⚠️ **The gesture ends on `document`, not on the handle**, and the release
   * here is dispatched there on purpose. Reordering the list moves the asa in
   * the DOM, which silently drops any pointer capture on it; with the listeners
   * on the element the `pointerup` landed elsewhere, `endDrag` never ran, and
   * the row stayed dimmed for ever.
   *
   * ⚠️ **Three clips, not two, and the THIRD row's handle.** The row playing
   * has no handle at all, and the row right after it cannot be a drag target
   * — dropping something there would put it ahead of what is playing. The
   * third row is the one still free to move, onto the second.
   */
  it('reorders by dragging with a finger, and lets go when the finger does', async () => {
    const wrapper = await mountWithThreeClips();
    const queue = useQueueStore();

    const rows = wrapper.findAll('.q-row');
    const original = document.elementFromPoint;
    // The pointer is over the SECOND row for the whole gesture.
    document.elementFromPoint = () => rows[1]!.element;

    const grip = rows[2]!.find('.q-row__grip');
    await grip.trigger('pointerdown', { pointerId: 1, pointerType: 'touch' });
    expect(wrapper.findAll('.q-row')[2]?.classes()).toContain('is-dragging');

    document.dispatchEvent(new Event('pointermove'));
    await wrapper.vm.$nextTick();
    expect(queue.keys).toEqual(['c1', 'c3', 'c2']);

    // Released far from the handle, which is where a real finger ends up.
    document.dispatchEvent(new Event('pointerup'));
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('.q-row').some((row) => row.classes().includes('is-dragging'))).toBe(
      false,
    );

    document.elementFromPoint = original;
    resetAudioElementFactory();
    wrapper.unmount();
  });

  it('empties the whole queue', async () => {
    const wrapper = await mountWithClips();
    const queue = useQueueStore();

    // ⚠️ Icon-only: the accessible name is the `aria-label`, not the text.
    await wrapper.find('[aria-label="Vaciar"]').trigger('click');

    expect(queue.isEmpty).toBe(true);

    resetAudioElementFactory();
    wrapper.unmount();
  });
});

describe('a shared queue arriving in a link', () => {
  beforeEach(() => {
    clipEndpoint.answers.set(137, apiClip(137));
    clipEndpoint.answers.set(107, apiClip(107));
  });

  /** `[137, 107]` → `2D1j`, the design's own encoding. */
  const CODE = '2D1j';

  it('offers three choices and takes none of them by itself', async () => {
    const wrapper = await mountQueue(`/cola?c=${CODE}`);
    const queue = useQueueStore();

    expect(wrapper.find('.queue__banner').text()).toContain('Te han pasado una cola');
    const actions = wrapper.findAll('.queue__banner-actions button').map((b) => b.text());
    expect(actions).toEqual(['Añadir al final', 'Reemplazar la mía', 'Descartar']);

    // ⚠️ **Nothing has happened yet.** A link somebody sent is not a command.
    expect(queue.keys).toEqual([]);

    resetAudioElementFactory();
    wrapper.unmount();
  });

  it('appends the shared clips when asked to', async () => {
    const wrapper = await mountQueue(`/cola?c=${CODE}`);
    const queue = useQueueStore();
    queue.enqueue(queued(9));
    await wrapper.vm.$nextTick();

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Añadir al final')
      ?.trigger('click');

    expect(queue.keys).toEqual(['c9', 'c137', 'c107']);

    resetAudioElementFactory();
    wrapper.unmount();
  });

  it('replaces the visitor’s queue only when they say so', async () => {
    const wrapper = await mountQueue(`/cola?c=${CODE}`);
    const queue = useQueueStore();
    queue.enqueue(queued(9));
    await wrapper.vm.$nextTick();

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Reemplazar la mía')
      ?.trigger('click');

    expect(queue.keys).toEqual(['c137', 'c107']);

    resetAudioElementFactory();
    wrapper.unmount();
  });

  it('drops the code from the URL once the question is answered', async () => {
    const wrapper = await mountQueue(`/cola?c=${CODE}`);

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Descartar')
      ?.trigger('click');
    await flushPromises();

    // ⚠️ Otherwise a reload asks the same question again.
    expect(router.currentRoute.value.fullPath).toBe('/cola');
    expect(wrapper.find('.queue__banner').exists()).toBe(false);

    resetAudioElementFactory();
    wrapper.unmount();
  });

  /**
   * ⚠️ **Silently.** Refusing a whole shared queue because one clip was deleted
   * through the admin surface is worse for the visitor than showing the rest.
   */
  it('drops an id that no longer exists without saying anything', async () => {
    clipEndpoint.answers.delete(107);

    const wrapper = await mountQueue(`/cola?c=${CODE}`);

    expect(wrapper.find('.queue__banner').text()).toContain('1 cortes');
    expect(wrapper.text()).not.toContain('error');

    resetAudioElementFactory();
    wrapper.unmount();
  });

  it('shows no banner at all for a code that decodes to nothing', async () => {
    const wrapper = await mountQueue('/cola?c=!!');

    expect(wrapper.find('.queue__banner').exists()).toBe(false);
    expect(clipEndpoint.requested).toEqual([]);

    resetAudioElementFactory();
    wrapper.unmount();
  });
});

/**
 * A whole episode among the clips (2026-08-25).
 *
 * ⚠️ The row is the same row — it moves, it plays, it goes away — with two
 * differences that are not cosmetic: it cannot be downloaded, and it cannot
 * travel in a share link.
 */
describe('an episode in the queue', () => {
  it('counts episodes apart from clips rather than averaging them away', async () => {
    const view = await mountQueue();
    const queue = useQueueStore();
    queue.enqueue(queued(1));
    queue.enqueue(queued(2));
    queue.enqueue(queuedEpisode(93));
    await view.vm.$nextTick();

    expect(view.find('.queue__meta').text()).toContain('2 cortes · 1 episodio');
  });

  it('names it, links to its page and says what it is', async () => {
    const view = await mountQueue();
    useQueueStore().enqueue(queuedEpisode(93));
    await view.vm.$nextTick();

    const row = view.find('.q-row');
    expect(row.find('.q-row__title a').attributes('href')).toBe('/episode/93-Episodio-93');
    expect(row.find('.q-row__meta').text()).toContain('Episodio completo');
    expect(row.find('.q-row__time').text()).toBe('03:02:37');
  });

  /** ⚠️ Absent, not disabled: the download button cuts a clip out of an
   *  episode, and there is no such thing for the episode itself. */
  it('offers no download', async () => {
    const view = await mountQueue();
    const queue = useQueueStore();
    queue.enqueue(queuedEpisode(93));
    queue.enqueue(queued(1));
    await view.vm.$nextTick();

    const rows = view.findAll('.q-row');
    const labels = (index: number) =>
      rows[index]?.findAll('.q-row__ico').map((b) => b.attributes('aria-label') ?? '') ?? [];

    expect(labels(0).some((label) => label.startsWith('Descargar'))).toBe(false);
    expect(labels(1).some((label) => label.startsWith('Descargar'))).toBe(true);
  });

  /**
   * ⚠️ **Said BEFORE the link is copied.** `?c=` is two base62 characters per
   * clip id with no room for a kind, and that format is a public URL shape, so
   * an episode simply cannot travel in one. Sharing a silently shorter queue is
   * the failure this line prevents.
   */
  it('warns that the episode will not travel in a shared link', async () => {
    const view = await mountQueue();
    const queue = useQueueStore();
    queue.enqueue(queued(1));
    await view.vm.$nextTick();
    expect(view.find('.queue__notice').exists()).toBe(false);

    queue.enqueue(queuedEpisode(93));
    await view.vm.$nextTick();

    expect(view.find('.queue__notice').text()).toContain('El episodio entero no viaja');
  });

  it('removes it by its own key, leaving the clip of the same id alone', async () => {
    const view = await mountQueue();
    const queue = useQueueStore();
    queue.enqueue(queued(93));
    queue.enqueue(queuedEpisode(93));
    await view.vm.$nextTick();

    const remove = view
      .findAll('.q-row__ico')
      .find((button) => button.attributes('aria-label') === 'Quitar Episodio 93 de la cola');
    await remove?.trigger('click');

    expect(queue.keys).toEqual(['c93']);
  });
});
