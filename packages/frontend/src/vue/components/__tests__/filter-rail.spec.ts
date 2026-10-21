import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { h } from 'vue';
import vuetify from '@/plugins/vuetify';
import FilterRail from '@/components/FilterRail.vue';
import { freshPinia, stubBrowserApis, testRouter } from './mount-with-vuetify';

/**
 * The 232 px filter rail, and the sticky header + sheet it becomes on a phone.
 *
 * ⚠️ **One component for both**, because they are one control: the desktop rail
 * and the mobile sheet hold the same filters, and building them separately is
 * how a filter ends up existing on one and not the other.
 *
 * ⚠️ **This is where the site credit lives now.** With an infinite list and a
 * fixed player the footer is unreachable — you can never scroll past the end of
 * a list that keeps growing — so `⌨️ con ❤️ por dicren` moved into the rail.
 * It is the one place
 * the app says who owns the content, so the assertions that used to live in
 * `app-shell.spec.ts` live here.
 */

/**
 * ⚠️ `dirname(fileURLToPath(import.meta.url))` and NOT
 * `new URL('…', import.meta.url)`: Vite treats that second form as a static
 * ASSET reference and rewrites it into a served URL, so the path arrives as
 * `http://localhost/…` and `readFileSync` rejects it.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON = join(HERE, '../../../../package.json');
const packageVersion = (JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as { version: string })
  .version;

beforeAll(stubBrowserApis);

function mountRail(props: Record<string, unknown> = {}) {
  return mount(FilterRail, {
    props,
    slots: {
      search: () => h('input', { class: 'test-search', type: 'search' }),
      default: () => h('div', { class: 'test-filters' }, 'filtros'),
    },
    global: { plugins: [freshPinia(), vuetify, testRouter()] },
  });
}

/** The same rail below the design's 720 px breakpoint. ⚠️ `matchMedia` is what
 *  the component asks, so that is what the test answers — jsdom implements no
 *  media queries of its own. */
function mountCompactRail(props: Record<string, unknown> = {}) {
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
    return mountRail(props);
  } finally {
    window.matchMedia = original;
  }
}

describe('the credit that moved out of the footer', () => {
  it('names gravina82 and prints the build it is', () => {
    const wrapper = mountRail();
    const credit = wrapper.find('.rail__credit');

    expect(credit.text()).toContain('por dicren para');
    expect(credit.text()).toContain('gravina82');
    // ⚠️ Who owns the content. The root `CLAUDE.md` opens with it, and it is the
    // one sentence the site is obliged to carry.
    expect(credit.text()).toContain('todo el contenido es de gravina82');

    // ⚠️ The version comes from a `define`d constant read out of THIS
    // package's `package.json`, not from `import.meta.env`. Comparing against
    // the file is what proves the wiring rather than that some string rendered.
    expect(__APP_VERSION__).toBe(packageVersion);
    expect(credit.text()).toContain(`v${packageVersion}`);

    wrapper.unmount();
  });

  it('points its two links outward, safely', () => {
    const wrapper = mountRail();

    const links = wrapper.findAll('.rail__credit a');
    expect(links.map((a) => a.attributes('href'))).toEqual([
      'https://gravina82.com',
      'https://github.com/DiCrEn/gravindex',
    ]);
    for (const link of links) {
      expect(link.attributes('target')).toBe('_blank');
      expect(link.attributes('rel')).toContain('noopener');
    }

    wrapper.unmount();
  });
});

describe('the two layouts', () => {
  /**
   * ⚠️ **One at a time, and this is the assertion that says so.** Rendering both
   * and hiding one with CSS would put every one of the 102 tag checkboxes in the
   * document twice — invisible to a sighted visitor, very visible to a screen
   * reader, and twice the work for every keyboard `Tab` through the filters.
   *
   * The harness stubs `matchMedia` as "not matching", which is the wide layout.
   */
  it('renders the rail alone at desktop width', () => {
    const wrapper = mountRail();

    expect(wrapper.find('.rail').exists()).toBe(true);
    expect(wrapper.find('.rail__mobilehead').exists()).toBe(false);
    // Each slot appears exactly once.
    expect(wrapper.findAll('.test-search')).toHaveLength(1);
    expect(wrapper.findAll('.test-filters')).toHaveLength(1);

    wrapper.unmount();
  });

  it('renders the sticky header and the sheet alone below the breakpoint', () => {
    const wrapper = mountCompactRail();

    expect(wrapper.find('.rail').exists()).toBe(false);
    expect(wrapper.find('.rail__mobilehead').exists()).toBe(true);
    expect(wrapper.findAll('.test-search')).toHaveLength(1);
    expect(wrapper.findAll('.test-filters')).toHaveLength(1);

    wrapper.unmount();
  });
});

