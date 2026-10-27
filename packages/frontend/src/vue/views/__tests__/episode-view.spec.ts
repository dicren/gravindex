import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { createPinia } from 'pinia';
import { PiniaColada } from '@pinia/colada';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import type { EpisodeClip } from '#/domain/clips/clip.entity';
import type { EpisodeDetail } from '#/domain/episodes/episode.entity';
import { NetworkError, NotFoundError } from '#/domain/errors';
import vuetify from '@/plugins/vuetify';
import {
  resetAudioElementFactory,
  setAudioElementFactory,
  usePlaybackStore,
  type PlaybackAudio,
  type PlaybackAudioEvent,
} from '@/stores/playback.store';
import { useQueueStore } from '@/stores/queue.store';
import ClipRowItem from '@/components/ClipRowItem.vue';
import EpisodeView from '@/views/EpisodeView.vue';
import { stubBrowserApis } from '@/components/__tests__/mount-with-vuetify';

/**
 * The episode screen. Three things here are load-bearing and none of them is
 * visible in a screenshot:
 *
 * 1. **`/episode/12-anything` is episode 12.** Only the leading integer of the
 *    `"<id>-<slug>"` form is ever parsed, which is what keeps links shared
 *    since 2019 working after the titles were re-scraped.
 * 2. **A failure moves the URL.** The 404 state is a route, so it can be linked
 *    and reloaded.
 * 3. **These clips carry `up` and no `points`.** That is the API's shape, and
 *    inventing the difference would print a number the server never sent.
 */

const episodeEndpoint = vi.hoisted(() => ({
  /** Ids the view actually asked the query layer for. */
  requestedIds: [] as number[],
  /** Ids the query actually RAN for — empty when `enabled` is false. */
  fetchedIds: [] as number[],
  answer: undefined as unknown,
}));

/**
 * `GET /episodes/:id/waveform`, which this screen asks for the WHOLE episode.
 *
 * ⚠️ `to` is where the episode's length comes from — the episode payload has no
 * duration field at all — so a `to` of `0` is the "nothing has measured this
 * one" case, not a broken fixture.
 */
const waveformEndpoint = vi.hoisted(() => ({
  /** Every `(episodeId, query)` pair the view asked for. */
  requests: [] as { episodeId: number; query: Record<string, unknown> }[],
  answer: { from: 0, to: 1200, peaks: [] as number[] } as unknown,
}));

