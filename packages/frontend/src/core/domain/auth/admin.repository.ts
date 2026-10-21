import type { Tag } from '#/domain/tags/tag.entity';
import type { AdminClip, AdminClipChanges, TagRename } from './admin-clip.entity';

/**
 * Port implemented by `infrastructure/auth/admin-http.repository.ts` — the
 * moderation surface that did not exist before: today an ugly cut
 * or an abusive tag can only be removed with hand-written SQL against
 * production.
 *
 * ⚠️ **No method takes a token.** The credential is injected into the adapter
 * (an `AdminTokenStore` in its constructor, wired in `config/auth.config.ts`),
 * exactly as the anonymous voter token is injected into `ClipHttpRepository` —
 * so no use case, store or view ever holds a JWT in a variable and no call site
 * can accidentally pass the wrong one. Every method here rejects with
 * `AdminSessionExpiredError` when the server refuses the credential.
 *
 * ⚠️ **A tag travels in a body or a query string, never in a path segment.**
 * Tags are free text — 102 distinct ones in production, twelve with accents or
 * eñes — and nothing stops the next one containing a `/`, which would silently
 * be a different route. The backend's DTOs say the same thing in the same
 * words; keep it true on this side.
 */
export interface AdminRepository {
  /**
   * One clip, in the flat admin shape. Rejects `NotFoundError` if it is gone.
   *
   * ⚠️ The only read here, and so the only method that takes an `AbortSignal`.
   * The four below are writes: a moderation edit that vanished halfway would be
   * the worst possible thing to have to reason about (see `ClipRepository`).
   */
  getClip(clipId: number, signal?: AbortSignal): Promise<AdminClip>;

  /**
   * Edit a clip in place. Only the fields present in `changes` move.
   *
   * ⚠️ `end > start` is checked by the server against the **merged** result, so
   * a PATCH that sends only `start` can still be refused. That refusal arrives
   * as a `RequestRejectedError` carrying the server's own explanation, which is
   * the message the form must show.
   */
  updateClip(clipId: number, changes: AdminClipChanges): Promise<AdminClip>;

  /**
   * Delete a clip, permanently.
   *
   * ⚠️ **A hard delete, in a transaction: the votes, the plays and the tags go
   * with it, and the id is never reused.** Clip ids are public URLs — two of
   * them were removed by hand years ago and their permalinks still 404 — so a
   * deletion kills a link that may be shared somewhere nobody can see. There is
   * no undo and no recycle bin. Any UI calling this must say so before it does.
   */
  deleteClip(clipId: number): Promise<void>;

  /** Rename one tag on one clip. Rejects if the clip already carries `newTag`. */
  renameTag(clipId: number, rename: TagRename): Promise<AdminClip>;

  /** Take a tag off a clip. Rejects `NotFoundError` if it was not there. */
  removeTag(clipId: number, tag: Tag): Promise<void>;
}
