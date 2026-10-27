import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { PiniaColada } from '@pinia/colada';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import type { EpisodeDetail } from '#/domain/episodes/episode.entity';
import { NetworkError, NotFoundError, RequestRejectedError } from '#/domain/errors';
import vuetify from '@/plugins/vuetify';
import EditorView from '@/views/EditorView.vue';
import TagPicker from '@/components/TagPicker.vue';
import ThreeHandleSlider from '@/components/ThreeHandleSlider.vue';
import { useNotificationsStore } from '@/stores/notifications.store';
import { hhmmssToSeconds } from '@/utils/timecode';
import type { EditorAudio, EditorAudioEvent } from '@/utils/editor-audio';
import { stubBrowserApis } from '@/components/__tests__/mount-with-vuetify';

/**
 * The clip editor. The assertions that matter here are the ones a screenshot
 * cannot make:
 *
 * 1. **What is published is what was displayed.** The editor keeps seconds, not
 *    strings, so the property has to be proved rather than assumed — the spec
 *    reads the timecodes off the DOM and parses them back.
 * 2. **Zoom narrows the window, not the cut.** Zooming must not rebuild the
 *    slider; nothing may fall out of it.
 * 3. **A 400 is the server talking, not the network failing.** It arrives as
 *    `REQUEST_REJECTED` carrying the backend's own sentence, and that sentence
 *    is what the visitor reads.
 */

// ── The fake episode ─────────────────────────────────────────────────────────

const episodeEndpoint = vi.hoisted(() => ({
  requestedIds: [] as number[],
  fetchedIds: [] as number[],
  answer: undefined as unknown,
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
  // ⚠️ The zoomed track's waveform is decorative here — `grav-wave.spec.ts`
  // covers measured-vs-placeholder, and this file's assertions are about the
  // slider, the timecodes and publishing. An empty `data` keeps `GravWave` on
  // its drawn placeholder, same as before this query existed.
  useEpisodeWaveform: () => ({ data: { value: undefined } }),
}));

const clipsApi = vi.hoisted(() => ({
  created: [] as unknown[],
  failure: undefined as unknown,
}));

vi.mock('@/queries/clips.query', () => ({
  useCreateClip: () => ({
    mutateAsync: (draft: unknown) => {
      if (clipsApi.failure) return Promise.reject(clipsApi.failure);
      clipsApi.created.push(draft);
      return Promise.resolve({ id: 999 });
    },
  }),
}));

vi.mock('@/queries/tags.query', () => ({
  // ⚠️ `{ tag, count }` — `GET /tags` answers objects, not a flat `string[]`.
  useTagList: () => ({
    data: { value: ['Mulata'].map((tag) => ({ tag, count: 1 })) },
    isPending: { value: false },
    isLoading: { value: false },
  }),
}));

/**
 * ⚠️ **The cross-tab seam, stubbed so this screen's half of it is observable**
 * (2026-10-27). The editor claims the sound when it plays and gives it up when
 * another tab does; both halves are one call each into
 * `tab-coordination/start-tab-coordination.ts`, and neither is otherwise visible
 * from here.
 */
const tabCoordination = vi.hoisted(() => ({
  claim: vi.fn(),
  listeners: [] as (() => void)[],
  subscriptions: 0,
  unsubscriptions: 0,
}));

vi.mock('@/tab-coordination/start-tab-coordination', () => ({
  claimPlayback: tabCoordination.claim,
  onSoundTaken: (listener: () => void) => {
    tabCoordination.subscriptions += 1;
    tabCoordination.listeners.push(listener);
    return () => {
      tabCoordination.unsubscriptions += 1;
    };
  },
}));

/** Some other tab started sounding, as the shell would report it. */
function anotherTabTookTheSound(): void {
  for (const listener of [...tabCoordination.listeners]) listener();
}

// ── The fake audio element ───────────────────────────────────────────────────

/**
 * ⚠️ jsdom implements no part of `HTMLMediaElement` playback — `play()` throws
 * "Not implemented" and `duration` is `NaN` forever — so the editor takes its
 * element from a factory the same way `playback.store` does, and this replaces
 * it. Everything the screen does to the audio is observable on this object.
 */
class FakeAudio implements EditorAudio {
  currentTime = 0;
  duration = 10_020;
  playbackRate = 1;
  playing = false;
  playCalls = 0;
  pauseCalls = 0;
  private readonly listeners = new Map<EditorAudioEvent, Set<() => void>>();

  constructor(readonly src: string) {}

  play(): Promise<void> {
    this.playing = true;
    this.playCalls += 1;
    return Promise.resolve();
  }

  pause(): void {
    this.playing = false;
    this.pauseCalls += 1;
  }

  addEventListener(type: EditorAudioEvent, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: EditorAudioEvent, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: EditorAudioEvent): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }
}

const audioSpy = vi.hoisted(() => ({
  instances: [] as unknown[],
  duration: 10_020,
}));

