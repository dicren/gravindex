import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import type { EpisodeListItem } from '#/domain/episodes/episode.entity';
import vuetify from '@/plugins/vuetify';
import CalendarDayPanel from '@/components/CalendarDayPanel.vue';
import EpisodeRowItem from '@/components/EpisodeRowItem.vue';
import { freshPinia, stubBrowserApis, testRouter } from './mount-with-vuetify';

/**
 * ⚠️ Real `PointerEvent`s, not `trigger()`: `@vue/test-utils` assigns its option
 * object onto the event AFTER constructing it, and `clientX` is getter-only on
 * the prototype. Same reason `three-handle-slider.spec.ts` does it this way.
 */
function firePointer(
  el: Element,
  type: string,
  clientX: number,
  clientY: number,
  pointerType = 'touch',
): void {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      pointerId: 1,
      pointerType,
      isPrimary: true,
    }),
  );
}

function episode(id: number, clipCount = 0): EpisodeListItem {
  return {
    id,
    title: `Episodio ${id}`,
    cover: 'https://example.test/cover.png',
    file: 'https://example.test/audio.mp3',
    originalUrl: 'https://example.test/episodio',
    date: new Date(2011, 6, 25, 12),
    clipCount,
  };
}

async function mountPanel(overrides: Record<string, unknown> = {}) {
  const router = testRouter();
  await router.push('/episodes/calendario/2011');
  await router.isReady();

  return mount(CalendarDayPanel, {
    props: {
      day: '2011-07-25',
      episodes: [episode(93, 11)],
      clipCount: 11,
      anchor: null,
      hasPrev: true,
      hasNext: true,
      compact: false,
      ...overrides,
    },
    global: { plugins: [vuetify, freshPinia(), router] },
  });
}