vi.mock('@/queries/episodes.query', () => ({
  episodeQueryOptions: (episodeId: number) => {
    episodeEndpoint.requestedIds.push(episodeId);
    return {
      key: ['episodes', 'detail', episodeId],
      query: () => {
        episodeEndpoint.fetchedIds.push(episodeId);
        const answer = episodeEndpoint.answer;
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
      },
    };
  },
  episodeWaveformQueryOptions: (episodeId: number, query: Record<string, unknown>) => ({
    key: ['episodes', 'waveform', episodeId, query],
    query: () => {
      waveformEndpoint.requests.push({ episodeId, query });
      const answer = waveformEndpoint.answer;
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  }),
}));

// The row's own writes. Mounting the real `ClipRowItem` is the point — this
// screen must not reimplement voting, sharing, downloading or queueing — but its
// mutations have no business reaching a network layer here.
vi.mock('@/queries/clips.query', () => ({
  useVoteClip: () => ({ mutateAsync: vi.fn() }),
  useRegisterPlay: () => ({ mutate: vi.fn() }),
  useAddTag: () => ({ mutateAsync: vi.fn() }),
}));

// ⚠️ The queue store reaches for the play counter directly, not through the
// query layer mocked above — and the real one would call the `fetch` that
// `vitest.setup.ts` makes throw.
vi.mock('#/config/clips.config', () => ({ registerPlayUseCase: { execute: vi.fn() } }));

vi.mock('@/queries/tags.query', () => ({
  // ⚠️ `{ tag, count }` — `GET /tags` answers objects, not a flat `string[]`.
  useTagList: () => ({
    data: { value: ['Mulata', 'Canciones'].map((tag) => ({ tag, count: 1 })) },
    isPending: { value: false },
    isLoading: { value: false },
  }),
}));

const CLIP: EpisodeClip = {
  id: 178,
  title: 'La mulata del clítor...',
  start: 792,
  end: 870,
  tags: ['Mulata'],
  up: 15,
};

const EPISODE: EpisodeDetail = {
  id: 63,
  title: 'Episodio 86 (Spanish Zombies)',
  cover: 'https://example.invalid/cover.png',
  file: 'https://example.invalid/Episodio086.mp3',
  originalUrl: 'https://example.invalid/episodio-86',
  date: new Date(2012, 10, 18),
  clips: [CLIP],
};

/** jsdom does not implement `HTMLMediaElement.play()`, which is why the
 *  playback store takes a factory at all. */
class FakeAudio implements PlaybackAudio {
  src = '';
  currentTime = 0;
  duration = Number.NaN;
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

const Blank = defineComponent({ render: () => null });

let router: Router;
let wrapper: VueWrapper | undefined;

async function mountEpisode(url: string): Promise<VueWrapper> {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Blank },
      { path: '/episodes/:page?', name: 'episodes', component: Blank },
      { path: '/episode/:title', name: 'episode', component: Blank },
      { path: '/creator/:title', name: 'creator', component: Blank },
      { path: '/error/404', name: 'error404', component: Blank },
      { path: '/error', name: 'errorUnknown', component: Blank },
      { path: '/:id', name: 'clip', component: Blank },
    ],
  });
  await router.push(url);
  await router.isReady();

  wrapper = mount(EpisodeView, {
    global: { plugins: [createPinia(), PiniaColada, vuetify, router] },
  });
  await flushPromises();
  return wrapper;
}

beforeAll(stubBrowserApis);

beforeEach(() => {
  localStorage.clear();
  episodeEndpoint.requestedIds = [];
  episodeEndpoint.fetchedIds = [];
  episodeEndpoint.answer = EPISODE;
  waveformEndpoint.requests = [];
  waveformEndpoint.answer = { from: 0, to: 1200, peaks: [] };
  setAudioElementFactory(() => new FakeAudio());
});

afterEach(() => {
  resetAudioElementFactory();
  wrapper?.unmount();
  wrapper = undefined;
});

describe('the URL', () => {
  it('parses only the leading integer of "<id>-<slug>"', async () => {
    const view = await mountEpisode('/episode/12-anything');

    // ⚠️ The slug is decoration and is never validated: the id is what resolves.
    expect(episodeEndpoint.requestedIds).toContain(12);
    expect(episodeEndpoint.fetchedIds).toEqual([12]);
    expect(view.text()).toContain('Episodio 86 (Spanish Zombies)');
  });

  it('resolves a bare id with no slug at all', async () => {
    await mountEpisode('/episode/63');

    expect(episodeEndpoint.fetchedIds).toEqual([63]);
  });
});

describe('when there is no such episode', () => {
  it('sends an unparseable id to the 404 URL without asking the server', async () => {
    await mountEpisode('/episode/melocoton');

    // ⚠️ The address MOVES, so the error can be linked and survives a reload.
    expect(router.currentRoute.value.path).toBe('/error/404');
    // ...and `enabled` kept the pointless `GET /episodes/NaN` from going out,
    // which would have come back a 400 and landed on the WRONG error page.
    expect(episodeEndpoint.fetchedIds).toEqual([]);
  });

  it('sends a missing episode to the 404 URL', async () => {
    episodeEndpoint.answer = new NotFoundError('episode 9999');
    await mountEpisode('/episode/9999-fantasma');

    expect(episodeEndpoint.fetchedIds).toEqual([9999]);
    expect(router.currentRoute.value.path).toBe('/error/404');
  });

  it('sends anything else to the unknown-error URL', async () => {
    // The `notifyError(ex, true)` split, minus the HTTP status it branched on:
    // "this is gone" and "this did not work" are different pages.
    episodeEndpoint.answer = new NetworkError('offline');
    await mountEpisode('/episode/63');

    expect(router.currentRoute.value.path).toBe('/error');
  });
});