vi.mock('@/utils/editor-audio', async () => {
  const actual =
    await vi.importActual<typeof import('@/utils/editor-audio')>('@/utils/editor-audio');
  return {
    ...actual,
    createEditorAudio: (src: string) => {
      const element = new FakeAudio(src);
      element.duration = audioSpy.duration;
      audioSpy.instances.push(element);
      return element;
    },
  };
});

function lastAudio(): FakeAudio {
  const element = audioSpy.instances.at(-1);
  if (!(element instanceof FakeAudio)) throw new Error('the editor built no audio element');
  return element;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const EPISODE: EpisodeDetail = {
  id: 63,
  title: 'Episodio 86 (Spanish Zombies)',
  cover: 'https://example.invalid/cover.png',
  file: 'https://example.invalid/Episodio086.mp3',
  originalUrl: 'https://example.invalid/episodio-86',
  date: new Date(2012, 10, 18),
  clips: [
    {
      id: 178,
      title: 'La mulata del clítor...',
      start: 792,
      end: 870,
      tags: ['Mulata'],
      up: 15,
    },
  ],
};

/** `duration - 10 min`, the default end. 10 020 − 600 = 9 420 = 02:37:00. */
const DEFAULT_END_LABEL = '02:37:00';

const Blank = defineComponent({ render: () => null });

let router: Router;
let wrapper: VueWrapper | undefined;

async function mountEditor(url = '/creator/63-episodio-86'): Promise<VueWrapper> {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: Blank },
      { path: '/episode/:title', name: 'episode', component: Blank },
      { path: '/creator', name: 'creatorSearch', component: Blank },
      { path: '/creator/:title', name: 'creator', component: Blank },
      { path: '/error/404', name: 'error404', component: Blank },
      { path: '/error', name: 'errorUnknown', component: Blank },
      { path: '/:id', name: 'clip', component: Blank },
    ],
  });
  await router.push(url);
  await router.isReady();

  wrapper = mount(EditorView, {
    global: { plugins: [createPinia(), PiniaColada, vuetify, router] },
  });
  await flushPromises();
  return wrapper;
}

/** Mount, then let the stream report its duration — the `canplay` gate. */
async function mountReady(url?: string): Promise<VueWrapper> {
  const view = await mountEditor(url);
  lastAudio().emit('canplay');
  await flushPromises();
  return view;
}

/**
 * What the screen displays for a `data-test`.
 *
 * ⚠️ **`cut-start` and `cut-end` are `<input>`s since 2026-08-22** and the rest
 * are still elements, so this reads whichever the node actually is. The property
 * the whole file exists to pin — *what is published is parsed back out of what
 * the screen displays* — is unchanged by that; what "displays" means for a text
 * field is its `value`.
 */
function shown(view: VueWrapper, name: string): string {
  const node = view.find(`[data-test="${name}"]`);
  const element = node.element as HTMLElement;
  return element instanceof HTMLInputElement ? element.value : node.text();
}

/** Type into one of the two timecode fields, as a person would. */
async function typeTime(view: VueWrapper, name: 'cut-start' | 'cut-end', text: string) {
  const field = view.find(`[data-test="${name}"]`);
  await field.trigger('focus');
  await field.setValue(text);
}

function clickByLabel(view: VueWrapper, label: string): Promise<void> {
  const button = view.findAll('button').find((b) => b.attributes('aria-label') === label);
  if (button === undefined) throw new Error(`no button labelled "${label}"`);
  return button.trigger('click');
}

function clickByText(view: VueWrapper, text: string): Promise<void> {
  const button = view.findAll('button').find((b) => b.text().trim() === text);
  if (button === undefined) throw new Error(`no button reading "${text}"`);
  return button.trigger('click');
}

/** The slider's own emission, i.e. what a real drag produces. */
async function dragTimeline(view: VueWrapper, next: [number, number, number]): Promise<void> {
  view.findComponent(ThreeHandleSlider).vm.$emit('update:modelValue', next);
  await nextTick();
}

async function fillClip(view: VueWrapper, title: string, tags: string[]): Promise<void> {
  await view.find('#editor-title').setValue(title);
  view.findComponent(TagPicker).vm.$emit('update:modelValue', tags);
  await nextTick();
}

beforeAll(stubBrowserApis);

beforeEach(() => {
  setActivePinia(createPinia());
  episodeEndpoint.requestedIds = [];
  episodeEndpoint.fetchedIds = [];
  episodeEndpoint.answer = EPISODE;
  clipsApi.created = [];
  clipsApi.failure = undefined;
  audioSpy.instances = [];
  audioSpy.duration = 10_020;
  tabCoordination.claim.mockClear();
  tabCoordination.listeners = [];
  tabCoordination.subscriptions = 0;
  tabCoordination.unsubscriptions = 0;
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.useRealTimers();
});

