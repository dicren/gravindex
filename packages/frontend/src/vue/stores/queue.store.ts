import { defineStore } from 'pinia';
import { computed, ref, shallowRef, triggerRef, watch } from 'vue';

import { registerPlayUseCase } from '#/config/clips.config';
import { MIN_RESUME_SECONDS, usePlaybackStore, type PlayableItem } from './playback.store';

/**
 * Everything the queue and the player need to draw a clip, and nothing else.
 *
 * ⚠️ **Structural on purpose, exactly like `PlayableItem`.** It is NOT the
 * `Clip` domain entity: this store lives in `vue/`, the entity in
 * `core/domain/clips/`, and keeping the dependency out means the queue can be
 * tested with five numbers and two strings, and that a change to the clip DTO
 * cannot break playback. `src` is the EPISODE's remote mp3, because a clip has
 * no audio file of its own.
 *
 * `up` rides along so the player can show the vote count for whatever is
 * playing without a request. ⚠️ For a clip opened directly by URL there is no
 * row to have carried it, which is why `GET /clips/:id` had to start returning
 * it.
 */
export interface QueuedClip {
  readonly kind: 'clip';
  readonly id: number;
  readonly title: string;
  /** Seconds into the episode. */
  readonly start: number;
  /** Seconds into the episode. Playback stops here. */
  readonly end: number;
  /** The episode's remote mp3. Several clips share one. */
  readonly src: string;
  readonly episodeId: number;
  readonly episodeTitle: string;
  readonly cover: string;
  readonly up: number;
}

/**
 * A whole episode, queued like anything else (2026-08-25).
 *
 * ⚠️ **This is the decision `/episode/:id` was built on**: the episode plays
 * through the one global player rather than through a second transport of its
 * own. The alternative — the page owning its own `<audio>`, as the editor does
 * — was rejected because a row has no play button precisely so that there is
 * exactly one thing making sound on this site, and because walking away from
 * the page would then cut the episode off mid-sentence.
 *
 * ⚠️ **`end` is the episode's length and it is routinely `0`.** It arrives from
 * `GET /episodes/:id/waveform`'s `to`, which is `0` for the nine episodes
 * nothing has measured, and there is nothing to ask on a cold boot — so the
 * playback store treats `0` as "until the file runs out" and takes the length
 * from the browser. See `PlayableItem.end`.
 *
 * ⚠️ There is no `up` and no `start`: an episode is not voted on, is not
 * downloaded, and always plays from the beginning.
 */
export interface QueuedEpisode {
  readonly kind: 'episode';
  readonly id: number;
  readonly title: string;
  /** Measured length in seconds, or `0` when nothing has measured it. */
  readonly end: number;
  /** The remote mp3 — for an episode, the whole of it. */
  readonly src: string;
  readonly cover: string;
}

/** What a queue holds. ⚠️ Discriminated by `kind`, never by "does it have an
 *  `up`": a narrowing helper is how the two would drift. */
export type QueuedItem = QueuedClip | QueuedEpisode;

/**
 * How an item is addressed in the order and in storage: `c12` is clip 12,
 * `e93` is episode 93.
 *
 * ⚠️ **A plain number is not enough any more, and this is the reason the whole
 * change is more than a new interface.** Clip 93 and episode 93 both exist, so
 * an order of bare ids cannot say which one it means. The prefix is one
 * character, survives `JSON.stringify`, and makes every `Map` and `includes`
 * below correct by construction rather than by comment.
 */
export type QueueKey = `c${number}` | `e${number}`;

export function clipKey(clipId: number): QueueKey {
  return `c${clipId}`;
}

export function episodeKey(episodeId: number): QueueKey {
  return `e${episodeId}`;
}

export function keyOf(item: QueuedItem): QueueKey {
  return item.kind === 'clip' ? clipKey(item.id) : episodeKey(item.id);
}

/** `c12` → `12`, `e93` → `null` — what the share code needs, since only clips
 *  can travel in one. */