describe('what the screen shows', () => {
  it('leads with the episode and the section title', async () => {
    const view = await mountEpisode('/episode/63');

    const heading = view.find('h1');
    expect(heading.text()).toBe('Episodio 86 (Spanish Zombies)');
    expect(view.text()).toContain('18 de Noviembre de 2012');
    expect(view.text()).toContain('Los mejores momentos');
    // ⚠️ This screen's episode header is the same one the
    // editor carries, `Cortar` included — the two screens about one episode
    // open the same way.
    expect(view.text()).toContain('Cortar');
    expect(view.text()).toContain('1 corte');
  });

  it('renders a row per clip, with its vote tally and no invented points', async () => {
    const view = await mountEpisode('/episode/63');

    const rows = view.findAllComponents(ClipRowItem);
    expect(rows).toHaveLength(1);

    const clip = rows[0]?.props('clip');
    expect(clip).toMatchObject({ up: 15 });
    // ⚠️ `GET /episodes/:id` counts the votes but sends no `points`. One here
    // would be a number the server never sent.
    expect(clip && 'points' in clip).toBe(false);
    // ⚠️ …and no `down` anywhere: every vote is positive.
    expect(clip && 'down' in clip).toBe(false);

    // `compact` hides the episode line: the episode is
    // already the page, and an `EpisodeClip` carries none of its own anyway.
    expect(rows[0]?.props('compact')).toBe(true);
    expect(rows[0]?.props('episode')).toMatchObject({ id: 63 });

    expect(view.find('.i-row__count').text()).toBe('15');
  });

  it('says it is loading until the episode arrives', async () => {
    // A promise that never settles: the view has nothing else to render, and
    // deliberately no error branch — every failure navigates away instead.
    episodeEndpoint.answer = new Promise(() => {});
    const view = await mountEpisode('/episode/63');

    expect(view.text()).toContain('cargando el episodio…');
  });

  it('invites you to cut the first clip, with the app’s own joke, verbatim', async () => {
    episodeEndpoint.answer = { ...EPISODE, clips: [] };
    const view = await mountEpisode('/episode/63');

    // ⚠️ THIS is where the line comes from — an episode nobody has cut yet. It
    // is content, not filler: do not rewrite, improve or translate it.
    expect(view.find('.episode__empty p').text()).toBe(
      'Esto está más vacío que la petaca de Melocotón Cane',
    );
    expect(view.findAllComponents(ClipRowItem)).toHaveLength(0);

    // ⚠️ The label changed with the B3 empty state (2026-08-25): `¡Crea un
    // corte!` became `Corta el primero`, which is what the accepted drawing
    // said. The JOKE above is the part that is frozen; this is a button.
    const invite = view.find('.episode__empty a');
    expect(invite.text()).toBe('Corta el primero');
    // ⚠️ The editor takes the bare id, not the `<id>-<slug>` form.
    expect(invite.attributes('href')).toBe('/creator/63');
  });
});

describe('a tag clicked on a row', () => {
  it('navigates to the library filtered by it', async () => {
    const view = await mountEpisode('/episode/63');

    const chip = view
      .findAll('button')
      .find((b) => b.attributes('aria-label') === 'Filtrar por el tag Mulata');
    await chip?.trigger('click');
    await flushPromises();

    // ⚠️ Only the library can BECOME a filter, so from here it is a navigation.
    // A card must not decide this for itself by branching on `$route.path`,
    // which would put routing knowledge inside a component three screens reuse.
    expect(router.currentRoute.value.name).toBe('home');
    // The shape the library reads back — one repeatable `tags` key, which is
    // the query string that shared links already use.
    expect(router.currentRoute.value.fullPath).toBe('/?tags=Mulata');
    expect(router.currentRoute.value.query).toEqual({ tags: ['Mulata'] });
  });
});

