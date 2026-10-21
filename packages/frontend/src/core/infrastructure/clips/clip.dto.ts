import { z } from 'zod';

/**
 * ⚠️ Deliberately NARROW and hand-written, like `tags/tag.dto.ts`: only the
 * fields this app consumes. A backend that adds one never breaks the client; a
 * backend that changes one we read fails loudly here instead of surfacing as
 * `undefined` three layers up.
 */

export const clipEpisodeSchema = z.object({
  id: z.number(),
  title: z.string(),
  cover: z.string(),
  file: z.string(),
  originalUrl: z.string(),
  // ⚠️ Coerced, not merely typed. The wire carries a UTC ISO-8601 string and
  // the domain wants an instant; `z.coerce.date()` does both, and rejects a
  // string that parses to Invalid Date — which would otherwise reach a view as
  // "NaN de NaN" instead of an error anyone can act on.
  date: z.coerce.date(),
});

/**
 * ⚠️ The wire shape of a tag is `{ clipId, tag }`, and `clipId` is dropped on
 * purpose: it only ever repeats the id of the clip the tag hangs off, and the
 * domain's `Tag` is the string itself (`domain/tags/tag.entity.ts`).
 */
export const clipTagSchema = z.object({ tag: z.string() });

export const clipSchema = z.object({
  id: z.number(),
  title: z.string(),
  start: z.number(),
  end: z.number(),
  episode: clipEpisodeSchema,
  tags: z.array(clipTagSchema),
  // ⚠️ Required: the permalink needs the count for its vote button. Declaring it
  // required is the point — a backend that omits it must fail here rather than
  // render `undefined` as a zero.
  up: z.number(),
});

/**
 * ⚠️ The list rows additionally carry `points`, the sort key, and
 * `GET /clips/:id` does not. Two schemas rather than one with an optional
 * field: parsing a permalink response against this one must fail, loudly.
 *
 * ⚠️ No `down` anywhere: every vote is positive.
 */
export const clipListItemSchema = clipSchema.extend({
  points: z.number(),
});

/** `GET /clips/:id/related` — a bare array of library rows, no envelope. */
export const relatedClipsResponseSchema = z.array(clipListItemSchema);

export const clipListResponseSchema = z.object({
  total: z.number(),
  results: z.array(clipListItemSchema),
});

/**
 * ⚠️ The repeated-vote answer arrives HERE, not as an HTTP error: an ordinary
 * 201 whose `error` is `'you have already voted'`. `add` and `delete` are the
 * values the server stored and removed, which is what the card's counters are
 * adjusted by.
 */
export const voteResponseSchema = z.object({
  add: z.number(),
  delete: z.number(),
  error: z.string().nullable(),
});

export const clipTagResponseSchema = clipTagSchema;

export type ClipDto = z.infer<typeof clipSchema>;
export type ClipListItemDto = z.infer<typeof clipListItemSchema>;
export type ClipTagDto = z.infer<typeof clipTagSchema>;
export type VoteResponseDto = z.infer<typeof voteResponseSchema>;
