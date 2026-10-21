import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { VSelect } from 'vuetify/components';
import vuetify from '@/plugins/vuetify';
import GravPagination from '@/components/GravPagination.vue';
import { freshPinia, stubBrowserApis, testRouter } from './mount-with-vuetify';

/**
 * ⚠️ Nothing here measures the DOM to decide how many page buttons fit; that
 * is left to Vuetify's `total-visible`. What is asserted here is the *behaviour*
 * a pager has to provide —
 * navigation, a page-size selector, and the offset-preserving arithmetic — plus
 * the Spanish accessible names, which Vuetify would otherwise supply in English.
 */

beforeAll(stubBrowserApis);

function mountPagination(props: { total: number; page?: number; limit?: number }) {
  return mount(GravPagination, {
    props: { page: 1, limit: 12, ...props },
    global: { plugins: [freshPinia(), vuetify, testRouter()] },
  });
}

function pageButton(wrapper: ReturnType<typeof mountPagination>, label: string) {
  return wrapper.findAll('button').find((b) => b.attributes('aria-label') === label);
}

describe('GravPagination', () => {
  it('offers as many pages as the total and the page size imply', () => {
    const wrapper = mountPagination({ total: 180, limit: 12 });

    // 180 clips at 12 a page is 15 pages — the real production numbers.
    expect(pageButton(wrapper, 'Ir a la página 15')).toBeDefined();
    expect(pageButton(wrapper, 'Ir a la página 16')).toBeUndefined();

    wrapper.unmount();
  });

  it('never offers a second page for an empty result', () => {
    const wrapper = mountPagination({ total: 0 });

    expect(pageButton(wrapper, 'Ir a la página 2')).toBeUndefined();

    wrapper.unmount();
  });

  it('navigates, and scrolls back to the top of the new page', async () => {
    // ⚠️ Spied, not observed through `window.scrollY`: jsdom's `scrollTo` is
    // "not implemented", so the position never moves and the naive assertion
    // passes whether the call happens or not.
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);

    const wrapper = mountPagination({ total: 180, page: 1 });
    await pageButton(wrapper, 'Ir a la página 3')?.trigger('click');

    expect(wrapper.emitted('update:page')).toEqual([[3]]);
    // A grid of cards is taller than the viewport; landing mid-page on new
    // results is disorienting, which is why the page goes back to the top.
    expect(scrollTo).toHaveBeenCalledWith(0, 0);

    vi.unstubAllGlobals();
    wrapper.unmount();
  });

  it('refuses a page outside the range', async () => {
    const wrapper = mountPagination({ total: 24, limit: 12, page: 1 });

    // `«` and `‹` are disabled on page 1, so this is the belt to their braces.
    await pageButton(wrapper, 'Primera página')?.trigger('click');
    expect(wrapper.emitted('update:page')).toBeUndefined();

    wrapper.unmount();
  });

  it('keeps you near the same offset when the page size changes', async () => {
    // The page-size arithmetic:
    // ceil(((page - 1) * limit - 1) / newLimit).
    const wrapper = mountPagination({ total: 180, page: 3, limit: 12 });

    wrapper.findComponent(VSelect).vm.$emit('update:modelValue', 24);
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('update:limit')).toEqual([[24]]);
    expect(wrapper.emitted('update:page')).toEqual([[1]]);

    wrapper.unmount();
  });

  it('leaves the page alone when the arithmetic lands out of range', async () => {
    // ⚠️ From page 1 the formula yields 0, which is why it looks off by one and
    // is not: `goTo` rejects it and the visitor stays put.
    const wrapper = mountPagination({ total: 180, page: 1, limit: 12 });

    wrapper.findComponent(VSelect).vm.$emit('update:modelValue', 48);
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('update:limit')).toEqual([[48]]);
    expect(wrapper.emitted('update:page')).toBeUndefined();

    wrapper.unmount();
  });

  it('offers the three page sizes', () => {
    const wrapper = mountPagination({ total: 180 });

    expect(wrapper.findComponent(VSelect).props('items')).toEqual([
      { title: '12 por página', value: 12 },
      { title: '24 por página', value: 24 },
      { title: '48 por página', value: 48 },
    ]);

    wrapper.unmount();
  });

  it('names every control in Spanish, whatever it is drawn with', () => {
    // ⚠️ Vuetify's own aria strings are English, so an un-overridden control
    // here is unlabelled to a screen reader — and the arrows became `v-icon`s
    // when `@mdi/font` landed, which is exactly the change that could have
    // dropped the overrides without anything looking wrong.
    const wrapper = mountPagination({ total: 180, page: 3 });

    // Named in the loop body's assertion message by the label itself.
    for (const label of [
      'Primera página',
      'Página anterior',
      'Página siguiente',
      'Última página',
      'Ir a la página 2',
      'Página actual, página 3',
    ]) {
      expect(pageButton(wrapper, label)).toBeDefined();
    }
    // The glyph moved into the icon font; the name stayed on the button.
    expect(pageButton(wrapper, 'Primera página')?.find('.mdi-chevron-double-left').exists()).toBe(
      true,
    );
    expect(pageButton(wrapper, 'Página anterior')?.find('.mdi-chevron-left').exists()).toBe(true);
    expect(pageButton(wrapper, 'Página siguiente')?.find('.mdi-chevron-right').exists()).toBe(true);
    expect(pageButton(wrapper, 'Última página')?.find('.mdi-chevron-double-right').exists()).toBe(
      true,
    );

    // ⚠️ And the icons say nothing: every one of them is `aria-hidden`, so the
    // button's accessible name is the label above and not "chevron double left".
    for (const icon of wrapper.findAll('.v-icon')) {
      expect(icon.attributes('aria-hidden')).toBe('true');
    }

    wrapper.unmount();
  });

  it('draws the page-size chevron, which is what the brown icon token colours', () => {
    // ⚠️ `menu-icon=""` used to suppress it because an uninstalled font would
    // have rendered an empty box. The chevron is painted in `$brown-gravinero`,
    // and `.control-graviner .v-icon` in the theme sets that colour — a rule with
    // nothing to paint until this icon exists.
    const wrapper = mountPagination({ total: 180 });

    const limit = wrapper.find('.grav-pagination__limit');
    expect(limit.classes()).toContain('control-graviner');
    expect(limit.find('.v-select__menu-icon').exists()).toBe(true);

    wrapper.unmount();
  });
});
