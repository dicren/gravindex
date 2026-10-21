import { AdminSessionExpiredError } from '#/domain/auth/admin-session-expired.error';
import type { AdminClip, AdminClipChanges, TagRename } from '#/domain/auth/admin-clip.entity';
import type { AdminRepository } from '#/domain/auth/admin.repository';
import type { AdminToken } from '#/domain/auth/admin-session.entity';
import type { AdminTokenStore } from '#/domain/auth/admin-token.store';
import { assertResponseOk, translateHttpError } from '#/infrastructure/http/translate-http-error';
import {
  adminControllerDeleteClip,
  adminControllerDeleteTag,
  adminControllerGetClip,
  adminControllerRenameTag,
  adminControllerUpdateClip,
} from '#/infrastructure/generated';
import type { Tag } from '#/domain/tags/tag.entity';
import { adminClipSchema } from './auth.dto';

/**
 * The moderation adapter: read, edit and delete a clip, rename and remove its
 * tags. Every call carries the admin JWT and nothing else.
 *
 * ⚠️ **The token is attached per request, not globally.** The generated client
 * would happily take an `auth` callback in its shared config, and that would
 * silently put a credential in reach of every operation in the app. Passing it
 * here means the `Authorization` header exists on exactly the five calls in
 * this file, and a public screen physically cannot send one.
 *
 * ⚠️ **The anonymous voter token appears nowhere in this file, by design.** It
 * is a client-supplied, spoofable deduplication hint for votes; no admin route
 * trusts it, the backend has a test proving one carrying only a voter token is
 * refused, and this client must never be what attempts it. Different header,
 * different storage, different adapter — see
 * `domain/auth/admin-session.entity.ts`.
 *
 * ⚠️ **A tag travels in a body or a query string, never a path segment.** Tags
 * are free text; one containing a `/` in a path would not be a route with a
 * funny parameter, it would be a 404 — or worse, a different route. The
 * generated serializer percent-encodes the query value, which is the whole
 * contract on this side.
 */
export class AdminHttpRepository implements AdminRepository {
  constructor(private readonly adminTokenStore: AdminTokenStore) {}

  async getClip(clipId: number, signal?: AbortSignal): Promise<AdminClip> {
    try {
      const auth = this.requireToken();
      const {
        data,
        error: failure,
        response,
      } = await adminControllerGetClip({ path: { id: clipId }, auth, signal });
      assertAdminResponseOk(response, failure);
      return adminClipSchema.parse(data);
    } catch (error) {
      throw translateHttpError(error, signal);
    }
  }

  async updateClip(clipId: number, changes: AdminClipChanges): Promise<AdminClip> {
    try {
      const auth = this.requireToken();
      const {
        data,
        error: failure,
        response,
      } = await adminControllerUpdateClip({
        path: { id: clipId },
        // ⚠️ Passed through with its `undefined`s: the serializer drops them,
        // so an untouched field is genuinely absent from the body rather than
        // sent as `null` — which the validation pipe would refuse.
        body: { title: changes.title, start: changes.start, end: changes.end },
        auth,
      });
      assertAdminResponseOk(response, failure);
      return adminClipSchema.parse(data);
    } catch (error) {
      throw translateHttpError(error);
    }
  }

  async deleteClip(clipId: number): Promise<void> {
    try {
      const auth = this.requireToken();
      const { error: failure, response } = await adminControllerDeleteClip({
        path: { id: clipId },
        auth,
      });
      assertAdminResponseOk(response, failure);
      // 204, no body. Nothing to parse, and inventing something to validate
      // would only give a successful deletion a way to fail.
    } catch (error) {
      throw translateHttpError(error);
    }
  }

  async renameTag(clipId: number, rename: TagRename): Promise<AdminClip> {
    try {
      const auth = this.requireToken();
      const {
        data,
        error: failure,
        response,
      } = await adminControllerRenameTag({
        path: { id: clipId },
        // ⚠️ Both tags in the BODY. See the class note.
        body: { tag: rename.tag, newTag: rename.newTag },
        auth,
      });
      assertAdminResponseOk(response, failure);
      return adminClipSchema.parse(data);
    } catch (error) {
      throw translateHttpError(error);
    }
  }

  async removeTag(clipId: number, tag: Tag): Promise<void> {
    try {
      const auth = this.requireToken();
      const { error: failure, response } = await adminControllerDeleteTag({
        path: { id: clipId },
        // ⚠️ The tag in the QUERY STRING. See the class note.
        query: { tag },
        auth,
      });
      assertAdminResponseOk(response, failure);
    } catch (error) {
      throw translateHttpError(error);
    }
  }

  /**
   * The token, as the callback the generated client's `security` array expects.
   *
   * ⚠️ Refuses to make the request at all when there is none, rather than
   * sending `Bearer undefined` and letting the server answer 401. Same outcome
   * for the app — the session is over — one round trip cheaper, and the error
   * says what actually happened.
   */
  private requireToken(): () => AdminToken {
    const token = this.adminTokenStore.read();
    if (token === null) {
      throw new AdminSessionExpiredError('There is no admin token in this browser.');
    }
    return () => token;
  }
}

/**
 * `assertResponseOk`, with 401 pulled out first.
 *
 * ⚠️ Every admin route answers 401 for one reason — the credential is missing,
 * expired (12 h) or belongs to a deleted user — and the app has to react to
 * that by ending the session, not by showing the server's sentence. Left to
 * `assertResponseOk` it would arrive as an ordinary `RequestRejectedError`,
 * indistinguishable from the 400 the validation pipe sends when a title is too
 * long, and the only way to tell them apart in `vue/` would be to read the
 * status — which is exactly what `core/domain/errors` exists to prevent.
 */
function assertAdminResponseOk(response: Response | undefined, errorBody?: unknown): void {
  if (response?.status === 401) {
    throw new AdminSessionExpiredError();
  }
  assertResponseOk(response, errorBody);
}
