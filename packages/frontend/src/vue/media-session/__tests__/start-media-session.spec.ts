import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { startMediaSession } from '@/media-session/start-media-session';
import {
  resetAudioElementFactory,
  setAudioElementFactory,
  usePlaybackStore,
  type PlaybackAudio,
} from '@/stores/playback.store';
import { useQueueStore, type QueuedClip, type QueuedEpisode } from '@/stores/queue.store';

/**
 * The media session is a **projection**, so what there is to test is the
 * projection: does the lock screen get the right title, does its play button
 * move the same stores the on-screen player does, and does a browser without a
 * session cost the app anything (it does not).
 *
 * ⚠️ Every assertion is made either on the double's own recorded calls or on the
 * real stores / fake audio element. Nothing here reaches into the module's state,
 * because it has none.
 */

/**
 * ⚠️ **`POST /clips/:id/play`, mocked for the same reason `queue.store.spec.ts`
 * mocks it**: enqueueing the first item starts it, which counts a play, and the
 * real use case would reach for `fetch` — which `vitest.setup.ts` makes throw on
 * purpose so no unit test can write to the development database.
 */
const playCounter = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('#/config/clips.config', () => ({ registerPlayUseCase: playCounter }));

/**
 * A stand-in for `HTMLAudioElement`.
 *
 * ⚠️ **Its `play()` fires `'play'` then `'playing'`, and its `pause()` fires
 * `'pause'`, because the store's `playing` is the ELEMENT's state** — the store
 * believes what the element reports and nothing else. A fake that only resolved
 * a promise would leave `playing` false and every assertion below meaningless.
 *
 * ⚠️ Implemented **wider than the interface requires** (`paused`, `load()`, any
 * event name): the interface is the playback store's to widen, and this thing's
 * job is to still compile the day it does.
 */
class FakeAudio implements PlaybackAudio {
  src = '';
  currentTime = 0;
  /** `NaN` before metadata, exactly as a real element reports it. */
  duration = Number.NaN;
  paused = true;
  playCalls = 0;
  pauseCalls = 0;
  loadCalls = 0;
  private readonly listeners = new Map<string, (() => void)[]>();

  load(): void {
    this.loadCalls += 1;
  }

  play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
    this.emit('play');
    this.emit('playing');
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCalls += 1;
    this.paused = true;
    this.emit('pause');
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

/**
 * ⚠️ `MediaMetadata` is a **separate global** from `navigator.mediaSession`, and
 * a browser that has one has the other. Stubbed rather than cast away, so the
 * production path is `new MediaMetadata(…)` for real — which is what Chrome
 * requires: the property's IDL is an interface type, so a plain object literal
 * throws `TypeError` there even though it reads fine in a test.
 */
class FakeMediaMetadata {
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly artwork: readonly MediaImage[];

  constructor(init: MediaMetadataInit) {
    this.title = init.title ?? '';
    this.artist = init.artist ?? '';
    this.album = init.album ?? '';
    this.artwork = init.artwork ?? [];
  }
}

/**
 * The session double: plain writable properties, handlers recorded in a map,
 * position updates appended to an array.
 */
class FakeMediaSession {
  metadata: FakeMediaMetadata | null = null;
  playbackState: MediaSessionPlaybackState = 'none';
  readonly handlers = new Map<string, ((details: MediaSessionActionDetails) => void) | null>();
  readonly positionStates: MediaPositionState[] = [];

  setActionHandler(
    action: string,
    handler: ((details: MediaSessionActionDetails) => void) | null,
  ): void {
    this.handlers.set(action, handler);
  }

  setPositionState(state?: MediaPositionState): void {
    this.positionStates.push(state ?? {});
  }

  /** What the lock screen does when a thumb lands on it. */
  press(action: string, details: Partial<MediaSessionActionDetails> = {}): void {
    const handler = this.handlers.get(action);
    if (handler === null || handler === undefined) {
      throw new Error(`no handler registered for ${action}`);
    }
    handler({ action: action as MediaSessionAction, ...details });
  }

