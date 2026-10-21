import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, ref, type App } from 'vue';
import { createPinia } from 'pinia';
import { PiniaColada, useQueryCache, type QueryCache } from '@pinia/colada';
import { flushPromises } from '@vue/test-utils';
import type { ClipListQuery, ClipPage } from '#/domain/clips/clip.repository';
import { RequestAbortedError } from '#/domain/errors';
import { useClipList } from '../clips.query';
import { clipKeys } from '../query-keys';

/**
 * ⚠️ **The cancellation regression this file pins.** Pinia Colada offers
 * cancellation for free, but only *offers* it: the query
 * function is handed an `AbortSignal` and has to pass it on. `clips.query.ts`
 * used to drop it, so a superseded search ran to completion. Nothing looked
 * wrong (the stale answer lands in its own cache key), which is precisely why
 * it needs a test rather than a reviewer.
 *
 * Two separate claims, and both matter:
 *
 *   1. the request for the abandoned filter is **aborted**;
 *   2. that abort is **invisible** — it never becomes an error state, so
 *      returning to that filter later does not find a failure waiting.
 */
const mocks = vi.hoisted(() => ({
  listClips: vi.fn(),
  getClip: vi.fn(),
  createClip: vi.fn(),
  registerPlay: vi.fn(),
  voteClip: vi.fn(),
  addTag: vi.fn(),
}));

vi.mock('#/config/clips.config', () => ({
  listClipsUseCase: { execute: mocks.listClips },
  getClipUseCase: { execute: mocks.getClip },
  createClipUseCase: { execute: mocks.createClip },
  registerPlayUseCase: { execute: mocks.registerPlay },
  voteClipUseCase: { execute: mocks.voteClip },
  addTagUseCase: { execute: mocks.addTag },
}));

const EMPTY_PAGE: ClipPage = { results: [], total: 0 };

/** One recorded call to the use case, with the signal it was handed. */
interface Call {
  readonly query: ClipListQuery;
  readonly signal: AbortSignal | undefined;
}

let app: App | undefined;

function withSetup<T>(composable: () => T): T {
  let result: T | undefined;
  app = createApp(
    defineComponent({
      setup() {
        result = composable();
        return () => null;
      },
    }),
  );
  app.use(createPinia());
  app.use(PiniaColada);
  app.mount(document.createElement('div'));
  return result as T;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  app?.unmount();
  app = undefined;
});

describe('a superseded list query', () => {
  /**
   * The use case as the real one behaves under cancellation: the slow term
   * hangs until its signal fires and then rejects with `RequestAbortedError`,
   * which is what `translateHttpError` produces from an aborted signal.
   */
  function stubUseCase(slowTerm: string): Call[] {
    const calls: Call[] = [];
    mocks.listClips.mockImplementation((query: ClipListQuery, signal?: AbortSignal) => {
      calls.push({ query, signal });
      const isFirstSlowCall =
        query.search === slowTerm &&
        calls.filter((call) => call.query.search === slowTerm).length === 1;
      if (!isFirstSlowCall || signal === undefined) return Promise.resolve(EMPTY_PAGE);
      return new Promise<ClipPage>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new RequestAbortedError('The request was cancelled before it answered.'));
        });
      });
    });
    return calls;
  }

  it('⚠️ aborts the request it replaced instead of leaving it running', async () => {
    const calls = stubUseCase('zzzznotaterm');
    const search = ref('zzzznotaterm');

    withSetup(() => useClipList(() => ({ page: 1, limit: 12, search: search.value })));
    await flushPromises();

    expect(calls).toHaveLength(1);
    // The signal has to arrive at all — the bug was that it never did.
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.signal?.aborted).toBe(false);

    search.value = 'cancion';
    await flushPromises();

    expect(calls).toHaveLength(2);
    expect(calls[0]?.signal?.aborted).toBe(true);
    // …and the request that replaced it is very much alive.
    expect(calls[1]?.signal?.aborted).toBe(false);
  });

  it('⚠️ never turns that abort into an error the user could see', async () => {
    stubUseCase('zzzznotaterm');
    const search = ref('zzzznotaterm');

    const api = withSetup(() => ({
      list: useClipList(() => ({ page: 1, limit: 12, search: search.value })),
      cache: useQueryCache(),
    }));
    await flushPromises();

    search.value = 'cancion';
    await flushPromises();

    // What the view binds to.
    expect(api.list.error.value).toBeNull();
    expect(api.list.status.value).not.toBe('error');

    // ⚠️ And the abandoned entry itself, which is the half a screenshot cannot
    // show: `abortable` rethrows the signal's own reason so Colada recognises
    // the rejection as its own cancellation and leaves this state alone. Store
    // the `RequestAbortedError` here instead and the failure surfaces later —
    // whenever someone types that search again.
    const abandoned: QueryCache = api.cache;
    const entry = abandoned.get(clipKeys.list({ page: 1, limit: 12, search: 'zzzznotaterm' }));
    expect(entry?.state.value.error).toBeNull();
  });

  it('answers cleanly when the visitor comes back to the filter they abandoned', async () => {
    stubUseCase('zzzznotaterm');
    const search = ref('zzzznotaterm');

    const api = withSetup(() => useClipList(() => ({ page: 1, limit: 12, search: search.value })));
    await flushPromises();
    search.value = 'cancion';
    await flushPromises();

    search.value = 'zzzznotaterm';
    await flushPromises();

    expect(api.error.value).toBeNull();
    expect(api.data.value).toEqual(EMPTY_PAGE);
  });
});
