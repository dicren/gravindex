import { InjectRepository } from '@mikro-orm/nestjs';
import { EntityRepository } from '@mikro-orm/postgresql';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { User } from '../database/entities/User.entity';
import { AdminTokenPayload } from './admin-token.payload';

// The cost factor `scripts/hash-password.ts` prints with — the hand-written
// bootstrap INSERT and this service have to agree, or the first login fails for
// a reason nobody can see.
// ⚠️ bcrypt reads the cost out of the hash itself when verifying, so raising
// this number does not invalidate existing rows; it only affects new hashes.
const BCRYPT_SALT_ROUNDS = 10;

/**
 * ⚠️ ONE message for every way a login can fail — unknown username, wrong
 * password, a row whose `password_hash` was inserted in plaintext. A different
 * 404/401 per case would turn the endpoint into a user-enumeration oracle, and
 * this system has a handful of accounts and no rate limiting in front of it
 * (root AGENTS.md: rate limiting was deferred with the proxy).
 */
const INVALID_CREDENTIALS = 'Invalid username or password.';

/**
 * How long an admin session lasts.
 *
 * ⚠️ A literal, not a `ConfigService` lookup: `@nestjs/jwt` types `expiresIn`
 * as `ms`'s `StringValue` template-literal union (`'12h'`, `'7d'`, …), which a
 * plain `string` off the config is not assignable to — and the honest fix is a
 * literal, not a cast that would let `.env` ship `"twelve hours"` into a
 * silently-ignored option.
 *
 * 12 h is a deliberate expiry, not "until the browser is cleared": the token
 * is the only credential that can delete community data. There is no refresh
 * flow and no revocation list — logging in again is the whole recovery story,
 * and deleting the `user` row stops every token within one lookup because the
 * guard re-reads the account on every request.
 */
export const ADMIN_TOKEN_TTL = '12h';

/**
 * The whole authentication surface of this application: hash a password, check
 * one, mint an admin JWT, resolve one back to a live account.
 *
 * Built from two libraries, `bcrypt` and `@nestjs/jwt`, with a single token
 * type, because there is a single kind of authenticated caller here.
 */
@Injectable()
export class AuthService {
  /**
   * A hash of a value nobody knows, compared against when the username does not
   * exist.
   *
   * ⚠️ It is what makes the failure paths cost the same. `bcrypt.compare` is
   * deliberately slow (~100 ms at cost 10); an early `return` on "no such user"
   * would answer in under a millisecond and tell an attacker exactly which
   * usernames are real, no matter how identical the response body is.
   *
   * Generated per process from a random UUID rather than hard-coded: this
   * repository is public, and a committed hash is a committed (if worthless)
   * secret. The ~100 ms it costs at boot is paid once.
   */
  private readonly decoyHash = bcrypt.hashSync(randomUUID(), BCRYPT_SALT_ROUNDS);

  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(User)
    private readonly userRepository: EntityRepository<User>,
  ) {}

  hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  }

  comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Username + password → the account, or a 401 that says nothing else.
   *
   * @throws {UnauthorizedException}
   */
  async validateCredentials(username: string, password: string): Promise<User> {
    const user = await this.userRepository.findOne({ username });
    // ⚠️ Always compare, even with no user — see `decoyHash`. Do not "optimise"
    // this into an early return.
    const matches = await this.comparePassword(password, user?.passwordHash ?? this.decoyHash);
    if (!user || !matches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    return user;
  }

  issueAdminToken(user: User): string {
    const payload: AdminTokenPayload = {
      sub: user.id,
      username: user.username,
      scope: 'admin',
    };
    // ⚠️ No per-call `expiresIn`. The lifetime is a module-level
    // `signOptions` default (see `auth.module.ts`), so a `sign()` added later
    // and forgetting it still produces an expiring token — the reverse would
    // mint an eternal one.
    return this.jwtService.sign(payload);
  }

  /**
   * A signed, unexpired, admin-scoped token — or a 401. Signature checking
   * only; whether the account still exists is `resolveAdmin`'s question.
   *
   * @throws {UnauthorizedException}
   */
  verifyAdminToken(token: string): AdminTokenPayload {
    let payload: AdminTokenPayload;
    try {
      payload = this.jwtService.verify<AdminTokenPayload>(token);
    } catch {
      // Malformed, wrongly signed and expired all collapse into one answer:
      // the client's reaction is the same (log in again) and the distinction
      // only helps someone probing the secret.
      throw new UnauthorizedException('Invalid or expired session token.');
    }
    if (payload.scope !== 'admin') {
      throw new UnauthorizedException('Invalid or expired session token.');
    }
    return payload;
  }

  /**
   * The token's account, re-read from the database on every request.
   *
   * ⚠️ The extra `findOne` is the point, not overhead: with no revocation list,
   * deleting the `user` row is the ONLY way to kill a token that is still
   * within its 12 h, and that only works if the guard asks.
   *
   * @throws {UnauthorizedException}
   */
  async resolveAdmin(token: string): Promise<User> {
    const payload = this.verifyAdminToken(token);
    const user = await this.userRepository.findOne({ id: payload.sub });
    if (!user) {
      throw new UnauthorizedException('Invalid or expired session token.');
    }
    return user;
  }
}