describe('the URL', () => {
  it('parses only the leading integer of "<id>-<slug>"', async () => {
    await mountReady('/creator/63-episodio-86');

    expect(episodeEndpoint.fetchedIds).toEqual([63]);
  });

  it('resolves a bare episode id, as links to the editor may carry it', async () => {
    await mountReady('/creator/63');

    expect(episodeEndpoint.fetchedIds).toEqual([63]);
  });

  it('sends an unparseable id to the 404 URL without asking the server', async () => {
    await mountEditor('/creator/melocoton');

    expect(router.currentRoute.value.path).toBe('/error/404');
    expect(episodeEndpoint.fetchedIds).toEqual([]);
  });

  it('sends a missing episode to the 404 URL', async () => {
    episodeEndpoint.answer = new NotFoundError('episode 9999');
    await mountEditor('/creator/9999-fantasma');

    expect(router.currentRoute.value.path).toBe('/error/404');
  });

  it('sends anything else to the unknown-error URL', async () => {
    episodeEndpoint.answer = new NetworkError('offline');
    await mountEditor();

    expect(router.currentRoute.value.path).toBe('/error');
  });
});

describe('what the screen shows', () => {
  it('waits until the stream reports a duration before drawing anything', async () => {
    // ⚠️ The `canplay` gate: there is nothing to cut before the browser
    // knows how long the episode is — and nothing to SCALE the episode map by
    // either, which is why it is drawn disabled rather
    // than guessing a length.
    const view = await mountEditor();
    expect(view.text()).toContain('cargando el episodio…');
    expect(view.find('.ed-map').exists()).toBe(false);

    lastAudio().emit('canplay');
    await flushPromises();
    expect(view.text()).not.toContain('cargando el episodio…');
    // ⚠️ The EPISODE is the page title now, not "Editor de cortes": the screen
    // opens with the same header `/episode/:title` does, so the two screens
    // about one episode start the same way.
    expect(view.find('h1').text()).toBe('Episodio 86 (Spanish Zombies)');
  });

  it('names the episode and says how many cuts it already has', async () => {
    const view = await mountReady();

    expect(view.text()).toContain('Episodio 86 (Spanish Zombies)');
    expect(view.text()).toContain('1 corte ya publicado');
  });

  it('opens on the whole episode minus its last ten minutes', async () => {
    const view = await mountReady();

    expect(shown(view, 'cut-start')).toBe('00:00:00');
    expect(shown(view, 'cut-end')).toBe(DEFAULT_END_LABEL);
    expect(shown(view, 'cut-duration')).toBe('02:37:00');
    // The episode's own length is in the header now, next to the clip count,
    // rather than in a third box under the timeline.
    expect(view.text()).toContain('02:47:00');
  });

  it('streams the EPISODE mp3, since a clip has no file of its own', async () => {
    await mountReady();

    expect(lastAudio().src).toBe('https://example.invalid/Episodio086.mp3');
  });

  /**
   * ⚠️ **The clips already published are DRAWN now, not listed** — a strip over
   * the whole episode and dashed boxes over the zoomed track.
   * The grid of cards this replaces said the
   * same thing in words and could not say WHERE.
   *
   * They restrict nothing: overlapping stays allowed, and this is about not
   * doing it by accident.
   */
  it('draws the clips already cut from this episode on the episode map', async () => {
    const view = await mountReady();

    const bands = view.findAll('.ed-map__clip');
    expect(bands).toHaveLength(1);
    expect(bands[0]?.attributes('title')).toBe('Nº 178 · La mulata del clítor...');
    // And the cut being made, in red, on the same strip.
    expect(view.find('.ed-map__new').exists()).toBe(true);
    // And the zoom window outlined over it — "lo que ves abajo".
    expect(view.find('.ed-map__window').exists()).toBe(true);
  });

  it('marks a published clip over the zoomed track when it falls inside the view', async () => {
    const view = await mountReady();

    const marks = view.findAll('.ed-existing');
    expect(marks).toHaveLength(1);
    expect(marks[0]?.text()).toContain('Nº 178 · La mulata del clítor...');
  });

  it('draws no bands at all when nobody has cut this episode yet', async () => {
    episodeEndpoint.answer = { ...EPISODE, clips: [] };
    const view = await mountReady();

    expect(view.findAll('.ed-map__clip')).toHaveLength(0);
    expect(view.findAll('.ed-existing')).toHaveLength(0);
    expect(view.text()).toContain('0 cortes ya publicados');
  });

  it('prints --:--:-- rather than NaN before the duration is known', async () => {
    // `HTMLAudioElement.duration` is NaN until metadata arrives, and an episode
    // whose mp3 never reports one must not print `NaN:NaN:NaN`.
    audioSpy.duration = Number.NaN;
    const view = await mountReady();

    expect(shown(view, 'cut-start')).toBe('00:00:00');
    expect(shown(view, 'cut-end')).toBe('00:00:00');
  });
});

