import { AdminSessionExpiredError } from '#/domain/auth/admin-session-expired.error';
import type {
  AdminCredentials,
  AdminIdentity,
  AdminSession,
} from '#/domain/auth/admin-session.entity';
import type { AdminTokenStore } from '#/domain/auth/admin-token.store';
import type { AuthRepository } from '#/domain/auth/auth.repository';
import { adminControllerMe, authControllerLogin } from '#/infrastructure/generated';
import { assertResponseOk, translateHttpError } from '#/infrastructure/http/translate-http-error';
import { adminIdentitySchema, loginResponseSchema } from './auth.dto';

/**
 * Login and the session probe. Same four steps as every adapter: call the
 * generated operation → reject a non-2xx → parse with a narrow schema → return
 * entities. No URL is written by hand.
 *
 * ⚠️ **The credential is injected, never read from storage inline** — an
 * `AdminTokenStore` in the constructor, wired in `config/auth.config.ts`,
 * exactly as `ClipHttpRepository` takes the anonymous voter token provider.
 * That symmetry is deliberate and so is the separation: this file names the
 * `Authorization` header and nothing else, and it must never reach for
 * `VoterTokenProvider`, `VOTER_TOKEN_HEADER`, or the `gravindex.voter-token`
 * key. An anonymous deduplication hint is not a credential, the backend has a
 * test asserting it is refused as one, and a client that tried would be
 * shipping a bug it could not see.
 */
export class AuthHttpRepository implements AuthRepository {
  constructor(private readonly adminTokenStore: AdminTokenStore) {}

  async login(credentials: AdminCredentials): Promise<AdminSession> {
    try {
      const {
        data,
        error: failure,
        response,
      } = await authControllerLogin({
        body: { username: credentials.username, password: credentials.password },
      });
      // ⚠️ Plain `assertResponseOk`, with NO 401 special case. A refused login
      // is a `RequestRejectedError` like any other refusal: nothing expired,
      // the session never started, and turning it into
      // `AdminSessionExpiredError` would make the login screen try to send
      // itself back to the login screen.
      assertResponseOk(response, failure);

      const parsed = loginResponseSchema.parse(data);
      return { token: parsed.accessToken, username: parsed.username };
    } catch (error) {
      throw translateHttpError(error);
    }
  }

  async probe(): Promise<AdminIdentity> {
    try {
      const token = this.adminTokenStore.read();
      // ⚠️ Answered without a round trip. "No token" is already the answer the
      // probe would come back with, and asking would spend a request to be told
      // something this browser knows.
      if (token === null) {
        throw new AdminSessionExpiredError('There is no admin token in this browser.');
      }

      const { data, error: failure, response } = await adminControllerMe({ auth: () => token });

      // ⚠️ Checked BEFORE `assertResponseOk`, which flattens every 4xx into a
      // refusal to be shown as-is. A 401 here is the ONE thing this call exists
      // to detect, and the app reacts to it by ending the session rather than
      // by printing a message.
      if (response?.status === 401) {
        throw new AdminSessionExpiredError();
      }
      assertResponseOk(response, failure);

      return adminIdentitySchema.parse(data);
    } catch (error) {
      throw translateHttpError(error);
    }
  }
}
