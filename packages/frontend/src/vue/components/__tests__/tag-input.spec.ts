import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { VCombobox } from 'vuetify/components';
import vuetify from '@/plugins/vuetify';
import TagAutocomplete from '@/components/TagAutocomplete.vue';
import TagPicker from '@/components/TagPicker.vue';
import { freshPinia, stubBrowserApis, testRouter } from './mount-with-vuetify';

/**
 * The tag input, which three screens share.
 *
 * ⚠️ Two of these guard bugs that were found in a browser and are invisible in
 * review: Vuetify's own matcher is accent-SENSITIVE (so a tenth of the real tag
 * list becomes unreachable), and a single-value `v-combobox` rewrites its model
 * on every keystroke (so typing `brinate` submitted seven tags).
 */

// ⚠️ Ten, not six: `TagPicker`'s narrow band offers eight before it offers
// "+ los N", so a shorter list can never exercise the overflow at all.
const ALL_TAGS = [
  'Absurdo',
  'Anécdotas',
  'Briñate',
  'Cine',
  'Gazpacho',
  'Star Wars',
  'Publicidad',
  'Toros',
  'Viajes',
  'Zapatos',
];

// ⚠️ `{ tag, count }` — `GET /tags` answers objects, not a flat `string[]`. The widget offers NAMES: a count next to a free-text input reads
// as part of the tag, and it belongs to the library's filter, where it means
// something.
vi.mock('@/queries/tags.query', () => ({
  useTagList: () => ({
    data: { value: ALL_TAGS.map((tag, index) => ({ tag, count: index + 1 })) },
    isPending: { value: false },
    isLoading: { value: false },
  }),
}));

beforeAll(stubBrowserApis);

function mountAutocomplete(props: Record<string, unknown> = {}) {
  return mount(TagAutocomplete, {
    props,
    global: { plugins: [freshPinia(), vuetify, testRouter()] },
  });
}

describe('TagAutocomplete', () => {
  it('filters accent-insensitively, which Vuetify’s own matcher does not', async () => {
    const wrapper = mountAutocomplete();

    await wrapper.find('input').setValue('brinat');
    expect(wrapper.findComponent(VCombobox).props('items')).toEqual(['Briñate']);

    await wrapper.find('input').setValue('anecdo');
    expect(wrapper.findComponent(VCombobox).props('items')).toEqual(['Anécdotas']);

    // ...and typing the accent works just as well.
    await wrapper.find('input').setValue('Briña');
    expect(wrapper.findComponent(VCombobox).props('items')).toEqual(['Briñate']);

    wrapper.unmount();
  });

  it('hands the filtering off entirely — Vuetify must not filter again', () => {
    // With `no-filter` off, Vuetify would re-filter the already-folded list
    // accent-sensitively and throw the matches away.
    expect(mountAutocomplete().findComponent(VCombobox).props('noFilter')).toBe(true);
  });

  it('never offers a tag that is already chosen', async () => {
    const wrapper = mountAutocomplete({ exclude: ['Cine', 'Briñate'] });

    await wrapper.find('input').setValue('');
    expect(wrapper.findComponent(VCombobox).props('items')).toEqual([
      'Absurdo',
      'Anécdotas',
      'Gazpacho',
      'Star Wars',
      'Publicidad',
      'Toros',
      'Viajes',
      'Zapatos',
    ]);

    wrapper.unmount();
  });

  it('submits nothing while you type, and exactly once on Enter', async () => {
    // ⚠️ The regression this file exists for. A single-value combobox emits
    // `update:modelValue` per keystroke; that put `?tags=b&tags=r&tags=i…` in
    // the address bar. `multiple` is what makes the model move only on a real
    // selection.
    const wrapper = mountAutocomplete();
    const input = wrapper.find('input');

    for (const text of ['g', 'ga', 'gaz']) {
      await input.setValue(text);
    }
    expect(wrapper.emitted('submit')).toBeUndefined();

    await input.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('submit')).toEqual([['Gazpacho']]);

    wrapper.unmount();
  });

  it('accepts a brand-new tag nobody has used, so the vocabulary can grow', async () => {
    const wrapper = mountAutocomplete();

    await wrapper.find('input').setValue('Melocotón Cane');
    // Nothing matches, so there is nothing to auto-select and the free text
    // stands. A tag has to be inventable or a clip could never get its first.
    expect(wrapper.findComponent(VCombobox).props('items')).toEqual([]);
    await wrapper.find('input').trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('submit')).toEqual([['Melocotón Cane']]);

    wrapper.unmount();
  });

  it('clears itself after a submission, ready for the next tag', async () => {
    const wrapper = mountAutocomplete();

    await wrapper.find('input').setValue('gaz');
    await wrapper.find('input').trigger('keydown', { key: 'Enter' });
    await wrapper.vm.$nextTick();

    expect(wrapper.findComponent(VCombobox).props('modelValue')).toEqual([]);

    wrapper.unmount();
  });
});

