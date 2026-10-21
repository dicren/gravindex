import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory, RouterView, type Router } from 'vue-router';
import { defineComponent, h } from 'vue';
import { registerAdminGuard } from '@/router/admin-guard';
import { createAppRouter } from '@/router';
import { freshPinia } from '@/components/__tests__/mount-with-vuetify';

/**
 * ⚠️ **"Redirects without flashing content" is the claim, so the test has to
 * measure the flash, not the destination.** Asserting only that the URL ends up
 * at `/admin/login` would pass just as happily for a guard that renders the
 * moderation screen first and bounces afterwards — which is the bug.
 *
 * Two things are asserted instead: the guarded route's component is **never
 * fetched** (the counter below, standing in for the lazy chunk the real router
 * imports), and the sentinel markup never reaches the DOM.
 */
const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('#/config/auth.config', () => ({
  restoreSessionUseCase: { execute: mocks.restore },
  loginUseCase: { execute: mocks.login },
  logoutUseCase: { execute: mocks.logout },
}));

const ADMIN_SENTINEL = 'PANTALLA-DE-MODERACION';

const LoginStub = defineComponent({ render: () => h('div', 'formulario de acceso') });
const LayoutStub = defineComponent({ render: () => h('div', ['marco admin', h(RouterView)]) });
const AdminStub = defineComponent({ render: () => h('div', ADMIN_SENTINEL) });

/** How many times the guarded route's component was asked for. */
let adminComponentFetches = 0;

function guardedRouter(): Router {
  adminComponentFetches = 0;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: defineComponent({ render: () => h('div', 'inicio') }) },
      { path: '/admin/login', name: 'adminLogin', component: LoginStub },
      {
        path: '/admin',
        component: LayoutStub,
        meta: { requiresAdmin: true },
        children: [
          {
            path: '',
            name: 'adminClips',
            component: () => {
              adminComponentFetches += 1;
              return Promise.resolve(AdminStub);
            },
          },
        ],
      },
    ],
  });
  registerAdminGuard(router);
  return router;
}

/** The whole app, for the purposes of this file: whatever the router resolves. */
const Shell = defineComponent({ render: () => h(RouterView) });

async function visit(path: string) {
  const router = guardedRouter();
  const pinia = freshPinia();
  const wrapper = mount(Shell, { global: { plugins: [pinia, router] } });
  await router.isReady();
  await router.push(path).catch(() => {});
  await flushPromises();
  return { router, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.restore.mockResolvedValue({ status: 'anonymous' });
});

describe('an unauthenticated visit to an admin route', () => {
  it('never renders admin content, and never even fetches its component', async () => {
    const { router, wrapper } = await visit('/admin');

    expect(router.currentRoute.value.name).toBe('adminLogin');
    expect(adminComponentFetches).toBe(0);
    expect(wrapper.html()).not.toContain(ADMIN_SENTINEL);
    expect(document.body.textContent).not.toContain(ADMIN_SENTINEL);
  });

  it('remembers where the visitor was going', async () => {
    const { router } = await visit('/admin');
    expect(router.currentRoute.value.query.redirect).toBe('/admin');
  });
});

describe('a confirmed session', () => {
  it('reaches the moderation screen', async () => {
    mocks.restore.mockResolvedValue({
      status: 'authenticated',
      identity: { id: 1, username: 'moderador' },
    });

    const { router, wrapper } = await visit('/admin');

    expect(router.currentRoute.value.name).toBe('adminClips');
    expect(wrapper.html()).toContain(ADMIN_SENTINEL);
    // The counterweight to the test above: the component IS fetched when the
    // session is real, so "never fetched" there means "the guard stopped it",
    // not "the wiring never worked".
    expect(adminComponentFetches).toBe(1);
  });

  it('sends someone already logged in away from the login form', async () => {
    mocks.restore.mockResolvedValue({
      status: 'authenticated',
      identity: { id: 1, username: 'moderador' },
    });

    const { router } = await visit('/admin/login');
    expect(router.currentRoute.value.name).toBe('adminClips');
  });
});

describe('a token the probe could not check', () => {
  it('is let through rather than treated as a logout', async () => {
    mocks.restore.mockResolvedValue({ status: 'unverified' });

    const { router } = await visit('/admin');

    // ⚠️ The alternative — bouncing to the login form — is a bug the admin
    // experiences as being randomly logged out whenever the network hiccups.
    // The screens behind the gate show their own connection error, and the
    // backend still refuses anything the credential cannot buy.
    expect(router.currentRoute.value.name).toBe('adminClips');
  });
});

describe('the real application router', () => {
  it('carries the guard and the admin records', async () => {
    const router = createAppRouter();
    freshPinia();

    await router.push('/admin/clips/182');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('adminLogin');
    expect(router.currentRoute.value.query.redirect).toBe('/admin/clips/182');
  });

  it('leaves every public route untouched — and does not probe for them', async () => {
    const router = createAppRouter();
    freshPinia();

    await router.push('/about');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('about');
    expect(mocks.restore).not.toHaveBeenCalled();
  });
});
