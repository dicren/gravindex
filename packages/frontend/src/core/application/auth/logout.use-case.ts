import type { AdminTokenStore } from '#/domain/auth/admin-token.store';

/**
 * Forget the credential.
 *
 * ⚠️ **Purely local, and there is no endpoint to call.** The backend issues
 * stateless JWTs with a 12 h life and keeps no session table, so "log out"
 * genuinely means "drop the string" — a round trip would be theatre, and one
 * that could *fail* and leave the token on the machine. The token remains
 * technically valid on the server until it expires; what makes logging out real
 * is that this browser no longer has it.
 *
 * ⚠️ It is also the recovery path for an expired session, which is why it never
 * throws: whatever went wrong, ending up with no token is the correct state.
 */
export class LogoutUseCase {
  constructor(private readonly adminTokenStore: AdminTokenStore) {}

  execute(): void {
    this.adminTokenStore.clear();
  }
}
