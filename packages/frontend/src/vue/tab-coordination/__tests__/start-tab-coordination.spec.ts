import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import {
  claimPlayback,
  onSoundTaken,
  startTabCoordination,
} from '@/tab-coordination/start-tab-coordination';
import {
  resetAudioElementFactory,
  setAudioElementFactory,
  usePlaybackStore,
  type PlaybackAudio,
} from '@/stores/playback.store';
import { QUEUE_STORAGE_KEY, useQueueStore, type QueuedClip } from '@/stores/queue.store';

/**
 * **Two tabs, one sound** (2026-10-27), as far as one process can hold it.
 *
 * ⚠️ **What a unit test can and cannot prove here.** A real second tab cannot be
 * opened inside jsdom, so the browser plumbing itself — that `BroadcastChannel`
 * delivers across tabs and that `storage` fires in the OTHER tab — belongs to
 * `test/e2e/specs/18-tabs.spec.ts`. What is worth pinning HERE is the protocol:
 * when this tab gives the sound up, when it keeps it, and the tie-break that
 * stops two simultaneous presses from silencing both.
 *
 * ⚠️ **The channel is stubbed on the global, not injected through a seam**, and
 * that is deliberate: `BroadcastChannel` is a platform API the module resolves at
 * mount, exactly like `localStorage` or `navigator.mediaSession`. jsdom has no
 * implementation, so a fake here is not fighting the environment — and the module
 * gains no test-only parameter that production code would have to carry.
 */

class FakeBroadcastChannel {
  static readonly opened: FakeBroadcastChannel[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly posted: unknown[] = [];
  closed = false;

  constructor(readonly name: string) {
    FakeBroadcastChannel.opened.push(this);
  }

  postMessage(data: unknown): void {
    this.posted.push(data);
  }

  close(): void {
    this.closed = true;
  }

  /** Deliver a message the way the browser would: from somewhere else. */
  deliver(data: unknown): void {
    this.onmessage?.({ data } as unknown as MessageEvent);
  }
}

class FakeAudio implements PlaybackAudio {
  src = '';
  currentTime = 0;
  pauseCalls = 0;
  private readonly listeners = new Map<string, (() => void)[]>();

  play(): Promise<void> {
    this.emit('play');
    this.emit('playing');
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls += 1;
    this.emit('pause');
  }

