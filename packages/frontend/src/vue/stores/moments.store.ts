import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

/**
 * A second of an episode somebody marked while listening to it — **a private
 * draft of a clip.**
 *
 * ⚠️ **That framing is the design, not a metaphor.** A clip is public: it has an
 * id, a permalink, votes, tags and a row in everyone's library. A moment is the
 * same thing — a piece of an episode — before any of that: no title, no tags,
 * nobody else's business. It is why a moment is never shared, never voted on and
 * never reaches the server: when you want it to exist for other people you cut
 * it, which is what `/creator/:id` has always been for.
 *
 * ⚠️ **`at` already carries the reaction lag.** Nobody presses the button while
 * the funny thing is happening — they press two to eight seconds after it — so
 * `mark()` stores the position minus `REACTION_LAG_SECONDS`. Everything
 * downstream reads a number that already points at the right place; nothing else
 * in the app subtracts anything.
 */
export interface Moment {
  readonly episodeId: number;
  /** Seconds into the episode, whole, `>= 0`. */
  readonly at: number;
  /** When it was marked, epoch milliseconds. Only ever printed. */
  readonly markedAt: number;
  /** The clip published from it, once there is one. See `markAsCut`. */
  readonly clipId?: number;
}

/**
 * How late the button is pressed, in seconds.
 *
 * ⚠️ A **screen decision, not data** — and that is the whole reason `at` is one
 * number rather than a `[start, end]` window. Changing this tomorrow changes
 * where new marks land and touches nothing already stored in anybody's browser;
 * a stored window would have frozen the choice in every visitor's
 * `localStorage` the moment they used it.
 */
export const REACTION_LAG_SECONDS = 4;

/** How far before the mark `Escuchar desde aquí` starts. Derived, never stored. */
export const LISTEN_LEAD_SECONDS = 20;

/** How wide the editor opens when a moment is cut. Half either side of `at`. */
export const CUT_WINDOW_SECONDS = 40;

/**
 * Two marks closer than this are the same laugh pressed twice.
 *
 * ⚠️ Refusing is what a pin one pixel wide is worth: at 2 h 03 on a 1100 px map,
 * ten seconds is 1,5 px, so the second alfiler would be drawn on top of the
 * first and neither could be hit. `mark()` answers `too-close` and the caller
 * says so instead of silently doing nothing.
 */
export const MIN_GAP_SECONDS = 10;

/**
 * The caps, and why there are two.
 *
 * `localStorage` is 5–10 MB per origin **shared** with the queue, the voter
 * token and the consent decision, so an unbounded list here is a way to break
 * the other three. 200 moments is roughly 20 KB; nobody reaches it, and the
 * one who does loses their oldest mark rather than their queue.
 */
export const MAX_MOMENTS = 200;
export const MAX_MOMENTS_PER_EPISODE = 50;

/**
 * ⚠️ The sixth `localStorage` key, joining `gravindex.voter-token`,
 * `gravindex.analytics-consent`, `gravindex.list-limit.<id>` and
 * `gravindex.queue`.
 */
const STORAGE_KEY = 'gravindex.moments';

/**
 * What `mark()` answers.
 *
 * ⚠️ `evicted` is reported rather than swallowed: dropping somebody's oldest
 * mark without telling them is exactly the kind of quiet data loss this project
 * does not do. (It used to cite `queue.store.ts` on "the queue that
 * half-remembers"; that note is gone — the queue stores the playback position
 * now, under an invariant rather than a refusal. See `StoredQueue`.)
 */
export type MarkOutcome =
  | { readonly status: 'marked'; readonly moment: Moment; readonly evicted: number }
  /** Already marked. `moment` is the mark that was already there. */
  | { readonly status: 'too-close'; readonly moment: Moment };

/** Where `Escuchar desde aquí` starts the episode. Clamped at the beginning. */
export function listenFrom(moment: Moment): number {
  return Math.max(0, moment.at - LISTEN_LEAD_SECONDS);
}

