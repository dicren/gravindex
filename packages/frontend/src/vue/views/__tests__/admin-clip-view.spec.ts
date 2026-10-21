import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createRouter, createMemoryHistory, RouterView, type Router } from 'vue-router';
import { defineComponent, h } from 'vue';
import { PiniaColada } from '@pinia/colada';
import { AdminSessionExpiredError } from '#/domain/auth/admin-session-expired.error';
import type { AdminClip } from '#/domain/auth/admin-clip.entity';
import { RequestRejectedError } from '#/domain/errors';
import vuetify from '@/plugins/vuetify';
import AdminLayout from '@/views/admin/AdminLayout.vue';
import AdminClipView from '@/views/admin/AdminClipView.vue';
import { freshPinia, stubBrowserApis } from '@/components/__tests__/mount-with-vuetify';

/**
 * The moderation screen, mounted **inside its layout** rather than on its own.
 *
 * ⚠️ That is not scene-setting: the reaction to a session ending mid-edit lives
 * in `AdminLayout`'s watcher, and the view is what triggers it. Testing them
 * apart would leave the seam between "the request failed with a 401" and "the
 * admin is back at the login form" unasserted, which is precisely the path a
 * 12 h token guarantees somebody will walk.
 */
const mocks = vi.hoisted(() => ({
  getClip: vi.fn(),
  updateClip: vi.fn(),
  deleteClip: vi.fn(),
  renameTag: vi.fn(),
  removeTag: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  restore: vi.fn(),
}));

vi.mock('#/config/auth.config', () => ({
  getAdminClipUseCase: { execute: mocks.getClip },
  updateAdminClipUseCase: { execute: mocks.updateClip },
  deleteAdminClipUseCase: { execute: mocks.deleteClip },
  renameClipTagUseCase: { execute: mocks.renameTag },
  removeClipTagUseCase: { execute: mocks.removeTag },
  loginUseCase: { execute: mocks.login },
  logoutUseCase: { execute: mocks.logout },
  restoreSessionUseCase: { execute: mocks.restore },
}));

const CLIP: AdminClip = {
  id: 182,
  title: 'La mulata del clítor...',
  start: 792,
  end: 870,
  episodeId: 63,
  tags: ['Mulata', 'Anécdotas'],
};

const LoginStub = defineComponent({ template: '<div>FORMULARIO-DE-ACCESO</div>' });
const ClipsStub = defineComponent({ template: '<div>LISTA-DE-CLIPS</div>' });
const Shell = defineComponent({ render: () => h(RouterView) });

function viewRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin/login', name: 'adminLogin', component: LoginStub },
      {
        path: '/admin',
        component: AdminLayout,
        children: [
          { path: '', name: 'adminClips', component: ClipsStub },
          { path: 'clips/:id', name: 'adminClip', component: AdminClipView },
        ],
      },
    ],
  });
}

let wrapper: VueWrapper | null = null;

async function mountClip(path = '/admin/clips/182'): Promise<Router> {
  const router = viewRouter();
  await router.push(path);
  await router.isReady();

  wrapper = mount(Shell, {
    attachTo: document.body,
    global: { plugins: [freshPinia(), PiniaColada, vuetify, router] },
  });
  await flushPromises();
  return router;
}

/**
 * A button by its visible label, since these controls have no test ids.
 *
 * ⚠️ Exact match, not `startsWith`: the form's "Guardar cambios" and a tag
 * row's "Guardar" are two different buttons, and a prefix match silently picks
 * the wrong one — which is a test that passes while asserting nothing.
 */
function buttonWith(label: string) {
  const found = wrapper?.findAll('button').find((button) => button.text().trim() === label);
  if (!found) throw new Error(`No button labelled "${label}"`);
  return found;
}

/**
 * Wait for the app to actually be somewhere.
 *
 * ⚠️ Counting `flushPromises()` calls by hand was flaky here and the flakiness
 * was real, not cosmetic: a failed write settles the mutation, the store, a
 * watcher and then a navigation, and how many microtask turns that takes
 * depends on the mutation library, not on this file. Polling for the outcome
 * asserts the behaviour rather than the number of ticks it needs.
 */
async function waitForRoute(router: Router, name: string): Promise<void> {
  await vi.waitFor(async () => {
    await flushPromises();
    expect(router.currentRoute.value.name).toBe(name);
  });
}

/**
 * The same, for the confirmation dialog — whose content Vuetify **teleports out
 * of the component tree**, so `wrapper.find` cannot see it. Clicking it means
 * going through the real DOM.
 */
async function clickInDialog(label: string): Promise<void> {
  const button = [...document.body.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`No dialog button labelled "${label}"`);
  button.click();
  await flushPromises();
  await flushPromises();
}

beforeAll(stubBrowserApis);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClip.mockResolvedValue(CLIP);
  mocks.restore.mockResolvedValue({
    status: 'authenticated',
    identity: { id: 1, username: 'moderador' },
  });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = '';
});

