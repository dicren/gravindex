import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { User } from '../database/entities/User.entity';
import { AdminRequest } from './admin.guard';

/**
 * Reads the account `AdminGuard` resolved for this request.
 *
 * ⚠️ Only valid on a route that actually carries `@UseGuards(AdminGuard)`. It
 * throws rather than returning `undefined` when the guard did not run, so
 * forgetting the guard is a loud 401 on the first request instead of a handler
 * quietly acting on nobody.
 *
 * A route that needs the caller must take it from here and never re-resolve
 * the token: two resolutions are two answers to "who is this".
 */
export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): User => {
  const request = ctx.switchToHttp().getRequest<AdminRequest>();
  if (!request.adminUser) {
    throw new UnauthorizedException('Missing admin session token.');
  }
  return request.adminUser;
});
