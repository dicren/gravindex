import type { AdminCredentials, AdminSession } from '#/domain/auth/admin-session.entity';
import type { AdminTokenStore } from '#/domain/auth/admin-token.store';
import type { AuthRepository } from '#/domain/auth/auth.repository';
import { ValidationError } from '#/domain/errors';

/**
 * Log in, and keep the credential.
 *
 * ⚠️ **Storing the token is part of logging in, and belongs here.** Splitting
 * "get a token" from "remember it" would leave a window in which the app is
 * authenticated in memory and not on disk, and would make every caller
 * responsible for a step it must never forget. One use case, one outcome.
 *
 * ⚠️ The two checks below are the backend's own (`LoginDto`: non-empty, bounded)
 * and nothing more. In particular there is **no** client-side test of whether
 * the username exists or the password looks right — the whole point of the
 * endpoint's decoy hash is that this client cannot tell, and must not appear to.
 */
export class LoginUseCase {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly adminTokenStore: AdminTokenStore,
  ) {}

  // `async` so a rejected rule arrives as a rejected promise, like every other
  // failure — see `clips/create-clip.use-case.ts`.
  async execute(credentials: AdminCredentials): Promise<AdminSession> {
    if (credentials.username.trim() === '') {
      throw new ValidationError('A login needs a username.');
    }
    if (credentials.password === '') {
      throw new ValidationError('A login needs a password.');
    }

    const session = await this.authRepository.login(credentials);
    this.adminTokenStore.write(session.token);
    return session;
  }
}
