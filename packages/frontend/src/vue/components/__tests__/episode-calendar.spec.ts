import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, nextTick, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import type { Router } from 'vue-router';
import type { EpisodeListItem } from '#/domain/episodes/episode.entity';
import vuetify from '@/plugins/vuetify';
import EpisodeCalendar from '@/components/EpisodeCalendar.vue';
import CalendarDayPanel from '@/components/CalendarDayPanel.vue';
import { freshPinia, stubBrowserApis, testRouter } from './mount-with-vuetify';

function episode(id: number, date: Date, clipCount = 0): EpisodeListItem {
  return {
    id,
    title: `Episodio ${id}`,
    cover: 'https://example.test/cover.png',
    file: 'https://example.test/audio.mp3',
    originalUrl: 'https://example.test/episodio',
    date,
    clipCount,
  };
}

/** Two years, and the last day of the first sits next to the first of the second. */
const CATALOGUE = [
  episode(1, new Date(2011, 6, 25, 12), 11),
  episode(2, new Date(2011, 11, 18, 12)),
  episode(3, new Date(2012, 0, 4, 12)),
];

const harness = vi.hoisted(() => ({
  episodes: [] as EpisodeListItem[],
  compact: false,
}));

vi.mock('@/composables/use-episode-calendar', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/composables/use-episode-calendar')>();
  return {
    ...original,
    useEpisodeCalendar: () => ({
      calendar: computed(() => original.buildCalendar(harness.episodes)),
      isPending: computed(() => false),
      error: computed(() => null),
      refetch: vi.fn(),
    }),
  };
});

vi.mock('@/composables/use-compact-layout', () => ({
  COMPACT_BREAKPOINT_PX: 720,
  useCompactLayout: () => ref(harness.compact),
}));

