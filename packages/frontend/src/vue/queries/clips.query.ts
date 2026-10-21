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
  addTagUseCase,
  createClipUseCase,
  getClipUseCase,
  listClipsUseCase,
  listRelatedClipsUseCase,
  registerPlayUseCase,
  voteClipUseCase,
} from '#/config/clips.config';
import type { AddTagInput } from '#/application/clips/add-tag.use-case';
import type { VoteClipInput } from '#/application/clips/vote-clip.use-case';
import type { AddTagOutcome, Clip, ClipListItem, EpisodeClip } from '#/domain/clips/clip.entity';
import type { ClipListQuery, ClipPage, NewClip } from '#/domain/clips/clip.repository';
import { applyVote, type VoteOutcome } from '#/domain/clips/vote.entity';
import type { EpisodeDetail } from '#/domain/episodes/episode.entity';
import type { DomainError } from '#/domain/errors';
import { clipKey, useQueueStore } from '@/stores/queue.store';
import { abortable } from './abortable';
import { clipKeys, episodeKeys, tagKeys } from './query-keys';

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * A page of the library.
 *
 * An options **factory**, not a composable, so `useFilteredList` can pass a
 * filter that changes: `useQuery(() => clipListQueryOptions(effective))`
 * re-keys and refetches by itself, and cancels the request it is replacing.
 *
 * ⚠️ That cancellation is only real because of `abortable`: Colada's signal
 * has to be *taken* and handed to the use case. Dropping it — `query: () =>
 * listClipsUseCase.execute(query)` — compiles, works, and leaves every
 * superseded search running to completion. The e2e suite measures it
 * (`test/e2e/specs/03-cancellation.spec.ts`), because nothing on screen can.
 */
export function clipListQueryOptions(
  query: ClipListQuery,
): DefineQueryOptions<ClipPage, DomainError> {
  return {
    key: clipKeys.list(query),
    query: abortable((signal) => listClipsUseCase.execute(query, signal)),
  };
}

/**
 * One clip by the id in its permalink.
 *
 * ⚠️ It carries `up`, because the permalink and the global player both draw a
 * vote count for a clip opened by URL and there is no other source for it.
 *
 * ⚠️ It carries no `points` — `points` is a `GET /clips` column — but it IS
 * patched on a vote now that it has a count to patch. See `applyVoteToCaches`.
 */
export function clipQueryOptions(clipId: number): DefineQueryOptions<Clip, DomainError> {
  return {
    key: clipKeys.detail(clipId),
    query: abortable((signal) => getClipUseCase.execute(clipId, signal)),
  };
}

export function useClipList(query: () => ClipListQuery): UseQueryReturn<ClipPage, DomainError> {
  return useQuery<ClipPage, DomainError>(() => clipListQueryOptions(query()));
}

export function useClip(clipId: () => number): UseQueryReturn<Clip, DomainError> {
  return useQuery<Clip, DomainError>(() => clipQueryOptions(clipId()));
}

/**
 * `Relacionados · comparten tag` — up to six clips sharing a tag with this one.
 *
 * ⚠️ The ORDER is the server's and is the whole reason this is an endpoint:
 * most clips carry a single tag, so resolving it in the browser with
 * `GET /clips?tags[]=` would rank by whatever the default sort produced. Nothing
 * here re-sorts or truncates.
 */
export function relatedClipsQueryOptions(
  clipId: number,
): DefineQueryOptions<ClipListItem[], DomainError> {
  return {
    key: clipKeys.related(clipId),
    query: abortable((signal) => listRelatedClipsUseCase.execute(clipId, signal)),
  };
}

export function useRelatedClips(clipId: () => number): UseQueryReturn<ClipListItem[], DomainError> {
  return useQuery<ClipListItem[], DomainError>(() => relatedClipsQueryOptions(clipId()));
}

// ── The optimistic vote ──────────────────────────────────────────────────────

function isClipPage(value: unknown): value is ClipPage {
  if (typeof value !== 'object' || value === null) return false;
  const page = value as { results?: unknown; total?: unknown };
  return Array.isArray(page.results) && typeof page.total === 'number';
}

/**
 * ⚠️ **A list entry holds one of TWO shapes, and forgetting the second is a
 * silent bug.** Every public list is a Colada `useInfiniteQuery`, whose entry
 * data is `{ pages, pageParams }` — every batch loaded so far under one key —
 * while the admin clip list is still an ordinary `useQuery` holding a single
 * `ClipPage`. Both live under `['clips', 'list', …]`.
 *
 * This was found by the code failing to do anything: a patch written for the
 * page shape alone type-checks, passes its own test against `useClipList`, and
 * then does nothing at all on the library — the one screen where most votes are
 * cast — because `isClipPage({ pages: […] })` is false and the loop skips it.
 * The vote would land on the server and the number under the thumb would not
 * move until the next refetch.
 */