describe('moving the cut points', () => {
  it('nudges the start by ±1 / ±10 seconds', async () => {
    const view = await mountReady();

    await clickByLabel(view, 'Retrasar el inicio 10 segundos');
    await clickByLabel(view, 'Retrasar el inicio 10 segundos');
    await clickByLabel(view, 'Retrasar el inicio 1 segundos');
    expect(shown(view, 'cut-start')).toBe('00:00:21');

    await clickByLabel(view, 'Adelantar el inicio 10 segundos');
    expect(shown(view, 'cut-start')).toBe('00:00:11');
  });

  /**
   * ⚠️ **`±5` was removed on 2026-08-22 and this is the one function the screen
   * lost.** The six pills per end moved out of their own column to sit either
   * side of the timecode they move, and five buttons a side do not fit around a
   * number. The pair that stayed is the pair the keyboard already offered — the
   * slider's `step` is 1 and Shift multiplies it by ten.
   */
  it('offers exactly two step sizes per end, and no others', async () => {
    const view = await mountReady();

    const labels = view
      .findAll('button')
      .map((button) => button.attributes('aria-label'))
      .filter((label): label is string => /el (inicio|final) \d+ segundos$/.test(label ?? ''));

    expect(new Set(labels)).toEqual(
      new Set([
        'Adelantar el inicio 10 segundos',
        'Adelantar el inicio 1 segundos',
        'Retrasar el inicio 1 segundos',
        'Retrasar el inicio 10 segundos',
        'Adelantar el final 10 segundos',
        'Adelantar el final 1 segundos',
        'Retrasar el final 1 segundos',
        'Retrasar el final 10 segundos',
      ]),
    );
  });

  it('nudges the end, and stops it at the floor of the episode', async () => {
    const view = await mountReady();

    await clickByLabel(view, 'Adelantar el final 10 segundos');
    expect(shown(view, 'cut-end')).toBe('02:36:50');
    await clickByLabel(view, 'Retrasar el final 1 segundos');
    expect(shown(view, 'cut-end')).toBe('02:36:51');
  });

  it('carries the playhead rather than jamming against it', async () => {
    // ⚠️ The one place the editor does NOT use the slider's own nudge. A handle
    // on the timeline stops at its neighbour, and the playhead is wherever the
    // audio happens to be — so `start` would be unable to move at all while the
    // stream sat at zero. The guard is "start may not pass END", and the
    // playhead is dragged along exactly as `audioToSection()` dragged the stream.
    const view = await mountReady();
    expect(lastAudio().currentTime).toBe(0);

    await clickByLabel(view, 'Retrasar el inicio 10 segundos');

    expect(shown(view, 'cut-start')).toBe('00:00:10');
    expect(lastAudio().currentTime).toBe(10);
  });

  it('refuses to push the start past the end', async () => {
    const view = await mountReady();
    await dragTimeline(view, [100, 100, 105]);

    await clickByLabel(view, 'Retrasar el inicio 10 segundos');

    // A start past the end is refused outright rather than clamped.
    expect(shown(view, 'cut-start')).toBe('00:01:40');
  });

  it('moves a point to where the audio is', async () => {
    const view = await mountReady();
    const audio = lastAudio();
    audio.currentTime = 1234.6;
    audio.emit('timeupdate');
    await nextTick();

    await clickByLabel(view, 'Mover el inicio al punto actual');

    // Rounded to the whole second the API stores.
    expect(shown(view, 'cut-start')).toBe('00:20:35');
  });

  /**
   * ⚠️ **A published clip is somewhere to LISTEN, not somewhere to move the cut
   * to.** Clicking one jumps playback there; it does not move the START.
   * The cut is yours and the other clips are
   * information — moving your start onto somebody else's clip was a shortcut
   * for one workflow and a surprise in every other.
   */
  it('jumps playback to a published clip without touching the cut', async () => {
    const view = await mountReady();
    const before = shown(view, 'cut-start');

    await clickByLabel(view, 'Escuchar el corte La mulata del clítor...');

    expect(lastAudio().currentTime).toBe(792);
    expect(shown(view, 'cut-start')).toBe(before);
  });
});

/**
 * ⚠️ **The timecodes became `<input>`s on 2026-08-22**, and the property this
 * whole file exists to pin had to survive it: *what is published is parsed back
 * out of what the screen displays*. It now survives in a stricter form —
 * `cutSeconds` refuses to answer at all when the text in a field is not the
 * number the timeline is showing, so a value the cut REFUSED cannot be
 * published while it is still sitting on screen.
 */
/**
 * ⚠️ **The e2e suite drives this screen by accessible name**, and two of those
 * names cross a component boundary — `TagPicker` takes them as props. A rename
 * on either side would leave `07-editor.spec.ts` failing in a browser, minutes
 * away, with nothing pointing back here.
 */
describe('the names the browser suite drives this screen by', () => {
  it('labels the tag field, and points the visible label at the input itself', async () => {
    const view = await mountReady();

    const field = view.find('#editor-tags');
    expect(field.exists()).toBe(true);
    expect(field.element.tagName).toBe('INPUT');
    // ⚠️ `TagSelector` let the `id` fall through to its root `<div>`, so clicking
    // the word "Tags" focused nothing at all.
    expect(field.attributes('aria-label')).toBe('Añade un tag al corte');
    expect(view.find('label[for="editor-tags"]').text()).toContain('Tags');
  });

  it('labels both timecodes, and both are typed into', async () => {
    const view = await mountReady();

    for (const [test, label] of [
      ['cut-start', 'Inicio del corte'],
      ['cut-end', 'Fin del corte'],
    ]) {
      const field = view.find(`[data-test="${test}"]`);
      expect(field.element.tagName).toBe('INPUT');
      expect(field.attributes('aria-label')).toBe(label);
    }
  });
});

