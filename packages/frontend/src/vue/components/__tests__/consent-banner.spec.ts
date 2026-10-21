import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick, defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import vuetify from '@/plugins/vuetify';
import App from '@/App.vue';
import ConsentBanner from '@/components/ConsentBanner.vue';
import GravFooter from '@/components/GravFooter.vue';
import { useConsentStore } from '@/stores/consent.store';
import { freshPinia, stubBrowserApis } from './mount-with-vuetify';

/**
 * The banner: the one place a visitor decides, and therefore the one place a
 * dark pattern would live. Most of what is asserted below is about the SHAPE of
 * the choice rather than about rendering — that both answers cost one click,
 * that neither is emphasised, that the page underneath stays usable, and that
 * nothing appears at all when there is nothing to consent to.
 */

const MEASUREMENT_ID = 'G-TESTID1234';
const CONSENT_KEY = 'gravindex.analytics-consent';

const BODY_COPY =
  'Uso Google Analytics para saber cuánta gente pasa por aquí y qué páginas mira. ' +
  'Para eso guarda cookies en tu navegador. Si lo rechazas no se carga nada y la web ' +
  'funciona igual; puedes cambiar de opinión cuando quieras desde el pie de página.';

const squash = (value: string) => value.replace(/\s+/g, ' ').trim();

beforeAll(stubBrowserApis);

beforeEach(() => {
  vi.stubEnv('VITE_GA4_ID', MEASUREMENT_ID);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  localStorage.clear();
  document.body.innerHTML = '';
});

function mountBanner(stored?: string) {
  if (stored !== undefined) localStorage.setItem(CONSENT_KEY, stored);
  const pinia = freshPinia();
  const wrapper = mount(ConsentBanner, {
    global: { plugins: [pinia, vuetify] },
    attachTo: document.body,
  });
  return { wrapper, consent: useConsentStore() };
}

const banner = (wrapper: VueWrapper) => wrapper.find('[data-testid="consent-banner"]');
const accept = (wrapper: VueWrapper) => wrapper.find('[data-testid="consent-accept"]');
const reject = (wrapper: VueWrapper) => wrapper.find('[data-testid="consent-reject"]');

describe('what it says', () => {
  it('is the copy that was written for it, in Spanish, verbatim', () => {
    const { wrapper } = mountBanner();

    expect(wrapper.find('.grav-consent__title').text()).toBe('Cookies de analítica');
    expect(squash(wrapper.find('.grav-consent__text').text())).toBe(BODY_COPY);
    expect(accept(wrapper).text()).toBe('Aceptar');
    expect(reject(wrapper).text()).toBe('Rechazar');

    wrapper.unmount();
  });

  it('claims nothing it cannot back — no policy, no legal boilerplate', () => {
    // ⚠️ A banner is not the place to invent compliance claims or link to a
    // privacy policy this app does not have. It says what the cookies are for
    // and offers the two answers.
    const { wrapper } = mountBanner();
    const text = squash(wrapper.text()).toLowerCase();

    expect(text).not.toMatch(/cumpl|rgpd|gdpr|política de privacidad|términos/);
    expect(wrapper.findAll('a')).toHaveLength(0);

    wrapper.unmount();
  });
});

describe('the choice it offers', () => {
  it('gives both answers the same weight — same size, same variant, same colour', () => {
    const { wrapper } = mountBanner();

    // ⚠️ The dark pattern this guards against is a loud "Aceptar" beside a grey
    // "Rechazar". Compare the rendered classes: they carry Vuetify's size,
    // variant and colour.
    const classesOf = (element: Element) =>
      [...element.classList].filter((name) => name !== 'grav-consent__button').sort();

    expect(classesOf(accept(wrapper).element)).toEqual(classesOf(reject(wrapper).element));
    expect(accept(wrapper).element.tagName).toBe(reject(wrapper).element.tagName);

    wrapper.unmount();
  });

  it('offers exactly two, both real buttons, both reachable from the keyboard', () => {
    const { wrapper } = mountBanner();

    const buttons = banner(wrapper).findAll('button');
    expect(buttons).toHaveLength(2);

    for (const button of buttons) {
      // A native `<button>` is in the tab order by definition; an `<a>` without
      // `href` is not.
      expect(button.element.tagName).toBe('BUTTON');
      expect(button.attributes('tabindex')).toBeUndefined();
      expect(button.attributes('disabled')).toBeUndefined();
      expect(button.attributes('aria-hidden')).toBeUndefined();
    }

    // ...and adjacent, so no amount of tabbing lands on one and not the other.
    expect(buttons[0]?.element.nextElementSibling).toBe(buttons[1]?.element);

    wrapper.unmount();
  });

  it('records a yes and gets out of the way', async () => {
    const { wrapper, consent } = mountBanner();

    await accept(wrapper).trigger('click');

    expect(consent.granted).toBe(true);
    expect(localStorage.getItem(CONSENT_KEY)).toBe('granted');
    expect(banner(wrapper).exists()).toBe(false);

    wrapper.unmount();
  });

  it('records a no and gets out of the way just the same', async () => {
    const { wrapper, consent } = mountBanner();

    await reject(wrapper).trigger('click');

    expect(consent.granted).toBe(false);
    expect(localStorage.getItem(CONSENT_KEY)).toBe('denied');
    expect(banner(wrapper).exists()).toBe(false);

    wrapper.unmount();
  });
});

