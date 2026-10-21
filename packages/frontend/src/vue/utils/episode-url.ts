import type { Episode } from '#/domain/episodes/episode.entity';

/**
 * The `"<id>-<slug>"` form of `/episode/:title`.
 *
 * ⚠️ **The algorithm is frozen.** These URLs have been shared since 2019 and
 * the router only ever parses the leading integer back out, so the slug is
 * decoration — but changing how it is spelled would make every link the site
 * generates from now on differ from every link already in the wild, for no gain.
 * Strip everything that is not ASCII alphanumeric or a space, then turn spaces
 * into hyphens. Accents simply vanish (`Episodio 12 (Spanish Zombies)` becomes
 * `12-Episodio-12-Spanish-Zombies`), runs of hyphens are not collapsed, and the
 * case is left alone. All of that is kept on purpose, character for character.
 *
 * It lives in `vue/` and not in `core/` on purpose: the slug is a routing
 * concern, and `core/domain/episodes/episode.repository.ts` says so — the
 * repository takes a numeric id and has never heard of a slug.
 */
export function buildEpisodeUrl(episode: Pick<Episode, 'id' | 'title'>): string {
  const slug = episode.title.replace(/[^a-zA-Z0-9 ]/g, '').replace(/ /g, '-');
  return `${episode.id}-${slug}`;
}