  /** The last position the session was told about, if any. */
  get lastPosition(): MediaPositionState | undefined {
    return this.positionStates.at(-1);
  }
}

/** Everything the module answers. ⚠️ Spelled out here rather than imported, so
 *  a fourth list cannot quietly shrink the one under test. */
const ACTIONS = [
  'play',
  'pause',
  'stop',
  'seekbackward',
  'seekforward',
  'seekto',
  'nexttrack',
  'previoustrack',
];

const EPISODE = 'https://example.test/episodes/42.mp3';

function clip(id: number, over: Partial<QueuedClip> = {}): QueuedClip {
  return {
    kind: 'clip',
    id,
    title: `Corte ${id}`,
    start: 100,
    end: 160,
    src: EPISODE,
    episodeId: 42,
    episodeTitle: 'Episodio 42',
    cover: 'https://example.test/cover.jpg',
    up: 3,
    ...over,
  };
}

function episode(id: number, over: Partial<QueuedEpisode> = {}): QueuedEpisode {
  return {
    kind: 'episode',
    id,
    title: `Episodio ${id}`,
    end: 3600,
    src: EPISODE,
    cover: 'https://example.test/cover.jpg',
    ...over,
  };
}

let audio: FakeAudio;
let session: FakeMediaSession;

beforeEach(() => {
  localStorage.clear();
  playCounter.execute.mockClear();
  setActivePinia(createPinia());

  audio = new FakeAudio();
  setAudioElementFactory(() => audio);

  session = new FakeMediaSession();
  Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true });
  vi.stubGlobal('MediaMetadata', FakeMediaMetadata);
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'mediaSession');
  vi.unstubAllGlobals();
  resetAudioElementFactory();
});

describe('without a media session', () => {
  it('is inert and returns a callable teardown', () => {
    // ⚠️ jsdom, a sandboxed iframe and a LAN dev server over plain `http://` all
    // look like this. The app must not care.
    Reflect.deleteProperty(navigator, 'mediaSession');

    const stop = startMediaSession();

    expect(typeof stop).toBe('function');
    expect(() => stop()).not.toThrow();
  });

  it('lets the player work exactly as before', () => {
    Reflect.deleteProperty(navigator, 'mediaSession');
    const queue = useQueueStore();

    const stop = startMediaSession();
    queue.enqueue(clip(1));

    expect(queue.currentIndex).toBe(0);
    expect(audio.playCalls).toBe(1);

    stop();
  });
});

describe('metadata', () => {
  it('names a queued clip after the clip, its episode and this site', () => {
    const queue = useQueueStore();
    startMediaSession();

    queue.enqueue(clip(1, { title: 'El de la marmota', episodeTitle: 'Episodio 42' }));

    expect(session.metadata?.title).toBe('El de la marmota');
    expect(session.metadata?.artist).toBe('Episodio 42');
    expect(session.metadata?.album).toBe('Índice gravinero');
    expect(session.metadata?.artwork).toEqual([{ src: 'https://example.test/cover.jpg' }]);
  });

  it('names a queued episode after the episode, the podcast and this site', () => {
    const queue = useQueueStore();
    startMediaSession();

    queue.enqueue(episode(93, { title: 'Lo que se fue' }));

    expect(session.metadata?.title).toBe('Lo que se fue');
    expect(session.metadata?.artist).toBe('Gravina82');
    expect(session.metadata?.album).toBe('Índice gravinero');
    expect(session.metadata?.artwork).toEqual([{ src: 'https://example.test/cover.jpg' }]);
  });

  it('sends no artwork at all rather than an empty source', () => {
    // ⚠️ An empty `src` is not "no cover" to a browser, it is a request for the
    // page itself, which it then tries to draw as the album art.
    const queue = useQueueStore();
    startMediaSession();

    queue.enqueue(clip(1, { cover: '' }));

    expect(session.metadata?.artwork).toEqual([]);
  });

  it('takes the notification away when the queue is emptied', () => {
    const queue = useQueueStore();
    startMediaSession();

    queue.enqueue(clip(1));
    expect(session.metadata).not.toBeNull();

    queue.clear();

    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe('none');
  });

  it('has nothing to say while the queue points at an unresolved key', () => {
    // A cold boot has ids and no titles: the session must stay empty until
    // hydration turns them into clips, rather than showing a previous title.
    const queue = useQueueStore();
    startMediaSession();

    expect(queue.current).toBeNull();
    expect(session.metadata).toBeNull();
  });
});

