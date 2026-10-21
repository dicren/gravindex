import {
  useMutation,
  useQuery,
  useQueryCache,
  type DefineQueryOptions,
  type QueryCache,
  type UseMutationReturn,
  type UseQueryReturn,
} from '@pinia/colada';
import {
  deleteAdminClipUseCase,
  getAdminClipUseCase,
  removeClipTagUseCase,
  renameClipTagUseCase,
  updateAdminClipUseCase,
} from '#/config/auth.config';
import type { RemoveClipTagInput } from '#/application/auth/remove-clip-tag.use-case';
import type { RenameClipTagInput } from '#/application/auth/rename-clip-tag.use-case';
import type { UpdateAdminClipInput } from '#/application/auth/update-admin-clip.use-case';
import type { AdminClip } from '#/domain/auth/admin-clip.entity';
import type { DomainError } from '#/domain/errors';
import { abortable } from './abortable';
import { adminKeys, clipKeys, episodeKeys, tagKeys } from './query-keys';

/**
 * The Colada layer over the moderation use cases. Same split as everywhere
 * else: the use cases are plain async functions in `core/`, and the caching,
 * the loading flags and the invalidation live here in `vue/`.
 *
 * ⚠️ **Every write here invalidates the whole public tree, with no optimistic
 * patching.** The vote counters earn their exception because they are the most
 * used control in the app and the server tells us exactly what it did
 * (`clips.query.ts`); a moderation edit is rare, deliberate, and changes text a
 * dozen cached pages may be showing. Refetching is both cheaper to reason about
 * and the only version that cannot leave a deleted clip on screen.
 */

// ── Reads ────────────────────────────────────────────────────────────────────

/** ⚠️ The one read on this screen, so the one query here that is cancellable —
 *  a moderator jumping between clips leaves no request behind. The writes below
 *  are not, and must not become so (see `AdminRepository`). */
export function adminClipQueryOptions(clipId: number): DefineQueryOptions<AdminClip, DomainError> {
  return {
    key: adminKeys.clip(clipId),
    query: abortable((signal) => getAdminClipUseCase.execute(clipId, signal)),
  };
}

export function useAdminClip(clipId: () => number): UseQueryReturn<AdminClip, DomainError> {
  return useQuery<AdminClip, DomainError>(() => adminClipQueryOptions(clipId()));
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Everything a moderation write can be showing somewhere else.
 *
 * ⚠️ `tagKeys` is in the list because removing a clip's last copy of a tag can
 * remove that tag from the whole site — `GET /tags` is a `DISTINCT` over the
 * `tag` table, so the autocomplete's vocabulary genuinely shrinks.
 */
function invalidatePublicCaches(queryCache: QueryCache): Promise<unknown> {
  return Promise.all([
    queryCache.invalidateQueries({ key: clipKeys.all() }),
    queryCache.invalidateQueries({ key: episodeKeys.details() }),
    queryCache.invalidateQueries({ key: tagKeys.all() }),
  ]);
}

/** Edit a clip's title or its cut. A 400 arrives with the server's own message. */
export function useUpdateAdminClip(): UseMutationReturn<
  AdminClip,
  UpdateAdminClipInput,
  DomainError
> {
  const queryCache = useQueryCache();

  return useMutation<AdminClip, UpdateAdminClipInput, DomainError>({
    mutation: (input) => updateAdminClipUseCase.execute(input),
    onSuccess: async (clip) => {
      // The fresh clip is already in hand, so the admin screen does not refetch
      // itself — only the public caches, which cannot know.
      queryCache.setQueryData<AdminClip>(adminKeys.clip(clip.id), clip);
      await invalidatePublicCaches(queryCache);
    },
  });
}

/**
 * Delete a clip, permanently.
 *
 * ⚠️ The cached admin entry is **removed**, not invalidated: invalidating would
 * refetch an id that now 404s and paint an error over a screen that is
 * navigating away. There is nothing left to be stale about.
 */
export function useDeleteAdminClip(): UseMutationReturn<void, number, DomainError> {
  const queryCache = useQueryCache();

  return useMutation<void, number, DomainError>({
    mutation: (clipId) => deleteAdminClipUseCase.execute(clipId),
    onSuccess: async (_result, clipId) => {
      // `get`, not `ensure`: `ensure` would CREATE the entry it is about to
      // remove when there is none.
      const entry = queryCache.get(adminKeys.clip(clipId));
      if (entry !== undefined) queryCache.remove(entry);
      await invalidatePublicCaches(queryCache);
    },
  });
}

/** Rename one tag on one clip. A 409 means the clip already carries the new one. */
export function useRenameClipTag(): UseMutationReturn<AdminClip, RenameClipTagInput, DomainError> {
  const queryCache = useQueryCache();

  return useMutation<AdminClip, RenameClipTagInput, DomainError>({
    mutation: (input) => renameClipTagUseCase.execute(input),
    onSuccess: async (clip) => {
      queryCache.setQueryData<AdminClip>(adminKeys.clip(clip.id), clip);
      await invalidatePublicCaches(queryCache);
    },
  });
}

/** Take a tag off a clip — the abusive-tag half of why this screen exists. */
export function useRemoveClipTag(): UseMutationReturn<void, RemoveClipTagInput, DomainError> {
  const queryCache = useQueryCache();

  return useMutation<void, RemoveClipTagInput, DomainError>({
    mutation: (input) => removeClipTagUseCase.execute(input),
    onSuccess: async (_result, input) => {
      // ⚠️ 204, no body: unlike the rename there is no fresh clip to write in,
      // so this entry really does have to be refetched.
      await queryCache.invalidateQueries({ key: adminKeys.clip(input.clipId) });
      await invalidatePublicCaches(queryCache);
    },
  });
}