describe('when it appears', () => {
  it('is there on a first visit', () => {
    const { wrapper } = mountBanner();
    expect(banner(wrapper).exists()).toBe(true);
    wrapper.unmount();
  });

  it('is not there for a visitor who already answered', () => {
    for (const answer of ['granted', 'denied']) {
      const { wrapper } = mountBanner(answer);
      expect(banner(wrapper).exists()).toBe(false);
      wrapper.unmount();
      localStorage.clear();
    }
  });

  it('is not there at all with no measurement id, whatever was stored', () => {
    // ⚠️ The state of this repository: no id is committed, so no cookie is ever
    // set and the banner would be asking about nothing.
    vi.stubEnv('VITE_GA4_ID', '');
    const { wrapper } = mountBanner();

    expect(banner(wrapper).exists()).toBe(false);
    expect(wrapper.text()).toBe('');

    wrapper.unmount();
  });

  it('comes back when the footer asks for it again', async () => {
    const { wrapper, consent } = mountBanner('granted');
    expect(banner(wrapper).exists()).toBe(false);

    consent.askAgain();
    await nextTick();

    expect(banner(wrapper).exists()).toBe(true);
    // Both answers available again, including the one that withdraws consent.
    expect(accept(wrapper).exists()).toBe(true);
    expect(reject(wrapper).exists()).toBe(true);

    wrapper.unmount();
  });
});

describe('how it behaves for a keyboard or screen-reader user', () => {
  it('is a named region, and emphatically not a modal dialog', () => {
    const { wrapper } = mountBanner();

    const section = banner(wrapper);
    expect(section.element.tagName).toBe('SECTION');

    // Named, so it can be found in a landmark list rather than being "region".
    const labelledBy = section.attributes('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy ?? '')?.textContent?.trim()).toBe(
      'Cookies de analítica',
    );

    // ⚠️ Nothing here traps focus or covers the page: the site stays usable
    // with the banner up, which is the difference between asking and demanding.
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.find('[aria-modal]').exists()).toBe(false);
    expect(wrapper.find('.v-overlay__scrim').exists()).toBe(false);
    expect(document.body.hasAttribute('inert')).toBe(false);
    expect(document.documentElement.classList.contains('v-overlay-scroll-blocked')).toBe(false);

    wrapper.unmount();
  });

  it('cannot swallow clicks on the page it floats over', async () => {
    // ⚠️ jsdom has no layout engine, so this is asserted against the source, the
    // way `app-shell.spec.ts` asserts the route transition. The container spans
    // the whole viewport width: without `pointer-events: none` on it and `auto`
    // on the panel, its padding would eat clicks on whatever is underneath —
    // exactly the bug `NotificationHost.vue` documents.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');

    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../ConsentBanner.vue'),
      'utf8',
    ).replace(/<!--[\s\S]*?-->/g, '');

    expect(source).toMatch(/\.grav-consent\s*\{[^}]*pointer-events:\s*none/);
    expect(source).toMatch(/\.grav-consent__panel\s*\{[^}]*pointer-events:\s*auto/);
    // ...and it stays below the app bar, so it can never cover the navigation.
    expect(source).toMatch(/\.grav-consent\s*\{[^}]*z-index:\s*1000/);
  });

  it('does not steal focus when it appears on its own', () => {
    const { wrapper } = mountBanner();

    // A visitor arrived to read something. The banner is not an interruption.
    expect(document.activeElement).toBe(document.body);

    wrapper.unmount();
  });

  it('takes focus when it is REOPENED, because that was asked for', async () => {
    const { wrapper, consent } = mountBanner('denied');

    consent.askAgain();
    await nextTick();
    await nextTick();

    // ⚠️ The region, not one of the two buttons: focusing either would put a
    // thumb on the scale.
    expect(document.activeElement).toBe(banner(wrapper).element);

    wrapper.unmount();
  });

  it('closes on Escape without recording an answer', async () => {
    const { wrapper, consent } = mountBanner();

    await banner(wrapper).trigger('keydown', { key: 'Escape' });

    expect(banner(wrapper).exists()).toBe(false);
    // ⚠️ Dismissed is not accepted, and not refused either: nothing is stored,
    // nothing is loaded, and the next visit asks again.
    expect(consent.status).toBe('unknown');
    expect(localStorage.getItem(CONSENT_KEY)).toBeNull();

    wrapper.unmount();
  });
});