describe('the mobile sheet', () => {
  it('starts closed, and the button says so', () => {
    const wrapper = mountCompactRail();

    expect(wrapper.find('.rail__filterbtn').attributes('aria-expanded')).toBe('false');

    wrapper.unmount();
  });

  it('opens and closes on the Filtros button', async () => {
    const wrapper = mountCompactRail();

    await wrapper.find('.rail__filterbtn').trigger('click');
    expect(wrapper.find('.rail__filterbtn').attributes('aria-expanded')).toBe('true');

    await wrapper.find('.rail__filterbtn').trigger('click');
    expect(wrapper.find('.rail__filterbtn').attributes('aria-expanded')).toBe('false');

    wrapper.unmount();
  });

  it('carries the number of active filters on the button', () => {
    const wrapper = mountCompactRail({ activeFilters: 3 });

    expect(wrapper.find('.rail__filterbtn b').text()).toBe('3');

    wrapper.unmount();
  });

  it('shows no badge when nothing is filtered', () => {
    const wrapper = mountCompactRail({ activeFilters: 0 });

    expect(wrapper.find('.rail__filterbtn b').exists()).toBe(false);

    wrapper.unmount();
  });

  // ⚠️ The credit has to exist on a phone too: it is the one place the app says
  // who owns the content, and with one layout in the DOM it would otherwise
  // simply not be there below 720 px.
  it('carries the credit as well', () => {
    const wrapper = mountCompactRail();

    expect(wrapper.find('.rail__credit').text()).toContain('gravina82');

    wrapper.unmount();
  });
});

describe('the header the sheet hangs from', () => {
  afterEach(() => vi.restoreAllMocks());

  it('stays pinned by default, which is what the list wants', () => {
    const wrapper = mountCompactRail();

    expect(wrapper.find('.rail__mobilehead').classes()).not.toContain('is-loose');

    wrapper.unmount();
  });

  it('⚠️ lets go when a screen asks, because there is only one `top: 0`', () => {
    const wrapper = mountCompactRail({ stickyHead: false });

    expect(wrapper.find('.rail__mobilehead').classes()).toContain('is-loose');

    wrapper.unmount();
  });

  it('⚠️ takes the top back the moment the sheet opens, whatever it was told', async () => {
    const wrapper = mountCompactRail({ stickyHead: false });

    await wrapper.find('.rail__filterbtn').trigger('click');

    // A panel you can scroll away from — leaving its own search box and its own
    // Filtros button behind — is a panel with no way back.
    expect(wrapper.find('.rail__mobilehead').classes()).not.toContain('is-loose');

    await wrapper.find('.rail__filterbtn').trigger('click');
    expect(wrapper.find('.rail__mobilehead').classes()).toContain('is-loose');

    wrapper.unmount();
  });

  it('⚠️ places the sheet against the header’s MEASURED bottom, not a constant', async () => {
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
      fn(0);
      return 0;
    });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      // The header pinned at the top of a scrolled page: 58 px tall, at y 0.
      const bottom = this.classList.contains('rail__mobilehead') ? 58 : 0;
      return { top: 0, bottom, height: bottom, left: 0, right: 0, width: 0 } as DOMRect;
    });
    const wrapper = mountCompactRail();

    await wrapper.find('.rail__filterbtn').trigger('click');

    // The hard-coded `top: 116px` was the nav bar plus this header, true only at
    // the very top of an unscrolled page.
    expect(wrapper.find('.rail__sheet').attributes('style')).toContain('top: 58px');

    wrapper.unmount();
  });
});

describe('"Limpiar filtros"', () => {
  // ⚠️ An inert control is furniture: with nothing set there is nothing to
  // clear, and offering it anyway teaches people it does nothing.
  it('is absent until something is actually set', () => {
    const wrapper = mountRail({ canClear: false });

    expect(wrapper.text()).not.toContain('Limpiar filtros');

    wrapper.unmount();
  });

  it('asks the screen to clear, rather than clearing anything itself', async () => {
    const wrapper = mountRail({ canClear: true });

    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Limpiar filtros')
      ?.trigger('click');

    expect(wrapper.emitted('clear')).toHaveLength(1);

    wrapper.unmount();
  });
});
