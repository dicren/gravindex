import { ref } from 'vue';

import { downloadClipAudioUseCase } from '#/config/episodes.config';
import type { VoteValue } from '#/domain/clips/vote.entity';
import { useVoteClip } from '@/queries/clips.query';
import { useNotificationsStore } from '@/stores/notifications.store';
import { useQueueStore, type QueuedClip } from '@/stores/queue.store';
import { domainErrorNotice } from '@/utils/domain-error-notice';
import { buildEpisodeUrl } from '@/utils/episode-url';
import { saveFile } from '@/utils/save-file';

/**
 * The four things you can do to a clip, in one place.
 *
 * ⚠️ **They are shared because the design shares them.** Vote, share, download
 * and queue appear on the library row, the queue row, the clip permalink and
 * the global player — four components, one behaviour each.
 */

/** The one vote there is. See `vote.entity.ts` for why it is not a parameter. */
const UP: VoteValue = 1;

export interface UseClipActionsReturn {
  readonly voting: import('vue').Ref<boolean>;
  readonly vote: (clipId: number) => Promise<void>;
  readonly share: (clipId: number) => Promise<void>;
  /** ⚠️ Its own action rather than a parameter on `share`: an episode's URL is
   *  built from a title as well as an id, and the two shapes have nothing else
   *  in common. */
  readonly shareEpisode: (episode: { id: number; title: string }) => Promise<void>;
  readonly download: (clip: QueuedClip) => Promise<void>;
  /** ⚠️ Per CLIP, not a single flag — `QueueView.vue` renders every row off
   *  ONE `useClipActions()` call, so a plain boolean would light up every
   *  row's button while any one of them was downloading. */
  readonly isDownloading: (clipId: number) => boolean;
  readonly queue: (clip: QueuedClip) => void;
  readonly isQueued: (clipId: number) => boolean;
}

/** The permalink, which is what the share button copies and what the backend's
 *  social-preview tags point at. ⚠️ `/<id>` — the shape people have been
 *  sharing since 2019. */
export function clipShareUrl(clipId: number): string {
  return `${window.location.origin}/${clipId}`;
}

/** `/episode/<id>-<slug>`. ⚠️ The slug is decoration — the router parses the
 *  leading integer and nothing else — but it is what every episode link on this
 *  site looks like, so a shared one must not be the odd one out. */
export function episodeShareUrl(episode: { id: number; title: string }): string {
  return `${window.location.origin}/episode/${buildEpisodeUrl(episode)}`;
}

export function useClipActions(): UseClipActionsReturn {
  const notifications = useNotificationsStore();
  const queueStore = useQueueStore();
  const voteClip = useVoteClip();

  /** One vote at a time, per component. Double-clicking the thumb used to fire
   *  two requests, of which the second always answered "already voted". */
  const voting = ref(false);

  async function vote(clipId: number): Promise<void> {
    if (voting.value) return;
    voting.value = true;
    try {
      const outcome = await voteClip.mutateAsync({ clipId, value: UP });
      if (outcome.status === 'already-voted') {
        // ⚠️ NOT a failure: the API answers an ordinary 201 and the domain says so.
        notifications.push({ level: 'error', text: '¡No puedes votar dos veces!' });
      }
      // On `recorded` there is nothing to do here — `useVoteClip` has already
      // moved the counters in every cache and in the queue.
    } catch (error) {
      notifications.push(domainErrorNotice(error));
    } finally {
      voting.value = false;
    }
  }

  async function share(clipId: number): Promise<void> {
    try {
      // ⚠️ The modern clipboard API needs no hidden input and no
      // `document.execCommand("copy")`, which is deprecated.
      await navigator.clipboard.writeText(clipShareUrl(clipId));
      notifications.push({
        level: 'success',
        text: 'Enlace copiado. ¡Comparte la palabra gravinera!',
      });
    } catch {
      // Insecure origin, a denied permission, or a browser with no clipboard
      // API. Each of them is reported rather than swallowed.
      notifications.push({ level: 'error', text: 'No se ha podido copiar el enlace.' });
    }
  }

  async function shareEpisode(episode: { id: number; title: string }): Promise<void> {
    try {
      await navigator.clipboard.writeText(episodeShareUrl(episode));
      notifications.push({
        level: 'success',
        text: 'Enlace copiado. ¡Comparte la palabra gravinera!',
      });
    } catch {
      notifications.push({ level: 'error', text: 'No se ha podido copiar el enlace.' });
    }
  }

  /** One download at a time, per clip — the same guard `voting` is, keyed so
   *  a second clip's button is never blocked by the first one's request. */
  const downloadingClipId = ref<number | null>(null);

  /**
   * ⚠️ **Recorded deviation from the accepted design (2026-08-20): this is no
   * longer drawn-and-inert.** The design assumed a real download needed a
   * server-side cut — ffmpeg, a disk cache, the first
   * endpoint in this project to burn CPU and bandwidth per request. It does
   * not: an MP3 is a sequence of independent frames, so a clip is cut by
   * COPYING bytes out of small `Range` reads, entirely in the browser — see
   * `core/application/audio/mp3-frames.ts`. The only thing the backend does is
   * relay those bytes same-origin (`GET /episodes/:id/audio`), because
   * gravina82.com sends no CORS headers; it never touches the audio itself.
   */
  async function download(clip: QueuedClip): Promise<void> {
    if (downloadingClipId.value !== null) return;
    downloadingClipId.value = clip.id;
    try {
      const file = await downloadClipAudioUseCase.execute({
        episodeId: clip.episodeId,
        episodeTitle: clip.episodeTitle,
        clipTitle: clip.title,
        start: clip.start,
        end: clip.end,
      });
      saveFile(file.bytes, file.filename, 'audio/mpeg');
    } catch (error) {
      notifications.push(domainErrorNotice(error));
    } finally {
      downloadingClipId.value = null;
    }
  }

  function queue(clip: QueuedClip): void {
    queueStore.enqueue(clip);
  }

  return {
    voting,
    vote,
    share,
    shareEpisode,
    download,
    isDownloading: (clipId: number) => downloadingClipId.value === clipId,
    queue,
    isQueued: (clipId: number) => queueStore.contains(clipId),
  };
}
