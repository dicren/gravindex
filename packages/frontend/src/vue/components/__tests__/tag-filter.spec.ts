import { beforeAll, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { TagCount } from '#/domain/tags/tag.entity';
import vuetify from '@/plugins/vuetify';
import TagFilter from '@/components/TagFilter.vue';
import { freshPinia, stubBrowserApis, testRouter } from './mount-with-vuetify';

/**
 * The library's tag filter.
 *
 * ⚠️ **All 102 tags are offered, always**, and that was argued about: an earlier
 * proposal hid the 50 single-use ones behind the search box and was rejected —
 * *"si no, nadie se va a acordar de los tags ocultos"*.
 * The distribution is what makes a searchable
 * list right and a chip cloud wrong: ten tags carry 49 % of the 382 tag rows.
 */

const TAGS: TagCount[] = [
  { tag: 'Monográficos', count: 45 },
  { tag: 'Cine', count: 22 },
  { tag: 'Anécdotas', count: 18 },
  { tag: 'Briñate', count: 1 },
];

/** ⚠️ Code-point order is what the API answers in, and the filter re-sorts. */
const AS_THE_API_SENDS_THEM: TagCount[] = [
  { tag: 'Anécdotas', count: 18 },
  { tag: 'Briñate', count: 1 },
  { tag: 'Cine', count: 22 },
  { tag: 'Monográficos', count: 45 },
];

beforeAll(stubBrowserApis);

function mountFilter(props: Record<string, unknown> = {}) {
  return mount(TagFilter, {
    props: { tags: TAGS, modelValue: [], ...props },
    global: { plugins: [freshPinia(), vuetify, testRouter()] },
  });
}

/** The UNPINNED rows: the direct children of the scroller, i.e. everything that
 *  is not already selected and sitting above the dashed rule. */
const names = (wrapper: ReturnType<typeof mountFilter>) =>
  wrapper.findAll('.tagfilter__list > .tagfilter__item .tagfilter__name').map((n) => n.text());

describe('what it lists', () => {
  it('offers every tag it was given, with its count', () => {
    const wrapper = mountFilter();

    expect(names(wrapper)).toHaveLength(4);
    expect(wrapper.text()).toContain('Tags · 4');
    expect(wrapper.findAll('.tagfilter__item b').map((b) => b.text())).toEqual([
      '45',
      '22',
      '18',
      '1',
    ]);

    wrapper.unmount();
  });

  /**
   * ⚠️ **Ordered by use here, not on the wire.** `GET /tags` answers in
   * code-point order and that ordering is pinned by a test for a real reason — a
   * different Postgres locale reshuffles every accented tag — so the re-sort
   * happens in the browser, over 102 rows, for free.
   */
  it('re-sorts by count, whatever order the API used', () => {
    const wrapper = mountFilter({ tags: AS_THE_API_SENDS_THEM });

    expect(names(wrapper)).toEqual(['Monográficos', 'Cine', 'Anécdotas', 'Briñate']);

    wrapper.unmount();
  });

  it('says it is loading rather than showing an empty list', () => {
    const wrapper = mountFilter({ loading: true });

    expect(wrapper.text()).toContain('Cargando tags…');
    expect(names(wrapper)).toHaveLength(0);

    wrapper.unmount();
  });
});

describe('the search box', () => {
  // ⚠️ Accent-INsensitive, which Vuetify's own matcher is not: a tenth of the
  // real tag list carries a tilde or an ñ.
  it('matches accent-insensitively and as a substring', async () => {
    const wrapper = mountFilter();

    await wrapper.find('input[type="search"]').setValue('brinat');
    expect(names(wrapper)).toEqual(['Briñate']);

    await wrapper.find('input[type="search"]').setValue('necdo');
    expect(names(wrapper)).toEqual(['Anécdotas']);

    wrapper.unmount();
  });

  it('says so when nothing matches', async () => {
    const wrapper = mountFilter();

    await wrapper.find('input[type="search"]').setValue('zzz');

    expect(wrapper.text()).toContain('Ningún tag se llama así.');

    wrapper.unmount();
  });

  /**
   * ⚠️ **Folding is for MATCHING only.** Tags are compared byte for byte by the
   * backend, so a folded form must never reach the model — it would filter to
   * nothing.
   */
  it('emits the tag exactly as stored, never the folded form', async () => {
    const wrapper = mountFilter();

    await wrapper.find('input[type="search"]').setValue('brinat');
    await wrapper.findAll('.tagfilter__item').at(-1)?.trigger('click');

    expect(wrapper.emitted('update:modelValue')).toEqual([[['Briñate']]]);

    wrapper.unmount();
  });
});

describe('selecting', () => {
  it('adds a tag, and removes it on a second press', async () => {
    const wrapper = mountFilter();

    await wrapper.findAll('.tagfilter__item')[0]?.trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['Monográficos']]);

    const selected = mountFilter({ modelValue: ['Monográficos'] });
    await selected.findAll('.tagfilter__item')[0]?.trigger('click');
    expect(selected.emitted('update:modelValue')?.[0]).toEqual([[]]);

    wrapper.unmount();
    selected.unmount();
  });

  /**
   * ⚠️ **A NEW array every time.** `useListFilters` watches deeply, and a
   * mutation in place is a change it cannot always see — the same trap
   * `TagPicker` carries a comment about.
   */
  it('never mutates the array it was given', async () => {
    const model = ['Cine'];
    const wrapper = mountFilter({ modelValue: model });

    await wrapper.findAll('.tagfilter__item')[0]?.trigger('click');

    expect(model).toEqual(['Cine']);

    wrapper.unmount();
  });

  /**
   * ⚠️ Without this, choosing a tag from the bottom of a 102-row scroller means
   * it is no longer on screen and the only evidence of the filter is the list
   * changing under you.
   */
  it('pins the selected tags to the top, out of the scrolling list', () => {
    const wrapper = mountFilter({ modelValue: ['Briñate'] });

    expect(wrapper.find('.tagfilter__chosen').text()).toContain('Briñate');
    // ...and it is not repeated below.
    expect(names(wrapper)).toEqual(['Monográficos', 'Cine', 'Anécdotas']);

    wrapper.unmount();
  });

  it('keeps a selected tag visible even when the search excludes it', async () => {
    const wrapper = mountFilter({ modelValue: ['Briñate'] });

    await wrapper.find('input[type="search"]').setValue('cine');

    expect(wrapper.find('.tagfilter__chosen').text()).toContain('Briñate');
    expect(names(wrapper)).toEqual(['Cine']);

    wrapper.unmount();
  });

  it('says whether a row is on, not just how it is painted', () => {
    const wrapper = mountFilter({ modelValue: ['Monográficos'] });

    const pressed = wrapper.findAll('button').map((b) => b.attributes('aria-pressed'));
    expect(pressed).toContain('true');
    expect(pressed).toContain('false');

    wrapper.unmount();
  });
});
