import type { Episode } from '#/domain/episodes/episode.entity';
import type { Tag } from '#/domain/tags/tag.entity';
import type { VoteCounts, VoteTally } from './vote.entity';

/**
 * A clip is `(episode, start, end, title)` and nothing more — there is no audio
 * file of its own anywhere. `start`/`end` are **whole seconds** into the
 * episode's mp3, which the player seeks to and stops at.
 *
 * This is the `GET /clips/:id` shape. ⚠️ **It carries `up`.** The permalink puts
 * a vote button with a count on the page AND in the global player for a clip
 * opened by URL, so the count has to come from the endpoint. Every clip shape in the domain now
 * has a tally, which is why there is no longer a narrowing to go through before
 * rendering one.
 *
 * ⚠️ No `points` here: with every vote positive it would be a second name for
 * `up`. It lives on `ClipListItem` alone, and only because `order=points` is in
 * shared links.
 */
export interface Clip extends VoteTally {
  /** THE public identifier: `https://indice.gravina82.com/<id>` is the permalink.
   *  ⚠️ Ids are shared links in the wild; two of them were deleted by hand years
   *  ago and must go on 404-ing. */
  readonly id: number;
  readonly title: string;
  /** Offset into the episode, in whole seconds. */
  readonly start: number;
  /** Offset into the episode, in whole seconds. */
  readonly end: number;
  readonly episode: Episode;
  readonly tags: readonly Tag[];
}

/** A row of `GET /clips`, which additionally carries the sort key. */
export interface ClipListItem extends Clip, VoteCounts {}

/**
 * A clip as it rides along inside `GET /episodes/:id`: with `up`, but **without
 * `points`** and without its episode (you are already looking at it).
 */
export type EpisodeClip = Omit<Clip, 'episode'>;

/**
 * The common ground of the three shapes: everything a **row** needs to render.
 *
 * ⚠️ `episode` is optional, and that is the whole reason this type exists — an
 * `EpisodeClip` genuinely has none, because the screen showing it already is
 * the episode. `ClipRowItem` takes the episode as a separate prop and falls
 * back to this one.
 */
export type ClipRow = Omit<Clip, 'episode'> & { readonly episode?: Episode };

/**
 * ⚠️ The sort keys are a CLOSED SET, and the type is the point: the backend
 * whitelists exactly these three and answers 400 to anything else (it used to
 * interpolate the value straight into `ORDER BY`, which is why the whitelist
 * exists). A `string` here would make that 400 reachable from the UI.
 *
 * The values are SQL-ish because they are part of the wire contract: the
 * library's sort selector puts them in the URL query string, and those URLs
 * have been shared, so they cannot change.
 */
export const CLIP_ORDERS = ['points', 'clip.createdAt', 'episode.date'] as const;

export type ClipOrder = (typeof CLIP_ORDERS)[number];

/** What the backend falls back to when `order` is absent. */
export const DEFAULT_CLIP_ORDER: ClipOrder = 'points';

/**
 * The result of attaching a tag to a clip.
 *
 * ⚠️ Unlike voting — which answers 201 with an `error` string — a repeated tag
 * really is a 409. Both behaviours are the specification, and both surface here
 * as an outcome rather than an exception, so the two write paths read the same
 * way from a view: `switch (outcome.status)`. `already-present` is a perfectly
 * ordinary thing for a user to do (the tag is right there on the card) and is
 * not worth an error state.
 */
export type AddTagOutcome =
  | { readonly status: 'added'; readonly tag: Tag }
  | { readonly status: 'already-present'; readonly tag: Tag };