describe('playback state', () => {
  it('follows the element: none, playing, paused', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    startMediaSession();

    expect(session.playbackState).toBe('none');

    queue.enqueue(clip(1));
    expect(session.playbackState).toBe('playing');

    playback.pause();
    expect(session.playbackState).toBe('paused');
  });

  it('is none when the player holds nothing, even with a queue', () => {
    // `paused` would offer a play button that would start nothing; `none` is
    // "there is no media here yet".
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    startMediaSession();

    queue.enqueue(clip(1));
    playback.stop();

    expect(queue.current).not.toBeNull();
    expect(session.playbackState).toBe('none');
  });
});

describe('action handlers', () => {
  it('registers every action, before anything is queued', () => {
    // ⚠️ Some browsers raise the notification only once a `play` handler exists,
    // and the others must not depend on something already playing.
    startMediaSession();

    expect([...session.handlers.keys()].sort()).toEqual([...ACTIONS].sort());
    for (const handler of session.handlers.values()) expect(handler).toBeTypeOf('function');
  });

  it('resumes what is loaded from the play button', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    startMediaSession();

    queue.enqueue(clip(1));
    playback.pause();
    const before = audio.playCalls;

    session.press('play');

    expect(audio.playCalls).toBe(before + 1);
    expect(playback.playing).toBe(true);
  });

  it('starts the queue from the play button when nothing is loaded', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    startMediaSession();

    queue.enqueue(clip(1));
    playback.stop();

    session.press('play');

    expect(playback.current).not.toBeNull();
    expect(playback.playing).toBe(true);
  });

  it('pauses from the pause button', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    startMediaSession();

    queue.enqueue(clip(1));
    const before = audio.pauseCalls;

    session.press('pause');

    expect(audio.pauseCalls).toBe(before + 1);
    expect(playback.playing).toBe(false);
  });

  it('pauses rather than emptying the queue on stop', () => {
    // ⚠️ Recorded decision: a lock-screen stop is one thumb away from pause, and
    // emptying a hand-arranged queue from there would destroy work with no undo.
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    startMediaSession();

    queue.enqueue(clip(1));
    queue.enqueue(clip(2));

    session.press('stop');

    expect(playback.playing).toBe(false);
    expect(queue.size).toBe(2);
    expect(queue.currentIndex).toBe(0);
  });

  it('steps backwards and forwards by the offset the browser sends', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    startMediaSession();

    queue.enqueue(clip(1));
    playback.seek(30);
    expect(audio.currentTime).toBe(130);

    session.press('seekbackward', { seekOffset: 10 });
    expect(playback.elapsed).toBe(20);
    expect(audio.currentTime).toBe(120);

    session.press('seekforward', { seekOffset: 10 });
    expect(playback.elapsed).toBe(30);
    expect(audio.currentTime).toBe(130);
  });

  it('falls back to ten seconds when the browser sends no offset', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    startMediaSession();

    queue.enqueue(clip(1));
    playback.seek(30);

    session.press('seekforward');

    expect(playback.elapsed).toBe(40);
  });

  it('clamps a seek at the start and at the end of the item', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    startMediaSession();

    queue.enqueue(clip(1));

    session.press('seekbackward', { seekOffset: 1000 });
    expect(playback.elapsed).toBe(0);
    expect(audio.currentTime).toBe(100);

    session.press('seekforward', { seekOffset: 1000 });
    expect(playback.elapsed).toBe(60);
    expect(audio.currentTime).toBe(160);
  });

  it('seeks to a time given in seconds INTO the item', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    startMediaSession();

    queue.enqueue(clip(1, { start: 100, end: 160 }));

    session.press('seekto', { seekTime: 5 });

    expect(playback.elapsed).toBe(5);
    expect(audio.currentTime).toBe(105);
  });

  it('ignores a seek with no time at all', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    startMediaSession();

    queue.enqueue(clip(1));
    playback.seek(20);
    const before = audio.currentTime;

    session.press('seekto');

    expect(audio.currentTime).toBe(before);
    expect(playback.elapsed).toBe(20);
  });

  it('advances the queue from next', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    startMediaSession();

    queue.enqueue(clip(1, { start: 100 }));
    queue.enqueue(clip(2, { start: 200 }));

    session.press('nexttrack');

    expect(queue.currentIndex).toBe(1);
    expect(playback.current?.id).toBe(2);
    expect(audio.currentTime).toBe(200);
  });

  it('goes back from previous, and back to the start of the first item', () => {
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    startMediaSession();

    queue.enqueue(clip(1, { start: 100 }));
    queue.enqueue(clip(2, { start: 200 }));

    session.press('nexttrack');
    session.press('previoustrack');
    expect(queue.currentIndex).toBe(0);
    expect(playback.current?.id).toBe(1);

    // ⚠️ Past a few seconds, previous means "start this one again" rather than
    // "go back one" — the queue store's own rule, reached through this button.
    playback.seek(20);
    session.press('previoustrack');
    expect(queue.currentIndex).toBe(0);
    expect(playback.elapsed).toBe(0);
  });
});