  load(): void {
    // A release, not a load: nothing to model.
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

/** ⚠️ `POST /clips/:id/play`, mocked for the usual reason: enqueueing the first
 *  item starts it, and the real use case would reach for `fetch` — which
 *  `vitest.setup.ts` makes throw so no unit test can write to a database. */
const playCounter = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('#/config/clips.config', () => ({ registerPlayUseCase: playCounter }));

function clip(id: number): QueuedClip {
  return {
    kind: 'clip',
    id,
    title: `Corte ${id}`,
    start: 100,
    end: 160,
    src: 'https://example.test/episodes/42.mp3',
    episodeId: 42,
    episodeTitle: 'Episodio 42',
    cover: 'https://example.test/cover.jpg',
    up: 3,
  };
}

/** ⚠️ Somebody else's id. Any string will do: the claim wins whatever it is. */
const OTHER_TAB_ID = 'otra-pestana';

let audio: FakeAudio;
let stop: (() => void) | null = null;

/** The one channel this tab opened. */
function channel(): FakeBroadcastChannel {
  const opened = FakeBroadcastChannel.opened.at(-1);
  if (opened === undefined) throw new Error('the coordination opened no channel');
  return opened;
}

/** Mount, and hand back the stores the tests drive. */
function mount(): {
  playback: ReturnType<typeof usePlaybackStore>;
  queue: ReturnType<typeof useQueueStore>;
} {
  stop = startTabCoordination();
  return { playback: usePlaybackStore(), queue: useQueueStore() };
}

beforeEach(() => {
  localStorage.clear();
  FakeBroadcastChannel.opened.length = 0;
  globalThis.BroadcastChannel = FakeBroadcastChannel as unknown as typeof BroadcastChannel;
  setActivePinia(createPinia());
  audio = new FakeAudio();
  setAudioElementFactory(() => audio);
});

afterEach(() => {
  stop?.();
  stop = null;
  Reflect.deleteProperty(globalThis, 'BroadcastChannel');
  resetAudioElementFactory();
  vi.restoreAllMocks();
});

describe('the channel', () => {
  it('opens one, on the name every tab of this origin shares', () => {
    mount();

    expect(FakeBroadcastChannel.opened).toHaveLength(1);
    expect(channel().name).toBe('gravindex.tabs');
  });

  /**
   * ⚠️ **`null` is a working configuration**, the same way a browser with no
   * media session is: the queue still follows the last writer through
   * `storage`, and only the courtesy pause is lost. Old browsers, a sandboxed
   * iframe and storage disabled all look exactly like this.
   */
  it('mounts without one, and without throwing', () => {
    Reflect.deleteProperty(globalThis, 'BroadcastChannel');
    const { queue } = mount();

    expect(FakeBroadcastChannel.opened).toHaveLength(0);
    expect(() => claimPlayback()).not.toThrow();
    expect(queue.isEmpty).toBe(true);
  });

  it('says nothing at all when a channel cannot be built', () => {
    const refuse = function refusing(): never {
      throw new Error('no channel for you');
    };
    globalThis.BroadcastChannel = refuse as unknown as typeof BroadcastChannel;

    expect(() => mount()).not.toThrow();
    expect(() => claimPlayback()).not.toThrow();
  });

  it('closes it on teardown, and a claim afterwards is a no-op', () => {
    mount();
    const opened = channel();

    stop?.();
    stop = null;

    expect(opened.closed).toBe(true);
    claimPlayback();
    expect(opened.posted).toHaveLength(0);
  });
});

describe('taking the sound', () => {
  /**
   * ⚠️ **Every path into playback comes through the store**, so one watcher on
   * the element's own `playing` covers the row, the permalink, the transport's
   * next button and a clip ending. The editor is the exception, and it calls
   * `claimPlayback()` itself.
   */
  it('announces it when this tab starts sounding', () => {
    const { queue } = mount();

    queue.enqueue(clip(1));

    expect(channel().posted).toEqual([{ type: 'play-claimed', tabId: expect.any(String) }]);
  });

  it('says nothing for a pause', () => {
    const { queue, playback } = mount();
    queue.enqueue(clip(1));
    channel().posted.length = 0;

    playback.pause();

    expect(channel().posted).toHaveLength(0);
  });

  it('pauses politely when another tab claims it', () => {
    const { queue, playback } = mount();
    queue.enqueue(clip(1));
    expect(playback.playing).toBe(true);

    channel().deliver({ type: 'play-claimed', tabId: OTHER_TAB_ID });

    // ⚠️ A PAUSE, never a `stop()`: the item stays loaded and the position is
    // written on the way out, so pressing play in either tab carries on.
    expect(playback.playing).toBe(false);
    expect(playback.shouldBePlaying).toBe(false);
    expect(playback.currentClipId).toBe(1);
  });

  it('does nothing when it had no sound to give up', () => {
    const { playback } = mount();
    const before = audio.pauseCalls;

    channel().deliver({ type: 'play-claimed', tabId: OTHER_TAB_ID });

    expect(playback.playing).toBe(false);
    expect(audio.pauseCalls).toBe(before);
  });

  it('ignores its own claim coming back', () => {
    const { queue, playback } = mount();
    queue.enqueue(clip(1));
    const [own] = channel().posted;

    channel().deliver(own);

    expect(playback.playing).toBe(true);
  });

  /**
   * ⚠️ **The claim wins, whatever the ids**, and the alignment that makes that
   * safe is free: a tab that was already sounding had its own claim delivered to
   * the newcomer *before* the newcomer had any sound, so the newcomer ignored it
   * — and the newcomer's claim arrives here now, so this tab pauses. Last tab to
   * start sounding keeps it, which is what pressing play means.
   */
  it('gives the sound up to anybody, whatever the tab id', () => {
    const { queue, playback } = mount();
    queue.enqueue(clip(1));

    channel().deliver({ type: 'play-claimed', tabId: OTHER_TAB_ID });

    expect(playback.playing).toBe(false);
  });

  /** ⚠️ The channel is public to every script on the origin, so a message that
   *  is not the one message this app sends is dropped in silence. */
  it.each([[{ type: 'something-else', tabId: OTHER_TAB_ID }], [null], ['play-claimed'], [{}]])(
    'ignores %s',
    (message) => {
      const { queue, playback } = mount();
      queue.enqueue(clip(1));

      channel().deliver(message);

      expect(playback.playing).toBe(true);
    },
  );

  /**
   * ⚠️ **The editor's door, and why it exists.** The screen owns an element the
   * player store cannot reach, so a tab sitting on `/creator/:title` with its
   * element going is *not* "a tab with the sound" as far as `playback` is
   * concerned — it must still be told, and it decides for itself whether it was
   * playing.
   */
  it('tells the editor, even with the player silent', () => {
    const { playback } = mount();
    const takeTheSoundAway = vi.fn();
    const unsubscribe = onSoundTaken(takeTheSoundAway);
    expect(playback.playing).toBe(false);

    channel().deliver({ type: 'play-claimed', tabId: OTHER_TAB_ID });

    expect(takeTheSoundAway).toHaveBeenCalledTimes(1);
    unsubscribe();
    channel().deliver({ type: 'play-claimed', tabId: OTHER_TAB_ID });
    expect(takeTheSoundAway).toHaveBeenCalledTimes(1);
  });
});

describe('the queue another tab wrote', () => {
  /**
   * ⚠️ **The `storage` event is the transport, and it needs no new key**: it
   * fires in every other tab of the origin and never in the writer, which is
   * exactly the semantics this needs. The rules about WHAT gets adopted live in
   * `queue.store.ts` and are tested there; this is only the wiring.
   */
  it('adopts it when the browser says the key changed', () => {
    const { queue } = mount();
    queue.remember(clip(1));

    localStorage.setItem(
      QUEUE_STORAGE_KEY,
      JSON.stringify({ keys: ['c1', 'c2'], index: 1, at: 30 }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: QUEUE_STORAGE_KEY }));

    expect(queue.keys).toEqual(['c1', 'c2']);
    expect(queue.currentIndex).toBe(1);
  });

  it('ignores every other key', () => {
    const { queue } = mount();
    queue.enqueue(clip(1));

    localStorage.setItem(
      QUEUE_STORAGE_KEY,
      JSON.stringify({ keys: ['c1', 'c2'], index: 1, at: 30 }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: 'gravindex.moments' }));

    expect(queue.keys).toEqual(['c1']);
    expect(queue.currentIndex).toBe(0);
  });

  /**
   * ⚠️ **A tab frozen, discarded or restored out of the back/forward cache
   * missed every one of those events** and would come back holding a queue
   * nobody has any more. Both handlers are idempotent, which is what makes
   * "ask again on the way back" free.
   */
  it('asks again when the tab comes back', () => {
    const { queue } = mount();
    queue.remember(clip(1));

    localStorage.setItem(
      QUEUE_STORAGE_KEY,
      JSON.stringify({ keys: ['c1', 'c2'], index: 1, at: 30 }),
    );
    window.dispatchEvent(new Event('pageshow'));

    expect(queue.keys).toEqual(['c1', 'c2']);
  });

  it('stops listening on teardown', () => {
    const { queue } = mount();
    queue.enqueue(clip(1));
    stop?.();
    stop = null;

    localStorage.setItem(
      QUEUE_STORAGE_KEY,
      JSON.stringify({ keys: ['c1', 'c2'], index: 1, at: 30 }),
    );
    window.dispatchEvent(new StorageEvent('storage', { key: QUEUE_STORAGE_KEY }));

    expect(queue.keys).toEqual(['c1']);
  });
});
