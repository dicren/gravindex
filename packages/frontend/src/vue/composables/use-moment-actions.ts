import type { RouteLocationRaw } from 'vue-router';

import { useNotificationsStore } from '@/stores/notifications.store';
import { cutWindow, useMomentsStore, type Moment } from '@/stores/moments.store';
import { formatClipTime } from '@/utils/format-time';

/**
 * Marking and unmarking a moment, in one place — the same reason
 * `use-clip-actions.ts` exists.
 *
 * ⚠️ **Two screens press the same button**: the global player, which is where
 * the episode is actually sounding, and the episode's own transport, which is
 * where you are looking at the wave. Neither owns the behaviour, and the copy
 * they raise has to be the same words.
 *
 * ⚠️ **Playing and cutting are NOT here.** Playing needs the `QueuedEpisode`
 * the screen already built, and cutting is a navigation the screen owns; what
 * they share is the arithmetic, which lives in `stores/moments.store.ts`
 * (`listenFrom`, `cutWindow`) rather than being copied into two views.
 */
export interface UseMomentActionsReturn {
  /** Mark the second being listened to. Raises the notice; returns nothing,
   *  because every caller does the same thing with the outcome. */
  readonly mark: (episodeId: number, seconds: number) => void;
  /** Forget one. ⚠️ One click, no confirmation — see the note on the function. */
  readonly remove: (moment: Moment) => void;
  /** `/creator/:id` opened on the window around a mark. */
  readonly cutRoute: (moment: Moment, episodeLength?: number) => RouteLocationRaw;
}

export function useMomentActions(): UseMomentActionsReturn {
  const moments = useMomentsStore();
  const notifications = useNotificationsStore();

  function mark(episodeId: number, seconds: number): void {
    const outcome = moments.mark(episodeId, seconds);

    if (outcome.status === 'too-close') {
      // ⚠️ Not an error: pressing twice at the same laugh is a perfectly
      // reasonable thing to do, and the answer is "ya lo tienes", not a red
      // notice. Same shape as the repeated vote, which is also a 201.
      notifications.push({
        level: 'info',
        text: `Ese momento ya estaba marcado, en ${formatClipTime(outcome.moment.at, true)}.`,
      });
      return;
    }

    notifications.push({
      level: 'success',
      title: `Momento marcado en ${formatClipTime(outcome.moment.at, true)}`,
      // ⚠️ The lag is stated rather than hidden. The number on screen is four
      // seconds behind the one the player was showing when the button went
      // down, and somebody who is not told that reads it as a bug.
      text:
        outcome.evicted > 0
          ? 'Guardado unos segundos antes de pulsar. Se ha soltado el más antiguo para hacerle sitio.'
          : 'Guardado unos segundos antes de pulsar, que es cuando pasó.',
    });
  }

  /**
   * ⚠️ **One click and it is gone — no dialog, no undo, and the notice is what
   * makes that fair.** It names the exact second, so a mis-click is undone by
   * listening from there and pressing the button again. A modal for a private
   * bookmark would weigh more than the thing it is protecting, and the admin's
   * confirmation dialog is for deleting something that belongs to everybody.
   */
  function remove(moment: Moment): void {
    moments.remove(moment.episodeId, moment.at);
    notifications.push({
      level: 'info',
      text: `Momento de ${formatClipTime(moment.at, true)} borrado.`,
    });
  }

  function cutRoute(moment: Moment, episodeLength = 0): RouteLocationRaw {
    const window = cutWindow(moment, episodeLength);
    return {
      name: 'creator',
      params: { title: String(moment.episodeId) },
      // ⚠️ `moment` is what lets the editor mark the right mark as cut once the
      // clip is published: the window can be dragged anywhere before saving, so
      // the start it arrived with is no longer an identifier by then.
      query: { start: String(window.start), end: String(window.end), moment: String(moment.at) },
    };
  }

  return { mark, remove, cutRoute };
}