/**
 * The window the editor opens with, `CUT_WINDOW_SECONDS` wide around the mark.
 *
 * ⚠️ **It is a starting point, not an answer.** The three handles move exactly
 * as they always have; all this does is stop the visitor from hunting for the
 * spot they already marked. `length` clamps the tail for a mark near the end of
 * a measured episode; `0` means nobody knows the length yet, and then nothing is
 * clamped — the editor's own `canplay` will.
 */
export function cutWindow(moment: Moment, length = 0): { start: number; end: number } {
  const half = Math.floor(CUT_WINDOW_SECONDS / 2);
  const start = Math.max(0, moment.at - half);
  const end = length > 0 ? Math.min(length, moment.at + half) : moment.at + half;
  return { start, end };
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

/** `unknown` → a moment, or `null`. Anything that does not parse is dropped
 *  rather than repaired: this value is hand-edited more often than one thinks,
 *  and half a moment is worse than none. */
function toStoredMoment(value: unknown): Moment | null {
  if (typeof value !== 'object' || value === null) return null;

  const record = value as {
    episodeId?: unknown;
    at?: unknown;
    markedAt?: unknown;
    clipId?: unknown;
  };
  const { episodeId, at, markedAt, clipId } = record;

  if (!Number.isInteger(episodeId) || (episodeId as number) <= 0) return null;
  if (!Number.isInteger(at) || (at as number) < 0) return null;

  const moment: Moment = {
    episodeId: episodeId as number,
    at: at as number,
    // A missing or nonsense timestamp is not worth dropping the mark over: it
    // is only ever printed, and `0` reads as "hace mucho", not as an error.
    markedAt: typeof markedAt === 'number' && Number.isFinite(markedAt) ? markedAt : 0,
  };

  return Number.isInteger(clipId) && (clipId as number) > 0
    ? { ...moment, clipId: clipId as number }
    : moment;
}

function readStored(): Moment[] {
  const storage = resolveStorage();
  if (storage === null) return [];

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return [];

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];

    const { moments } = parsed as { moments?: unknown };
    if (!Array.isArray(moments)) return [];

    return moments
      .map(toStoredMoment)
      .filter((moment): moment is Moment => moment !== null)
      .sort(byPosition);
  } catch {
    // Corrupt JSON, a quota error, a storage that throws on read. No moments is
    // a working app; a throw at module scope is a blank page.
    return [];
  }
}

function writeStored(moments: readonly Moment[]): void {
  const storage = resolveStorage();
  if (storage === null) return;

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ moments }));
  } catch {
    // Private windows, a full quota, storage disabled. The marks still work for
    // this session — they just will not survive a reload, which is the same
    // outcome as never having made one.
  }
}

/** Episode first, then position. The order the list and the map both draw. */
function byPosition(a: Moment, b: Moment): number {
  return a.episodeId === b.episodeId ? a.at - b.at : a.episodeId - b.episodeId;
}

/**
 * Everybody's own moments, and nobody else's.
 *
 * ⚠️ **This store never talks to the server, and that is the decision rather
 * than a shortcut** (2026-08-26). A moment says *which episode, at which second,
 * on which day you were listening*: a trail of when somebody laughed, which is
 * more personal than the vote this project already refuses to attach to a
 * person. The database was deliberately born without a single personal column
 * (root `CLAUDE.md`, "Identity"), and putting this in it would undo that to buy
 * nothing — the only identity available is `X-Voter-Token`, which lives in this
 * same `localStorage`, so clearing site data would take the marks with it
 * either way.
 *
 * ⚠️ **Losing them is therefore normal, exactly like losing the voter token.**
 * A private window, a second browser and cleared storage all start empty. The
 * screens say so out loud ("solo en este navegador") instead of pretending
 * otherwise.
 */
