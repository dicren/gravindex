import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { User } from '../database/entities/User.entity';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { AuthController } from './auth.controller';
import { ADMIN_TOKEN_TTL, AuthService } from './auth.service';

/**
 * The admin surface: a `user` table, a login endpoint, a guard, and the
 * delete/edit routes under `/api/admin`.
 *
 * ⚠️ Two controllers on purpose. `AuthController` serves the single PUBLIC
 * route (`POST /api/auth/login`); `AdminController` carries the class-level
 * `AdminGuard` and everything behind it. A route added to the wrong file is
 * then a visible mistake rather than an invisible hole.
 *
 * ⚠️ It touches `clip`, `tag`, `vote` and `playback` through the shared
 * `EntityManager` and imports nothing from `api/clips` or `api/tags` — those
 * own the public contract and this one does not share it.
 */
@Module({
  imports: [
    // Only `User` needs a repository; everything else goes through the
    // `EntityManager`, which `MikroOrmCoreModule` exports globally.
    MikroOrmModule.forFeature([User]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        // ⚠️ **Refuse to boot rather than invent a default.** A signing key
        // that falls back to a constant is a key everyone with the repository
        // knows, and this repository is public — an attacker could mint their
        // own admin token. Failing here is loud, happens at startup, and is
        // fixed by one line in `.env`.
        if (!secret) {
          throw new Error(
            'JWT_SECRET is not set. The admin surface cannot sign tokens without it — ' +
              'add it to the root `.env` (see `.env.example`).',
          );
        }
        // ⚠️ `expiresIn` is a LITERAL, not a config lookup: `@nestjs/jwt`
        // types it as `ms`'s `StringValue` template-literal union, which a
        // plain `string` off `ConfigService` is not assignable to. The honest
        // resolution is a literal rather than a cast — a cast would let `.env`
        // ship `"twelve hours"` into an option that then silently does
        // nothing. See `ADMIN_TOKEN_TTL` for why 12 h.
        //
        // Set here rather than at each `sign()` so the default is "expires",
        // and a call site that forgets cannot mint an eternal token.
        return { secret, signOptions: { expiresIn: ADMIN_TOKEN_TTL } };
      },
    }),
  ],
  controllers: [AuthController, AdminController],
  providers: [AuthService, AdminService, AdminGuard],
  exports: [AuthService],
})
export class AuthModule {}
