import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';

import type { ClipListItem } from '#/domain/clips/clip.entity';
import type { Episode } from '#/domain/episodes/episode.entity';
import vuetify from '@/plugins/vuetify';
import ClipRowItem from '@/components/ClipRowItem.vue';
import ClipTagList from '@/components/ClipTagList.vue';
import EpisodeRowItem from '@/components/EpisodeRowItem.vue';
import GlobalPlayer from '@/components/GlobalPlayer.vue';
import GravPagination from '@/components/GravPagination.vue';
import NotificationHost from '@/components/NotificationHost.vue';
import TagFilter from '@/components/TagFilter.vue';
import TagPicker from '@/components/TagPicker.vue';
import { useNotificationsStore } from '@/stores/notifications.store';
import { freshPinia, stubBrowserApis, testRouter } from './mount-with-vuetify';

/**
 * ⚠️ **The guard on the icon pass.** Every affordance in this package was a
 * text glyph until `@mdi/font` was installed — `▶ ❚❚ ▲ ▼ + × « ‹ › »` — each
 * one paired with a Spanish `aria-label`. The glyphs were the workaround; the
 * labels are the accessibility. Swapping a glyph for a `<v-icon>` is the exact
 * edit that silently removes a control's only accessible name, because an
 * icon-only button LOOKS finished and announces as "button".
 *
 * So this file asserts the property directly, across every component that has
 * an interactive control: **no button anywhere may be nameless.** It fails on
 * the next icon swap that forgets a label, in a component nobody thought to
 * open.
 */

vi.mock('@/queries/clips.query', () => ({
  useVoteClip: () => ({ mutateAsync: vi.fn() }),
  useRegisterPlay: () => ({ mutate: vi.fn() }),
  useAddTag: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/queries/tags.query', () => ({
  useTagList: () => ({
    data: {
      value: [
        { tag: 'Mulata', count: 3 },
        { tag: 'Briñate', count: 1 },
      ],
    },
    isPending: { value: false },
    isLoading: { value: false },
  }),
}));

beforeAll(stubBrowserApis);

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

const plugins = () => [freshPinia(), vuetify, testRouter()];

/**
 * What a screen reader would announce for this control. `aria-label` wins, as
 * it does in the real accessible-name computation; otherwise the visible text,
 * which for an icon-only button is the empty string — precisely the failure
 * this file is looking for. (`v-icon` draws through a CSS `::before`, so an
 * icon contributes no `textContent` at all.)
 */
function accessibleName(button: DOMWrapper<Element>): string {
  const label = button.attributes('aria-label');
  if (label !== undefined && label.trim() !== '') return label.trim();
  return (button.element.textContent ?? '').trim();
}

function expectEveryButtonNamed(wrapper: VueWrapper, where: string): void {
  const buttons = wrapper.findAll('button');
  expect(buttons.length, `${where} rendered no buttons at all`).toBeGreaterThan(0);
  for (const button of buttons) {
    expect(accessibleName(button), `an unnamed button in ${where}`).not.toBe('');
  }
}