async function mountCalendar(path = '/episodes/calendario'): Promise<{
  wrapper: ReturnType<typeof mount>;
  router: Router;
}> {
  const router = testRouter();
  await router.push(path);
  await router.isReady();

  const wrapper = mount(EpisodeCalendar, {
    props: { filters: { search: '', withClips: false, mine: false } },
    global: { plugins: [vuetify, freshPinia(), router] },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrapper, router };
}

beforeEach(() => {
  stubBrowserApis();
  harness.episodes = CATALOGUE;
  harness.compact = false;
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('the year on screen', () => {
  it('⚠️ opens on the LAST year there is, like every other episode list', async () => {
    const { wrapper, router } = await mountCalendar();

    expect(wrapper.find('.cal__year').text()).toBe('2012');
    expect(router.currentRoute.value.params.year).toBe('2012');
  });

  it('reads the year out of the path', async () => {
    const { wrapper } = await mountCalendar('/episodes/calendario/2011');

    expect(wrapper.find('.cal__year').text()).toBe('2011');
  });

  it('⚠️ corrects a year past the end of the catalogue rather than drawing nothing', async () => {
    const { wrapper, router } = await mountCalendar('/episodes/calendario/2044');

    expect(wrapper.find('.cal__year').text()).toBe('2012');
    expect(router.currentRoute.value.params.year).toBe('2012');
  });

  it('⚠️ REPLACES on a year change, so one Back leaves the calendar', async () => {
    const { wrapper, router } = await mountCalendar('/episodes/calendario/2012');
    const push = vi.spyOn(router, 'push');
    const replace = vi.spyOn(router, 'replace');

    await wrapper.find('.cal__arrow').trigger('click');
    await flushPromises();

    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalled();
    expect(router.currentRoute.value.params.year).toBe('2011');
  });

  it('greys the step that has nowhere to go', async () => {
    const { wrapper } = await mountCalendar('/episodes/calendario/2012');
    const [prev, next] = wrapper.findAll('.cal__arrow');

    expect(prev?.attributes('disabled')).toBeUndefined();
    expect(next?.attributes('disabled')).toBeDefined();
  });

  it('carries the filters along when the year moves', async () => {
    const { wrapper, router } = await mountCalendar('/episodes/calendario/2012?withClips=true');

    await wrapper.find('.cal__arrow').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.query).toEqual({ withClips: 'true' });
  });
});

describe('the day panel', () => {
  it('opens on the day that was pressed and closes when it is pressed again', async () => {
    const { wrapper } = await mountCalendar('/episodes/calendario/2011');

    await wrapper.find('[data-day="2011-07-25"]').trigger('click');
    await nextTick();
    expect(wrapper.findComponent(CalendarDayPanel).exists()).toBe(true);

    await wrapper.find('[data-day="2011-07-25"]').trigger('click');
    await nextTick();
    expect(wrapper.findComponent(CalendarDayPanel).exists()).toBe(false);
  });

  it('nothing is open on arrival — the panel is the answer to a press', async () => {
    const { wrapper } = await mountCalendar('/episodes/calendario/2011');

    expect(wrapper.findComponent(CalendarDayPanel).exists()).toBe(false);
  });

  it('⚠️ steps to the next day WITH an episode, skipping the empty ones', async () => {
    const { wrapper } = await mountCalendar('/episodes/calendario/2011');
    await wrapper.find('[data-day="2011-07-25"]').trigger('click');
    await flushPromises();

    wrapper.findComponent(CalendarDayPanel).vm.$emit('step', 1);
    await flushPromises();

    expect(wrapper.findComponent(CalendarDayPanel).props('day')).toBe('2011-12-18');
  });

  it('⚠️ drags the calendar with it when a step crosses into another year', async () => {
    const { wrapper, router } = await mountCalendar('/episodes/calendario/2011');
    await wrapper.find('[data-day="2011-12-18"]').trigger('click');
    await nextTick();

    wrapper.findComponent(CalendarDayPanel).vm.$emit('step', 1);
    await flushPromises();

    expect(router.currentRoute.value.params.year).toBe('2012');
    expect(wrapper.find('.cal__year').text()).toBe('2012');
    // The panel followed rather than closing: it is one continuous walk.
    expect(wrapper.findComponent(CalendarDayPanel).props('day')).toBe('2012-01-04');
  });

  it('tells the panel where the ends of the catalogue are', async () => {
    const { wrapper } = await mountCalendar('/episodes/calendario/2011');
    await wrapper.find('[data-day="2011-07-25"]').trigger('click');
    await nextTick();

    const panel = wrapper.findComponent(CalendarDayPanel);
    expect(panel.props('hasPrev')).toBe(false);
    expect(panel.props('hasNext')).toBe(true);
  });

  it('closes when a change of year retires the day it was showing', async () => {
    const { wrapper } = await mountCalendar('/episodes/calendario/2011');
    await wrapper.find('[data-day="2011-07-25"]').trigger('click');
    await nextTick();

    await wrapper.findAll('.cal__arrow')[1]?.trigger('click');
    await flushPromises();

    expect(wrapper.findComponent(CalendarDayPanel).exists()).toBe(false);
  });
});

describe('bringing the month into view', () => {
  /**
   * ⚠️ jsdom measures everything as zero, so these stub the three rectangles the
   * arithmetic reads and assert the DECISION — which way the page moves, and by
   * how much. Whether the result really lands inside the band is the browser's
   * to answer (`test/e2e/specs/16-calendar.spec.ts`).
   */
  interface Chrome {
    readonly month: [number, number];
    readonly pop?: [number, number];
    readonly sheet?: [number, number];
  }

  function stubChrome({ month, pop, sheet }: Chrome): void {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const box = (top: number, bottom: number): DOMRect =>
        ({ top, bottom, height: bottom - top, left: 0, right: 300, width: 300 }) as DOMRect;
      if (this.classList.contains('topbar')) return box(0, 59);
      if (this.classList.contains('player-dock')) return box(822, 900);
      if (this.classList.contains('cal__sticky')) return box(0, 44);
      if (this.classList.contains('pop')) return box(...(pop ?? [0, 0]));
      if (this.classList.contains('cm')) return box(...month);
      if (this instanceof HTMLElement && this.dataset.month !== undefined) return box(...month);
      return box(...(sheet ?? [0, 0]));
    });
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
      fn(0);
      return 0;
    });
    for (const cls of ['topbar', 'player-dock']) {
      const el = document.createElement('div');
      el.className = cls;
      document.body.append(el);
    }
  }

  async function openAndCatchScroll(chrome: Chrome): Promise<ReturnType<typeof vi.fn>> {
    stubChrome(chrome);
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);

    const { wrapper } = await mountCalendar('/episodes/calendario/2011');
    await wrapper.find('[data-day="2011-07-25"]').trigger('click');
    await flushPromises();
    return scrollBy;
  }

  it('⚠️ moves the page so the whole MONTH fits, not just the panel', async () => {
    harness.compact = false;
    // The month hangs 100 px below the player's top edge at 822.
    const scrollBy = await openAndCatchScroll({ month: [600, 922], pop: [600, 700] });

    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 922 - 814 }));
  });

  it('⚠️ measures the header, so nothing is left under it', async () => {
    harness.compact = false;
    // The month starts above the 59 px sticky bar — the case `--v-layout-top`
    // could not see, because this site's header is not a `<v-app-bar>`.
    const scrollBy = await openAndCatchScroll({ month: [20, 260], pop: [200, 300] });

    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 20 - 67 }));
  });

  it('fits the month and the panel together when both fit', async () => {
    harness.compact = false;
    // The month is fine on its own; the panel below it is not.
    const scrollBy = await openAndCatchScroll({ month: [400, 640], pop: [640, 900] });

    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 900 - 814 }));
  });

  it('⚠️ keeps the MONTH whole when the two together do not fit', async () => {
    harness.compact = false;
    // Month plus panel is 900 px against a 747 px band: fitting both would push
    // the month's first weeks off the top.
    const scrollBy = await openAndCatchScroll({ month: [100, 500], pop: [500, 1000] });

    // The month alone, aligned under the header.
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 100 - 67 }));
  });

  it('leaves the page alone when the month is already whole', async () => {
    harness.compact = false;
    const scrollBy = await openAndCatchScroll({ month: [200, 440], pop: [440, 700] });

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('⚠️ on a phone the band stops at the sheet, and the panel is not part of the fit', async () => {
    harness.compact = true;
    // Sheet at 560; the month runs under it.
    const scrollBy = await openAndCatchScroll({ month: [400, 700], pop: [560, 740] });

    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 700 - 552 }));
  });
});