describe('the footer control', () => {
  function mountFooter(stored?: string) {
    if (stored !== undefined) localStorage.setItem(CONSENT_KEY, stored);
    const pinia = freshPinia();
    const wrapper = mount(GravFooter, { global: { plugins: [pinia, vuetify] } });
    return { wrapper, consent: useConsentStore() };
  }

  const changeButton = (wrapper: VueWrapper) => wrapper.find('.grav-footer__consent-button');

  it('says what the current answer is, in words', () => {
    for (const [stored, wording] of [
      ['granted', 'aceptadas'],
      ['denied', 'rechazadas'],
    ] as const) {
      const { wrapper } = mountFooter(stored);
      expect(squash(wrapper.find('.grav-footer__consent').text())).toContain(
        `Cookies de analítica: ${wording}.`,
      );
      wrapper.unmount();
      localStorage.clear();
    }
  });

  it('reopens the banner, which is what makes the choice changeable', async () => {
    const { wrapper, consent } = mountFooter('granted');

    expect(consent.isPromptVisible).toBe(false);
    await changeButton(wrapper).trigger('click');

    expect(consent.isPromptVisible).toBe(true);
    wrapper.unmount();
  });

  it('is a real button with a name that says what it does', () => {
    const { wrapper } = mountFooter('granted');

    const button = changeButton(wrapper);
    expect(button.element.tagName).toBe('BUTTON');
    expect(button.attributes('type')).toBe('button');
    // ⚠️ The accessible name CONTAINS the visible word (WCAG 2.5.3), so a voice
    // control user saying "cambiar" still activates it.
    const label = button.attributes('aria-label') ?? '';
    expect(label).toBe('Cambiar preferencia de cookies de analítica');
    expect(label.toLowerCase()).toContain(button.text().toLowerCase());

    wrapper.unmount();
  });

  it('says nothing when there is no analytics to have a preference about', () => {
    vi.stubEnv('VITE_GA4_ID', '');
    const { wrapper } = mountFooter('granted');

    expect(wrapper.find('.grav-footer__consent').exists()).toBe(false);
    // The credit line is untouched.
    expect(wrapper.text()).toContain('by Dicren with');

    wrapper.unmount();
  });
});

describe('in the shell', () => {
  const Blank = defineComponent({ template: '<div />' });

  async function mountApp() {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'home', component: Blank },
        { path: '/episodes/:page?', name: 'episodes', component: Blank },
        { path: '/creator', name: 'creatorSearch', component: Blank },
        // ⚠️ The shell now mounts the global player, whose queue pill IS the
        // link to `/cola` — a router without it makes mounting the shell a
        // "No match" before this suite gets to its own assertions.
        { path: '/cola', name: 'queue', component: Blank },
        { path: '/about', name: 'about', component: Blank },
      ],
    });
    await router.push('/');
    await router.isReady();
    const wrapper = mount(App, { global: { plugins: [freshPinia(), vuetify, router] } });
    await nextTick();
    return wrapper;
  }

  it('mounts exactly one banner — two would be two questions about one decision', async () => {
    const wrapper = await mountApp();

    expect(wrapper.findAll('[data-testid="consent-banner"]')).toHaveLength(1);

    wrapper.unmount();
  });

  it('loads nothing on boot: no tag, no request to Google, no cookie', async () => {
    // ⚠️ The claim the consent gate rests on, asserted at the level a visitor
    // would check it: the shell has mounted, the app has routed, and the
    // document contains nothing of Google's.
    const wrapper = await mountApp();

    expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
    expect(document.querySelector('script[data-grav-analytics]')).toBeNull();
    expect((window as Window & { gtag?: unknown }).gtag).toBeUndefined();
    expect((window as Window & { dataLayer?: unknown }).dataLayer).toBeUndefined();
    expect(document.cookie).toBe('');

    wrapper.unmount();
  });
});