export const useMomentsStore = defineStore('moments', () => {
  /** Every moment, sorted by `byPosition`. The sort is an invariant: the map's
   *  lane and the list under it both render straight out of this. */
  const moments = ref<Moment[]>(readStored());

  const total = computed(() => moments.value.length);
  const hasAny = computed(() => moments.value.length > 0);

  /** The episodes with at least one mark. ⚠️ Ids only — the episode list's
   *  `Con mis momentos` filter resolves them against the API rather than
   *  storing a copy of a title that an admin could rename tomorrow. */
  const episodeIds = computed((): number[] => [
    ...new Set(moments.value.map((moment) => moment.episodeId)),
  ]);

  const episodeCount = computed(() => episodeIds.value.length);

  function persist(): void {
    writeStored(moments.value);
  }

  /** One episode's marks, in order. */
  function forEpisode(episodeId: number): Moment[] {
    return moments.value.filter((moment) => moment.episodeId === episodeId);
  }

  function countFor(episodeId: number): number {
    return forEpisode(episodeId).length;
  }

  /**
   * Mark the moment being listened to.
   *
   * `seconds` is the playhead as the player reads it; the lag comes off here so
   * no caller has to remember it.
   */
  function mark(episodeId: number, seconds: number): MarkOutcome {
    const at = Math.max(0, Math.round(seconds) - REACTION_LAG_SECONDS);

    const existing = moments.value.find(
      (moment) => moment.episodeId === episodeId && Math.abs(moment.at - at) < MIN_GAP_SECONDS,
    );
    if (existing !== undefined) return { status: 'too-close', moment: existing };

    const moment: Moment = { episodeId, at, markedAt: Date.now() };
    const next = [...moments.value, moment].sort(byPosition);

    // ⚠️ The per-episode cap first, then the global one, and both drop the
    // OLDEST mark rather than refusing the new one: the mark somebody just made
    // is the one they are looking at.
    const evicted =
      dropOldest(next, (candidate) => candidate.episodeId === episodeId, MAX_MOMENTS_PER_EPISODE) +
      dropOldest(next, () => true, MAX_MOMENTS);

    moments.value = next;
    persist();
    return { status: 'marked', moment, evicted };
  }

  function remove(episodeId: number, at: number): void {
    const next = moments.value.filter(
      (moment) => !(moment.episodeId === episodeId && moment.at === at),
    );
    if (next.length === moments.value.length) return;

    moments.value = next;
    persist();
  }

  /**
   * Remember that a clip was published from this mark.
   *
   * ⚠️ **The mark survives the cut** — the accepted answer of three (2026-08-26).
   * Deleting it would be tidier and loses the thread the moment it matters: an
   * admin deleting an ugly cut would leave nothing behind, and the person who
   * marked it would have no way back to the second they found. What it costs is
   * this one field, and a row that says `ya es el corte nº 137` instead of
   * offering to cut the same thing twice.
   */
  function markAsCut(episodeId: number, at: number, clipId: number): void {
    let changed = false;
    const next = moments.value.map((moment) => {
      if (moment.episodeId !== episodeId || moment.at !== at || moment.clipId === clipId) {
        return moment;
      }
      changed = true;
      return { ...moment, clipId };
    });

    if (!changed) return;
    moments.value = next;
    persist();
  }

  return {
    moments,
    total,
    hasAny,
    episodeIds,
    episodeCount,
    forEpisode,
    countFor,
    mark,
    remove,
    markAsCut,
  };
});

/**
 * Drop the oldest marks of `list` (in place) until at most `max` of them match.
 * Returns how many went.
 *
 * ⚠️ Oldest by `markedAt`, not by position in the episode: the cap is about how
 * long ago you cared, and a mark at 00:03 is not older than one at 02:59.
 */
function dropOldest(list: Moment[], matches: (moment: Moment) => boolean, max: number): number {
  let evicted = 0;

  while (list.filter(matches).length > max) {
    const oldest = list
      .filter(matches)
      .reduce((worst, candidate) => (candidate.markedAt < worst.markedAt ? candidate : worst));
    list.splice(list.indexOf(oldest), 1);
    evicted += 1;
  }

  return evicted;
}
