import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createRouter, createMemoryHistory, type Router } from 'vue-router';
import { defineComponent } from 'vue';
import vuetify from '@/plugins/vuetify';
import AdminLoginView from '@/views/admin/AdminLoginView.vue';
import { freshPinia, stubBrowserApis } from '@/components/__tests__/mount-with-vuetify';

/**
 * ⚠️ **Nothing is mocked below the view.** The real store, the real use case,
 * the real HTTP adapter and the real `sessionStorage` all run; only `fetch` is
 * stubbed. That is deliberate: the claim worth testing is "a successful login
 * **stores the JWT** and reaches the admin", and every layer between the button
 * and the storage key is exactly where that could stop being true.
 */
const realFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Answers by URL, so the login and the session probe can differ. */
function stubApi(handler: (url: string) => Response) {
  const fetchStub = vi.fn<typeof fetch>().mockImplementation((input) => {
    const url = input instanceof Request ? input.url : String(input);
    return Promise.resolve(handler(url));
  });
  globalThis.fetch = fetchStub;
  return fetchStub;
}

const Blank = defineComponent({ template: '<div>zona de moderación</div>' });

function viewRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/login', name: 'adminLogin', component: AdminLoginView },
      { path: '/admin', name: 'adminClips', component: Blank },
      { path: '/admin/clips/:id', name: 'adminClip', component: Blank },
    ],
  });
}

async function mountAt(path = '/admin/login'): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = viewRouter();
  await router.push(path);
  await router.isReady();

  const wrapper = mount(AdminLoginView, {
    global: { plugins: [freshPinia(), vuetify, router] },
  });
  await flushPromises();
  return { wrapper, router };
}

async function fillAndSubmit(wrapper: VueWrapper, username: string, password: string) {
  const fields = wrapper.findAll('input');
  await fields[0]?.setValue(username);
  await fields[1]?.setValue(password);
  await wrapper.find('form').trigger('submit');
  await flushPromises();
}

beforeAll(stubBrowserApis);

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.sessionStorage.clear();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('a successful login', () => {
  it('stores the JWT in sessionStorage and lands on the moderation screen', async () => {
    stubApi(() => jsonResponse({ accessToken: 'jwt-for-tests', username: 'moderador' }));
    const { wrapper, router } = await mountAt();

    await fillAndSubmit(wrapper, 'moderador', 'contraseña-de-prueba');

    expect(globalThis.sessionStorage.getItem('gravindex.admin-token')).toBe('jwt-for-tests');
    expect(router.currentRoute.value.name).toBe('adminClips');
  });

  it('resumes where the visitor was going before the session ended', async () => {
    stubApi(() => jsonResponse({ accessToken: 'jwt-for-tests', username: 'moderador' }));
    const { wrapper, router } = await mountAt('/admin/login?redirect=/admin/clips/182');

    await fillAndSubmit(wrapper, 'moderador', 'contraseña-de-prueba');

    expect(router.currentRoute.value.path).toBe('/admin/clips/182');
  });

  /**
   * ⚠️ `redirect` arrives from the address bar, so it is attacker-controlled.
   * A `//evil.example` is a path by every naive check and another host to a
   * browser — the classic open redirect, and this is where it would live.
   */
  it('refuses to be redirected off-site by a crafted link', async () => {
    stubApi(() => jsonResponse({ accessToken: 'jwt-for-tests', username: 'moderador' }));
    const { wrapper, router } = await mountAt('/admin/login?redirect=//evil.example/admin');

    await fillAndSubmit(wrapper, 'moderador', 'contraseña-de-prueba');

    expect(router.currentRoute.value.name).toBe('adminClips');
  });
});

describe('a refused login', () => {
  /**
   * ⚠️ **The property this test exists to protect.** The backend answers an
   * unknown username and a wrong password with the same body, the same status
   * and the same elapsed time — it hashes against a decoy — so the endpoint
   * cannot be used to enumerate accounts. A screen that worded the two
   * differently would hand that back, and it is the kind of "helpful" copy
   * change nobody reviews twice.
   */
  it('says the same thing for an unknown user and for a wrong password', async () => {
    stubApi(() => jsonResponse({ statusCode: 401, message: 'Unauthorized' }, 401));

    const first = await mountAt();
    await fillAndSubmit(first.wrapper, 'no-existe', 'lo-que-sea');
    const unknownUserMessage = first.wrapper.find('[role="alert"]').text();

    const second = await mountAt();
    await fillAndSubmit(second.wrapper, 'moderador', 'contraseña-equivocada');
    const wrongPasswordMessage = second.wrapper.find('[role="alert"]').text();

    expect(unknownUserMessage).toBe('Usuario o contraseña incorrectos.');
    expect(wrongPasswordMessage).toBe(unknownUserMessage);
    expect(globalThis.sessionStorage.getItem('gravindex.admin-token')).toBeNull();
  });

  it('distinguishes "the server said no" from "the server never answered"', async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    const { wrapper } = await mountAt();

    await fillAndSubmit(wrapper, 'moderador', 'contraseña-de-prueba');

    expect(wrapper.find('[role="alert"]').text()).toBe('No se ha podido conectar con el servidor.');
  });

  it('does not send a request at all with an empty field', async () => {
    const fetchStub = stubApi(() => jsonResponse({}, 200));
    const { wrapper } = await mountAt();

    await fillAndSubmit(wrapper, 'moderador', '');

    expect(fetchStub).not.toHaveBeenCalled();
    expect(wrapper.find('[role="alert"]').text()).toBe('Escribe el usuario y la contraseña.');
  });
});