describe('editing a clip', () => {
  it('fills the form from the clip it loaded', async () => {
    await mountClip();

    const inputs = wrapper!.findAll('input');
    expect((inputs[0]?.element as HTMLInputElement).value).toBe('La mulata del clítor...');
    expect((inputs[1]?.element as HTMLInputElement).value).toBe('792');
    expect((inputs[2]?.element as HTMLInputElement).value).toBe('870');
  });

  it('sends ONLY the field that changed', async () => {
    mocks.updateClip.mockResolvedValue({ ...CLIP, title: 'Un título arreglado' });
    await mountClip();

    await wrapper!.findAll('input')[0]?.setValue('Un título arreglado');
    await buttonWith('Guardar cambios').trigger('click');
    await flushPromises();

    // ⚠️ Not `{ title, start, end }`: echoing an untouched value back is a
    // write that can fail validation for a change nobody made.
    expect(mocks.updateClip).toHaveBeenCalledWith({
      clipId: 182,
      changes: { title: 'Un título arreglado', start: undefined, end: undefined },
    });
  });

  it('shows the backend’s own explanation when it refuses the edit', async () => {
    mocks.updateClip.mockRejectedValue(new RequestRejectedError('end must be greater than start'));
    await mountClip();

    await wrapper!.findAll('input')[2]?.setValue('1');
    await buttonWith('Guardar cambios').trigger('click');
    await flushPromises();

    // The server is the only party that can check `end > start` on a PATCH that
    // carries one of the two, so its sentence is the useful half of the notice.
    expect(wrapper!.text()).toContain('end must be greater than start');
  });

  it('does not send a request when nothing was touched', async () => {
    await mountClip();

    await buttonWith('Guardar cambios').trigger('click');
    await flushPromises();

    expect(mocks.updateClip).not.toHaveBeenCalled();
    expect(wrapper!.text()).toContain('No has cambiado nada.');
  });
});

describe('the tags', () => {
  /** Open the first tag's rename field and type into it. */
  async function typeNewName(name: string): Promise<void> {
    await buttonWith('Renombrar').trigger('click');
    await flushPromises();
    await wrapper!.find('.admin-clip__tags input').setValue(name);
  }

  it('renames one, exactly as typed', async () => {
    mocks.renameTag.mockResolvedValue(CLIP);
    await mountClip();

    await typeNewName('Mulata gravinera');
    await buttonWith('Guardar').trigger('click');
    await flushPromises();

    expect(mocks.renameTag).toHaveBeenCalledWith({
      clipId: 182,
      tag: 'Mulata',
      newTag: 'Mulata gravinera',
    });
  });

  it('sends nothing when the name was not actually changed', async () => {
    await mountClip();

    await buttonWith('Renombrar').trigger('click');
    await flushPromises();
    await buttonWith('Guardar').trigger('click');
    await flushPromises();

    expect(mocks.renameTag).not.toHaveBeenCalled();
  });

  it('surfaces a rename the server refuses', async () => {
    mocks.renameTag.mockRejectedValue(
      new RequestRejectedError('The clip already carries that tag'),
    );
    await mountClip();

    await typeNewName('Anécdotas');
    await buttonWith('Guardar').trigger('click');
    await flushPromises();

    expect(wrapper!.text()).toContain('The clip already carries that tag');
  });

  it('removes one', async () => {
    mocks.removeTag.mockResolvedValue(undefined);
    await mountClip();

    await buttonWith('Quitar').trigger('click');
    await flushPromises();

    expect(mocks.removeTag).toHaveBeenCalledWith({ clipId: 182, tag: 'Mulata' });
  });
});

describe('deleting a clip', () => {
  it('asks first, and says exactly what will be lost', async () => {
    await mountClip();

    await buttonWith('Borrar clip').trigger('click');
    await flushPromises();

    const dialog = document.body.textContent ?? '';
    expect(dialog).toContain('¿Borrar el clip #182?');
    // ⚠️ The three facts that make this confirmation worth reading: it is
    // permanent, the votes/plays/tags go too, and a PUBLIC URL dies with it.
    expect(dialog).toContain('con sus votos, sus reproducciones y sus tags');
    expect(dialog).toContain('/182');
    expect(dialog).toContain('no se reutilizará nunca');
    expect(dialog).toContain('Esto no se puede deshacer.');

    // Nothing has happened yet. Opening the dialog is not the deletion.
    expect(mocks.deleteClip).not.toHaveBeenCalled();
  });

  it('cancels without deleting anything', async () => {
    await mountClip();

    await buttonWith('Borrar clip').trigger('click');
    await flushPromises();
    await clickInDialog('Cancelar');

    expect(mocks.deleteClip).not.toHaveBeenCalled();
  });

  it('deletes on the second, explicit click and leaves the clip’s address', async () => {
    mocks.deleteClip.mockResolvedValue(undefined);
    const router = await mountClip();

    await buttonWith('Borrar clip').trigger('click');
    await flushPromises();
    await clickInDialog('Borrar para siempre');

    expect(mocks.deleteClip).toHaveBeenCalledWith(182);
    await waitForRoute(router, 'adminClips');
  });
});

describe('a session that ends mid-edit', () => {
  it('goes back to the login form instead of showing an error', async () => {
    mocks.updateClip.mockRejectedValue(new AdminSessionExpiredError());
    const router = await mountClip();

    await wrapper!.findAll('input')[0]?.setValue('Otro título');
    await buttonWith('Guardar cambios').trigger('click');
    await waitForRoute(router, 'adminLogin');

    // ⚠️ And it remembers where the admin was, so logging back in resumes the
    // edit rather than dumping them on the list.
    expect(router.currentRoute.value.query.redirect).toBe('/admin/clips/182');
    expect(wrapper!.text()).toContain('FORMULARIO-DE-ACCESO');
  });

  it('says nothing about "no autorizado" on the way out', async () => {
    mocks.updateClip.mockRejectedValue(new AdminSessionExpiredError());
    const router = await mountClip();

    await wrapper!.findAll('input')[0]?.setValue('Otro título');
    await buttonWith('Guardar cambios').trigger('click');
    await waitForRoute(router, 'adminLogin');

    // The screen the message would have appeared on is already gone; printing
    // it would be noise attached to a page nobody is looking at.
    expect(wrapper!.text()).not.toContain('The admin session is no longer valid.');
  });
});
