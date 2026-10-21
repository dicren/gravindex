import { AdminSessionExpiredError } from '#/domain/auth/admin-session-expired.error';
import type { RestoreSessionOutcome } from '#/domain/auth/admin-session.entity';
import type { AdminTokenStore } from '#/domain/auth/admin-token.store';
import type { AuthRepository } from '#/domain/auth/auth.repository';

/**
 * "Is whoever opened this tab still logged in?" — run once per page load,
 * before any admin screen is allowed to render.
 *
 * ⚠️ **The three-way answer is the whole point of this file.** A token that
 * could not be *checked* is not a token that was *rejected*:
 *
 * - **no token** → `anonymous`, with no request at all. Nothing to prove.
 * - **the server refused it** (`AdminSessionExpiredError`, i.e. a 401: expired
 *   after its 12 h, or its `user` row deleted) → the token is **erased here**
 *   and the answer is `anonymous`. Erasing it is what stops every subsequent
 *   navigation from re-asking a question already answered.
 * - **the server never answered** (offline, timeout, 5xx) → `unverified`, and
 *   ⚠️ **the token is kept**. Throwing away a working credential because the
 *   wifi blinked would be a bug the admin experiences as a random logout.
 *
 * ⚠️ Nothing else may be swallowed. A `ValidationError` or an
 * `UnexpectedResponseError` from the probe means the contract moved, and
 * reporting that as "you are logged out" would hide it — so only the two cases
 * above are interpreted, and everything else is `unverified` by the same
 * reasoning: we did not learn that the credential is bad.
 */
export class RestoreSessionUseCase {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly adminTokenStore: AdminTokenStore,
  ) {}

  async execute(): Promise<RestoreSessionOutcome> {
    if (this.adminTokenStore.read() === null) {
      return { status: 'anonymous' };
    }

    try {
      return { status: 'authenticated', identity: await this.authRepository.probe() };
    } catch (error) {
      if (error instanceof AdminSessionExpiredError) {
        this.adminTokenStore.clear();
        return { status: 'anonymous' };
      }
      return { status: 'unverified' };
    }
  }
}
