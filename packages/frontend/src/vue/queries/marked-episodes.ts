import type { EpisodeListItem } from '#/domain/episodes/episode.entity';
import { getEpisodeUseCase } from '#/config/episodes.config';
import { foldForSearch } from '@/utils/fold-accents';

/**
 * The episodes this browser has marked a moment on, as list rows.
 *
 * ⚠️ **`Con mis momentos` is the one filter the server cannot answer** (root
 * `AGENTS.md`, "Mis momentos"): the marks live in `localStorage` and nothing
 * about them ever reaches the API. So the rows are assembled here, one
 * `GET /episodes/:id` per marked episode.
 *
 * ⚠️ **Shared by the list and the calendar on purpose.** Both need the same
 * thing — every marked episode, ordered like `GET /episodes` orders them — and
 * the two screens drifting apart on what "mis momentos" means is exactly the
 * bug this file exists to prevent. The list then slices a page out of it; the
 * calendar takes the lot.
 *
 * ⚠️ **Every marked episode is fetched, not just a page's worth**, and that is
 * deliberate: the rows have to be ordered by publish date to match every other
 * episode list on the site, and nothing here knows an episode's date until it
 * has asked. It is a handful of requests — the cap is 200 marks over at most
 * that many episodes, and realistically a dozen.
 *
 * ⚠️ **An id the API refuses is dropped rather than failing the screen.**
 * Episodes are never deleted, but a mark can outlive anything, and a whole
 * screen erroring over one stale id would be the wrong trade.
 */
export async function fetchMarkedEpisodes(
  episodeIds: readonly number[],
  search: string,
  signal?: AbortSignal,
): Promise<EpisodeListItem[]> {
  if (episodeIds.length === 0) return [];

  const found = await Promise.all(
    episodeIds.map((id) =>
      getEpisodeUseCase
        .execute(id, signal)
        .then((episode): EpisodeListItem => {
          const { clips, ...rest } = episode;
          return { ...rest, clipCount: clips.length };
        })
        .catch(() => null),
    ),
  );

  // ⚠️ The search runs HERE, folded, because there is no request to put it on.
  // It matches the episode title and nothing else — the same narrowness
  // `GET /episodes?search=` has, so the hint under the box stays true in both
  // modes.
  const needle = foldForSearch(search);

  return (
    found
      .filter((episode): episode is EpisodeListItem => episode !== null)
      .filter((episode) => needle === '' || foldForSearch(episode.title).includes(needle))
      // Newest first, with an id tiebreak: what the endpoint answers, reproduced.
      .sort((a, b) => b.date.getTime() - a.date.getTime() || b.id - a.id)
  );
}
