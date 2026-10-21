import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import vuetify from '@/plugins/vuetify';
import InfiniteMore from '@/components/InfiniteMore.vue';
import { stubBrowserApis } from './mount-with-vuetify';

/**
 * The infinite-scroll sentinel, which replaced the paginator.
 *
 * ⚠️ **The button is not a nicety.** An `IntersectionObserver` fires on scroll,
 * and a keyboard user may never scroll — so the rest of a 180-clip library would
 * be unreachable without it. It is acceptable and cheap, and it is also the
 * difference between the list existing and not.
 */

type ObserverCallback = (entries: { isIntersecting: boolean }[]) => void;

const observers = vi.hoisted(() => ({
  callbacks: [] as ObserverCallback[],
  observed: 0,
  unobserved: 0,
  disconnected: 0,
  available: true,
}));

class FakeObserver {
  constructor(callback: ObserverCallback) {
    observers.callbacks.push(callback);
  }
  observe(): void {
    observers.observed += 1;
  }
  unobserve(): void {
    observers.unobserved += 1;
  }
  disconnect(): void {
    observers.disconnected += 1;
  }
}

beforeAll(stubBrowserApis);

beforeEach(() => {
  observers.callbacks = [];
  observers.observed = 0;
  observers.unobserved = 0;
  observers.disconnected = 0;
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});

function mountSentinel(props: Record<string, unknown> = {}) {
  return mount(InfiniteMore, {
    props: { hasMore: true, ...props },
    global: { plugins: [vuetify] },
  });
}

describe('when there is more to load', () => {
  it('watches for the sentinel coming into view, well before it does', () => {
    const wrapper = mountSentinel();

    expect(observers.observed).toBe(1);

    wrapper.unmount();
  });

  it('asks for the next batch when the sentinel is reached', () => {
    const wrapper = mountSentinel();

    observers.callbacks[0]?.([{ isIntersecting: true }]);

    expect(wrapper.emitted('load')).toHaveLength(1);

    wrapper.unmount();
  });

  it('does not ask when the sentinel merely leaves the viewport', () => {
    const wrapper = mountSentinel();

    observers.callbacks[0]?.([{ isIntersecting: false }]);

    expect(wrapper.emitted('load')).toBeUndefined();

    wrapper.unmount();
  });

  /**
   * ⚠️ **Without this, a short batch walks the whole list in one go**: the
   * sentinel is still on screen when the batch lands, so it fires again
   * immediately — which is exactly what infinite scroll exists to avoid.
   */
  it('stops watching while a batch is in flight, and resumes after', async () => {
    const wrapper = mountSentinel();

    await wrapper.setProps({ loading: true });
    expect(observers.unobserved).toBe(1);

    await wrapper.setProps({ loading: false });
    expect(observers.observed).toBe(2);

    wrapper.unmount();
  });

  it('refuses a second request while one is loading', () => {
    const wrapper = mountSentinel({ loading: true });

    observers.callbacks[0]?.([{ isIntersecting: true }]);

    expect(wrapper.emitted('load')).toBeUndefined();

    wrapper.unmount();
  });

  it('says what it is doing, in the noun the screen uses', () => {
    const wrapper = mountSentinel({ loading: true, noun: 'episodios' });

    expect(wrapper.text()).toContain('cargando más episodios…');

    wrapper.unmount();
  });

  it('offers a real button for anyone not scrolling', async () => {
    const wrapper = mountSentinel({ noun: 'cortes' });

    const button = wrapper.find('.more__button');
    expect(button.text()).toBe('Cargar más cortes');

    await button.trigger('click');
    expect(wrapper.emitted('load')).toHaveLength(1);

    wrapper.unmount();
  });

  it('disconnects on unmount', () => {
    mountSentinel().unmount();

    expect(observers.disconnected).toBe(1);
  });
});

describe('when the list is complete', () => {
  it('renders nothing at all', () => {
    const wrapper = mountSentinel({ hasMore: false });

    expect(wrapper.find('.more').exists()).toBe(false);

    wrapper.unmount();
  });
});

describe('without an IntersectionObserver', () => {
  // ⚠️ The button is the ONLY affordance then, which is why it is not a
  // progressive enhancement of the observer but a peer of it.
  it('still offers the button', () => {
    vi.stubGlobal('IntersectionObserver', undefined);

    const wrapper = mountSentinel();

    expect(wrapper.find('.more__button').exists()).toBe(true);

    wrapper.unmount();
  });
});