describe('CalendarDayPanel', () => {
  beforeEach(stubBrowserApis);

  it('names the day and what it holds', async () => {
    const wrapper = await mountPanel();

    expect(wrapper.find('.pop__date').text()).toBe('lun 25 de Julio de 2011');
    expect(wrapper.find('.pop__meta').text()).toBe('1 episodio · 11 cortes');
  });

  it('⚠️ puts the LIST’s own row inside, not a second drawing of an episode', async () => {
    const wrapper = await mountPanel({ episodes: [episode(93, 11), episode(94)] });

    expect(wrapper.findAllComponents(EpisodeRowItem)).toHaveLength(2);
  });

  it('asks to step a day from each arrow', async () => {
    const wrapper = await mountPanel();

    await wrapper.findAll('.pop__step')[0]?.trigger('click');
    await wrapper.findAll('.pop__step')[1]?.trigger('click');

    expect(wrapper.emitted('step')).toEqual([[-1], [1]]);
  });

  it('greys the arrow that has nowhere to go', async () => {
    const wrapper = await mountPanel({ hasPrev: false });

    expect(wrapper.findAll('.pop__step')[0]?.attributes('disabled')).toBeDefined();
    expect(wrapper.findAll('.pop__step')[1]?.attributes('disabled')).toBeUndefined();
  });

  it('closes from its own button', async () => {
    const wrapper = await mountPanel();

    await wrapper.find('.pop__close').trigger('click');

    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  describe('the keyboard', () => {
    it('⚠️ steps a day with the arrow keys, the same as the buttons', async () => {
      const wrapper = await mountPanel();

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));

      expect(wrapper.emitted('step')).toEqual([[1], [-1]]);
    });

    it('closes on Escape', async () => {
      const wrapper = await mountPanel();

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(wrapper.emitted('close')).toHaveLength(1);
    });

    it('⚠️ never steals an arrow aimed at a text box — the search field is right there', async () => {
      const wrapper = await mountPanel();
      const field = document.createElement('input');
      document.body.append(field);

      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

      expect(wrapper.emitted('step')).toBeUndefined();
      field.remove();
    });

    it('leaves a modified arrow to the browser', async () => {
      const wrapper = await mountPanel();

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', metaKey: true }));

      expect(wrapper.emitted('step')).toBeUndefined();
    });

    it('does not step past the end', async () => {
      const wrapper = await mountPanel({ hasNext: false });

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));

      expect(wrapper.emitted('step')).toBeUndefined();
    });

    it('stops listening once it is gone', async () => {
      const wrapper = await mountPanel();
      wrapper.unmount();

      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));

      expect(wrapper.emitted('step')).toBeUndefined();
    });
  });

  describe('a press outside', () => {
    it('⚠️ closes the popover: nothing dims the page, so the calendar behind it is live', async () => {
      const wrapper = await mountPanel({ compact: false });
      const outside = document.createElement('div');
      document.body.append(outside);

      firePointer(outside, 'pointerdown', 10, 10, 'mouse');

      expect(wrapper.emitted('close')).toHaveLength(1);
      outside.remove();
    });

    it('leaves a press inside it alone', async () => {
      const wrapper = await mountPanel({ compact: false });

      firePointer(wrapper.find('.pop__body').element, 'pointerdown', 10, 10, 'mouse');

      expect(wrapper.emitted('close')).toBeUndefined();
    });

    it('⚠️ leaves a press on a DAY alone — that cell decides for itself', async () => {
      const wrapper = await mountPanel({ compact: false });
      const cell = document.createElement('button');
      cell.className = 'cm__d';
      document.body.append(cell);

      firePointer(cell, 'pointerdown', 10, 10, 'mouse');

      expect(wrapper.emitted('close')).toBeUndefined();
      cell.remove();
    });

    it('does nothing as a sheet, where the scrim is the outside', async () => {
      const wrapper = await mountPanel({ compact: true });
      const outside = document.createElement('div');
      document.body.append(outside);

      firePointer(outside, 'pointerdown', 10, 10, 'touch');

      expect(wrapper.emitted('close')).toBeUndefined();
      outside.remove();
    });

    it('stops listening once it is gone', async () => {
      const wrapper = await mountPanel({ compact: false });
      wrapper.unmount();
      const outside = document.createElement('div');
      document.body.append(outside);

      firePointer(outside, 'pointerdown', 10, 10, 'mouse');

      expect(wrapper.emitted('close')).toBeUndefined();
      outside.remove();
    });
  });

  describe('the swipe', () => {
    const swipe = async (wrapper: Awaited<ReturnType<typeof mountPanel>>, dx: number) => {
      const panel = wrapper.find('.pop').element;
      firePointer(panel, 'pointerdown', 200, 300);
      firePointer(panel, 'pointermove', 200 + dx / 2, 302);
      firePointer(panel, 'pointerup', 200 + dx, 304);
      await nextTick();
    };

    it('⚠️ goes forward on a swipe left, like a page turning', async () => {
      const wrapper = await mountPanel({ compact: true });

      await swipe(wrapper, -90);

      expect(wrapper.emitted('step')).toEqual([[1]]);
    });

    it('goes back on a swipe right', async () => {
      const wrapper = await mountPanel({ compact: true });

      await swipe(wrapper, 90);

      expect(wrapper.emitted('step')).toEqual([[-1]]);
    });

    it('ignores a nudge too short to be meant', async () => {
      const wrapper = await mountPanel({ compact: true });

      await swipe(wrapper, -20);

      expect(wrapper.emitted('step')).toBeUndefined();
    });

    it('⚠️ ignores a mostly-vertical drag, which is somebody scrolling', async () => {
      const wrapper = await mountPanel({ compact: true });
      const panel = wrapper.find('.pop').element;
      firePointer(panel, 'pointerdown', 200, 300);
      firePointer(panel, 'pointermove', 220, 400);
      firePointer(panel, 'pointerup', 240, 500);
      await nextTick();

      expect(wrapper.emitted('step')).toBeUndefined();
    });

    it('⚠️ is not offered in the wide layout, where the panel is a popover', async () => {
      const wrapper = await mountPanel({ compact: false });

      await swipe(wrapper, -90);

      expect(wrapper.emitted('step')).toBeUndefined();
    });

    it('leaves a mouse drag alone — that is a text selection', async () => {
      const wrapper = await mountPanel({ compact: true });
      const panel = wrapper.find('.pop').element;
      firePointer(panel, 'pointerdown', 200, 300, 'mouse');
      firePointer(panel, 'pointerup', 100, 300, 'mouse');
      await nextTick();

      expect(wrapper.emitted('step')).toBeUndefined();
    });

    it('⚠️ swallows the click a swipe ends on, or letting go over Cortar navigates', async () => {
      const wrapper = await mountPanel({ compact: true });
      await swipe(wrapper, -90);

      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      wrapper.find('.pop').element.dispatchEvent(click);

      expect(click.defaultPrevented).toBe(true);
    });
  });

  it('draws a scrim to close against, but only as a sheet', async () => {
    const wide = await mountPanel({ compact: false });
    expect(wide.find('.pop-scrim').exists()).toBe(false);

    const narrow = await mountPanel({ compact: true });
    expect(narrow.find('.pop-scrim').exists()).toBe(true);
    await narrow.find('.pop-scrim').trigger('click');
    expect(narrow.emitted('close')).toHaveLength(1);
  });
});