/**
 * ⚠️ **The bar is three rows in the DOM on BOTH layouts**, flattened back into
 * one line by `display: contents` on a wide screen. Before that it was whatever
 * `flex-wrap` produced, which on a phone was five ragged lines with the last of
 * them below the fold — i.e. the buttons that move the cut were unreachable
 * without scrolling away from the timeline they move.
 */
describe('the transport bar', () => {
  it('is three rows, grouped by what each one moves', async () => {
    const view = await mountReady();
    const rows = view.findAll('.ed-bar__row');

    expect(rows).toHaveLength(3);
    // What sounds · where the playback is · what is on screen.
    expect(rows[0]?.text()).toContain('Escuchar el corte');
    expect(rows[1]?.text()).toContain('recorrer');
    expect(rows[2]?.text()).toContain('zoom');
  });

  /**
   * ⚠️ **"Ir a" stopped being a group of its own on 2026-08-22.** Its two jumps
   * move the playhead exactly like the four seeks do, so they are the bookends
   * of that row now — the bar lost a label without losing a control, which is
   * what let three rows fit a 390 px screen.
   */
  it('keeps both jumps to the cut inside the seek row', async () => {
    const view = await mountReady();
    const seekRow = view.findAll('.ed-bar__row')[1];

    const labels = seekRow?.findAll('button').map((b) => b.attributes('aria-label'));
    expect(labels).toEqual([
      'Ir al inicio del corte',
      'Retrocede 1 minuto',
      'Retrocede 10 segundos',
      'Avanza 10 segundos',
      'Avanza 1 minuto',
      'Ir al 5 segundos antes del final del corte',
    ]);
  });
});

describe('typing a timecode', () => {
  it('moves the cut to a time that is typed in', async () => {
    const view = await mountReady();

    await typeTime(view, 'cut-start', '00:20:00');

    expect(shown(view, 'cut-start')).toBe('00:20:00');
    expect(view.findComponent(ThreeHandleSlider).props('modelValue')[0]).toBe(1200);
  });

  it('refuses to publish a half-typed time, and never publishes a guess', async () => {
    const view = await mountReady();
    await fillClip(view, 'un corte', ['Mulata']);

    await typeTime(view, 'cut-start', '00:20:');

    // ⚠️ The screen shows something that is not a timecode, so there is nothing
    // to publish: the button is off rather than falling back to the model.
    const publish = view.findAll('button').find((b) => b.text().includes('Publicar'));
    expect(publish?.attributes('disabled')).toBeDefined();
    await publish?.trigger('click');
    expect(clipsApi.created).toEqual([]);
  });

  it('refuses to publish a time the cut would not take', async () => {
    const view = await mountReady();
    await dragTimeline(view, [100, 100, 200]);
    await fillClip(view, 'un corte', ['Mulata']);

    // Past the end — `moveCutPoint` declines it, so the field and the timeline
    // disagree until the field loses focus.
    await typeTime(view, 'cut-start', '01:00:00');

    expect(shown(view, 'cut-start')).toBe('01:00:00');
    expect(view.findComponent(ThreeHandleSlider).props('modelValue')[0]).toBe(100);
    const publish = view.findAll('button').find((b) => b.text().includes('Publicar'));
    expect(publish?.attributes('disabled')).toBeDefined();
  });

  it('snaps back to the model when the field is left', async () => {
    const view = await mountReady();
    await dragTimeline(view, [100, 100, 200]);

    await typeTime(view, 'cut-start', 'melocotón');
    await view.find('[data-test="cut-start"]').trigger('blur');

    // ⚠️ The snap-back IS the feedback: the number that is really there returns,
    // instead of a refused one sitting on screen disagreeing with the timeline.
    expect(shown(view, 'cut-start')).toBe('00:01:40');
  });

  it('follows the timeline while it is not being typed into', async () => {
    const view = await mountReady();

    await dragTimeline(view, [300, 300, 900]);

    expect(shown(view, 'cut-start')).toBe('00:05:00');
    expect(shown(view, 'cut-end')).toBe('00:15:00');
  });
});