/**
 * The map: the whole episode's waveform with its published clips drawn on it.
 *
 * ⚠️ Three facts here are the whole reason the screen was rebuilt, and none of
 * them is visible in a screenshot either:
 *
 * 1. **The length comes from the waveform.** `GET /episodes/:id` has no
 *    duration field, so `to` is the only number that can place a band.
 * 2. **The episode plays through the QUEUE**, not through an audio element this
 *    view owns — one transport for the whole site.
 * 3. **`to: 0` is a real state**, not a failure: nine episodes have no measured
 *    waveform, and the screen says "midiendo el episodio…" rather than drawing
 *    bands against a scale it does not have.
 */
describe('the episode map', () => {
  it('asks for the whole episode at full resolution', async () => {
    await mountEpisode('/episode/63');

    expect(waveformEndpoint.requests).toEqual([
      // ⚠️ No `from`/`to` — that is what makes it the whole file — and the
      // maximum the endpoint allows, because the bars are averaged down in the
      // browser (`utils/waveform-bars.ts`).
      { episodeId: 63, query: { points: 2000 } },
    ]);
  });

  it('prints the measured length in the header', async () => {
    waveformEndpoint.answer = { from: 0, to: 10957, peaks: [] };
    const view = await mountEpisode('/episode/63');

    expect(view.find('[data-test="episode-duration"]').text()).toBe('03:02:37');
  });

  it('draws one band per clip, placed by where the cut is', async () => {
    waveformEndpoint.answer = { from: 0, to: 1000, peaks: [] };
    const view = await mountEpisode('/episode/63');

    const bands = view.findAll('.ep-map__band');
    expect(bands).toHaveLength(1);
    // The fixture clip runs 792 → 870 of a 1000 s episode.
    expect(bands[0]?.attributes('style')).toContain('left: 79.2%');
    expect(bands[0]?.attributes('style')).toContain('width: 7.8%');
  });

  /**
   * ⚠️ **A minimum width, and it is load-bearing.** The shortest clip in the
   * database runs 39 seconds against a three-hour episode — 0,36 %, which on a
   * phone is one pixel and is not something a finger can hit.
   */
  it('never draws a band too thin to press', async () => {
    waveformEndpoint.answer = { from: 0, to: 10957, peaks: [] };
    episodeEndpoint.answer = {
      ...EPISODE,
      clips: [{ ...CLIP, start: 3415, end: 3454 }],
    };
    const view = await mountEpisode('/episode/63');

    expect(view.find('.ep-map__band').attributes('style')).toContain('width: 0.6%');
  });

  /** ⚠️ A band plays THAT CLIP, rather than seeking the episode to it: every
   *  other control on this site that names a clip plays that clip. */
  it('plays the clip when its band is pressed', async () => {
    const view = await mountEpisode('/episode/63');
    const queue = useQueueStore();

    await view.find('.ep-map__band').trigger('click');

    expect(queue.keys).toEqual(['c178']);
    expect(queue.current).toMatchObject({
      kind: 'clip',
      id: 178,
      // ⚠️ A clip has no audio file of its own: the episode's mp3.
      src: 'https://example.invalid/Episodio086.mp3',
    });
  });

  it('lights the matching row while a band is hovered, and lets go', async () => {
    const view = await mountEpisode('/episode/63');

    await view.find('.ep-map__band').trigger('mouseenter');
    expect(view.find('.episode__row').classes()).toContain('is-marked');

    await view.find('.ep-map__band').trigger('mouseleave');
    expect(view.find('.episode__row').classes()).not.toContain('is-marked');
  });

  it('lights the matching band while a row is hovered', async () => {
    const view = await mountEpisode('/episode/63');

    await view.find('.episode__row').trigger('mouseenter');
    expect(view.find('.ep-map__band').classes()).toContain('is-marked');
  });

  /**
   * ⚠️ **Through the queue.** The rejected alternative was an `<audio>` owned
   * by this view, as the editor has: a row on this site has no play button
   * precisely because there is one transport, and an episode is three hours
   * long, so leaving the page must not cut it off.
   */
  it('queues the episode itself when told to listen', async () => {
    waveformEndpoint.answer = { from: 0, to: 10957, peaks: [] };
    const view = await mountEpisode('/episode/63');
    const queue = useQueueStore();
    const playback = usePlaybackStore();

    await view.find('.ep-transport__play').trigger('click');

    expect(queue.keys).toEqual(['e63']);
    expect(queue.current).toMatchObject({
      kind: 'episode',
      id: 63,
      title: 'Episodio 86 (Spanish Zombies)',
      // The measured length rides along, so the player's clock is right from
      // the first frame instead of waiting for the browser to read the file.
      end: 10957,
    });
    expect(playback.playing).toBe(true);
    expect(view.find('.ep-transport__play').text()).toBe('Pausar');
  });

  /**
   * ⚠️ **Both transport buttons are their glyph alone below 720 px**, so the
   * visible words stopped being their accessible name and an `aria-label` had to
   * take over. A control whose name lives in a `<span>` a media query hides is a
   * control a screen reader announces as "botón" on a phone and nowhere else —
   * which is also why the label follows the state rather than being constant.
   */
  it('names both transport buttons independently of the words it draws', async () => {
    const view = await mountEpisode('/episode/63');

    const play = view.find('.ep-transport__play');
    const share = view.find('.ep-transport__share');

    expect(play.attributes('aria-label')).toBe('Escuchar el episodio');
    expect(share.attributes('aria-label')).toBe('Compartir el episodio');

    await play.trigger('click');
    expect(view.find('.ep-transport__play').attributes('aria-label')).toBe('Pausar');
  });

  it('pauses and resumes without restarting the episode', async () => {
    const view = await mountEpisode('/episode/63');
    const playback = usePlaybackStore();

    await view.find('.ep-transport__play').trigger('click');
    await view.find('.ep-transport__play').trigger('click');
    expect(playback.playing).toBe(false);

    await view.find('.ep-transport__play').trigger('click');
    expect(playback.playing).toBe(true);
    expect(playback.elapsed).toBe(0);
  });

  /**
   * ⚠️ **A click on the wave starts the episode as well as seeking.** "From
   * here" is a play instruction; asking somebody to press play first and then
   * find the same spot again is the interaction the map exists to replace.
   */
  it('starts the episode at the point clicked on the wave', async () => {
    waveformEndpoint.answer = { from: 0, to: 1000, peaks: [] };
    const view = await mountEpisode('/episode/63');
    const queue = useQueueStore();
    const playback = usePlaybackStore();

    const wave = view.find('.ep-map__wave');
    wave.element.getBoundingClientRect = () => ({ left: 0, width: 100 }) as unknown as DOMRect;
    await wave.trigger('click', { clientX: 25 });

    expect(queue.current).toMatchObject({ kind: 'episode', id: 63 });
    expect(playback.elapsed).toBe(250);
  });

  /**
   * ⚠️ **Mis momentos** (2026-08-26): the private marks somebody leaves while
   * listening. Three properties are the design, and none of them is obvious
   * from the markup:
   *
   * 1. **They are drawn in their own lane, above the wave**, because the wave
   *    already carries the published clips and a mark inside a band would be
   *    two controls fighting for one click.
   * 2. **Marking needs the episode to be sounding.** There is no "current
   *    second" otherwise, and a button that marked 00:00 would be worse than one
   *    that is visibly unavailable.
   * 3. **Nothing reaches the server.** The whole feature lives in
   *    `localStorage`, which is also how these tests seed it.
   */
  describe('mis momentos', () => {
    const MOMENTS_KEY = 'gravindex.moments';

    function seedMoments(moments: object[]): void {
      localStorage.setItem(MOMENTS_KEY, JSON.stringify({ moments }));
    }

    it('draws neither a lane nor a section for an episode nobody has marked', async () => {
      const view = await mountEpisode('/episode/63');

      expect(view.find('.ep-lane').exists()).toBe(false);
      expect(view.find('[data-test="moment-list"]').exists()).toBe(false);
      // ⚠️ Absent, not an empty state: this screen carries the button that
      // creates the first one, so a box explaining the feature would sit next
      // to the thing it is explaining.
      expect(view.text()).not.toContain('Mis momentos');
    });

    it('refuses to mark until the episode is what is sounding, and says why', async () => {
      const view = await mountEpisode('/episode/63');

      const mark = view.find('[data-test="mark-moment"]');
      expect(mark.attributes('disabled')).toBeDefined();
      expect(mark.attributes('aria-label')).toBe('Escucha el episodio para marcar un momento');

      await view.find('.ep-transport__play').trigger('click');

      expect(view.find('[data-test="mark-moment"]').attributes('disabled')).toBeUndefined();
      expect(view.find('[data-test="mark-moment"]').attributes('aria-label')).toBe(
        'Marcar este momento',
      );
    });

    it('marks the second before the button was pressed, and draws it', async () => {
      waveformEndpoint.answer = { from: 0, to: 1000, peaks: [] };
      const view = await mountEpisode('/episode/63');
      const playback = usePlaybackStore();

      await view.find('.ep-transport__play').trigger('click');
      playback.seek(500);
      await view.vm.$nextTick();
      await view.find('[data-test="mark-moment"]').trigger('click');

      // 500 minus the four seconds nobody presses in time.
      expect(view.find('[data-test="moment-list"]').text()).toContain('00:08:16');
      const pin = view.find('[data-test="moment-pin"]');
      expect(pin.exists()).toBe(true);
      // 496 of 1000 seconds.
      expect(pin.attributes('style')).toContain('49.6%');
    });

    it('plays the episode from before a pin, so the mark is not already past', async () => {
      waveformEndpoint.answer = { from: 0, to: 1000, peaks: [] };
      seedMoments([{ episodeId: 63, at: 500, markedAt: Date.UTC(2026, 7, 24) }]);
      const view = await mountEpisode('/episode/63');
      const queue = useQueueStore();
      const playback = usePlaybackStore();

      await view.find('[data-test="moment-pin"]').trigger('click');

      expect(queue.current).toMatchObject({ kind: 'episode', id: 63 });
      // ⚠️ Twenty seconds of run-up: landing exactly on the mark would start
      // the audio after the thing that was marked.
      expect(playback.elapsed).toBe(480);
    });

    it('opens the editor on a window around the mark, and says which mark it was', async () => {
      seedMoments([{ episodeId: 63, at: 500, markedAt: Date.UTC(2026, 7, 24) }]);
      const view = await mountEpisode('/episode/63');

      const cut = view.find('[data-test="moment-cut"]');

      expect(cut.attributes('href')).toBe('/creator/63?start=480&end=520&moment=500');
    });

    it('forgets one when its row asks to', async () => {
      seedMoments([
        { episodeId: 63, at: 500, markedAt: Date.UTC(2026, 7, 24) },
        { episodeId: 63, at: 900, markedAt: Date.UTC(2026, 7, 25) },
      ]);
      const view = await mountEpisode('/episode/63');
      expect(view.findAll('[data-test="moment-pin"]')).toHaveLength(2);

      await view.find('.moment__forget').trigger('click');

      expect(view.findAll('[data-test="moment-pin"]')).toHaveLength(1);
      expect(view.find('[data-test="moment-list"]').text()).not.toContain('00:08:20');
      expect(JSON.parse(localStorage.getItem(MOMENTS_KEY) ?? '{}')).toEqual({
        moments: [{ episodeId: 63, at: 900, markedAt: Date.UTC(2026, 7, 25) }],
      });
    });

    /**
     * ⚠️ **The mark survives the clip cut from it** — the accepted answer of
     * three. It stops offering to cut the same second twice and links to what
     * came of it instead.
     */
    it('says which clip a mark became, and stops offering to cut it again', async () => {
      seedMoments([{ episodeId: 63, at: 800, markedAt: Date.UTC(2026, 7, 24), clipId: CLIP.id }]);
      const view = await mountEpisode('/episode/63');

      const list = view.find('[data-test="moment-list"]');
      expect(list.text()).toContain(`ya es el corte nº ${CLIP.id}`);
      expect(list.find('a').attributes('href')).toBe(`/${CLIP.id}`);
      expect(view.find('[data-test="moment-cut"]').exists()).toBe(false);
    });

    /** ⚠️ A clip the admin surface deleted leaves the mark behind. Offering
     *  `Cortar` again is then the truth, not a regression. */
    it('goes back to offering the cut when the clip it names is gone', async () => {
      seedMoments([{ episodeId: 63, at: 800, markedAt: Date.UTC(2026, 7, 24), clipId: 9999 }]);
      const view = await mountEpisode('/episode/63');

      expect(view.find('[data-test="moment-list"]').text()).toContain('sin cortar');
      expect(view.find('[data-test="moment-cut"]').exists()).toBe(true);
    });

    it('only draws the marks of the episode on screen', async () => {
      seedMoments([
        { episodeId: 63, at: 500, markedAt: Date.UTC(2026, 7, 24) },
        { episodeId: 99, at: 700, markedAt: Date.UTC(2026, 7, 24) },
      ]);
      const view = await mountEpisode('/episode/63');

      expect(view.findAll('[data-test="moment-pin"]')).toHaveLength(1);
      expect(view.text()).toContain('1 momento tuyo');
    });
  });

  /**
   * The nine episodes nothing has measured, and the moment before the request
   * answers. ⚠️ Drawn rather than hidden: no bands, no scale, and a line that
   * says which of the two it is.
   */
  describe('an episode with no measured waveform', () => {
    beforeEach(() => {
      waveformEndpoint.answer = { from: 0, to: 0, peaks: [] };
    });

    it('says so instead of placing bands against a scale it does not have', async () => {
      const view = await mountEpisode('/episode/63');

      expect(view.text()).toContain('midiendo el episodio…');
      expect(view.findAll('.ep-map__band')).toHaveLength(0);
      expect(view.find('[data-test="episode-duration"]').text()).toBe('--:--');
    });

    /** ⚠️ Still playable: `end: 0` is "until the file runs out", and the
     *  browser is what supplies the length. */
    it('still plays, with the length left for the browser to report', async () => {
      const view = await mountEpisode('/episode/63');
      const queue = useQueueStore();

      await view.find('.ep-transport__play').trigger('click');

      expect(queue.current).toMatchObject({ kind: 'episode', id: 63, end: 0 });
    });

    /** A click on the wave has no scale to turn into a position, so it does
     *  nothing at all rather than starting the episode at zero. */
    it('ignores a click on the wave', async () => {
      const view = await mountEpisode('/episode/63');
      const queue = useQueueStore();

      const wave = view.find('.ep-map__wave');
      wave.element.getBoundingClientRect = () => ({ left: 0, width: 100 }) as unknown as DOMRect;
      await wave.trigger('click', { clientX: 25 });

      expect(queue.keys).toEqual([]);
    });
  });
});
