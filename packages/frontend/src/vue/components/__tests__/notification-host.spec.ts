import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';

import vuetify from '@/plugins/vuetify';
import NotificationHost from '@/components/NotificationHost.vue';
import { useNotificationsStore } from '@/stores/notifications.store';
import { freshPinia, stubBrowserApis } from './mount-with-vuetify';

/**
 * ⚠️ **This suite exists because the store passed its own tests while the app
 * showed nothing.** `notifications.store.ts` was complete and covered; the
 * screens pushed into it correctly; and there was no container in the shell, so
 * "¡No puedes votar dos veces!" and "Enlace copiado al portapapeles." reached
 * the queue and vanished. Every assertion below is about the half that gap was
 * in: the rendering, not the queueing.
 */

beforeAll(stubBrowserApis);

function mountHost() {
  const pinia = freshPinia();
  const wrapper = mount(NotificationHost, { global: { plugins: [pinia, vuetify] } });
  // ⚠️ Same Pinia instance, so this is the store the component reads — not a
  // second one. `freshPinia` has already made it active.
  return { wrapper, notifications: useNotificationsStore() };
}

const toasts = (wrapper: VueWrapper) => wrapper.findAll('.grav-notification');

const closeButton = (wrapper: VueWrapper) =>
  wrapper.findAll('button').find((b) => b.attributes('aria-label') === 'Cerrar notificación');

describe('a notice pushed to the store', () => {
  it('renders, which is the whole point of this component existing', async () => {
    const { wrapper, notifications } = mountHost();

    expect(toasts(wrapper)).toHaveLength(0);

    notifications.push({ level: 'error', text: '¡No puedes votar dos veces!' });
    await nextTick();

    expect(toasts(wrapper)).toHaveLength(1);
    expect(wrapper.text()).toContain('¡No puedes votar dos veces!');

    wrapper.unmount();
  });

  it('takes its colour from the level, through the theme rather than a hex', async () => {
    const { wrapper, notifications } = mountHost();

    const levels = ['info', 'success', 'warning', 'error'] as const;
    for (const level of levels) {
      notifications.push({ level, text: `un aviso ${level}` });
    }
    await nextTick();

    const list = toasts(wrapper);

    levels.forEach((level, index) => {
      expect(list[index]?.classes()).toContain(`grav-notification--${level}`);
      // ⚠️ The colour is carried by a custom property filled from the THEME —
      // `--v-theme-info|success|warning|error`, which `gravinero-theme.ts` sets
      // from the palette. A hex here would pass every test
      // in this file and drift the day the token moves, which is exactly what
      // `theme/__tests__/gravinero-theme.spec.ts` forbids.
      const style = (list[index]?.element as HTMLElement).style;
      expect(style.getPropertyValue('--grav-notification-level')).toBe(
        `rgb(var(--v-theme-${level}))`,
      );
    });

    wrapper.unmount();
  });

  it('says the level in words, not in colour alone', async () => {
    const { wrapper, notifications } = mountHost();

    // ⚠️ The `mdi-` icon this replaced was `aria-hidden` and decorative, so the
    // severity of a notice was a colour and nothing else — which is no signal
    // at all for a reader who does not get the colour.
    notifications.push({ level: 'error', text: '¡No puedes votar dos veces!' });
    notifications.push({ level: 'success', text: 'Enlace copiado.' });
    await nextTick();

    const labels = wrapper.findAll('.grav-notification__level').map((label) => label.text());
    expect(labels).toEqual(['Error', 'Hecho']);

    wrapper.unmount();
  });

  it('renders the title emphasised and separate from the body', async () => {
    const { wrapper, notifications } = mountHost();

    notifications.push({ level: 'error', title: 'Error 409', text: 'Tag repeated' });
    await nextTick();

    expect(wrapper.find('.grav-notification__title').text()).toBe('Error 409');
    expect(wrapper.find('.grav-notification__text').text()).toBe('Tag repeated');

    wrapper.unmount();
  });

  it('is announced to a screen reader without stealing focus', async () => {
    const { wrapper, notifications } = mountHost();

    const host = wrapper.find('[data-testid="notification-host"]');
    // ⚠️ The live region is the CONTAINER, and it is mounted before anything is
    // pushed. A region inserted already populated is the case assistive
    // technologies most often miss.
    expect(host.attributes('aria-live')).toBe('polite');
    expect(host.attributes('role')).toBe('status');
    expect(host.attributes('aria-atomic')).toBe('false');

    notifications.push({ text: 'Enlace copiado al portapapeles.' });
    await nextTick();

    // Nothing here is a dialog and nothing is focused: a toast that grabs focus
    // interrupts whatever the visitor was typing.
    expect(document.activeElement).toBe(document.body);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.find('[aria-modal]').exists()).toBe(false);

    wrapper.unmount();
  });
});

