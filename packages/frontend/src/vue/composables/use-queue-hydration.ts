import { watch } from 'vue';

import { getClipUseCase } from '#/config/clips.config';
import { getEpisodeUseCase } from '#/config/episodes.config';
import { NotFoundError } from '#/domain/errors';
import {
  clipIdOf,
  useQueueStore,
  type QueuedClip,
  type QueuedEpisode,
  type QueueKey,
} from '@/stores/queue.store';

/**
 * Turn the ids in `localStorage` back into clips.
 *
 * The queue persists **ids only** — no titles, no audio URLs (see
 * `queue.store.ts`) — so on a cold load the store knows the order and nothing
 * else. This resolves the gap, once per id, and it is mounted once from the
 * shell.
 *
 * ⚠️ **An id that no longer resolves is dropped silently.** A clip removed
 * through the admin surface must not leave a 404 in somebody's queue, and it
 * must not raise a toast either: the visitor did nothing wrong, and there is
 * nothing for them to do about it. Only a genuine `NOT_FOUND` drops the id —
 * a network failure leaves it in place, so a queue does not evaporate because
 * the connection blinked while the page was loading.
 *
 * ⚠️ **Deliberately not a Pinia Colada query**, which is the default everywhere
 * else in this layer. Three reasons, and the first is the real one:
 *
 *  1. it is a one-shot resolution of ids the store already owns, not a
 *     cacheable read keyed by a filter — there is no key that would mean
 *     anything, and re-keying on "the ids I have not resolved yet" makes the
 *     entry churn on every enqueue;
 *  2. a partial failure is the normal case and has to stay invisible, while a
 *     Colada entry's job is to surface exactly that as an error state;
 *  3. nothing renders from its result. The store is what the player and `/cola`
 *     read; this only fills it in.
 *
 * The clip permalink DOES go through Colada, so a queued clip whose page has
 * been opened is served from that cache rather than fetched twice — this only
 * ever runs for ids no screen has shown.
 */
export function useQueueHydration(): void {
  const queue = useQueueStore();
  /** Keys already asked about, so a failed fetch is not retried on every tick. */
  const attempted = new Set<QueueKey>();

  /**
   * ⚠️ **An episode is resolved from `GET /episodes/:id` alone, so it comes back
   * with no length** (`end: 0`). Asking for its waveform as well would be a
   * second request per queued episode purely to fill in a number the browser
   * hands over for free the moment it plays it — see `PlayableItem.end`. The
   * screen that draws the waveform asks for it; the queue does not need to.
   */
  async function resolve(key: QueueKey): Promise<void> {
    if (attempted.has(key)) return;
    attempted.add(key);

    const clipId = clipIdOf(key);

    try {
      if (clipId !== null) {
        const clip = await getClipUseCase.execute(clipId);
        queue.remember(toQueuedClip(clip));
      } else {
        const episode = await getEpisodeUseCase.execute(Number(key.slice(1)));
        queue.remember(toQueuedEpisode(episode, 0));
      }
    } catch (error) {
      // ⚠️ Only a 404 removes the key. Anything else — offline, a 500, an
      // aborted request — leaves the queue as it is and the key simply stays
      // unresolved until the next load.
      if (error instanceof NotFoundError) {
        queue.forget(key);
        return;
      }
      // Allow a retry on the next boot rather than remembering the failure.
      attempted.delete(key);
    }
  }

  function hydrate(): void {
    for (const key of queue.keys) {
      if (!queue.entries.has(key)) void resolve(key);
    }
  }

  // `immediate`, and then again whenever keys arrive from a shared link.
  watch(() => queue.keys, hydrate, { immediate: true });
}

/**
 * `Clip` → the structural record the queue holds.
 *
 * ⚠️ `src` is the EPISODE's mp3: a clip has no audio file of its own, which is
 * the fact the whole app is built on.
 */
export function toQueuedClip(clip: {
  id: number;
  title: string;
  start: number;
  end: number;
  up: number;
  episode: { id: number; title: string; cover: string; file: string };
}): QueuedClip {
  return {
    kind: 'clip',
    id: clip.id,
    title: clip.title,
    start: clip.start,
    end: clip.end,
    src: clip.episode.file,
    episodeId: clip.episode.id,
    episodeTitle: clip.episode.title,
    cover: clip.episode.cover,
    up: clip.up,
  };
}

/**
 * `Episode` → the structural record the queue holds.
 *
 * ⚠️ `durationSeconds` is `GET /episodes/:id/waveform`'s `to` where the caller
 * has it and `0` where it does not — the API has no duration field of its own
 * (root `CLAUDE.md`, "Data model": the column exists and is not surfaced). `0`
 * is a working value, not a hole: see `QueuedEpisode.end`.
 */
export function toQueuedEpisode(
  episode: { id: number; title: string; cover: string; file: string },
  durationSeconds: number,
): QueuedEpisode {
  return {
    kind: 'episode',
    id: episode.id,
    title: episode.title,
    end: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0,
    src: episode.file,
    cover: episode.cover,
  };
}