describe('the timeline and its zoom', () => {
  it('scrubs the audio when the playhead is dragged — once the drag settles', async () => {
    vi.useFakeTimers();
    const view = await mountReady();
    const audio = lastAudio();

    await dragTimeline(view, [0, 4000, 9420]);
    // ⚠️ The mp3 is remote: seeking once per pointer move would range-request
    // the network to death, so the seek waits a second.
    expect(audio.currentTime).toBe(0);

    vi.advanceTimersByTime(1000);
    expect(audio.currentTime).toBe(4000);
  });

  it('narrows the visible window without losing the cut', async () => {
    const view = await mountReady();
    await dragTimeline(view, [792, 800, 870]);

    await clickByLabel(view, 'Hacer zoom a la sección delimitada');

    const slider = view.findComponent(ThreeHandleSlider);
    // Zoom fits the cut with a 10% margin on each side.
    expect(slider.props('min')).toBe(784);
    expect(slider.props('max')).toBe(878);
    // ⚠️ And the points are exactly where they were: zoom only re-maps positions.
    expect(shown(view, 'cut-start')).toBe('00:13:12');
    expect(shown(view, 'cut-end')).toBe('00:14:30');
  });

  /**
   * ⚠️ **`Acercar` completes the pair, and it is not "Ajustar al corte".**
   * Without it the only way to zoom IN was "Ajustar al corte" — which also
   * *moves* the window to a particular place.
   */
  it('zooms in without moving the window somewhere else', async () => {
    const view = await mountReady();
    await dragTimeline(view, [3000, 3000, 3600]);

    const before = view.findComponent(ThreeHandleSlider);
    const width = before.props('max') - before.props('min');

    await clickByLabel(view, 'Acercar el zoom');

    const after = view.findComponent(ThreeHandleSlider);
    expect(after.props('max') - after.props('min')).toBeLessThan(width);
    // The cut did not move: only what is on screen did.
    expect(shown(view, 'cut-start')).toBe('00:50:00');
    expect(shown(view, 'cut-end')).toBe('01:00:00');
  });

  /**
   * ⚠️ **The guard that came with `Acercar`.** `ThreeHandleSlider` reclamps any
   * value outside its window, so a window closing past `start` would not hide
   * the handle — it would MOVE it, eating the cut one press at a time. The two
   * older zooms could not hit this: `zoomToCut` contains the cut by
   * construction and `zoomOut` only widens.
   */
  it('never zooms in past the cut, however many times it is pressed', async () => {
    const view = await mountReady();
    await dragTimeline(view, [3000, 3000, 3600]);

    for (let press = 0; press < 12; press++) await clickByLabel(view, 'Acercar el zoom');

    const slider = view.findComponent(ThreeHandleSlider);
    expect(slider.props('min')).toBeLessThanOrEqual(3000);
    expect(slider.props('max')).toBeGreaterThanOrEqual(3600);
    expect(shown(view, 'cut-start')).toBe('00:50:00');
    expect(shown(view, 'cut-end')).toBe('01:00:00');
  });

  it('widens the window again, and resets it to the whole episode', async () => {
    const view = await mountReady();
    await dragTimeline(view, [792, 800, 870]);
    await clickByLabel(view, 'Hacer zoom a la sección delimitada');

    await clickByLabel(view, 'Retrocede el zoom');
    let slider = view.findComponent(ThreeHandleSlider);
    expect(slider.props('min')).toBe(184);
    expect(slider.props('max')).toBe(1478);

    await clickByLabel(view, 'Reiniciar zoom');
    slider = view.findComponent(ThreeHandleSlider);
    expect(slider.props('min')).toBe(0);
    expect(slider.props('max')).toBe(10_020);
    expect(shown(view, 'cut-start')).toBe('00:13:12');
    expect(shown(view, 'cut-end')).toBe('00:14:30');
  });

  it('follows the audio with the playhead while it plays', async () => {
    const view = await mountReady();
    const audio = lastAudio();
    audio.currentTime = 42.8;
    audio.emit('timeupdate');
    await nextTick();

    expect(shown(view, 'current-time')).toBe('00:00:42');
    expect(view.findComponent(ThreeHandleSlider).props('modelValue')).toEqual([0, 42, 9420]);
  });

  it('never lets the stream wander outside the cut', async () => {
    // The stream is kept inside the cut, which is also what keeps the three
    // handles ordered now that they can no longer cross.
    const view = await mountReady();
    await dragTimeline(view, [100, 100, 200]);
    const audio = lastAudio();

    audio.currentTime = 5000;
    audio.emit('timeupdate');
    await nextTick();

    expect(audio.currentTime).toBe(100);
  });
});

