import { ref, type Ref } from 'vue';
import { useRouter } from 'vue-router';

import { listClipsUseCase } from '#/config/clips.config';
import { useNotificationsStore } from '@/stores/notifications.store';
import { domainErrorNotice } from '@/utils/domain-error-notice';

export interface UseRandomClipReturn {
  readonly loading: Ref<boolean>;
  readonly goToRandomClip: () => Promise<void>;
}

/**
 * The header's `Al azahar` button: jump to one clip picked uniformly at
 * random out of the whole library.
 *
 * ⚠️ There is no `GET /clips/random` — the API answers pages, so this spends
 * two reads: one `limit=1` call to learn `total`, then a second `limit=1` call
 * at a page drawn from `[1, total]`. At this project's scale (root
 * `AGENTS.md`: 180 clips) that is two trivial queries, not a search worth
 * optimising away.
 */
export function useRandomClip(): UseRandomClipReturn {
  const router = useRouter();
  const notifications = useNotificationsStore();
  const loading = ref(false);

  async function goToRandomClip(): Promise<void> {
    if (loading.value) return;
    loading.value = true;
    try {
      const first = await listClipsUseCase.execute({ page: 1, limit: 1 });
      if (first.total === 0) {
        notifications.push({ level: 'info', text: 'Todavía no hay ningún corte.' });
        return;
      }

      const page = 1 + Math.floor(Math.random() * first.total);
      const chosen = page === 1 ? first : await listClipsUseCase.execute({ page, limit: 1 });
      const clip = chosen.results[0];
      if (!clip) {
        notifications.push({ level: 'info', text: 'Todavía no hay ningún corte.' });
        return;
      }

      await router.push({ name: 'clip', params: { id: clip.id } });
    } catch (error) {
      notifications.push(domainErrorNotice(error));
    } finally {
      loading.value = false;
    }
  }

  return { loading, goToRandomClip };
}