describe('markup inside a notice', () => {
  /**
   * ⚠️ **The regression guard on the XSS decision.** Notices are built from API
   * payloads, which quote clip titles and free-text tags typed by anonymous
   * visitors. Both fields are plain text, and this fails the moment anyone
   * reintroduces `v-html`.
   */
  it('is drawn as characters, never parsed as HTML', async () => {
    const { wrapper, notifications } = mountHost();

    const payload = '<img src=x onerror="alert(1)">';
    notifications.push({ level: 'error', title: '<b>Error</b>', text: payload });
    await nextTick();

    const text = wrapper.find('.grav-notification__text');
    const title = wrapper.find('.grav-notification__title');

    expect(text.text()).toBe(payload);
    expect(title.text()).toBe('<b>Error</b>');

    // The proof, rather than the appearance of it: no element was created.
    expect(text.element.querySelector('img')).toBeNull();
    expect(title.element.querySelector('b')).toBeNull();
    expect(wrapper.element.querySelectorAll('img')).toHaveLength(0);
    expect(wrapper.html()).toContain('&lt;img');

    wrapper.unmount();
  });
});

describe('how a notice goes away', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dismisses itself after 2.5 s, the timing the site has had since 2019', async () => {
    const { wrapper, notifications } = mountHost();

    notifications.push({ text: 'Enlace copiado al portapapeles.' });
    await nextTick();
    expect(toasts(wrapper)).toHaveLength(1);

    // One tick short: still there. This is what separates "auto-dismisses" from
    // "dismisses at some point".
    vi.advanceTimersByTime(2_499);
    await nextTick();
    expect(toasts(wrapper)).toHaveLength(1);

    vi.advanceTimersByTime(1);
    await nextTick();
    expect(toasts(wrapper)).toHaveLength(0);

    wrapper.unmount();
  });

  it('stops counting down when it is clicked — the reader is still reading', async () => {
    const { wrapper, notifications } = mountHost();

    notifications.push({ text: 'Un aviso largo que hay que terminar de leer.' });
    await nextTick();

    await toasts(wrapper)[0]?.trigger('click');
    await nextTick();

    // Long past the 2.5 s it would otherwise have had.
    vi.advanceTimersByTime(60_000);
    await nextTick();

    expect(toasts(wrapper)).toHaveLength(1);
    expect(notifications.items[0]?.pinned).toBe(true);

    wrapper.unmount();
  });

  it('goes on the close button, which has a name rather than being an empty box', async () => {
    // A `<button>` with no content and no label is a hit area a screen reader
    // announces as just "button".
    const { wrapper, notifications } = mountHost();

    notifications.push({ level: 'warning', text: 'Ese tag ya existe en ese clip.' });
    await nextTick();

    const close = closeButton(wrapper);
    expect(close).toBeDefined();

    await close?.trigger('click');
    await nextTick();

    expect(toasts(wrapper)).toHaveLength(0);
    expect(notifications.items).toHaveLength(0);

    wrapper.unmount();
  });

  it('closes a pinned notice too — the close button is the only way out of one', async () => {
    const { wrapper, notifications } = mountHost();

    notifications.push({ text: 'Un aviso fijado.' });
    await nextTick();
    await toasts(wrapper)[0]?.trigger('click');
    await nextTick();

    await closeButton(wrapper)?.trigger('click');
    await nextTick();

    expect(toasts(wrapper)).toHaveLength(0);

    wrapper.unmount();
  });
});