describe('the transport', () => {
  it('plays and pauses', async () => {
    const view = await mountReady();
    const audio = lastAudio();

    await clickByLabel(view, 'Reproducir');
    await flushPromises();
    expect(audio.playCalls).toBe(1);

    await clickByLabel(view, 'Pausar');
    expect(audio.playing).toBe(false);
  });

  /**
   * ⚠️ **`claimPlayback()` from the play path, and not from `onMounted`**: this
   * screen owns an element the player store cannot see, so nothing else can
   * announce that it is making sound — and a claim on the way in would silence
   * the other tab just for somebody opening the editor.
   */
  it('announces that it is taking the sound when it plays', async () => {
    const view = await mountReady();
    expect(tabCoordination.claim).not.toHaveBeenCalled();

    await clickByLabel(view, 'Reproducir');
    await flushPromises();

    expect(tabCoordination.claim).toHaveBeenCalledTimes(1);
  });

  it('gives the sound up when another tab takes it', async () => {
    const view = await mountReady();
    const audio = lastAudio();
    await clickByLabel(view, 'Reproducir');
    await flushPromises();
    expect(audio.playing).toBe(true);

    anotherTabTookTheSound();
    await nextTick();

    expect(audio.playing).toBe(false);
    // ⚠️ A pause, not a reset: the cut is where it was, and the transport goes
    // back to offering play in the same screen.
    await clickByLabel(view, 'Reproducir');
  });

  it('stops listening for that when it unmounts', async () => {
    const view = await mountReady();
    expect(tabCoordination.subscriptions).toBe(1);

    view.unmount();

    expect(tabCoordination.unsubscriptions).toBe(1);
  });

  it('jumps to the start of the cut, and to five seconds before its end', async () => {
    const view = await mountReady();
    await dragTimeline(view, [600, 600, 900]);
    const audio = lastAudio();

    await clickByLabel(view, 'Ir al inicio del corte');
    expect(audio.currentTime).toBe(600);

    await clickByLabel(view, 'Ir al 5 segundos antes del final del corte');
    expect(audio.currentTime).toBe(895);
  });

  it('accumulates the relative seeks instead of throwing them away', async () => {
    // ⚠️ The deltas accumulate: three quick presses of "−10" move thirty seconds.
    vi.useFakeTimers();
    const view = await mountReady();
    await dragTimeline(view, [0, 600, 9420]);
    const audio = lastAudio();
    audio.currentTime = 600;

    await clickByLabel(view, 'Retrocede 10 segundos');
    await clickByLabel(view, 'Retrocede 10 segundos');
    await clickByLabel(view, 'Retrocede 10 segundos');
    vi.advanceTimersByTime(100);

    expect(audio.currentTime).toBe(570);
  });

  /** ⚠️ Four fixed steps since 2026-08-22, not a `<v-slider>` from 0.5 to 4 in
   *  halves — the one control on this screen that was not built out of the
   *  site's own tokens. */
  it('drives the playback rate', async () => {
    const view = await mountReady();

    await clickByLabel(view, 'Velocidad x2');
    expect(lastAudio().playbackRate).toBe(2);

    const pressed = view
      .findAll('button')
      .filter((button) => button.attributes('aria-pressed') === 'true')
      .map((button) => button.text());
    expect(pressed).toEqual(['2']);
  });

  it('pauses on the way out, so no episode goes on talking', async () => {
    await mountReady();
    const audio = lastAudio();

    wrapper?.unmount();
    wrapper = undefined;

    expect(audio.pauseCalls).toBeGreaterThan(0);
  });
});