describe('coming back from an episode', () => {
  /**
   * ⚠️ The open day and the position live in `history.state`, never in the URL:
   * "the calendar, by 2011" is what somebody shares, and which day they had open
   * is what the Back button owes them. See `EpisodeCalendar.vue`.
   */
  const remember = (memory: unknown): void => {
    window.history.replaceState({ ...(window.history.state ?? {}), gravindexCalendar: memory }, '');
  };

  afterEach(() => window.history.replaceState(null, ''));

  it('puts the day that was open back', async () => {
    remember({ day: '2011-12-18', scroll: 0 });

    const { wrapper } = await mountCalendar('/episodes/calendario/2011');

    expect(wrapper.findComponent(CalendarDayPanel).props('day')).toBe('2011-12-18');
  });

  it('⚠️ restores the position itself, because the router tried while the screen was empty', async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
      fn(0);
      return 0;
    });
    remember({ day: null, scroll: 382 });

    await mountCalendar('/episodes/calendario/2011');

    expect(scrollTo).toHaveBeenCalledWith({ top: 382, behavior: 'auto' });
  });

  it('opens nothing on a day the filter no longer draws', async () => {
    remember({ day: '1999-01-01', scroll: 0 });

    const { wrapper } = await mountCalendar('/episodes/calendario/2011');

    expect(wrapper.findComponent(CalendarDayPanel).exists()).toBe(false);
  });

  it('does nothing at all on a fresh arrival', async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);

    const { wrapper } = await mountCalendar('/episodes/calendario/2011');

    expect(wrapper.findComponent(CalendarDayPanel).exists()).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ The other half — stamping the state on the way out — is asserted in the
   * browser (`test/e2e/specs/16-calendar.spec.ts`), not here.
   * `onBeforeRouteLeave` registers against the matched route record, and this
   * spec mounts the component directly rather than through a `<RouterView>`, so
   * the guard never installs. Reproducing that here would mean building a router
   * whose component IS this one, to assert something a real Back press proves
   * better.
   */
});

describe('what it says when there is nothing', () => {
  it('borrows the list’s own empty copy', async () => {
    harness.episodes = [];

    const { wrapper } = await mountCalendar();

    expect(wrapper.text()).toContain('Ningún episodio se llama así');
  });
});
