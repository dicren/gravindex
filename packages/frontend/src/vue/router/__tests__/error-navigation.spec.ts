import { beforeEach, describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { RouterView } from 'vue-router';
import { NetworkError, NotFoundError } from '#/domain/errors';
import { createAppRouter, router } from '../index';
import { errorRouteFor, goToErrorPage, goToNotFoundPage } from '../error-navigation';

// Errors are routes now, so what is under test is that **the URL moves**: the
// state can be linked, survives a reload, and does not break the back button.

/** A fresh page load at whatever `window.location` currently is. */
async function reload() {
  const reloaded = createAppRouter();
  // Installing the router is what triggers its initial navigation from the
  // browser's URL — which is exactly what a reload does.
  const wrapper = mount(RouterView, { global: { plugins: [reloaded] } });
  await reloaded.isReady();
  await flushPromises();
  return { router: reloaded, wrapper };
}

describe('error navigation', () => {
  beforeEach(async () => {
    window.history.replaceState({}, '', '/');
    await router.replace('/');
  });

  describe('the URL actually changes', () => {
    it('goes to /error/404 when the thing does not exist', async () => {
      await router.replace('/episode/9999-no-existe');
      expect(window.location.pathname).toBe('/episode/9999-no-existe');

      await goToErrorPage(new NotFoundError('gone'));

      expect(window.location.pathname).toBe('/error/404');
      expect(router.currentRoute.value.name).toBe('error404');
    });

    it('goes to /error for anything else that went wrong', async () => {
      await router.replace('/episode/1-algo');

      await goToErrorPage(new NetworkError('offline'));

      expect(window.location.pathname).toBe('/error');
      expect(router.currentRoute.value.name).toBe('errorUnknown');
    });

    it('goes to /error/404 with no error in hand', async () => {
      // `Episode` and `Editor` both did this before ever calling the API:
      // `parseInt(title)` → `isNaN` → the 404 page.
      await goToNotFoundPage();

      expect(window.location.pathname).toBe('/error/404');
    });

    // ⚠️ `replace`, not `push`. With `push`, "back" returns to the URL that
    // failed, which fetches, fails and bounces forward again — a trap the
    // visitor cannot press their way out of.
    it('does not leave the failing URL in the history', async () => {
      await router.push('/episode/9999-no-existe');
      const entries = window.history.length;

      await goToErrorPage(new NotFoundError('gone'));

      expect(window.history.length).toBe(entries);
    });
  });

  describe('a reload of that URL lands on the error view', () => {
    it('renders the 404 page', async () => {
      await goToErrorPage(new NotFoundError('gone'));

      const { router: reloaded, wrapper } = await reload();

      expect(reloaded.currentRoute.value.name).toBe('error404');
      // The glyph is the page.
      expect(wrapper.find('.error.glitch').attributes('data-text')).toBe('404');
      expect(wrapper.text()).toContain('404');
    });

    it('renders the unknown-error page', async () => {
      await goToErrorPage(new Error('¯\\_(ツ)_/¯'));

      const { router: reloaded, wrapper } = await reload();

      expect(reloaded.currentRoute.value.name).toBe('errorUnknown');
      expect(wrapper.text()).toContain('Unknown error');
    });
  });

  describe('an unknown URL 404s where it is', () => {
    it('keeps the address the visitor followed', async () => {
      window.history.replaceState({}, '', '/no/such/page');

      const { router: reloaded, wrapper } = await reload();

      // ⚠️ No redirect to `/error/404`: an unknown path is not an app error, and
      // the address that was shared is the one worth keeping.
      expect(window.location.pathname).toBe('/no/such/page');
      expect(reloaded.currentRoute.value.name).toBe('E404');
      expect(wrapper.find('.error.glitch').attributes('data-text')).toBe('404');
    });
  });

  describe('the error routes take nothing away from the app', () => {
    // ⚠️ Clip ids are public URLs shared in the wild. `/error/404` is two
    // segments, so it cannot shadow one — including the day clip 404 exists.
    it('still resolves /404 as a clip permalink', () => {
      expect(router.resolve('/404').name).toBe('clip');
      expect(router.resolve('/404').params.id).toBe('404');
    });
  });

  describe('errorRouteFor', () => {
    it('maps the domain error, not an HTTP status', () => {
      expect(errorRouteFor(new NotFoundError('x'))).toEqual({ name: 'error404' });
      expect(errorRouteFor(new NetworkError('x'))).toEqual({ name: 'errorUnknown' });
      expect(errorRouteFor(new Error('x'))).toEqual({ name: 'errorUnknown' });
      expect(errorRouteFor(undefined)).toEqual({ name: 'errorUnknown' });
    });
  });
});
