import { z } from 'zod';
import { clipEpisodeSchema, clipTagSchema } from '#/infrastructure/clips/clip.dto';

/**
 * Narrow, hand-written, and reusing the clips feature's schemas where the wire
 * really is the same shape — an episode inside a clip and an episode on its own
 * are the same six fields, and a tag is `{ clipId, tag }` in both places.
 * Copying them would mean two definitions drifting apart on the next backend
 * change.
 */
export const episodeSchema = clipEpisodeSchema;

/**
 * ⚠️ A row of `GET /episodes` carries `clipCount` and the same episode inside a
 * clip does not — the count is a property of the LIST, not of an episode. The
 * episode rows print `7 cortes` / `sin cortes` and filter on it.
 */
export const episodeListItemSchema = episodeSchema.extend({ clipCount: z.number() });

export const episodeListResponseSchema = z.object({
  total: z.number(),
  results: z.array(episodeListItemSchema),
});

/**
 * ⚠️ A clip inside an episode carries `up` but **no `points`** and no episode of
 * its own. That is narrower than a `GET /clips` row and the asymmetry is
 * deliberate, so this is its own schema rather than a loosened copy of
 * `clipListItemSchema`.
 */
export const episodeClipSchema = z.object({
  id: z.number(),
  title: z.string(),
  start: z.number(),
  end: z.number(),
  tags: z.array(clipTagSchema),
  up: z.number(),
});

export const episodeDetailSchema = episodeSchema.extend({
  clips: z.array(episodeClipSchema),
});

/**
 * `GET /episodes/:id/waveform`. `peaks` stays a base64 STRING at this layer —
 * decoding it into bytes is `episode.mapper.ts`'s job, same as every other
 * wire-shape-to-entity step.
 */
export const episodeWaveformSchema = z.object({
  from: z.number(),
  to: z.number(),
  points: z.number(),
  peaks: z.string(),
});

export type EpisodeDto = z.infer<typeof episodeSchema>;
export type EpisodeListItemDto = z.infer<typeof episodeListItemSchema>;
export type EpisodeClipDto = z.infer<typeof episodeClipSchema>;
export type EpisodeDetailDto = z.infer<typeof episodeDetailSchema>;
export type EpisodeWaveformDto = z.infer<typeof episodeWaveformSchema>;
