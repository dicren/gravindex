import { z } from 'zod';

/**
 * ⚠️ Deliberately NARROW and hand-written, like `clips/clip.dto.ts`: only the
 * fields this app consumes. A backend that adds one never breaks the client; a
 * backend that changes one we read fails loudly here instead of surfacing as
 * `undefined` three layers up.
 */

/**
 * `POST /api/auth/login`.
 *
 * ⚠️ `accessToken` is checked for being a **non-empty** string, and that is not
 * ceremony: an empty one would be stored, sent as `Bearer `, refused by every
 * admin route, and read by this client as "your session expired" one screen
 * later — a login that appears to succeed and then silently fails. Failing here
 * names the real problem.
 */
export const loginResponseSchema = z.object({
  accessToken: z.string().min(1),
  username: z.string(),
});

/** `GET /api/admin/me` — the "is this token still good?" probe. */
export const adminIdentitySchema = z.object({
  id: z.number(),
  username: z.string(),
});

/**
 * The admin clip shape, shared by `GET`, `PATCH` and the tag rename.
 *
 * ⚠️ Flat, and NOT the public clip: `episodeId` instead of a populated episode,
 * `tags` as plain strings instead of `{ clipId, tag }` rows, and no vote counts
 * at all. Parsing an admin response against `clipSchema` must fail, which is
 * why this is a second schema rather than a loosened first one.
 */
export const adminClipSchema = z.object({
  id: z.number(),
  title: z.string(),
  start: z.number(),
  end: z.number(),
  episodeId: z.number(),
  tags: z.array(z.string()),
});