describe('every interactive control keeps an accessible name', () => {
  it('on the clip row, which is what the whole site is made of', () => {
    const wrapper = mount(ClipRowItem, {
      props: { clip: CLIP },
      global: { plugins: plugins() },
    });

    expectEveryButtonNamed(wrapper, 'ClipRowItem');

    const names = wrapper.findAll('button').map((b) => accessibleName(b));
    // ⚠️ The labels quote what the glyph cannot say: which clip, and how many
    // votes. Four icon-only controls in one row makes this the component the
    // whole file exists for.
    expect(names).toContain('Votar a favor de La mulata del clítor... (15 votos)');
    expect(names).toContain('Compartir La mulata del clítor...');
    expect(names).toContain('Descargar La mulata del clítor...');
    expect(names).toContain('Añadir La mulata del clítor... a la cola');
    expect(names).toContain('Filtrar por el tag Mulata');
    // ⚠️ ONE vote control. A stray "Votar en contra" here would be a second,
    // negative vote that the API refuses.
    expect(names.filter((name) => name.startsWith('Votar'))).toHaveLength(1);

    wrapper.unmount();
  });

  it('on the global player, whose controls are almost all icons', () => {
    const wrapper = mount(GlobalPlayer, { global: { plugins: plugins() } });

    expectEveryButtonNamed(wrapper, 'GlobalPlayer');

    const names = wrapper.findAll('button').map((b) => accessibleName(b));
    expect(names).toContain('Reproducir');
    expect(names).toContain('Siguiente corte de la cola');

    wrapper.unmount();
  });

  it('on the tag filter, where every row is a control', () => {
    const wrapper = mount(TagFilter, {
      props: { tags: [{ tag: 'Mulata', count: 3 }], modelValue: [] },
      global: { plugins: plugins() },
    });

    expectEveryButtonNamed(wrapper, 'TagFilter');
    // ⚠️ `aria-pressed`, because these are toggles and a name alone does not
    // say whether the filter is on.
    expect(wrapper.find('button').attributes('aria-pressed')).toBe('false');

    wrapper.unmount();
  });

  it('on the tag list, where the add control is now icon-only', () => {
    const wrapper = mount(ClipTagList, {
      props: { clipId: 178, tags: ['Mulata'] },
      global: { plugins: plugins() },
    });

    expectEveryButtonNamed(wrapper, 'ClipTagList');
    expect(wrapper.find('.mdi-plus').exists()).toBe(true);

    wrapper.unmount();
  });

  it('on the tag picker, where the label carries the tag name', () => {
    const wrapper = mount(TagPicker, {
      props: { modelValue: ['Briñate'] },
      global: { plugins: plugins() },
    });

    expectEveryButtonNamed(wrapper, 'TagPicker');
    // ⚠️ Not a shared "Cerrar": with eight chips on screen, eight identically
    // named buttons name none of them.
    expect(wrapper.findAll('button').map((b) => accessibleName(b))).toContain(
      'Quitar el tag Briñate',
    );
    expect(wrapper.find('.mdi-close').exists()).toBe(true);

    wrapper.unmount();
  });

  it('on the pagination, whose arrows Vuetify would otherwise name in English', () => {
    const wrapper = mount(GravPagination, {
      props: { page: 3, limit: 12, total: 180 },
      global: { plugins: plugins() },
    });

    expectEveryButtonNamed(wrapper, 'GravPagination');

    const names = wrapper.findAll('button').map((b) => accessibleName(b));
    expect(names).toContain('Página anterior');
    expect(names).toContain('Página siguiente');
    expect(names).not.toContain('Previous page');

    wrapper.unmount();
  });

  it('on the episode row, whose links carry their own words', () => {
    // ⚠️ This row has no buttons at all — every affordance is a link, and each
    // one says where it goes. An icon-only `Cortar` would be the failure this
    // file looks for, so what is asserted is that the WORD is there beside it.
    const wrapper = mount(EpisodeRowItem, {
      props: { episode: { ...EPISODE, clipCount: 7 } },
      global: { plugins: plugins() },
    });

    const named = wrapper
      .findAll('a, button')
      .map((el) => accessibleName(el))
      .filter((name) => name !== '');
    expect(named).toContain('Cortar');
    expect(named).toContain('Ver los cortes');
    expect(named).toContain('Episodio 86 (Spanish Zombies)');

    wrapper.unmount();
  });

  it('on the toast host, whose close button carries a name', async () => {
    const pinia = freshPinia();
    const wrapper = mount(NotificationHost, { global: { plugins: [pinia, vuetify] } });
    useNotificationsStore().push({ level: 'error', text: '¡No puedes votar dos veces!' });
    await wrapper.vm.$nextTick();

    expectEveryButtonNamed(wrapper, 'NotificationHost');
    expect(wrapper.find('.mdi-close').exists()).toBe(true);

    wrapper.unmount();
  });
});

describe('the icons themselves say nothing', () => {
  it('is true of every icon the card draws', () => {
    // An icon that is not `aria-hidden` gets read out beside the label it is
    // decorating, which turns "Votar a favor (15 votos a favor)" into that plus
    // a stray "thumb up". Vuetify hides its own by default; these are ours.
    const wrapper = mount(ClipRowItem, {
      props: { clip: CLIP },
      global: { plugins: plugins() },
    });

    const icons = wrapper.findAll('.v-icon');
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon.attributes('aria-hidden')).toBe('true');
    }

    expect(wrapper.find('.mdi-thumb-up').exists()).toBe(true);
    /**
     * ⚠️ The row carries share and download as boxed icon buttons, where the
     * white card had the word `Compartir` and no glyph at all. The reason the
     * card had no icon — it clipped its own label at 224 px — does not apply to
     * a row that spans the screen.
     *
     * ⚠️ **And the share action is drawn with `mdi-link-variant`, not
     * `mdi-share-variant`.** It copies a permalink, so a chain says what it does
     * more precisely than a share tree; it is a solid glyph where the tree is
     * three dots joined by hairlines; and — the reason it was changed —
     * `mdi-share-variant` is a class name that content blockers' social lists
     * hide on sight, which is exactly what "the share button is invisible, as if
     * the icon did not exist" looks like from the outside. Keep the accessible
     * name in words: it is still `Compartir`.
     */
    expect(wrapper.find('.mdi-link-variant').exists()).toBe(true);
    expect(wrapper.find('.mdi-share-variant').exists()).toBe(false);
    expect(wrapper.find('.mdi-download').exists()).toBe(true);
    // ⚠️ And no thumb-down anywhere: there is one vote, and it is positive.
    expect(wrapper.find('.mdi-thumb-down').exists()).toBe(false);

    wrapper.unmount();
  });
});

describe('the icon font is actually wired into Vuetify', () => {
  it('resolves an mdi name to an mdi class rather than to nothing', () => {
    // ⚠️ The failure this catches is silent: with no iconset registered,
    // `<v-icon icon="mdi-play">` still renders an element and still
    // type-checks — it just has no glyph in it. The class is the observable
    // half of the wiring.
    expect(vuetify.icons.defaultSet).toBe('mdi');
    expect(Object.keys(vuetify.icons.sets)).toContain('mdi');
    // `$dropdown` and friends: the aliases Vuetify's OWN components reach for,
    // which is where the combobox chevron and the select arrow come from.
    expect(vuetify.icons.aliases?.dropdown).toBeDefined();
  });
});