describe('publishing', () => {
  it('stores exactly the seconds the screen displayed', async () => {
    // ⚠️ THE assertion of this screen. The editor keeps seconds, so the
    // equivalence has to be proved rather than assumed — the numbers posted are parsed back out
    // of the DOM the user was reading.
    const view = await mountReady();
    await clickByLabel(view, 'Retrasar el inicio 10 segundos');
    await clickByLabel(view, 'Adelantar el final 1 segundos');
    await fillClip(view, 'Un corte', ['Mulata']);

    const startLabel = shown(view, 'cut-start');
    const endLabel = shown(view, 'cut-end');
    expect(startLabel).toBe('00:00:10');
    expect(endLabel).toBe('02:36:59');

    await clickByText(view, 'Publicar corte');
    await flushPromises();

    expect(clipsApi.created).toHaveLength(1);
    expect(clipsApi.created[0]).toEqual({
      episodeId: 63,
      title: 'Un corte',
      tags: ['Mulata'],
      start: hhmmssToSeconds(startLabel),
      end: hhmmssToSeconds(endLabel),
    });
    // …and those are whole seconds, which is what the API stores.
    expect(clipsApi.created[0]).toMatchObject({ start: 10, end: 9419 });
  });

  /**
   * ⚠️ **Opened from one of my moments** (2026-08-26): `/creator/63?start&end`
   * seeds the cut, and `?moment` is what lets the published clip's id land back
   * on the right row of `Mis momentos`.
   *
   * ⚠️ `moment` is deliberately NOT the same number as `start`: the window can
   * be dragged anywhere before publishing, so the mark is what identifies the
   * mark.
   */
  describe('opened from a moment', () => {
    const MOMENTS_KEY = 'gravindex.moments';

    it('starts on the window the mark asked for instead of the default cut', async () => {
      const view = await mountReady('/creator/63?start=480&end=520&moment=500');

      expect(shown(view, 'cut-start')).toBe('00:08:00');
      expect(shown(view, 'cut-end')).toBe('00:08:40');
      // ⚠️ And the stream goes with it: `keepInsideCut` would only correct the
      // position on the first `timeupdate`, i.e. after somebody pressed play and
      // heard the wrong part of the episode.
      expect(lastAudio().currentTime).toBe(480);
    });

    it('zooms in on it, or a forty-second cut would be four pixels of the track', async () => {
      const view = await mountReady('/creator/63?start=480&end=520&moment=500');

      // The window either side of the cut, not the whole two-and-a-half hours.
      expect(view.text()).toContain('00:07:00');
      expect(view.text()).toContain('00:09:40');
    });

    it('tells the mark which clip it became, and only that mark', async () => {
      localStorage.setItem(
        MOMENTS_KEY,
        JSON.stringify({
          moments: [
            { episodeId: 63, at: 500, markedAt: 1 },
            { episodeId: 63, at: 900, markedAt: 2 },
          ],
        }),
      );
      const view = await mountReady('/creator/63?start=480&end=520&moment=500');
      await fillClip(view, 'Un corte', ['Mulata']);

      await clickByText(view, 'Publicar corte');
      await flushPromises();

      expect(JSON.parse(localStorage.getItem(MOMENTS_KEY) ?? '{}')).toEqual({
        moments: [
          { episodeId: 63, at: 500, markedAt: 1, clipId: 999 },
          { episodeId: 63, at: 900, markedAt: 2 },
        ],
      });
    });

    it('publishes what the handles ended up on, not what the mark suggested', async () => {
      const view = await mountReady('/creator/63?start=480&end=520&moment=500');
      await clickByLabel(view, 'Retrasar el inicio 10 segundos');
      await fillClip(view, 'Un corte', ['Mulata']);

      await clickByText(view, 'Publicar corte');
      await flushPromises();

      expect(clipsApi.created[0]).toMatchObject({ start: 490, end: 520 });
    });

    /** ⚠️ The URL is public and `?start=melocotón` is somebody playing. The
     *  editor still works; it just opens where it always did. */
    it('ignores a seed it cannot read', async () => {
      const view = await mountReady('/creator/63?start=melocoton&end=520');

      expect(shown(view, 'cut-start')).toBe('00:00:00');
      expect(shown(view, 'cut-end')).toBe(DEFAULT_END_LABEL);
    });

    it('ignores a window that is not one', async () => {
      // `end` at or before `start` is a cut the screen would never have allowed.
      const view = await mountReady('/creator/63?start=600&end=600');

      expect(shown(view, 'cut-start')).toBe('00:00:00');
      expect(shown(view, 'cut-end')).toBe(DEFAULT_END_LABEL);
    });

    it('clamps a window that runs past the end of the episode', async () => {
      const view = await mountReady('/creator/63?start=10010&end=10050&moment=10030');

      expect(hhmmssToSeconds(shown(view, 'cut-end'))).toBe(audioSpy.duration);
    });
  });

  it('goes to the episode it was cut from', async () => {
    const view = await mountReady();
    await fillClip(view, 'Un corte', ['Mulata']);

    await clickByText(view, 'Publicar corte');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/episode/63-Episodio-86-Spanish-Zombies');
  });

  it('asks for a title before anything leaves the browser', async () => {
    const view = await mountReady();
    view.findComponent(TagPicker).vm.$emit('update:modelValue', ['Mulata']);
    await nextTick();

    await clickByText(view, 'Publicar corte');
    await flushPromises();

    expect(view.text()).toContain('Introduce un título para el corte.');
    expect(clipsApi.created).toHaveLength(0);
  });

  it('asks for at least one tag', async () => {
    // ⚠️ The API accepts an empty `tags` array; the screen never does.
    const view = await mountReady();
    await view.find('#editor-title').setValue('Un corte');

    await clickByText(view, 'Publicar corte');
    await flushPromises();

    expect(view.text()).toContain('Introduce al menos un tag.');
    expect(clipsApi.created).toHaveLength(0);
  });

  it('clears a validation message once the field is filled in', async () => {
    // The flags are recomputed on every attempt, so the complaint goes away once
    // the field is filled in.
    const view = await mountReady();
    await clickByText(view, 'Publicar corte');
    await flushPromises();
    expect(view.text()).toContain('Introduce un título para el corte.');

    await fillClip(view, 'Un corte', ['Mulata']);
    await clickByText(view, 'Publicar corte');
    await flushPromises();

    expect(view.text()).not.toContain('Introduce un título para el corte.');
  });

  it('shows the backend’s own sentence when it refuses the clip', async () => {
    // ⚠️ A 400 is the server understanding and refusing, not the network
    // failing. Saying "no se ha podido conectar" would be a lie about a request
    // that arrived perfectly — and would hide the only useful half of the answer.
    clipsApi.failure = new RequestRejectedError('end must be greater than start');
    const view = await mountReady();
    await fillClip(view, 'Un corte', ['Mulata']);

    await clickByText(view, 'Publicar corte');
    await flushPromises();

    const notifications = useNotificationsStore();
    expect(notifications.items.map((item) => item.text)).toContain(
      'end must be greater than start',
    );
    expect(router.currentRoute.value.path).toBe('/creator/63-episodio-86');
  });

  it('falls back to the generic notice when the server never answered', async () => {
    clipsApi.failure = new NetworkError('offline');
    const view = await mountReady();
    await fillClip(view, 'Un corte', ['Mulata']);

    await clickByText(view, 'Publicar corte');
    await flushPromises();

    const notifications = useNotificationsStore();
    expect(notifications.items.map((item) => item.text)).toContain(
      'No se ha podido conectar con el servidor.',
    );
  });
});
