import { UnauthorizedException } from '@nestjs/common';

/**
 * The one way to pull a bearer token out of an `Authorization` header.
 *
 * It exists so that the same header cannot authenticate one route while being
 * invisible to another: one parser, one answer.
 *
 * ⚠️ Matching is case-insensitive (RFC 7235 defines the scheme token as such)
 * and the token is trimmed.
 */
const BEARER_PATTERN = /^Bearer[ \t]+(.+)$/i;

/** The token, or `undefined` when the header is absent, malformed or empty. */
export function bearerFrom(header: string | undefined): string | undefined {
  const token = header?.match(BEARER_PATTERN)?.[1]?.trim();
  return token ? token : undefined;
}

/**
 * The token, or a 401. Every route that uses it exists only for an
 * authenticated caller, so the absence *is* the failure.
 *
 * @throws {UnauthorizedException}
 */
export function requireBearer(header: string | undefined, message: string): string {
  const token = bearerFrom(header);
  if (!token) throw new UnauthorizedException(message);
  return token;
}
