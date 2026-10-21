import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { User } from '../database/entities/User.entity';
import { AuthService } from './auth.service';
import { requireBearer } from './bearer';

/** What the guard attaches for `@CurrentAdmin()` to read back. */
export interface AdminRequest extends Request {
  adminUser?: User;
}

const MISSING_TOKEN = 'Missing admin session token.';

/**
 * The gate on every `/api/admin/*` route. There is no second guard and no role
 * system: a `user` row is an admin, full stop.
 *
 * ⚠️ **It reads exactly one header, `Authorization`.** In particular it does
 * NOT look at `X-Voter-Token` — the anonymous per-browser UUID the public
 * write endpoints use for deduplication. That token is client-generated,
 * unsigned and trivially forged; treating it as identity anywhere in here would
 * hand the delete endpoints to anyone who can set a header. `admin.guard.spec`
 * asserts a request carrying only a voter token is refused.
 *
 * Every failure is the same 401, resolved through `AuthService` so that "what
 * is a valid admin token" has one answer rather than one per route.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const token = requireBearer(request.headers.authorization, MISSING_TOKEN);
    // Verifies the signature AND re-reads the account, so a deleted user's
    // still-unexpired token stops working.
    request.adminUser = await this.authService.resolveAdmin(token);
    return true;
  }
}
