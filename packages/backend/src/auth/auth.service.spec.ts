import { EntityRepository } from '@mikro-orm/postgresql';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '../database/entities/User.entity';
import { ADMIN_TOKEN_TTL, AuthService } from './auth.service';

// Throwaway values. ⚠️ This repository is public: nothing here may resemble a
// real secret or a real password.
const SECRET = 'unit-test-signing-key';
const OTHER_SECRET = 'a-different-unit-test-signing-key';
const PASSWORD = 'correct horse battery staple';

/**
 * ⚠️ No database. `AuthService`'s only persistence is one `findOne`, so it is
 * stubbed — the round trip against real rows is `admin.spec.ts`'s job. A spec that boots a live
 * database just to assert `toBeDefined()` protects nothing.
 */
function repositoryOf(users: User[]): EntityRepository<User> {
  return {
    findOne: (where: { username?: string; id?: number }) =>
      Promise.resolve(
        users.find(
          (user) =>
            (where.username === undefined || user.username === where.username) &&
            (where.id === undefined || user.id === where.id),
        ) ?? null,
      ),
    // Not `any`: a deliberately narrow stub, widened once, at the seam.
  } as unknown as EntityRepository<User>;
}

/** The error a promise rejected with, or a failure saying it did not reject. */
async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  let caught: Error | undefined;
  await promise.catch((error: Error) => {
    caught = error;
  });
  if (!caught) throw new Error('expected the promise to reject, but it resolved');
  return caught;
}

describe('AuthService', () => {
  const jwtService = new JwtService({
    secret: SECRET,
    signOptions: { expiresIn: ADMIN_TOKEN_TTL },
  });
  let admin: User;
  let service: AuthService;

  beforeAll(async () => {
    admin = new User();
    admin.id = 1;
    admin.username = 'admin';
    admin.passwordHash = await new AuthService(jwtService, repositoryOf([])).hashPassword(PASSWORD);
    service = new AuthService(jwtService, repositoryOf([admin]));
  }, 30_000);

  describe('tokens', () => {
    it('issues a token that resolves back to the account', async () => {
      const token = service.issueAdminToken(admin);

      expect(service.verifyAdminToken(token)).toMatchObject({
        sub: 1,
        username: 'admin',
        scope: 'admin',
      });
      await expect(service.resolveAdmin(token)).resolves.toBe(admin);
    });

    it('stamps an expiry on every token it issues', () => {
      // The lifetime is a module-level `signOptions` default precisely so a
      // `sign()` that forgets it still expires. If this ever comes back
      // undefined, tokens have become eternal.
      const payload = jwtService.decode<{ exp?: number; iat?: number }>(
        service.issueAdminToken(admin),
      );

      expect(payload.exp).toBeDefined();
      expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(12 * 60 * 60);
    });

    it('rejects a token signed with another key', () => {
      const forged = new JwtService({ secret: OTHER_SECRET }).sign({
        sub: 1,
        username: 'admin',
        scope: 'admin',
      });

      expect(() => service.verifyAdminToken(forged)).toThrow(UnauthorizedException);
    });

    it('rejects an expired token', () => {
      const stale = jwtService.sign(
        { sub: 1, username: 'admin', scope: 'admin' },
        // Seconds, in the past. Nothing to wait for.
        { expiresIn: -1 },
      );

      expect(() => service.verifyAdminToken(stale)).toThrow(UnauthorizedException);
    });

    // The discriminator that stops a future second token type — signed with the
    // same key, for some other purpose — from opening the admin surface.
    it('rejects a correctly signed token that is not admin-scoped', () => {
      const wrongScope = jwtService.sign({ sub: 1, username: 'admin', scope: 'something-else' });

      expect(() => service.verifyAdminToken(wrongScope)).toThrow(UnauthorizedException);
    });

    it('rejects a valid token whose account no longer exists', async () => {
      const orphaned = service.issueAdminToken(admin);
      const withoutTheUser = new AuthService(jwtService, repositoryOf([]));

      await expect(withoutTheUser.resolveAdmin(orphaned)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('credentials', () => {
    it('accepts the right password', async () => {
      await expect(service.validateCredentials('admin', PASSWORD)).resolves.toBe(admin);
    });

    it('refuses a wrong password and an unknown user with the same message', async () => {
      const wrong = await rejectionOf(service.validateCredentials('admin', 'not it'));
      const unknown = await rejectionOf(service.validateCredentials('nobody', PASSWORD));

      expect(wrong).toBeInstanceOf(UnauthorizedException);
      expect(unknown).toBeInstanceOf(UnauthorizedException);
      expect(unknown.message).toBe(wrong.message);
    });

    /**
     * ⚠️ The response body being identical is not enough: an early return on
     * "no such user" answers in microseconds while a real comparison costs
     * ~100 ms at bcrypt cost 10, and that difference alone enumerates accounts.
     *
     * Asserted by the clock rather than by spying on `bcrypt.compare`: under
     * `esModuleInterop` the namespace import is a frozen re-export wrapper, so
     * `jest.spyOn` on it either fails or patches a copy the service never
     * calls. The elapsed time is the property that actually matters anyway.
     * The floor is a fifth of the real cost, so it fails only if the compare is
     * genuinely skipped.
     */
    it('pays the same bcrypt cost for an unknown username', async () => {
      const start = Date.now();
      await service.validateCredentials('nobody-at-all', PASSWORD).catch(() => undefined);
      const unknownUserCost = Date.now() - start;

      expect(unknownUserCost).toBeGreaterThan(20);
    });
  });
});