export function clipIdOf(key: QueueKey): number | null {
  if (!key.startsWith('c')) return null;
  const id = Number(key.slice(1));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * A resolved item paired with its ABSOLUTE position in `keys` — what `/cola`
 * needs to tell "before `currentIndex`" from "at or after it" without the
 * index drifting while a key is still being hydrated.
 */
export interface QueueRow {
  readonly item: QueuedItem;
  readonly index: number;
}

/**
 * ⚠️ The fourth `localStorage` key, joining `gravindex.voter-token`,
 * `gravindex.analytics-consent` and `gravindex.list-limit.<id>`.
 */
const STORAGE_KEY = 'gravindex.queue';

/**
 * What is written. ⚠️ **Keys, the position in the queue, and the position
 * inside what it points at** — no titles, no audio URLs, no timestamps, no vote
 * counts. Two reasons for that limit and either would do: a title edited or a
 * clip deleted through the admin surface would leave a stale copy on someone's
 * machine forever, and a queue is a list of public ids, so storing anything
 * more is storing something for no one's benefit.
 *
 * ⚠️ **`at` reverses a recorded decision (2026-08-26).** This comment used to
 * say the playback position was deliberately not persisted, because "a queue
 * that half-remembers is worse than one that does not". What that missed is how
 * long the things in here are: the median clip runs two minutes, one in ten
 * past seven, and a whole EPISODE — three hours of it — has been a queue item
 * since 2026-08-25. Starting that again at `00:00` tomorrow is not a clean
 * slate, it is losing your place. The half-remembering the old note feared is
 * answered by writing the number and the key it belongs to together: **`at`
 * always describes `keys[index]`**, so there is no state where the queue points
 * at one thing and the position at another.
 *
 * ⚠️ **`keys` replaced `ids` on 2026-08-25 and the reader still accepts the old
 * shape.** Anything written before episodes could be queued is an array of bare
 * numbers, and every one of those numbers is a clip — so a stored `[137, 43]`
 * loads as `['c137', 'c43']` and nobody's queue is emptied by an upgrade. The
 * old key is not written again.
 */
interface StoredQueue {
  keys: QueueKey[];
  index: number;
  /**
   * Seconds **into the item at `index`** — the same unit as `playback.elapsed`,
   * never an absolute position inside the episode. `0` is "from the top", which
   * is also what every queue written before 2026-08-26 says by saying nothing.
   */
  at: number;
}

/** A remembered position, and the item it belongs to. */
interface ResumePoint {
  readonly key: QueueKey;
  readonly at: number;
}

/** What a stored queue says about where its current item was left, if anything.
 *  ⚠️ `null` for a queue with no position, no current item, or both. */
function resumePointOf(state: StoredQueue): ResumePoint | null {
  const key = state.keys[state.index];
  return key !== undefined && state.at > 0 ? { key, at: state.at } : null;
}

/** `unknown` → a key, or `null`. Also accepts the bare number that previously stored data uses. */
function toStoredKey(value: unknown): QueueKey | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? clipKey(value) : null;
  }
  if (typeof value !== 'string') return null;

  const id = Number(value.slice(1));
  if (!Number.isInteger(id) || id <= 0) return null;
  if (value.startsWith('c')) return clipKey(id);
  if (value.startsWith('e')) return episodeKey(id);
  return null;
}

/**
 * `unknown` → seconds into the current item, or `0`.
 *
 * ⚠️ Whole seconds, never negative, and never under the floor the playback store
 * honours anyway (`MIN_RESUME_SECONDS`) — everything else in this app measures
 * audio in integer seconds, and a hand-edited `-30` would otherwise arrive at
 * the element as a seek to before the file begins.
 */
function toStoredPosition(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < MIN_RESUME_SECONDS) return 0;
  return Math.floor(value);
}

/** ⚠️ Reading the property itself can throw — Safari with "block all cookies",
 *  a sandboxed iframe — so the access is inside the `try`, not just the call.
 *  Same shape as every other storage helper in this package. */
function resolveStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readStoredQueue(): StoredQueue {
  const empty: StoredQueue = { keys: [], index: -1, at: 0 };
  const storage = resolveStorage();
  if (storage === null) return empty;

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return empty;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return empty;

    const record = parsed as { keys?: unknown; ids?: unknown; index?: unknown; at?: unknown };
    // ⚠️ `ids` is the pre-2026-08-25 shape. See `StoredQueue` above.
    const stored: unknown = Array.isArray(record.keys) ? record.keys : record.ids;
    if (!Array.isArray(stored)) return empty;

    // Anything that does not parse is dropped rather than repaired: this value
    // is edited by hand more often than one would think.
    const clean = [
      ...new Set(stored.map(toStoredKey).filter((key): key is QueueKey => key !== null)),
    ];

    const { index, at } = record;
    const position = typeof index === 'number' && index >= 0 && index < clean.length ? index : -1;
    return {
      keys: clean,
      index: position,
      // ⚠️ A position with nothing to belong to is dropped rather than handed to
      // whatever ends up at that index: `at` describes `keys[index]`, and a
      // queue whose index did not survive the read has no current item at all.
      at: position === -1 ? 0 : toStoredPosition(at),
    };
  } catch {
    // Corrupt JSON, a quota error, a storage that throws on read. An empty
    // queue is a working app; a thrown error at module scope is a blank page.
    return empty;
  }
}

function writeStoredQueue(state: StoredQueue): void {
  const storage = resolveStorage();
  if (storage === null) return;

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private windows, full quota, disabled storage. The queue still works for
    // this session — it just will not survive a reload, which is the same
    // outcome as never having had one.
  }
}

/**
 * The playback queue: what is playing, what comes next, and how to get back to
 * it tomorrow.
 *
 * ⚠️ **This is the plug `playback.store.ts` was shaped for.** That store's own
 * comment says a queue would add "`queue`/`enqueue`/`next`/`previous`, advancing
 * on the end-of-clip path instead of stopping, and a persistent player component
 * reading this same store" — this is that, and nothing in the playback store had
 * to be undone to fit it. It still owns exactly one audio element; this one owns
 * the order.
 *
 * The split between the two, which is worth keeping:
 *
 * - **`playback`** knows about an audio element, a position and one clip. It
 *   has no idea a queue exists beyond a single callback.
 * - **`queue`** knows about order and persistence and never touches an `Audio`.
 *
 * ⚠️ **Server state is not here.** The store holds ids and the small structural
 * record above; resolving an id the page has never seen is the delivery layer's
 * job (`composables/use-queue-hydration.ts`), which is also where "an id that no
 * longer exists disappears silently" happens.
 */