interface InfiniteClipPages {
  pages: ClipPage[];
}

function isInfiniteClipPages(value: unknown): value is InfiniteClipPages {
  if (typeof value !== 'object' || value === null) return false;
  const data = value as { pages?: unknown };
  return Array.isArray(data.pages) && data.pages.every(isClipPage);
}

function isClip(value: unknown): value is Clip {
  if (typeof value !== 'object' || value === null) return false;
  const clip = value as { id?: unknown; up?: unknown };
  return typeof clip.id === 'number' && typeof clip.up === 'number';
}

function isEpisodeDetail(value: unknown): value is EpisodeDetail {
  if (typeof value !== 'object' || value === null) return false;
  const episode = value as { clips?: unknown; id?: unknown };
  return Array.isArray(episode.clips) && typeof episode.id === 'number';
}

/** ⚠️ `points` is not stored anywhere — the backend computes it per request —
 *  and with every vote positive it is the same number as `up`. Patching one
 *  without the other would leave the default sort key disagreeing with the
 *  count printed beside it. */
function withVote(clip: ClipListItem, outcome: VoteOutcome): ClipListItem {
  const tally = applyVote(clip, outcome);
  return { ...clip, ...tally, points: tally.up };
}

/**
 * Move the counters to where the server says they now are — **without
 * refetching anything**.
 *
 * ⚠️ **Four caches, not two.** A vote count is drawn on the clip permalink, in
 * the related strip and in the global player, so a vote cast from
 * any of them has to move every copy of that clip on screen. The player reads
 * its number from the queue store, which is patched by `useVoteClip` — a Pinia
 * store is not a query cache and cannot be walked from here.
 *
 * ⚠️ This is the one deliberate exception to "writes invalidate"
 * (`packages/frontend/CLAUDE.md`, "Where Pinia Colada lives"). The counts are
 * adjusted from the response's `{ add, delete }`, and the site has felt instant
 * ever since; refetching a whole page of clips to
 * learn that one number went up by one would be a visible regression, on the
 * single most-used control in the app.
 *
 * It is not a guess, either — `add`/`delete` are what the server *did*, so
 * `applyVote` is arithmetic on a known result, not an optimistic prediction
 * that might need rolling back. A repeated vote comes back as `already-voted`
 * and `applyVote` correctly changes nothing.
 *
 * Four kinds of entry are patched, and the first one holds two different
 * shapes: `['clips','list',…]` (a Colada infinite `{ pages }` on every public
 * screen, a single `ClipPage` on the admin one — see `isInfiniteClipPages`),
 * `['clips','related',…]` (a bare array of rows), `['clips','detail',…]` (one
 * clip, which carries a count) and
 * `['episodes','detail',…]` (an episode's own clips).
 */
export function applyVoteToCaches(
  queryCache: QueryCache,
  clipId: number,
  outcome: VoteOutcome,
): void {
  if (outcome.status === 'already-voted') return;

  for (const entry of queryCache.getEntries({ key: clipKeys.lists() })) {
    const data = entry.state.value.data;

    // The infinite lists — every public screen. One entry, N batches.
    if (isInfiniteClipPages(data)) {
      if (!data.pages.some((page) => page.results.some((clip) => clip.id === clipId))) continue;

      queryCache.setQueryData<InfiniteClipPages>(entry.key, {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          results: page.results.map((clip) =>
            clip.id === clipId ? withVote(clip, outcome) : clip,
          ),
        })),
      });
      continue;
    }

    // The single-page shape, which only the admin clip list still uses.
    if (!isClipPage(data)) continue;
    if (!data.results.some((clip) => clip.id === clipId)) continue;

    queryCache.setQueryData<ClipPage>(entry.key, {
      ...data,
      results: data.results.map((clip) => (clip.id === clipId ? withVote(clip, outcome) : clip)),
    });
  }

  // The `Relacionados` strip: bare arrays of list rows, one entry per clip
  // whose permalink has been opened this session.
  for (const entry of queryCache.getEntries({ key: ['clips', 'related'] })) {
    const related = entry.state.value.data;
    if (!Array.isArray(related)) continue;
    if (!related.some((clip: ClipListItem) => clip.id === clipId)) continue;

    queryCache.setQueryData<ClipListItem[]>(
      entry.key,
      related.map((clip: ClipListItem) => (clip.id === clipId ? withVote(clip, outcome) : clip)),
    );
  }

  // ⚠️ The permalink's own entry. It carries `up` (and no `points`), so without
  // this loop voting from the permalink moves every number on the page except
  // the one under the button that was pressed.
  const detail = queryCache.getEntries({ key: clipKeys.detail(clipId) })[0];
  const clip = detail?.state.value.data;
  if (detail && isClip(clip)) {
    queryCache.setQueryData<Clip>(detail.key, { ...clip, ...applyVote(clip, outcome) });
  }

  for (const entry of queryCache.getEntries({ key: episodeKeys.details() })) {
    const episode = entry.state.value.data;
    if (!isEpisodeDetail(episode)) continue;
    if (!episode.clips.some((clip) => clip.id === clipId)) continue;

    queryCache.setQueryData<EpisodeDetail>(entry.key, {
      ...episode,
      clips: episode.clips.map((clip): EpisodeClip =>
        clip.id === clipId ? { ...clip, ...applyVote(clip, outcome) } : clip,
      ),
    });
  }
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Vote a clip up or down.
 *
 * ⚠️ Invalidates **nothing**. See `applyVoteToCaches`.
 *
 * A repeated vote resolves as `{ status: 'already-voted' }` rather than
 * rejecting — the API answers an ordinary 201 with an `error` string, and the
 * UI shows it as a notice. `error` here means the request failed for real.
 */