describe('TagPicker — the editor’s tag field', () => {
  function mountPicker(tags: string[] = []) {
    return mount(TagPicker, {
      props: { modelValue: tags, 'onUpdate:modelValue': () => {} },
      global: { plugins: [freshPinia(), vuetify, testRouter()] },
    });
  }

  it('replaces the array rather than mutating it', async () => {
    const wrapper = mountPicker([]);

    await wrapper.find('input').setValue('gaz');
    await wrapper.find('input').trigger('keydown', { key: 'Enter' });

    // ⚠️ A new array, not a `push`: a `v-model` target watched deeply elsewhere
    // in this app.
    //
    // ⚠️ `Gazpacho`, not `gaz`: Enter takes the first SUGGESTION and only
    // invents when nothing matched — the first suggestion wins.
    expect(wrapper.emitted('update:modelValue')).toEqual([[['Gazpacho']]]);

    wrapper.unmount();
  });

  it('invents the typed tag when nothing matches, and says so before Enter', async () => {
    // ⚠️ **The case the `v-combobox` this replaced failed silently.** With
    // `hide-no-data`, typing a tag nobody has used yet opened an EMPTY white
    // menu: the one moment the control had something to say, and it said
    // nothing.
    const wrapper = mountPicker([]);

    await wrapper.find('input').setValue('Cumbrico');
    expect(wrapper.text()).toContain('Inventar el tag «Cumbrico»');

    await wrapper.find('input').trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('update:modelValue')).toEqual([[['Cumbrico']]]);

    wrapper.unmount();
  });

  it('shows every tag with its use count, most used first', () => {
    const wrapper = mountPicker([]);

    const rows = wrapper.findAll('.tagpicker__item');
    expect(rows.length).toBeGreaterThan(1);
    // ⚠️ The count is the whole reason this is not a bare autocomplete: it is
    // what stops somebody inventing `Cacas` when nineteen clips already carry it.
    expect(rows[0]?.text()).toMatch(/\d+$/);

    const counts = rows.map((row) => Number(row.find('b').text()));
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);

    wrapper.unmount();
  });

  /**
   * ⚠️ **The narrow form is a different SHAPE, not a hidden copy**, and that is
   * this app's rule rather than a preference (`use-compact-layout.ts`): drawing
   * both and hiding one with CSS would put all 102 tags in the document twice —
   * invisible to somebody looking, very audible to a screen reader, and double
   * the `Tab` stops. So the assertion that matters is that the list is ABSENT,
   * not merely not shown.
   */
  describe('below the 720 px breakpoint', () => {
    function mountCompactPicker(tags: string[] = []) {
      const original = window.matchMedia;
      window.matchMedia = ((query: string) => ({
        matches: query.includes('max-width'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;

      try {
        return mountPicker(tags);
      } finally {
        window.matchMedia = original;
      }
    }

    it('offers a band of chips instead of the vertical list', () => {
      const wrapper = mountCompactPicker([]);

      expect(wrapper.find('.tagpicker__band').exists()).toBe(true);
      // ⚠️ Not `isVisible()` — absent. See the block comment above.
      expect(wrapper.find('.tagpicker__list').exists()).toBe(false);
      expect(wrapper.find('.tagpicker__chip-btn').text()).toBe('Zapatos 10');

      wrapper.unmount();
    });

    it('adds a tag from the band, and filters it in place while typing', async () => {
      const wrapper = mountCompactPicker([]);

      await wrapper.find('input').setValue('gaz');
      // ⚠️ Filtered where it stands: nothing opens and nothing overlays, which
      // is the point of the shape — a floating menu and the virtual keyboard
      // compete for the same half of a phone.
      expect(wrapper.find('.tagpicker__list').exists()).toBe(false);
      const chips = wrapper.findAll('.tagpicker__chip-btn');
      // ⚠️ The invent chip leads, because `gaz` is not a tag anybody has used —
      // the same rule the wide list follows, and the one the `v-combobox` this
      // replaced answered with an empty white menu.
      expect(chips.map((chip) => chip.text())).toEqual(['Inventar «gaz»', 'Gazpacho 5']);

      await chips.find((chip) => chip.text().includes('Gazpacho'))?.trigger('click');
      expect(wrapper.emitted('update:modelValue')).toEqual([[['Gazpacho']]]);

      wrapper.unmount();
    });

    it('opens the long list on demand, and only then', async () => {
      const wrapper = mountCompactPicker([]);
      expect(wrapper.find('.tagpicker__list').exists()).toBe(false);

      await wrapper.find('.tagpicker__chip-btn--more').trigger('click');

      expect(wrapper.find('.tagpicker__list').exists()).toBe(true);
      expect(wrapper.find('.tagpicker__band').exists()).toBe(false);

      wrapper.unmount();
    });
  });

  it('shows each chosen tag with a labelled way to remove it', async () => {
    const wrapper = mountPicker(['Briñate']);

    const remove = wrapper.find('.tagpicker__chip button');
    // ⚠️ A real button: Vuetify's `closable` chip carries the English
    // `$vuetify.close`, and the tag's NAME is the useful half of the label.
    expect(remove.attributes('aria-label')).toBe('Quitar el tag Briñate');
    await remove.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([[[]]]);

    wrapper.unmount();
  });

  it('never offers a tag that is already chosen', async () => {
    const wrapper = mountPicker(['Gazpacho']);

    expect(wrapper.findAll('.tagpicker__item').map((row) => row.text())).not.toContain(
      expect.stringContaining('Gazpacho'),
    );

    await wrapper.find('input').setValue('Gazpacho');
    await wrapper.find('input').trigger('keydown', { key: 'Enter' });

    // Not offered, and not inventable either — it is already there.
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();

    wrapper.unmount();
  });
});