export const useQueueStore = defineStore('queue', () => {
  const stored = readStoredQueue();

  /** The order. Keys, because that is what survives a reload. */
  const keys = ref<QueueKey[]>(stored.keys);
  /** Where in `keys` the player is. `-1` when nothing is loaded. */
  const currentIndex = ref<number>(stored.index);

  /**
   * The position this browser knows about, and the item it belongs to.
   *
   * ⚠️ **It mirrors what is in storage, and it is one number** (2026-08-26).
   * `at` describes `keys[index]` there and this pair describes the same key
   * here, so the two cannot drift apart: every `persist` writes both, and every
   * question about "where was this left" is asked of the key, never of a
   * timestamp or an order.
   *
   * ⚠️ **It is not spent by being read.** The player can stop holding an item
   * while the queue still points at it — the EDITOR does exactly that on the way
   * in (`utils/editor-audio.ts` asks this store's player to stop) — and both the
   * next write and the next play have to keep finding the position, or opening
   * the editor from an episode would quietly cost you your place in it.
   *
   * ⚠️ **Nothing on screen announces it before play is pressed**, and that is a
   * decision rather than an omission: a cold boot already shows the clip the
   * queue points at, so the only honest place for a waiting position would be
   * the player's clock, which would then read `00:40 / 00:00` — a position
   * beside a length nothing has loaded yet. Pressing play fills in both at once.
   */
  const lastVisit = resumePointOf(stored);
  let positionKey: QueueKey | null = lastVisit?.key ?? null;
  let positionAt: number = lastVisit?.at ?? 0;

  /**
   * What each id actually is, for the ids this session has met.
   *
   * ⚠️ A `shallowRef` around a plain `Map` rather than a reactive object: the
   * entries are immutable value objects that are only ever replaced, and a deep
   * proxy over a map that grows with every row rendered is a real cost for no
   * behaviour. `triggerRef` after a write is what makes the computeds below
   * re-run.
   */
  const entries = shallowRef(new Map<QueueKey, QueuedItem>());

  const playback = usePlaybackStore();

  /**
   * Clips whose play has already been counted this session.
   *
   * ⚠️ **Counted per clip, not per component.** The `playback` table is
   * append-only and nothing has ever read it back, so a second row for the same
   * visitor pausing and pressing play again is noise.
   */
  const counted = new Set<QueueKey>();

  /**
   * How far the position may move before it is written again, in seconds.
   *
   * ⚠️ **Measured in audio, not in wall clock**, so there is no timer to start,
   * stop or leak: `timeupdate` fires about four times a second and this store
   * only reaches for `localStorage` when the number it would write has actually
   * changed by five. An hour of listening is ~720 writes of a two-line JSON
   * object, and a seek — which moves `elapsed` by more than five in one tick —
   * is written immediately, which is exactly when somebody most expects it to
   * be remembered.
   */
  const PERSIST_EVERY_SECONDS = 5;

  /**
   * Where `key` was left, in seconds into it, or `0`.
   *
   * ⚠️ **Only ever one key has an answer.** Coming back and starting something
   * else is a decision to start something else: the write that follows files
   * this session's position under the key it belongs to, and the old number
   * stops describing anything.
   */
  function resumeFor(key: QueueKey): number {
    return positionKey === key ? positionAt : 0;
  }

  /**
   * Each resolved clip together with its ABSOLUTE position in `ids`.
   *
   * ⚠️ **The index a row carries is not its position in this array.** `clips`
   * (below) used to be the only view and silently closed the gap left by an id
   * still being fetched — fine while nothing compared positions across it, but
   * `/cola`'s history split (`packages/frontend/CLAUDE.md`, "The queue") needs
   * `currentIndex` to line up with a real position even mid-hydration, or a
   * clip resolved after its neighbours would land on the wrong side of the cut.
   */
  const rows = computed((): QueueRow[] =>
    keys.value
      .map((key, index) => ({ item: entries.value.get(key), index }))
      .filter((row): row is QueueRow => row.item !== undefined),
  );

  /** The queue as far as it is resolved, in order. ⚠️ A key still being fetched
   *  is simply absent — the list renders what it knows and grows as answers
   *  arrive. */
  const items = computed((): QueuedItem[] => rows.value.map((row) => row.item));

  /**
   * The clip ids of the queue, in order — what a `?c=` share link is made of.
   *
   * ⚠️ **Episodes are not in it, and cannot be.** `?c=` is two base62
   * characters per clip id with no room for a kind (`utils/queue-code.ts`), and
   * that format is a public URL shape. Rather than widen it, a shared queue
   * carries the clips and leaves the episode behind — which `/cola` says out
   * loud before anyone copies the link.
   */
  const shareableClipIds = computed((): number[] =>
    keys.value.map(clipIdOf).filter((id): id is number => id !== null),
  );

  /**
   * ⚠️ **Recorded deviation (2026-08-19): `/cola` no longer draws the whole
   * queue.** What is at or after `currentIndex` is `upcoming`, whose first row
   * is always the one playing; everything before it is `played`, tucked behind
   * a "Mostrar lo que ya ha sonado" toggle in the view. `currentIndex === -1`
   * (nothing loaded) makes `played` empty and `upcoming` the whole queue.
   * `next()` only ever moves forward, so nothing before the cut can start
   * sounding again on its own — which is also why the view refuses to let a
   * drag or an arrow put a clip ahead of `currentIndex`.
   */
  const played = computed((): QueueRow[] =>
    rows.value.filter((row) => row.index < currentIndex.value),
  );
  const upcoming = computed((): QueueRow[] =>
    rows.value.filter((row) => row.index >= currentIndex.value),
  );

  const current = computed((): QueuedItem | null => {
    const key = keys.value[currentIndex.value];
    return key === undefined ? null : (entries.value.get(key) ?? null);
  });

  const size = computed(() => keys.value.length);
  const isEmpty = computed(() => keys.value.length === 0);

  /** Total running time of everything resolved so far, in seconds. ⚠️ An
   *  episode nothing has measured contributes 0 — the alternative is a total
   *  that lies, and the browser only learns the length once it plays it. */
  const totalSeconds = computed(() =>
    items.value.reduce((sum, item) => sum + Math.max(0, item.end - startOf(item)), 0),
  );

  const hasNext = computed(
    () => currentIndex.value >= 0 && currentIndex.value < keys.value.length - 1,
  );

  function contains(clipId: number): boolean {
    return keys.value.includes(clipKey(clipId));
  }

  function containsEpisode(episodeId: number): boolean {
    return keys.value.includes(episodeKey(episodeId));
  }

  /**
   * Where the player is inside the queue's current item, as a number worth
   * writing down.
   *
   * ⚠️ **It asks the player only when the player is holding the right thing.**
   * Everything else — a cold boot where nothing has started, the editor having
   * stopped it, a removal that moved the index — falls back to what is already
   * known about that same key, because reading `elapsed` there would file one
   * item's position under another's, and answering `0` would throw the
   * visitor's place away on the next write, which a single `enqueue` triggers.
   *
   * ⚠️ And a position under `MIN_RESUME_SECONDS` is reported as none: the
   * beginning is not a place, and the playback store refuses to restore one
   * anyway.
   */
  function livePosition(): number {
    const key = keys.value[currentIndex.value];
    if (key === undefined) return 0;

    const item = entries.value.get(key);
    const loaded = playback.current;
    const isLoaded =
      item !== undefined && loaded !== null && loaded.kind === item.kind && loaded.id === item.id;

    // ⚠️ The player is not holding what the queue points at: nothing has started
    // yet on this visit, or the editor stopped it, or a removal moved the index.
    // What is already known about this very key is the best answer there is —
    // reading `elapsed` here would file one item's position under another's key,
    // and returning `0` would throw the visitor's place away on the next write,
    // which a single `enqueue` is enough to trigger.
    if (!isLoaded) return resumeFor(key);

    const seconds = Math.floor(playback.elapsed);
    return seconds >= MIN_RESUME_SECONDS ? seconds : 0;
  }

  function persist(): void {
    const at = livePosition();
    positionKey = keys.value[currentIndex.value] ?? null;
    positionAt = at;
    writeStoredQueue({ keys: [...keys.value], index: currentIndex.value, at });
  }

  /** ⚠️ An episode has no `start` field at all — it always plays from the
   *  beginning — so this is where the two shapes meet rather than a `0` written
   *  at four call sites. */
  function startOf(item: QueuedItem): number {
    return item.kind === 'clip' ? item.start : 0;
  }

  function toPlayable(item: QueuedItem): PlayableItem {
    return {
      kind: item.kind,
      id: item.id,
      src: item.src,
      start: startOf(item),
      end: item.end,
    };
  }

  /** Record what a key is. Called by the rows that already have the data, and
   *  by the boot-time resolution for the ones nobody has seen this session. */
  function remember(item: QueuedItem): void {
    entries.value.set(keyOf(item), item);
    triggerRef(entries);
  }

  /** Load `index` into the player and start it. */
  function playAt(index: number): void {
    const key = keys.value[index];
    const item = key === undefined ? undefined : entries.value.get(key);
    if (key === undefined || item === undefined) return;

    currentIndex.value = index;
    // ⚠️ The element first, the write second — the reverse of the order this
    // had until 2026-08-26. `persist` asks the player where it is, so writing
    // before `play` files the OUTGOING item's position under the incoming
    // item's key, which is the one thing `at` promises never to do.
    playback.play(toPlayable(item), resumeFor(key));
    persist();

    /**
     * ⚠️ **Every path that starts a clip comes through here**, which is why the
     * counter lives in the store rather than in a component: a row queues, the
     * permalink plays, the player's next button advances and a clip ending
     * advances again. The counter lives in one place for all of them.
     *
     * ⚠️ Fire and forget, and deliberately not a Colada mutation: the use case
     * swallows its own domain errors (`RegisterPlayUseCase`) because a lost
     * counter must never interrupt the audio or raise a toast at somebody who
     * only pressed play, and there is no cache for it to invalidate — nothing in
     * the app reads the table back.
     */
    // ⚠️ **Clips only.** `POST /clips/:id/play` counts a CUT being heard;
    // there is no episode counter on the wire and inventing one by passing an
    // episode id would write rows against whatever clip shares the number.
    if (item.kind === 'clip' && !counted.has(key)) {
      counted.add(key);
      void registerPlayUseCase.execute(item.id);
    }
  }

  /**
   * Append a clip and, **if the queue was empty, start playing it.**
   *
   * ⚠️ That second half is not a convenience, it is the rule that makes a card
   * without a play button work at all: with a
   * global player, "queue" is the only verb a row has, so a first visit that
   * merely filled a list would begin in silence and look broken.
   *
   * A clip already in the queue is a no-op — the row shows `En la cola` and its
   * button is inert, so there are no duplicates to reason about anywhere else.
   */
  function enqueue(item: QueuedItem): void {
    remember(item);
    const key = keyOf(item);
    if (keys.value.includes(key)) return;

    const wasEmpty = keys.value.length === 0;
    keys.value = [...keys.value, key];

    if (wasEmpty) {
      playAt(keys.value.length - 1);
    } else {
      persist();
    }
  }

  /**
   * **Play this clip now**, putting it in the queue right after whatever is
   * sounding — the permalink's `Escuchar`.
   *
   * ⚠️ **This is not `enqueue`, and the difference is the whole point**
   * (2026-08-19). `enqueue` appends and only starts playing when the queue was
   * empty, which is right for a row that says `Cola` and wrong for a button
   * that says `Escuchar`: somebody who opened one clip's page and pressed play
   * got a silent append to the end of a list they were not looking at. Here the
   * clip goes in **at `currentIndex + 1`** — so the queue is not thrown away,
   * only interrupted — and playback moves to it.
   *
   * ⚠️ A clip already in the queue is played **where it is**. Moving it would
   * reorder somebody's list as a side effect of pressing play, and the queue is
   * the one thing on this site people arrange by hand.
   *
   * ⚠️ With nothing loaded (`currentIndex === -1`) the arithmetic lands it at 0,
   * which is what "next" means when there is no current.
   */
  function playNow(item: QueuedItem): void {
    remember(item);
    const key = keyOf(item);

    const existing = keys.value.indexOf(key);
    if (existing !== -1) {
      playAt(existing);
      return;
    }

    const at = currentIndex.value + 1;
    const reordered = [...keys.value];
    reordered.splice(at, 0, key);
    keys.value = reordered;

    playAt(at);
  }

  /** Queue several at once, keeping their order — the shared-link `Añadir al
   *  final`. Only the first triggers playback, by the same rule as above. */
  function enqueueMany(newItems: readonly QueuedItem[]): void {
    for (const item of newItems) enqueue(item);
  }

  /** `Reemplazar la mía`: throw the queue away and adopt these instead. */
  function replaceWith(newItems: readonly QueuedItem[]): void {
    clear();
    enqueueMany(newItems);
  }

  /**
   * Play the next clip, or stop if this was the last.
   *
   * ⚠️ **Reaching the end of a clip comes here**, rather than rewinding and
   * stopping (`playback.store.ts`). The `next` button is the same call.
   *
   * ⚠️ It does **not** loop and does not autoplay anything outside the queue:
   * the last clip ending is the end.
   */
  function next(): void {
    if (!hasNext.value) {
      playback.pause();
      return;
    }
    playAt(currentIndex.value + 1);
  }

  /**
   * Remove one clip.
   *
   * ⚠️ Removing the clip that is PLAYING moves playback to the next one — or
   * stops, if it was the last. Anything else would leave the player showing a
   * clip that is no longer in the queue it belongs to.
   */
  function remove(key: QueueKey): void {
    const index = keys.value.indexOf(key);
    if (index === -1) return;

    const wasCurrent = index === currentIndex.value;
    const wasPlaying = playback.playing;
    keys.value = keys.value.filter((other) => other !== key);

    if (wasCurrent) {
      // The next item has just slid into this index. If there is none, the
      // queue ran out.
      if (index < keys.value.length) {
        currentIndex.value = index;
        persist();
        if (wasPlaying) playAt(index);
      } else {
        playback.stop();
        currentIndex.value = keys.value.length > 0 ? keys.value.length - 1 : -1;
        persist();
      }
      return;
    }

    // Removing something BEFORE the current clip shifts it up by one; the clip
    // playing must not change because a row above it went away.
    if (index < currentIndex.value) currentIndex.value -= 1;
    persist();
  }

  /**
   * Move a clip from one position to another — the drag handle.
   *
   * ⚠️ **Dragging never changes what is playing**, only what comes after. The
   * index is recomputed so the same clip stays current wherever it lands, which
   * is why this tracks the id rather than the number.
   */
  function move(from: number, to: number): void {
    if (from === to) return;
    if (from < 0 || from >= keys.value.length) return;

    const target = Math.min(Math.max(to, 0), keys.value.length - 1);
    const currentKey = keys.value[currentIndex.value];

    const reordered = [...keys.value];
    const [moved] = reordered.splice(from, 1);
    if (moved === undefined) return;
    reordered.splice(target, 0, moved);
    keys.value = reordered;

    if (currentKey !== undefined) currentIndex.value = reordered.indexOf(currentKey);
    persist();
  }

  /** `Vaciar`: clears the list **and** stops playback. A player still going
   *  over an empty queue is the state nobody can explain. */
  function clear(): void {
    playback.stop();
    keys.value = [];
    currentIndex.value = -1;
    persist();
  }

  /** Drop a key that no longer resolves. ⚠️ Silent by contract: a clip deleted
   *  through the admin surface must not leave a 404 in someone's queue. */
  function forget(key: QueueKey): void {
    if (!keys.value.includes(key)) return;
    remove(key);
    entries.value.delete(key);
    triggerRef(entries);
  }

  /** The row's own play/pause: play this queued clip, or pause if it is the one
   *  already going. */
  function toggleAt(index: number): void {
    if (index === currentIndex.value && playback.playing) {
      playback.pause();
      return;
    }
    if (index === currentIndex.value && playback.current !== null) {
      playback.resume();
      return;
    }
    playAt(index);
  }

  /** The player's play/pause. With nothing loaded it starts the queue. */
  function togglePlayback(): void {
    if (playback.playing) {
      playback.pause();
      return;
    }
    if (playback.current !== null) {
      playback.resume();
      return;
    }
    if (keys.value.length > 0) playAt(currentIndex.value >= 0 ? currentIndex.value : 0);
  }

  /**
   * ⚠️ **Where "a clip ended" becomes "play the next one".** The playback store
   * calls this and knows nothing else about the queue; without a handler it
   * falls back to its old rewind-and-stop, which is what keeps the editor —
   * which drives its own audio — unaffected.
   */
  playback.setEndedHandler(next);

  /**
   * Follow the playhead into `localStorage`, five seconds at a time.
   *
   * ⚠️ **The queue watches the player; the player still knows nothing about
   * this.** Persistence has always lived here, and a playback store that wrote
   * to storage could not be the four-numbers-and-a-string thing its own tests
   * drive. The clip EDITOR drives an element of its own and never appears here
   * at all — what it does do is ask the player to stop on its way in, which
   * lands on the second watcher below and is exactly why `livePosition`
   * remembers against a key rather than against whatever is loaded.
   */
  watch(
    () => playback.elapsed,
    (seconds) => {
      if (currentIndex.value < 0) return;
      if (Math.abs(seconds - positionAt) < PERSIST_EVERY_SECONDS) return;
      persist();
    },
    // ⚠️ `sync`, not the default `pre`: a write left waiting in a microtask is a
    // write that may not happen at all if the tab is closed in that instant,
    // which is precisely the moment this feature exists for. The callback is
    // three comparisons on all but every twentieth `timeupdate`.
    { flush: 'sync' },
  );

  /**
   * A pause is worth being exact about.
   *
   * ⚠️ Deliberately pausing is the clearest "I am leaving, and this is where I
   * was" anybody gives this app, and it is the one moment where losing up to
   * five seconds to the throttle above would be noticed. It fires on the end of
   * an item too, where `rewind()` has already put `elapsed` back to zero — so
   * the write that lands says `0`, which is the truth: something that finished
   * has no place to be resumed from.
   */
  watch(
    () => playback.playing,
    (isPlaying) => {
      if (!isPlaying && currentIndex.value >= 0) persist();
    },
    { flush: 'sync' },
  );

  return {
    keys,
    currentIndex,
    entries,
    items,
    shareableClipIds,
    rows,
    played,
    upcoming,
    current,
    size,
    isEmpty,
    totalSeconds,
    hasNext,
    contains,
    containsEpisode,
    remember,
    enqueue,
    playNow,
    enqueueMany,
    replaceWith,
    next,
    remove,
    move,
    clear,
    forget,
    playAt,
    toggleAt,
    togglePlayback,
  };
});