export function useVoteClip(): UseMutationReturn<VoteOutcome, VoteClipInput, DomainError> {
  const queryCache = useQueryCache();
  const queue = useQueueStore();

  return useMutation<VoteOutcome, VoteClipInput, DomainError>({
    mutation: (input) => voteClipUseCase.execute(input),
    onSuccess: (outcome, input) => {
      applyVoteToCaches(queryCache, input.clipId, outcome);

      // ⚠️ The queue is a Pinia store, not a query cache, so it cannot be
      // walked by `applyVoteToCaches` — and the player reads its count from
      // there. Without this, voting for the clip that is playing moves the
      // number in the row and leaves the one in the player behind.
      // ⚠️ `clipKey`, not the bare id: the queue is keyed by kind since
      // episodes can be in it, and an episode never has a vote to move.
      const queued = queue.entries.get(clipKey(input.clipId));
      if (queued !== undefined && queued.kind === 'clip') {
        queue.remember({ ...queued, ...applyVote(queued, outcome) });
      }
    },
  });
}

/**
 * Attach a tag to a clip.
 *
 * ⚠️ Invalidates on `added` only. `already-present` means the server changed
 * nothing, so refetching would spend two requests to redraw identical data —
 * and the tag the user typed is already on the card in front of them.
 *
 * Three keys move when a tag lands: the library's pages and the clip permalink
 * both render a clip's tags, and `GET /tags` gains an entry when the tag is new
 * to the whole site.
 */
export function useAddTag(): UseMutationReturn<AddTagOutcome, AddTagInput, DomainError> {
  const queryCache = useQueryCache();

  return useMutation<AddTagOutcome, AddTagInput, DomainError>({
    mutation: (input) => addTagUseCase.execute(input),
    onSuccess: async (outcome) => {
      if (outcome.status !== 'added') return;
      await Promise.all([
        queryCache.invalidateQueries({ key: clipKeys.all() }),
        queryCache.invalidateQueries({ key: episodeKeys.details() }),
        queryCache.invalidateQueries({ key: tagKeys.all() }),
      ]);
    },
  });
}

/**
 * Publish a clip cut from an episode.
 *
 * Invalidates the whole clips tree (the new clip belongs on some page of the
 * library, and which one depends on the sort), the episode it was cut from —
 * whose page lists its clips — and the tag list, since the editor can mint tags
 * nobody has used before.
 *
 * ⚠️ Not the episode *list*: those rows carry no clips.
 */
export function useCreateClip(): UseMutationReturn<Clip, NewClip, DomainError> {
  const queryCache = useQueryCache();

  return useMutation<Clip, NewClip, DomainError>({
    mutation: (draft) => createClipUseCase.execute(draft),
    onSuccess: async (_clip, draft) => {
      await Promise.all([
        queryCache.invalidateQueries({ key: clipKeys.all() }),
        queryCache.invalidateQueries({ key: episodeKeys.detail(draft.episodeId) }),
        queryCache.invalidateQueries({ key: tagKeys.all() }),
      ]);
    },
  });
}

/**
 * The play counter.
 *
 * ⚠️ Invalidates nothing and reports nothing: one `playback` row is appended
 * and no screen in the app has ever read that table back. The use case swallows
 * its own failures for the same reason — a lost counter must not interrupt the
 * audio (see `RegisterPlayUseCase`).
 */
export function useRegisterPlay(): UseMutationReturn<void, number, DomainError> {
  return useMutation<void, number, DomainError>({
    mutation: (clipId) => registerPlayUseCase.execute(clipId),
  });
}
