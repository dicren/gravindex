import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { NetworkError } from '#/domain/errors';
import vuetify from '@/plugins/vuetify';
import ClipTagList from '@/components/ClipTagList.vue';
import { useNotificationsStore } from '@/stores/notifications.store';
import { freshPinia, stubBrowserApis, testRouter } from './mount-with-vuetify';

/**
 * The card's tag row, and the only place in the app that tags an existing clip.
 *
 * ⚠️ The assertion that matters: a repeated tag is an **outcome**, not an
 * exception. The backend really does answer 409, `core/` really does turn it
 * into `{ status: 'already-present' }`, and the UI really must treat it as an
 * ordinary thing a visitor does — the chip is right there on the card.
 */

const mocks = vi.hoisted(() => ({ addTag: vi.fn() }));

vi.mock('@/queries/clips.query', () => ({
  useAddTag: () => ({ mutateAsync: mocks.addTag }),
}));

vi.mock('@/queries/tags.query', () => ({
  // ⚠️ `{ tag, count }` — see `tag-input.spec.ts`.
  useTagList: () => ({
    data: {
      value: [
        { tag: 'Mulata', count: 3 },
        { tag: 'Gazpacho', count: 1 },
      ],
    },
    isPending: { value: false },
    isLoading: { value: false },
  }),
}));

beforeAll(stubBrowserApis);

beforeEach(() => mocks.addTag.mockClear());

function mountList(tags: string[] = ['Mulata']) {
  return mount(ClipTagList, {
    props: { clipId: 178, tags },
    global: { plugins: [freshPinia(), vuetify, testRouter()] },
  });
}

async function typeAndSubmit(wrapper: ReturnType<typeof mountList>, tag: string) {
  const add = wrapper
    .findAll('button')
    .find((b) => b.attributes('aria-label') === 'Añadir un tag a este clip');
  await add?.trigger('click');
  await wrapper.find('input').setValue(tag);
  await wrapper.find('input').trigger('keydown', { key: 'Enter' });
  await flushPromises();
  await flushPromises();
}

describe('ClipTagList', () => {
  it('asks the screen what a tag click means instead of routing itself', async () => {
    // ⚠️ A card that branched on `$route.path === '/'` internally would put
    // routing knowledge inside a component three views reuse.
    const wrapper = mountList(['Mulata']);

    const chip = wrapper
      .findAll('button')
      .find((b) => b.attributes('aria-label') === 'Filtrar por el tag Mulata');
    // A real button, so it is focusable and keyboard-operable — a Vuetify chip
    // on its own is a `<span>` with a tabindex and no role at all.
    expect(chip?.element.tagName).toBe('BUTTON');
    await chip?.trigger('click');

    expect(wrapper.emitted('select')).toEqual([['Mulata']]);

    wrapper.unmount();
  });

  it('shows the amber notice when the tag is already on the clip', async () => {
    mocks.addTag.mockImplementation(() =>
      Promise.resolve({ status: 'already-present', tag: 'Gazpacho' }),
    );
    const wrapper = mountList(['Mulata']);

    await typeAndSubmit(wrapper, 'Gazpacho');

    const [notice] = useNotificationsStore().items;
    expect(notice?.text).toBe('Ese tag ya existe en ese clip.');
    // Amber, not red: nothing failed, and nothing was lost.
    expect(notice?.level).toBe('warning');

    wrapper.unmount();
  });

  it('sends the tag exactly as typed — never folded, trimmed or lower-cased', async () => {
    mocks.addTag.mockImplementation(() => Promise.resolve({ status: 'added', tag: 'Briñate' }));
    const wrapper = mountList([]);

    await typeAndSubmit(wrapper, 'Briñate');

    // ⚠️ `GET /clips?tags=…` matches byte for byte. Normalising here would mint
    // a tag the library's filter could never select again.
    expect(mocks.addTag).toHaveBeenCalledWith({ clipId: 178, tag: 'Briñate' });
    expect(useNotificationsStore().items).toHaveLength(0);

    wrapper.unmount();
  });

  it('reports a real failure as a failure', async () => {
    // ⚠️ `mockImplementationOnce`. A persistent rejecting implementation stays
    // installed past the end of the test, and the next call nobody is awaiting
    // surfaces as an unhandled rejection that Vitest bills to THIS test — with
    // every assertion in it passing. Cost an hour once; do not "simplify" it.
    mocks.addTag.mockImplementationOnce(() => Promise.reject(new NetworkError('offline')));
    const wrapper = mountList([]);

    await typeAndSubmit(wrapper, 'Gazpacho');

    expect(useNotificationsStore().items[0]).toMatchObject({
      level: 'error',
      text: 'No se ha podido conectar con el servidor.',
    });

    wrapper.unmount();
  });
});
