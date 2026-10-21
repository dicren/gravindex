import type { Tag } from '#/domain/tags/tag.entity';

/**
 * A clip as the admin screens see it — the shape of `GET /api/admin/clips/:id`.
 *
 * ⚠️ Deliberately **not** the public `Clip`. No `up`/`down`/`points` (those are
 * aggregated at read time and their absence is a contract of its own — root
 * `AGENTS.md`, "Vote counts are not a column") and no populated episode, only
 * its id. The admin surface is new, and being flat is
 * what keeps it honest: every field here is a field you can edit or delete.
 */
export interface AdminClip {
  readonly id: number;
  readonly title: string;
  /** Offset into the episode's mp3, in whole seconds. */
  readonly start: number;
  /** Offset into the episode's mp3, in whole seconds. */
  readonly end: number;
  readonly episodeId: number;
  readonly tags: readonly Tag[];
}

/**
 * What `PATCH /api/admin/clips/:id` accepts: every field optional, because the
 * real use is fixing one thing — a title someone typed badly, or a cut that
 * starts two seconds late.
 *
 * ⚠️ An absent field means "leave it alone", which is not the same as an empty
 * one. The adapter must omit what is undefined rather than send `null`.
 */
export interface AdminClipChanges {
  readonly title?: string;
  readonly start?: number;
  readonly end?: number;
}

/**
 * Renaming one tag **on one clip**.
 *
 * ⚠️ There is no site-wide rename: a tag is the `(clip, tag)` pair and nothing
 * else (root `AGENTS.md`, "Data model"), so "renaming Zombies everywhere" is
 * not an operation the API has. Editing the tag of one clip is, and that is
 * what this is. Do not build a UI that implies otherwise.
 */
export interface TagRename {
  /** The tag currently on the clip. */
  readonly tag: Tag;
  /** What it becomes. */
  readonly newTag: Tag;
}