describe('position state', () => {
  it('reports the length and where the player is', () => {
    const queue = useQueueStore();
    startMediaSession();

    queue.enqueue(clip(1, { start: 100, end: 160 }));

    expect(session.lastPosition).toEqual({ duration: 60, position: 0, playbackRate: 1 });
  });

  it('never reports it while the length is unknown', () => {
    // ⚠️ `setPositionState` throws on `0`, `NaN` and `Infinity`, and an uncaught
    // throw there costs the rest of the session's work. Idle first, then the two
    // impossible lengths the store itself refuses to produce.
    const playback = usePlaybackStore();
    startMediaSession();

    expect(session.positionStates).toHaveLength(0);

    playback.play({ kind: 'clip', id: 9, src: EPISODE, start: 0, end: Number.POSITIVE_INFINITY });
    expect(session.positionStates).toHaveLength(0);

    playback.play({ kind: 'clip', id: 10, src: EPISODE, start: 0, end: Number.NaN });
    expect(session.positionStates).toHaveLength(0);
  });

  it('keeps the position strictly below the length', () => {
    // ⚠️ A position of exactly `duration` throws in Chrome, which is the last
    // second of every clip.
    const queue = useQueueStore();
    const playback = usePlaybackStore();
    startMediaSession();

    queue.enqueue(clip(1, { start: 0, end: 60 }));
    playback.seek(60);

    const state = session.lastPosition;
    expect(state?.duration).toBe(60);
    expect(state?.position).toBeLessThan(60);
    expect(state?.position).toBeGreaterThan(59);
  });
});

describe('teardown', () => {
  it('unregisters every handler, clears the notification and is idempotent', () => {
    const queue = useQueueStore();
    const stop = startMediaSession();

    queue.enqueue(clip(1));
    expect(session.metadata).not.toBeNull();

    stop();

    for (const action of ACTIONS) expect(session.handlers.get(action)).toBeNull();
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe('none');

    expect(() => stop()).not.toThrow();
  });

  it('stops writing to the session once it is gone', () => {
    const queue = useQueueStore();
    const stop = startMediaSession();

    stop();
    queue.enqueue(clip(1));

    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe('none');
  });
});
