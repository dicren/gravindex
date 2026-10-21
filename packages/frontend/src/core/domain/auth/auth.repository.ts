import type { AdminCredentials, AdminIdentity, AdminSession } from './admin-session.entity';

/**
 * Port implemented by `infrastructure/auth/auth-http.repository.ts`.
 *
 * Two operations and one rule between them: `login` is the only place in the
 * whole application where a password exists, and `probe` is the only way to
 * find out whether a token still works.
 */
export interface AuthRepository {
  /**
   * Exchange a username and a password for a token.
   *
   * ⚠️ A refusal here is an ordinary `RequestRejectedError`, **never** an
   * `AdminSessionExpiredError`: nothing expired, the session never started.
   *
   * ⚠️ The backend answers an unknown user and a wrong password with the same
   * body, the same status **and the same elapsed time** (it hashes against a
   * decoy). That is deliberate — the endpoint must not reveal which accounts
   * exist — and the UI above must not undo it by telling the two apart.
   */
  login(credentials: AdminCredentials): Promise<AdminSession>;

  /**
   * "Is the token this browser has been keeping still good?" — `GET /api/admin/me`.
   *
   * ⚠️ Rejects with `AdminSessionExpiredError` when the server says no. It is
   * the only honest answer available: a 12 h token can expire, and deleting the
   * `user` row invalidates one immediately, neither of which the client can see
   * by looking at the string it holds.
   */
  probe(): Promise<AdminIdentity>;
}
